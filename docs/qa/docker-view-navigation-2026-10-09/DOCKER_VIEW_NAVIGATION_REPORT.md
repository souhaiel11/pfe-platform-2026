# Vue Docker dédiée et correction de navigation — R49

**Date** : 2026-10-09
**Objet** : Docker ouvrait Jenkins ; Docker a maintenant sa propre destination et
affiche l'image réelle du projet sélectionné.

---

## 1. Le défaut, et sa cause exacte

`frontend/src/app/features/projects/project-overview.component.ts:366`

```ts
const tabs = { build:'jenkins', tests:'jenkins', sonar:'sonar',
               trivy:'security:trivy', owasp:'security:owasp', zap:'security:zap',
               container:'jenkins', docker:'jenkins',   // ← le défaut
               deploy:'deploiement' };
```

Le pipeline réel expose bien une étape `docker` — vérifié en direct sur
`app-test-pfe-vermeg` et `pfe-app-test` :
`['zap','build','owasp','sonar','tests','trivy','deploy','docker']`. Cliquer la
carte ou l'étape Docker envoyait donc l'utilisateur sur la **preuve de build
Jenkins** au lieu de l'image.

**Un second défaut, latent**, aurait masqué la correction : `tabMap` dans
`project-detail.component.ts` ne connaissait pas `docker`. `onGoToTab()` faisait
`setActiveTab(this.tabMap['docker'])` → `undefined` → `setActiveTab` retombait
silencieusement sur `'rapport'`. Corriger la carte sans corriger `tabMap` aurait
donné un clic qui n'ouvre toujours pas Docker.

**Trois mauvais routages corrigés** :

| Emplacement | Avant | Après |
|---|---|---|
| `project-overview.ts:366` étape gouvernée `docker` | `'jenkins'` | `'docker'` |
| `project-overview.ts:366` étape `container` | `'jenkins'` | `'docker'` |
| `project-overview.ts:~416` étape héritée `Image` | `'jenkins'` | `'docker'` |
| `project-detail.ts` `tabMap` | *(absent)* | `docker: 'docker'` |

Les étapes qui relèvent **légitimement** de Jenkins ne bougent pas : `build` et
`tests` restent sous l'onglet CI/CD, et `deploy` garde la section de gouvernance
de la plateforme. Vérifié dans le bundle **servi** : `docker:"jenkins"` → **0**
occurrence, `container:"jenkins"` → **0**.

Aucune page dupliquée n'a été créée : la destination est l'onglet Docker qui
existait déjà, et `setActiveTab()` la reflète dans l'URL
(`/projects/:id?tab=docker`).

---

## 2. Ce que l'onglet Docker contenait

Rien sur l'image : uniquement l'optimiseur de Dockerfile. C'est probablement
pourquoi la carte avait été pointée vers Jenkins — il n'y avait rien à montrer.
La vue affiche maintenant l'image réelle, l'optimiseur restant dessous.

---

## 3. Matrice de provenance

Inventaire fait **avant** d'ajouter le moindre champ.

| UI_FIELD | AUTHORITATIVE_SOURCE | BACKEND/API | AVANT | APRÈS |
|---|---|---|---|---|
| Référence d'image | Jenkins (build) | `enrichedData.docker.image_tag` | non | **oui** |
| Repository | artefact vérifié, sinon référence | `artifact.repository` | non | **oui** |
| Tag | artefact vérifié, sinon référence | `artifact.tag` | non | **oui** |
| Digest | artefact de déploiement | `artifact.digest` | non | **oui** |
| Build # | Jenkins | `enrichedData.build.number` | partiel | **oui** |
| Commit source | WF1 / identité de build | `metadata.sourceCommitSha`, `buildIdentity.commitSha` | non | **oui** |
| Date du build | incident | `createdAt` | non | **oui** |
| Étape Docker | Jenkins | `docker.build_status` | non | **oui** |
| Statut build Jenkins | Jenkins | `build.status` | non | **oui** |
| Publication | Jenkins | `docker.push_status` | non | **oui** |
| Registre | artefact / azureConfig | `artifact.registry` | non | **oui** |
| Provenance vérifiée | backend | `artifact.provenanceVerified` | non | **oui** |
| Trivy : état, critiques, élevées, total | Trivy | `enrichedData.trivy.*` | non | **oui** |
| Ports exposés | azureConfig | `deploymentTarget.ports` | non | **oui** |
| Sonde de santé | azureConfig | `deploymentTarget.healthCheck` | non | **oui** |
| Cible de déploiement | azureConfig | `deploymentTarget.targetName` | non | **oui** |
| Lien build Jenkins | Jenkins | `build.url` | non | **oui** (preuve secondaire) |
| **Taille de l'image** | *aucune* | — | non | **non — pas de source** |
| **Image de base** | *aucune par projet* | — | non | **non — pas de source** |
| **Chemin du Dockerfile** | *aucune* | — | non | **non — pas de source** |

