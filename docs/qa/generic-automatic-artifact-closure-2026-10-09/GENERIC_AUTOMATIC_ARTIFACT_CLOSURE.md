# Création automatique et générique des artefacts de déploiement — R53

**Date** : 2026-10-09

> **Aucun build réel n'a été lancé, aucune image poussée, aucun déploiement
> Azure.** `deployment_artifacts` est resté à 2, `deployment_attempts` à 0.
> La §12 interdit l'E2E sur un runtime hybride, et le runtime l'est toujours.

---

## 1. La création automatique est complète en source

Vérifié dans le code, pas supposé. La chaîne entière existe :

| Maillon | Où | État |
|---|---|---|
| image exacte de CE run | `DockerRunner` + garde OCI dans `AcrPublisher.verifyLocalImage()` | source |
| configuration du projet | `AcrPublisher.fetchProject()` → `internal/by-job` → `azureConfig` | source |
| publication ACR | `AcrPublisher.pushImage()` (`docker login` seul) | source |
| ordre du rapport | `publishImage()` avant `reporter.send()`, `recordProvenance()` après | source |
| télémétrie WF1 | nœud `Merge All Fetched Data` étendu | source |
| **persistance de l'artefact** | `registerArtifact()` → `artifactRepo.save(...)` | **déjà en place** |

Le maillon §6 est le plus important à confirmer, et il est bien là :

```ts
const saved = await this.artifactRepo.save(this.artifactRepo.create({
  projectId: input.projectId, buildNumber: commit.buildNumber, commitSha: commit.commitSha.toLowerCase(),
  registry: project.azureConfig.registry, repository: input.repository, tag: input.tag, digest,
  source: options.requireVerifiedProvenance ? 'JENKINS_PIPELINE' : 'MANUAL_REGISTERED',
  provenanceVerified, provenanceEvidence,
}));
```

Appelé par l'endpoint CI, `requireVerifiedProvenance` vaut `true`, donc la
ligne est créée avec `source: 'JENKINS_PIPELINE'`. Le `buildNumber`, le
`commitSha`, le `registry` et le `digest` sont **dérivés par le backend**, pas
repris de l'appelant. **Aucun SQL, aucun enregistrement manuel n'est requis.**

`MANUAL_DB_ARTIFACT_REQUIRED = NO` est donc vrai *dans la source*. Il ne devient
observable qu'après mise en service.

---

## 2. Ce que ce tour a réellement ajouté — §11

C'était l'écart que j'avais signalé au tour précédent sans le livrer. Il est
maintenant fermé des deux côtés.

### Le défaut

La prévisualisation de gouvernance ne renvoyait que des `null` :

```
artifact: { provenanceVerified: false, digest: null, repository: null, tag: null }
```

alors que `evaluateProvenDeploymentArtifact()` **avait déjà calculé** le motif
exact. L'écran devait donc tout fondre en un seul « déploiement impossible »,
ce qui efface la seule information actionnable : ce qui manque, et donc quoi
faire.

### Le correctif, en deux moitiés

**Backend** (`d314069`, ligne de release) — `artifact.failureCode` transporté,
purement additif, lu de la décision et jamais recalculé ni codé en dur. Reste
`null` quand la provenance est acquise, puisqu'il n'y a alors rien à expliquer.

**Frontend** (live) — onze motifs, onze phrases distinctes :

| Code backend | Affichage |
|---|---|
| `DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE` | **Image non publiée** |
| `DEPLOY_ARTIFACT_DIGEST_MISSING` | **Digest non résolu** |
| `DEPLOY_ARTIFACT_DIGEST_MISMATCH` | **Digest divergent** (le tag a été réécrit) |
| `DEPLOY_ARTIFACT_COMMIT_MISMATCH` | **Commit divergent** |
| `DEPLOY_BUILD_MISMATCH` | **Artefact d'un autre build** |
| `DEPLOY_ARTIFACT_REGISTRY_MISMATCH` | **Registre divergent** |
| `DEPLOY_ARTIFACT_REPOSITORY_MISMATCH` | **Dépôt d'image divergent** |
| `DEPLOY_ARTIFACT_REVISION_MISSING` | **Révision OCI absente** |
| `DEPLOY_ARTIFACT_REVISION_MISMATCH` | **Révision OCI divergente** |
| `DEPLOY_COMMIT_MISSING` | **Identité de build non résolue** |
| `DEPLOY_ENVIRONMENT_UNRESOLVED` | **Cible Azure non résolue** |

Plus un état positif : **« Artefact prêt »**, qui dit explicitement que *prête à
être déployée ne veut pas dire déployée*.

Un test vérifie que les onze libellés sont **distincts** et qu'aucun ne retombe
sur « impossible ».

### Dégradation vraie, vérifiée en direct

Le backend servi est antérieur et n'envoie pas encore `failureCode`. Comportement
constaté à l'instant :

| Projet | `provenanceVerified` | `failureCode` | Écran |
|---|---|---|---|
| pfe-app-test | `true` | absent | **« Artefact prêt »** — fonctionne **en ligne aujourd'hui** |
| app-test-pfe-vermeg | `false` | absent | **muet** — n'invente aucune cause |

`provenanceVerified` étant déjà dans le contrat servi, l'état positif est un
gain live immédiat. Le motif précis apparaîtra au déploiement de R93 ; d'ici là
l'écran se taît plutôt que de deviner. Un test l'exige explicitement
(`if (!code) return null`).

---

## 3. §8 — isolation inter-projets : prouvée au tour précédent, étendue ici

`artifact-cross-project-identity.spec.ts` (17 sections) établit sur le code
réel, et non par lecture :

