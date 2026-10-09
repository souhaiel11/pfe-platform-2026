# Chaîne générique projet → artefact → Azure — clôture R52

**Date** : 2026-10-09

> **Rien n'a été mis en service pendant cette phase.** Aucun build réel, aucun
> push d'image, aucun déploiement Azure, aucune ressource Azure modifiée.
> `deployment_attempts` est resté à 0.

---

## Phase 0 — CURRENT_STATE_MATRIX

Vérifié en direct, sans faire confiance aux rapports précédents.

| Élément | État réel | Live ou source ? |
|---|---|---|
| branche plateforme | `theme-vermeg-reconciled` @ `9ac336c`, 106 fichiers WIP non commités | — |
| `origin/theme-vermeg-reconciled` | `206a8a7` | rien n'a été poussé |
| branche R93 | `release/backend-source-reconciliation-r93` @ `1e1de20` | **source seulement** |
| **pfe-backend en cours** | image `ca111a80…`, `platform.source-tree=f84bdefa…`, démarré 10:05:42Z | **ancienne release** |
| image R93 | `local/pfe-backend-reconciled:r93` (`4d3f26ce`), arbre `eb8ddf41…` | **construite, non déployée** |
| **WF1 vivant** | 50 nœuds, actif, nœud `Merge` sha `e30ccb82…` | **sans R48/R50** |
| WF1 dépôt | nœud `Merge` sha `b06c628e…`, porte `provenance_status` | **source seulement** |
| **bibliothèque partagée `origin/main`** | `a2427f8` — **pas d'`AcrPublisher`** | ce que Jenkins exécute |
| `feat/acr-publish-provenance` | `55a1a5a`, 2 commits d'avance | **non poussée** |
| cache Jenkins (= exécuté) | 8 classes, **aucun `AcrPublisher`**, **aucune étape `Publish Image`** | confirme l'absence |
| credentials Jenkins | 18 ids présents ; **`ACR_CREDENTIALS` absent**, **`N8N_INTERNAL_SECRET` absent** | bloquant |
| `deployment_artifacts` | 2 lignes (pfe-app-test, tags 150 et 151) | — |
| `deployment_attempts` | **0** | — |

### Les changements préparés : live ou source seulement ?

| Changement | État |
|---|---|
| `AcrPublisher` | **SOURCE SEULEMENT** (branche non poussée) |
| étape `Publish Image (ACR)` | **SOURCE SEULEMENT** |
| garde de révision OCI | **SOURCE SEULEMENT** |
| recherche de registre pilotée par le projet | **SOURCE SEULEMENT** |
| champs télémétrie Docker WF1 | **SOURCE SEULEMENT** |
| `provenance_status` | **SOURCE SEULEMENT** |
| backend R93 | **SOURCE + image construite, NON déployée** |
| `azureConfig.healthCheck` | **source** ; renseigné en base pour `pfe-app-test` uniquement |
| repli Jenkins générique (`JENKINS_INTERNAL_URL` / `JENKINS_TOKEN`) | **SOURCE SEULEMENT**, non approvisionné |
| **vue Docker + navigation (R49/R50/R51)** | **LIVE** (dist reconstruit, servi) |

C'est exactement l'hybride que la Phase 28 demandait de ne pas tester en
silence : **frontend neuf / WF1 ancien / bibliothèque ancienne / backend
ancien**. Il est donc documenté, et aucun E2E live n'a été tenté dessus.

---

## Phases 1, 13, 15, 16 — le contrat d'identité existe déjà et il est exact

C'est le constat central de cette phase : **la chaîne d'identité n'avait pas à
être écrite, elle existe et elle est correcte**. Vérifié dans le code de la
release, pas supposé.

**Sélection (Phase 13)** — `deployment-artifact.service.ts` :

```ts
const row = await this.artifactRepo.findOne({
  where: { projectId, buildNumber: commit.buildNumber, commitSha: commit.commitSha.toLowerCase() },
  order: { createdAt: 'DESC' },
});
```

Triple exact. Et `commit` est **re-dérivé** de `incident.metadata.sourceCommitSha`
pour ce build — jamais la revendication de l'appelant.

**Décision (Phase 1/13/15)** — `evaluateProvenDeploymentArtifact()`, chaîne de
refus en couches :

```
commit non résolu            → DEPLOY_COMMIT_MISSING
environnement non résolu     → DEPLOY_ENVIRONMENT_UNRESOLVED
aucun artefact               → DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE
build différent              → DEPLOY_BUILD_MISMATCH          (aucun repli « build précédent »)
commit différent             → DEPLOY_ARTIFACT_COMMIT_MISMATCH
digest absent / non sha256   → DEPLOY_ARTIFACT_DIGEST_MISSING  (un TAG n'est jamais un digest)
registre différent           → DEPLOY_ARTIFACT_REGISTRY_MISMATCH
dépôt différent              → DEPLOY_ARTIFACT_REPOSITORY_MISMATCH
provenance non vérifiée      → DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE
tag qui a bougé (TOCTOU)     → DEPLOY_ARTIFACT_DIGEST_MISMATCH
révision OCI contredite      → DEPLOY_ARTIFACT_REVISION_MISMATCH
```