Ces trois derniers champs **ne sont pas affichés**. `parseBaseImages()` existe,
mais à l'intérieur du builder-scanner (validation interne), et n'est exposé par
aucune API par projet ; `dockerfilePath` est une *entrée* de l'optimiseur avec
défaut `'Dockerfile'`, pas une métadonnée d'image. Les inventer aurait été
exactement ce que la règle interdit. Un test refuse leur apparition.

Aucun appel supplémentaire n'a été créé : le digest, le registre et le commit
viennent du contrat de gouvernance **déjà** en place
(`GET /azure-deploy/governance/:projectId`), chargé paresseusement à l'ouverture
de l'onglet.

---

## 4. Validation sur l'application servie

SOURCE → API → UI, quatre projets réels, dont un sans image et un sans build.

| PROJET | CHAMP | SOURCE | UI |
|---|---|---|---|
| app-test-pfe-vermeg | référence | `app-test-pfe-vermeg:8` | `app-test-pfe-vermeg:8` |
| | repository / tag | `app-test-pfe-vermeg` / `8` | idem |
| | digest | `null` (provenance non vérifiée) | **« Provenance non vérifiée »** |
| | commit | `97987c2f…` | `97987c2f…` |
| | build # | `8` | `8` |
| | publication | `NOT_ATTEMPTED` | **« Non tentée »** |
| | registre | `acrpfedevsecops` | `acrpfedevsecops` |
| | Trivy critiques | `1` | `1` |
| pfe-app-test | référence | `pfe-app-test:151` | `pfe-app-test:151` |
| | **digest** | `sha256:6dc3cdba6959…` | `sha256:6dc3cdba6959…` |
| | commit | `393816c250f7…` | `393816c250f7…` |
| | build # | `151` | `151` |
| | Trivy critiques | `14` | `14` |
| vuln-testapp | référence | `""` (vide) | **« Image non construite »** |
| | build # | `"41"` *(chaîne)* | `41` |
| | publication | `SKIPPED` | **« Non exécutée »** |
| | registre | `null` | **« Non configuré »** |
| | Trivy | `FAILED` | **« Indisponible »** — pas `0` |
| devsecops-remediation-testbed | *aucune analyse* | — | **« Non disponible »** partout, lien Jenkins masqué |

Le digest réel n'existe que pour `pfe-app-test` (deux artefacts en base, tags 150
et 151). Pour les autres, la vue dit **pourquoi** il manque au lieu de retomber
sur le tag — le digest est l'identité immuable, le tag ne l'est pas, et un test
interdit explicitement tout repli `digest || tag`.

### Un défaut trouvé par cette validation

`vuln-testapp` et `devsecops-testbed` livrent leur numéro de build en **chaîne**
(`"41"`, `"19"`) alors que les autres le livrent en nombre — selon le type de job
Jenkins. `availableNumber()` est délibérément strict (c'est le garde-fou central
contre les coercitions) et rejetait donc ces chaînes : l'UI affichait « Non
disponible » pour un numéro que la source portait bel et bien.

Un lecteur dédié, `sourceInteger()`, accepte un entier ou une chaîne faite
**uniquement** de chiffres. Ni `"41abc"`, ni `"4.1"`, ni `"1e3"`, ni `"-7"` : une
valeur douteuse reste absente plutôt que devinée. Les cinq projets affichent
maintenant leur numéro réel (8, 151, 41, 17, 19) — deux étaient perdus.

Au passage, le `'—'` de l'étape Build héritée a été remplacé par un état
véritable : un tiret n'est pas un état.

---

## 5. Sémantiques séparées

La vue distingue explicitement cinq choses que le cahier des charges demandait de
ne pas confondre :

```
IDENTITÉ      référence · repository · tag · digest · commit · date
CONSTRUCTION  étape Docker · build Jenkins · ports · sonde
REGISTRE      registre · publication · provenance vérifiée
SÉCURITÉ      état du scan Trivy · critiques · élevées · total
DÉPLOIEMENT   cible · relation
```

- **construite ≠ poussée** : `NOT_ATTEMPTED` (« Non tentée ») et `SKIPPED`
  (« Non exécutée ») sont deux faits distincts, pas un échec, et un test l'exige.
- **poussée ≠ déployée** : la relation dit « Image prête pour déploiement » ou
  « Identité d'image non vérifiée » ou « Non configuré ». Un test interdit la
  chaîne « Déployée » dans cette vue : elle ne constate aucun déploiement, donc
  elle ne l'affirme jamais.
- **build réussi ≠ scan réussi** : l'état Trivy passe par `scannerState()` et les
  compteurs par `scannerMetric()`, donc un scan en échec n'affiche pas `0`.