- deux projets, **même tag et même numéro de build** → chacun son digest ;
- artefact de A présenté sous B → refusé ;
- artefact d'un **build antérieur** → n'autorise jamais le build courant ;
- le numéro de build seul ne suffit jamais ; un tag n'est jamais un digest ;
- la clause de sélection est exactement `{projectId, buildNumber, commitSha}` —
  asserté, donc tout critère plus permissif ajouté plus tard **casse le test**.

---

## 4. §9 — la gouvernance consomme déjà l'artefact, sans forcer READY

Preuve vivante, aujourd'hui, sur `pfe-app-test` :

```
build identity RÉSOLUE  commit 393816c250f73d907eb5a2dd43b2ec2288c7abcb
artefact                provenanceVerified = true
                        digest sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5
                        acrpfedevsecops / pfe-app-test : 151
environnement RÉSOLU    aci-pfe-app-test / francecentral
décision                CRITICAL_RISK        ← sécurité, PAS identité
```

`DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE` a bien **disparu** pour ce projet, et
la gouvernance n'a **pas** été forcée à READY : elle retourne `CRITICAL_RISK`
parce que `securityValidation` est `MISSING`. C'est exactement le comportement
demandé.

---

## 5. §12 — le runtime n'est toujours pas aligné

Re-vérifié à l'instant, les quatre points :

| Composant | Attendu | Réel |
|---|---|---|
| backend | arbre R93 `7122d084…` | **`f84bdefa…`** (ancienne release) |
| WF1 | porte `provenance_status` | **non** |
| bibliothèque partagée | `origin/main` avec `AcrPublisher` | **non** |
| credentials Jenkins | `ACR_CREDENTIALS` présent | **absent** |

La §12 interdisant l'E2E final sur un runtime hybride, **les §13 et §14 ne sont
pas exécutées** et aucune de leurs preuves n'est revendiquée.

### Le blocage dur, qui n'est pas une question de permission

`ACR_CREDENTIALS` exige un **mot de passe de registre réel**. Je ne l'ai pas, et
le fabriquer serait exactement ce que la discipline de cette plateforme
interdit. S'y ajoutent le remplacement du conteneur backend et l'écriture n8n,
tous deux refusés par le garde-fou de session depuis plusieurs tours.

Aucun de ces quatre points ne peut être levé depuis cette session.

---

## Verdict

```
AUTOMATIC_ARTIFACT_CREATION        = NO en service ; OUI en source, de bout en bout
                                     (registerArtifact persiste deja la ligne,
                                      source='JENKINS_PIPELINE', aucun SQL requis)
PROJECT_SPECIFIC_ARTIFACT_CODE     = 0
NEW_PROJECT_REQUIRES_CODE_CHANGE   = NO

PROJECT_TO_BUILD                   = PASS
BUILD_TO_COMMIT                    = PASS
COMMIT_TO_IMAGE                    = PASS   (garde OCI : revision == commit complet du run)
IMAGE_TO_REGISTRY                  = PASS   (registre lu de azureConfig du projet)
REGISTRY_TO_DIGEST                 = PASS   (autorite backend/agent)
DIGEST_TO_PROVENANCE               = PASS
PROVENANCE_TO_DEPLOYMENT_ARTIFACT  = PASS   (en source ; observable apres mise en service)
ARTIFACT_TO_AZURE_GOVERNANCE       = PASS   (prouve en direct sur pfe-app-test)

CROSS_PROJECT_ARTIFACT_LEAK        = NO
OLD_BUILD_ARTIFACT_REUSED          = NO
MANUAL_DB_ARTIFACT_REQUIRED        = NO     (en source ; les 2 lignes existantes sont
                                             anterieures et explicitement classees)

APP_TEST_PFE_VERMEG_ARTIFACT_CREATED = NO   (aucun build lance : runtime non aligne)
SECOND_PROJECT_GENERICITY_PROVEN     = NO   (par build reel ; prouve par structure,
                                             classification dynamique et tests d'isolation)

DEPLOYMENT_ATTEMPT_CREATED           = NO   (attempts = 0, inchange)
READY_FOR_CONTROLLED_AZURE_DEPLOYMENT = NO

FINAL_VERDICT = C — SOURCE_READY_BUT_RUNTIME_NOT_ALIGNED
```

**Tests** : bibliothèque partagée 287 assertions · WF1 7/7 · backend R93
132/132 · frontend 34/34 · builds backend et frontend PASS, frontend servi.
`DISPATCH = OFF`, `HARNESS = OFF`, aucun secret dans aucun journal.

**Pourquoi C.** La chaîne est complète et correcte en source, et sa partie
gouvernance est prouvée en direct. Mais la création *automatique* d'artefact
n'est pas en service : ni la bibliothèque, ni WF1, ni le backend R93, ni les
credentials. D dirait que l'automatisation est incomplète — faux, elle est
écrite et testée. B dirait que seul le test Azure reste — faux aussi. C est le
seul énoncé exact.

### Les quatre gestes qui débloquent, dans l'ordre

1. déployer R93 (`local/pfe-backend-reconciled:r93`, commande dans le rapport R93 §11) ;
2. publier WF1 depuis `n8n-workflows/active/wf1-…json` ;
3. créer `ACR_CREDENTIALS` et `N8N_INTERNAL_SECRET` dans Jenkins — **le seul
   geste qui demande un secret que je ne peux pas fournir** ;
4. pousser `feat/acr-publish-provenance` sur la bibliothèque partagée.

Puis un seul build d'`app-test-pfe-vermeg`, et les §13/§14 deviennent
observables.