**Non-contournable (Phase 15)** — `deployment-authorization-policy.ts` :
`TECHNICALLY_IMPOSSIBLE` a le mode `null` et
`DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE` : « aucun mode d'autorisation ne
peut la satisfaire, **y compris pour un administrateur** ».

**Déploiement par digest (Phase 16)** — `agent.py` :

```python
if artifact_digest:
    full_image = f"{registry}.azurecr.io/{acr_repository}@{artifact_digest}"
else:
    full_image = f"{registry}.azurecr.io/{acr_repository}:{image_tag}"
```

Le digest est préféré, et la référence est **toujours construite** par l'agent,
jamais acceptée telle quelle de l'appelant.

### Ce que j'ai ajouté : la preuve de la sélection

Les specs existantes couvraient l'**enregistrement** (45 assertions). Rien ne
couvrait la **sélection** — précisément le cas où plusieurs projets portent le
même texte, que la chaîne générique crée par construction (tag
`<build>-<sha12>` : deux projets atteignent légitimement le build 8).

`backend/src/azure-deploy/artifact-cross-project-identity.spec.ts`
(commit `1e1de20`, 15 sections) établit sur le code réel :

- deux projets, **même tag et même numéro de build** → chacun son digest, aucune
  collision ;
- artefact de A présenté sous B → refusé ; même nom de dépôt relatif dans un
  autre registre → refusé ;
- artefact d'un **build antérieur** du même projet → n'autorise jamais le build
  courant ;
- le numéro de build seul ne suffit jamais ; un tag n'est jamais un digest ;
- un tag qui a bougé refuse via le re-contrôle TOCTOU ;
- l'absence reste bloquante — c'est le blocage **légitime**, pas un défaut ;
- la requête de sélection est clavée sur exactement
  `{projectId, buildNumber, commitSha}` — assertion sur la clause `where`, donc
  ajouter un critère plus permissif plus tard **fait échouer ce test**.

Cette spec ne peut vivre que sur la ligne de release : `deployment-identity.ts`
et tout le sous-système `azure-deploy` **n'existent pas** sur
`theme-vermeg-reconciled`.

---

## Phase 2 — classification dynamique des 7 projets

Calculée en direct depuis `azureConfig` + identité de build + artefact, sans
aucune table en dur :

| Projet | Classification | Décision | build résolu | digest |
|---|---|---|---|---|
| app-test-pfe-vermeg | `AZURE_CONFIGURED_BUT_NO_ARTIFACT` | TECHNICALLY_IMPOSSIBLE | oui | non |
| pfe-app-test | `AZURE_GOVERNANCE_BLOCKED` | **CRITICAL_RISK** | oui | **oui** |
| devsecops-testbed | `AZURE_CONFIGURED_BUT_NO_BUILD` | TECHNICALLY_IMPOSSIBLE | non | non |
| devsecops-platform-testbed | `AZURE_NOT_CONFIGURED` | TECHNICALLY_IMPOSSIBLE | non | non |
| devsecops-remediation-testbed | `AZURE_NOT_CONFIGURED` | TECHNICALLY_IMPOSSIBLE | non | non |
| remediation-retry-e2e-fixture | `AZURE_NOT_CONFIGURED` | TECHNICALLY_IMPOSSIBLE | non | non |
| vuln-testapp | `AZURE_NOT_CONFIGURED` | TECHNICALLY_IMPOSSIBLE | non | non |

---

## La chaîne est prouvée — sur un projet qui n'est PAS app-test-pfe-vermeg

`pfe-app-test`, aujourd'hui, en direct :

```
projet   3aa1c9b9-e114-40e4-884b-ebc7aa32e002
  → identité de build RÉSOLUE   commit 393816c250f73d907eb5a2dd43b2ec2288c7abcb
  → artefact  provenanceVerified = true
              digest     sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5
              registre   acrpfedevsecops
              dépôt      pfe-app-test
              tag        151
  → environnement RÉSOLU   aci-pfe-app-test / francecentral
  → décision de gouvernance   CRITICAL_RISK
```

Le blocage de `pfe-app-test` est **la sécurité** (`securityValidation`
`applicability: MISSING`), **pas l'identité de l'artefact**. C'est la
démonstration demandée : projet → build → commit → image → registre → digest →
provenance → gouvernance se résout bout en bout, dynamiquement, pour un projet
quelconque **dès qu'un artefact existe**.