- **configuré ≠ exécuté** : une cible absente dit « Non configuré ».

Jenkins est à sa place : **« Voir le build Jenkins »**, affiché seulement si une
URL `http(s)` réelle existe, aux côtés de « Voir les vulnérabilités de l'image »
(qui ouvre Sécurité filtré sur Trivy, sans dupliquer la table) et « Voir le
déploiement ».

---

## 6. Portée projet et généricité

Mêmes protections que le reste de la page, vérifiées par test :

- chargement **paresseux** sur l'onglet Docker (`loadImageProvenance()`), aucun
  préchargement ;
- `takeUntil(this.projectScopeReset$)` → la requête est annulée au changement de
  projet ;
- `imageProvenance` purgé avec le reste de l'état scopé ;
- garde de portée sur la réponse : `!g.projectId || g.projectId === this.id`,
  sinon rien n'est affiché.

`CROSS_PROJECT_DOCKER_LEAK = NO`. Chaque valeur de la matrice §4 est propre à son
projet ; `devsecops-remediation-testbed`, sans aucune analyse, n'hérite de rien.

`RUNTIME_PROJECT_HARDCODING = 0` : un test refuse tout nom de projet, UUID,
registre (`acrpfedevsecops`), cible (`aci-…`) et digest `sha256:` en dur dans les
quatre fichiers touchés. Rien n'est reconstruit à partir du nom du projet — le
repository vient de l'artefact vérifié ou de la référence produite par le build,
jamais d'une concaténation.

---

## 7. Historique d'images

**Non ajouté.** Deux artefacts existent en base pour un seul projet (tags 150 et
151) mais aucune API n'expose un historique d'images par projet. Le cahier des
charges l'interdisait explicitement en l'absence de source : aucune couche
d'historique fabriquée.

---

## Verdict

```
DOCKER_NAVIGATION_FIXED                 = YES
DOCKER_ROUTE                            = /projects/:projectId?tab=docker
                                          (onglet canonique existant, reflete dans l'URL ;
                                           aucune page dupliquee creee)
DOCKER_REDIRECT_TO_JENKINS_REMAINING    = 0   (verifie dans le bundle SERVI)

PROJECTS_DOCKER_VALIDATED               = 4   (app-test-pfe-vermeg, pfe-app-test,
                                               vuln-testapp sans image,
                                               devsecops-remediation-testbed sans build)

DOCKER_FIELDS_INVENTORIED               = 20
DOCKER_FIELDS_DISPLAYED                 = 17
DOCKER_FIELDS_SOURCE_AVAILABLE_BUT_MISSING = 0
                                          (3 non affiches faute de source : taille,
                                           image de base, chemin du Dockerfile)

IMAGE_NAME_DYNAMIC                      = YES
IMAGE_TAG_DYNAMIC                       = YES
IMAGE_DIGEST_DYNAMIC                    = YES (reel pour pfe-app-test ;
                                           « Provenance non verifiee » ailleurs)
BUILD_NUMBER_DYNAMIC                    = YES (2 numeros livres en chaine etaient
                                           perdus, maintenant lus)
COMMIT_SHA_DYNAMIC                      = YES
IMAGE_SIZE_DYNAMIC                      = NOT_AVAILABLE  (aucune source)
PORTS_DYNAMIC                           = YES (azureConfig ; « Non disponible » sinon)
HEALTHCHECK_DYNAMIC                     = YES (azureConfig ; « Non disponible » sinon)
TRIVY_SUMMARY_DYNAMIC                   = YES
REGISTRY_DATA_DYNAMIC                   = YES (NOT_CONFIGURED pour les projets sans Azure)

CROSS_PROJECT_DOCKER_LEAK               = NO
RUNTIME_PROJECT_HARDCODING              = 0
NEW_PROJECT_REQUIRES_CODE_CHANGE        = NO

FRONTEND_TESTS                          = PASS — 34/34 (dont 1 nouveau, 10 sections)
BACKEND_TESTS                           = PASS — 134/134 (inchange : aucune
                                           modification backend ce tour)
PRODUCTION_BUILD                        = PASS — servi en ligne

DISPATCH_FINAL_STATE                    = OFF
HARNESS_FINAL_STATE                     = OFF
AZURE_DEPLOYMENT_EXECUTED               = NO

FINAL_VERDICT = B — COMPLETE_WITH_SOURCE_LIMITATIONS
```

Le verdict est **B** et non **A** pour une raison précise : trois champs demandés
— taille d'image, image de base, chemin du Dockerfile — n'ont **aucune source
autoritaire** dans la plateforme aujourd'hui. Tout ce dont une source existe est
importé et affiché, et validé contre l'application servie. Les déclarer affichés
aurait demandé de les fabriquer.