Et le blocage d'`app-test-pfe-vermeg` est donc correctement diagnostiqué :
`DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE` **parce qu'aucune image n'a jamais été
publiée pour lui**, pas parce que la plateforme serait incapable de le faire.
Résoudre cela demande la mise en service de la publication — pas du code
spécifique à ce projet.

---

## Phase 26 — audit des artefacts : déjà classés explicitement

| tag | source | provenanceVerified | évidence |
|---|---|---|---|
| 150 | `MANUAL_REGISTERED` | true | `CONTROLLED_HISTORICAL_REGISTRATION` |
| 151 | `JENKINS_PIPELINE` | true | `org.opencontainers.image.revision=393816c2…` |

Le modèle **distingue déjà** un artefact enregistré à la main d'un artefact
produit par un pipeline, via la colonne `source` et son évidence. Les deux
lignes portent une identité complète (projet, build, commit, registre, dépôt,
tag, digest). **Aucune ligne n'a été fabriquée** pour faire passer un test.

Note : leurs tags sont des numéros de build nus (`150`, `151`), pas la forme
`<build>-<sha12>` que la nouvelle publication produira — cohérent avec leur
époque.

## Phase 27 — création d'artefact ≠ tentative de déploiement

`artifacts = 2`, `attempts = 0`, `authorizations = 0`. Enregistrer un artefact
n'a jamais créé de tentative de déploiement. Delta sur cette phase : **0**.

---

## Phases 29–34 — ce qui n'a PAS pu être fait, et pourquoi

L'ordre d'activation de la Phase 29 est bloqué dès ses premières étapes :

| Étape | État | Blocage |
|---|---|---|
| A. déployer le backend R93 | **non fait** | remplacement du conteneur refusé par le garde-fou de session (depuis R93) |
| B. publier WF1 | **non fait** | écriture n8n refusée par le garde-fou de session |
| C. approvisionner les credentials Jenkins | **non fait** | `ACR_CREDENTIALS` exige un **mot de passe ACR réel** que je n'ai pas et que je ne dois pas fabriquer (Phase 35) |
| D. publier la bibliothèque partagée | **non fait** | sans C, publier n'apporte rien ; et le tour précédent interdisait tout `git push` |
| E. un build réel contrôlé | **non fait** | dépend de A–D |
| F–H. observer / valider | **non fait** | dépend de E |

C est un blocage **matériel**, pas une permission : il n'existe aucun moyen
honnête de créer `ACR_CREDENTIALS` sans le secret du registre.

Les Phases 30 à 33 (build réel, push réel, digest réel, déploiement Azure) **ne
sont donc pas exécutées**, et aucune de leurs preuves n'est revendiquée.

### Phase 34 — généricité au-delà de deux projets

Prouvée **par structure et par classification dynamique**, pas par un troisième
build : les 7 projets passent par le même contrat, la classification ci-dessus
les sépare uniquement sur leur configuration et leurs données, la spec
d'identité démontre l'isolation inter-projets sur des identités arbitraires, et
aucun fichier du chemin ne nomme un projet. Une preuve par build réel pour un
troisième projet reste à faire après mise en service.

---

## Phase 20 — un écart réel qui reste ouvert

La page de déploiement **ne peut pas** encore expliquer précisément *quel* lien
d'identité manque. Cause exacte, trouvée en lisant la réponse réelle du
backend :

```
artifact: { provenanceVerified: false, digest: null, registry: "acrpfedevsecops",
            repository: null, tag: null }
```

Le `failureCode` précis (`DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE`,
`DEPLOY_BUILD_MISMATCH`, `DEPLOY_ARTIFACT_COMMIT_MISMATCH`,
`DEPLOY_ARTIFACT_DIGEST_MISSING`, …) **existe** dans
`evaluateProvenDeploymentArtifact()` mais **n'est pas exposé** par
`GET /azure-deploy/governance/:projectId` : l'écran ne voit que des `null` et ne
peut distinguer « image non construite » de « digest non résolu ».

Le correctif est petit et générique — exposer `artifact.failureCode` dans la
prévisualisation, puis le mapper dans l'écran — mais il porte sur le **backend
R93 qui n'est pas déployé** : livré maintenant, il serait invérifiable en ligne
et l'écran lirait un champ que le backend servi n'envoie pas. **Je le signale
donc plutôt que de le livrer à moitié**, avec son emplacement exact.

---

## Verdict

```
PROJECTS_AUDITED                          = 7
DEPLOYABLE_PROJECTS                       = 0 aujourd'hui (1 avec artefact qualifie : pfe-app-test,
                                            bloque par la SECURITE, pas par l'identite)
PROJECTS_WITH_REGISTRY_CONFIG             = 3
PROJECTS_WITH_AZURE_CONFIG                = 3

GENERIC_ARTIFACT_IDENTITY_CONTRACT        = PASS
PROJECT_TO_BUILD_BINDING                  = PASS
BUILD_TO_COMMIT_BINDING                   = PASS
BUILD_TO_IMAGE_BINDING                    = PASS
IMAGE_TO_REGISTRY_BINDING                 = PASS
REGISTRY_TO_DIGEST_BINDING                = PASS
DIGEST_TO_PROJECT_PROVENANCE              = PASS
EXACT_ARTIFACT_SELECTION                  = PASS   (15 sections de test sur le code reel)

CROSS_PROJECT_ARTIFACT_LEAK               = NO
STALE_IMAGE_PUBLISHABLE                   = NO
MUTABLE_TAG_USED_AS_AUTHORITY             = NO
BACKEND_DIGEST_AUTHORITY                  = YES

SHARED_LIBRARY_LIVE                       = NO   (origin/main n'a pas AcrPublisher)
WF1_LIVE                                  = NO   (nœud Merge sha e30ccb82, sans R48/R50)
BACKEND_RELEASE_LIVE                      = NO   (conteneur sur f84bdefa, R93 construite non deployee)
JENKINS_CREDENTIALS_READY                 = NO   (ACR_CREDENTIALS et N8N_INTERNAL_SECRET absents)

REAL_CONTROLLED_BUILD_EXECUTED            = NO
REAL_IMAGE_PUSH_EXECUTED                  = NO
REAL_REGISTRY_DIGEST_RESOLVED             = NO
REAL_PROVENANCE_REGISTERED                = NO
DEPLOYMENT_ARTIFACT_CREATED               = NO   (2 lignes preexistantes, aucune creee ici)
DEPLOYMENT_ATTEMPT_CREATED_BEFORE_AUTHORIZATION = NO

APP_TEST_PFE_VERMEG_ARTIFACT_READY        = NO   (aucune image jamais publiee pour lui)
PFE_APP_TEST_ARTIFACT_READY               = YES  (digest reel, provenance verifiee, chaine complete)
THIRD_PROJECT_GENERICITY_PROVEN           = NO   (prouve par structure et classification,
                                            pas par un troisieme build reel)

DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE_FOR_QUALIFIED_ARTIFACT = NO
   (pfe-app-test a un artefact qualifie et n'affiche PAS ce blocage : il affiche CRITICAL_RISK)

READY_FOR_CONTROLLED_AZURE_DEPLOYMENT     = NO
CONTROLLED_AZURE_DEPLOYMENT_EXECUTED      = NO

PROJECT_SPECIFIC_RUNTIME_CODE             = 0
NEW_PROJECT_REQUIRES_PLATFORM_CODE_CHANGE = NO

SHARED_LIBRARY_TESTS                      = PASS — 287 assertions (3 harnais)
WF1_TESTS                                 = PASS — 7/7
BACKEND_TESTS                             = PASS — 132/132 (branche R93)
FRONTEND_TESTS                            = PASS — 34/34

SECRETS_IN_PIPELINE_LOGS                  = 0
DISPATCH_FINAL_STATE                      = OFF
HARNESS_FINAL_STATE                       = OFF

P0_REMAINING = 0
P1_REMAINING = 4
   (a) backend R93 non deploye (garde-fou de session)
   (b) WF1 non publie (garde-fou de session)
   (c) ACR_CREDENTIALS / N8N_INTERNAL_SECRET absents de Jenkins — exige un vrai secret ACR
   (d) failureCode d'artefact non expose par la prevue de gouvernance (Phase 20)
P2_REMAINING = 3
   (a) bibliotheque partagee non poussee (aucune valeur avant (c))
   (b) azureConfig.healthCheck absent pour app-test-pfe-vermeg et devsecops-testbed
   (c) troisieme projet a prouver par un build reel

READY_TO_CLAIM_GENERIC_PROJECT_TO_AZURE_CHAIN = NO
FINAL_VERDICT = C — LIVE_PUBLICATION_OR_PROVENANCE_INCOMPLETE
```

**Pourquoi C et non B.** B dirait que seul le déploiement Azure reste en
attente. C'est faux : la **publication automatique elle-même n'est pas en
service** — bibliothèque non poussée, credentials absents, WF1 non publié,
backend R93 non déployé. C décrit l'état servi.

Ce qui *est* prouvé, et qui compte : la chaîne d'identité générique existe,
elle est exacte, elle est désormais testée contre les collisions
inter-projets, et elle se résout bout en bout aujourd'hui pour `pfe-app-test` —
dont le blocage est la sécurité, non l'identité. Le blocage
d'`app-test-pfe-vermeg` est correctement diagnostiqué comme une **absence
d'artefact**, et sa levée demande la mise en service de la publication, pas une
ligne de code propre à ce projet.
