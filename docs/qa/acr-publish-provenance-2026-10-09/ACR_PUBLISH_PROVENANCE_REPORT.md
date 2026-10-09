# Publication ACR automatique et enregistrement de provenance — R50

**Date** : 2026-10-09
**Objet** : publier dans ACR l'image produite par le build Jenkins courant, et
enregistrer sa provenance dans la plateforme.

---

## 1. Ce que l'inspection a trouvé

L'étape de build réelle n'est pas dans ce dépôt. Elle vit dans une
**bibliothèque Jenkins partagée**, déclarée dans la configuration du contrôleur
(`org.jenkinsci.plugins.workflow.libs.GlobalLibraries.xml`) :

```
nom     : pfe-devsecops
dépôt   : https://github.com/souhaiel11/pfe-devsecops-shared-library.git
branche : main   (defaultVersion)
```

Les Jenkinsfile des projets ne contiennent rien d'autre qu'une déclaration :

```groovy
@Library('pfe-devsecops') _
devSecOpsPipeline {
    applicationName = 'app-test-pfe-vermeg'
    skipTests       = false
    zapTargetUrl    = 'http://app-test-pfe-vermeg:8080'
}
```

Le code concerné :

| Fichier | Rôle |
|---|---|
| `vars/devSecOpsPipeline.groovy` | orchestration, 482 lignes |
| `src/org/pfe/devsecops/DockerRunner.groovy` | **l'étape de build de l'image** |
| `src/org/pfe/devsecops/StageTelemetry.groovy` | faits remontés à la plateforme |
| `src/org/pfe/devsecops/PlatformReporter.groovy` | envoi du payload |

**Vérification d'identité du code avant toute modification** : le
`DockerRunner.groovy` et le `devSecOpsPipeline.groovy` de `origin/main` sont
**identiques octet pour octet** à ceux que Jenkins a réellement mis en cache
(`/var/jenkins_home/workspace/app-test-pfe-vermeg@libs/68b8255a…`). C'est bien
le code qui tourne.

### Le constat

`DockerRunner` construisait l'image et s'arrêtait là :

```groovy
/** PIPELINE_GENERIC Docker image build. No push -- this platform never pushes from Jenkins. */
...
telemetry.docker.push_status = 'NOT_ATTEMPTED'
```

`push_status` était une **constante**. Rien n'atteignait jamais un registre :
aucun artefact déployable, aucune provenance, pour aucun projet. C'est pourquoi
l'écran Docker affichait « Non tentée » pour tous — honnêtement, mais sans que
rien ne puisse changer cet état.

Un seul projet a des artefacts en base (`pfe-app-test`, tags 150 et 151) :
enregistrés **à la main**, pas par un pipeline.

---

## 2. Ce qui est implémenté dans le pipeline

Nouveau `src/org/pfe/devsecops/AcrPublisher.groovy` et une étape
`Publish Image (ACR)` dans `devSecOpsPipeline.groovy`, après `Docker Build`.

### 2.1 L'image de CETTE exécution, et aucune autre

C'est le point le plus important, et il demande deux garde-fous, pas un :

1. **Adressage exact.** L'artefact est désigné par la référence que ce run a
   construite (`"${imageName}:${imageTag}"`), lue avec
   `docker image inspect "$PFE_LOCAL_REF"`. Jamais de parcours de
   `docker images`, jamais `latest`, jamais « la plus récente ».

2. **Preuve de revision.** `docker image inspect` sur une référence ne garantit
   pas que l'image est celle de ce run : deux builds de la même branche
   produisent la même forme `nom:BUILD_NUMBER`, et une image locale périmée
   serait publiable sous le tag d'un build neuf. Le publisher lit donc
   `org.opencontainers.image.revision` sur cette référence exacte et **refuse
   de pousser** si le label ne vaut pas le commit de ce run.

   Ce label existe déjà : `DockerRunner` le pose depuis `telemetry.checkoutFullSha`,
   la capture durcie par `git rev-parse` (jamais `env.GIT_COMMIT`). Le publisher
   le réutilise comme preuve, il ne le re-dérive pas.

### 2.2 Tag unique

```
<numéro de build>-<12 hex du commit>      ex. 8-97987c2f2902
```

Aucune des deux moitiés ne suffit seule : un numéro de build se réutilise quand
un job est recréé, un commit se réutilise à chaque reconstruction du même
commit. Ni `latest`, ni le numéro nu. Le tag respecte le motif du DTO backend.
Un numéro non numérique est **refusé**, pas assaini.

### 2.3 Dépôt ACR du projet — jamais choisi à sa place

Le publisher résout sa cible par le lookup générique
`GET /api/projects/internal/by-job/<jobName>` (le pipeline connaît son nom de
job, jamais un UUID de projet) et lit `azureConfig.registry` et
`azureConfig.imageRepository`.

| Situation | Comportement |
|---|---|
| ACR configuré | publication |
| aucun `azureConfig` | `push_status = NOT_CONFIGURED`, étape sautée, build non cassé |
| publication **exigée** (`requireImagePublication = true`) sans ACR | **échec explicite** nommant ce qu'il faut configurer |
| registre ou dépôt hors motif ACR | refus (`ACR_REGISTRY_INVALID` / `ACR_REPOSITORY_INVALID`), jamais normalisé en silence |

> **Décision assumée.** La consigne disait « échoue si le dépôt n'est pas
> configuré ». Appliquée littéralement à tous les projets, elle aurait cassé les
> quatre projets qui n'ont jamais demandé à publier. Le défaut retenu est donc
> `NOT_CONFIGURED` — un état honnête, jamais un faux succès — et l'échec dur est
> réservé au projet qui a explicitement opté pour la publication. Ce qui était
> réellement interdit, choisir un registre à la place du projet, ne se produit
> dans aucun des deux cas.

### 2.4 Digest réellement attribué par ACR

Lu **auprès du registre**, avec exactement la commande que l'agent Azure de la
plateforme utilise déjà dans `/resolve-digest` :

```sh
az acr repository show -n "$PFE_REGISTRY" --image "$PFE_REPOSITORY:$PFE_TAG" --query digest -o tsv
```

Pas le `RepoDigests` du démon local, qui peut être absent ou périmé. Une réponse
qui n'est pas un `sha256:<64 hex>` n'est jamais acceptée : le build échoue
(`ACR_DIGEST_UNRESOLVED`) plutôt que d'enregistrer une provenance pour un
artefact non adressable.

### 2.5 Enregistrement par le contrat existant

`POST /api/azure-deploy/artifacts/provenance`, endpoint CI qui existait déjà,
authentifié par le secret interne existant (`JwtOrInternalSecretGuard`). Corps
conforme à `RegisterArtifactDto`, sans un champ de plus :

```json
{ "projectId": "…", "buildNumber": 8, "commitSha": "<40 hex>",
  "repository": "app-test-pfe-vermeg", "tag": "8-97987c2f2902",
  "digest": "sha256:…" }
```

Deux propriétés du DTO qui ont guidé l'implémentation :

- **pas de champ `registry`** — le backend le lit du projet ; le pipeline n'a
  donc rien à affirmer là-dessus ;
- **`digest` est une RÉCLAMATION**, pas une autorité : le backend le re-résout
  lui-même via l'agent et peut contredire le pipeline. C'est précisément
  pourquoi l'envoyer a de la valeur.

### 2.6 Échecs et frontières

Le build **échoue** si la publication ou l'enregistrement échoue pour un projet
configuré : un artefact non enregistré n'est pas déployable sous gouvernance.

Trois faits, trois champs de télémétrie, parce que ce sont trois choses :

```
build_status       l'image a été produite
push_status        elle a atteint un registre
provenance_status  la plateforme l'a enregistrée
```

Un push réellement effectué **reste** `SUCCESS` même si l'enregistrement échoue
ensuite — et le build échoue quand même. **Aucun champ « deployed » n'est écrit
nulle part** : publier n'est pas déployer, et ce pipeline n'observe aucun
déploiement.

L'étape est sautée sur les builds de PR (une proposition n'est pas un artefact
déployable) et quand l'étape Docker n'a pas réussi.

---

## 3. Ce qui est implémenté dans l'interface

Peu, et seulement ce que les nouveaux faits rendent affichable :

- `push_status` devient réellement variable, donc la ligne **« Publication »**
  de la vue Docker (déjà présente, R49) cesse d'être figée sur « Non tentée » ;
- nouvel état `NOT_CONFIGURED` → « Aucun registre configuré », distinct d'un
  échec et d'un non-essai ;
- nouvelle ligne **« Provenance enregistrée »** (`dockerProvenanceState()`) ;
- nouvelle ligne **« Référence publiée »**, affichée uniquement si le registre
  l'a confirmée.

Le **digest** affiché continue de venir de l'artefact résolu par le backend, pas
de la réclamation du pipeline : c'est la source la plus forte.

---

## 4. Ce qui a été réellement testé

**255 assertions vertes**, trois harnais, dans la bibliothèque partagée :

```
test/offline_tests.groovy         (existant, non régressé)
test/acr_publisher_tests.groovy   (nouveau, 60 assertions)
test/shell_status_tests.sh        (existant, 11 assertions)
→ bash test/run-offline-tests.sh   avec groovy-all-2.4.21.jar
```

Entièrement simulé via `FakeSteps` : **aucun identifiant réel, aucun
`docker push`, aucun appel Azure, aucune ressource modifiée.** Le harnais
enregistre les scripts shell que le publisher *aurait* exécutés et en vérifie le
contrat.

Ce que les tests prouvent réellement :

| Domaine | Vérifié |
|---|---|
| Tag | combine build + commit ; deux commits au même build → deux tags ; deux builds du même commit → deux tags ; jamais `latest` ni le numéro nu ; respecte le motif du DTO ; un build non numérique est refusé |
| Cible | lue du projet ; chaque motif de refus distinct ; un dépôt manquant n'est jamais remplacé par le nom du projet ; un registre manquant jamais par un défaut |
| Identité | référence exacte ; **aucun `docker images`** ; **aucun `latest`** ; une image d'un autre commit est refusée **avant tout push** ; label absent refusé |
| Digest | demandé au registre par la même commande que l'agent ; `RepoDigests` n'est pas la source ; une réponse non-sha256 est refusée |
| Provenance | payload exact ; **pas** de champ `registry` ; **pas** de `provenanceVerified` ni `deployed` ; endpoint CI existant ; secret depuis l'environnement ; code non-2xx = échec |
| Échecs | commit non prouvable → aucun appel shell ; identité refusée → aucun push ; digest non résolu → aucune provenance ; provenance refusée → build en échec **mais push_status reste SUCCESS** |
| Secrets | le mot de passe passe par `--password-stdin` depuis l'environnement ; aucune valeur dans le texte du script |
| Généricité | aucun nom de projet, UUID, registre ou ressource Azure en dur |

Côté plateforme : **frontend 34/34**, build de production **PASS** et servi en
ligne ; **WF1 7/7**, 50 nœuds intacts.

**Non testé en réel, et je ne le prétends pas** : aucun build Jenkins n'a été
déclenché, aucune image n'a été poussée, aucun digest réel n'a été résolu par
cette implémentation. `deployment_artifacts` est resté à 2 lignes,
`deployment_attempts` à 0 — vérifié après coup.

---

## 5. Réglages Jenkins / ACR encore nécessaires

Rien de tout cela n'est du code.

**a) Identifiants Jenkins** — deux credentials attendus par
`PlatformConfig` (`CRED_ACR`, `CRED_INTERNAL_SECRET`). Le pipeline les lie dans
le `withCredentials` global : **s'ils n'existent pas, tous les builds
échoueront**, y compris ceux des projets sans ACR. C'est le point à régler en
premier.

1. `ACR_CREDENTIALS` — type *Username with password*. Jeton ACR
   (`az acr credential show -n <registre>`) ou principal de service avec
   `AcrPush`.
2. `N8N_INTERNAL_SECRET` — type *Secret text*, **même valeur** que la variable
   `N8N_INTERNAL_SECRET` du backend (déjà définie dans le conteneur).

**b) Agent Azure** — déjà correct, vérifié en direct :

```
AZURE_ALLOWED_ACRS = acrpfedevsecops          ← correspond aux projets configurés
AZURE_DEPLOY_AGENT_SECRET = <défini>
session Azure : valid=true (Azure for Students)
```

Un registre hors de cette liste recevrait `REGISTRY_NOT_ALLOWED` (403) : il faut
l'y ajouter avant de configurer un nouveau registre sur un projet.

**c) Par projet** — `azureConfig.registry` et `azureConfig.imageRepository`.
Présents sur `app-test-pfe-vermeg`, `pfe-app-test`, `devsecops-testbed` ;
absents sur les quatre autres, qui resteront `NOT_CONFIGURED`.

**d) `az` dans l'agent Jenkins** — le publisher appelle `az acr repository show`
depuis l'agent Jenkins. À vérifier : l'image `pfe-jenkins-with-docker-cli` a le
CLI Docker ; la présence d'`az` **et d'une session Azure dans Jenkins** n'a pas
été vérifiée. Si `az` manque dans Jenkins, c'est le seul point de l'implémentation
qui demanderait une révision — déléguer la lecture du digest à l'agent hôte via
le backend plutôt que de l'appeler depuis Jenkins.

---

## 6. Fichiers et dépôts manquants de cet espace de travail

**a) La bibliothèque partagée est un dépôt séparé.** Elle n'est pas dans
`platform/`. Elle est clonée à `/home/souhaiel/pfe-2026/pfe-devsecops-shared-library`,
mais ce clone **a divergé** de `origin/main` : 2 commits locaux absents du
distant, 10 commits distants absents en local. J'ai donc travaillé dans un
`git worktree` créé **depuis `origin/main`** — la seule référence qui correspond
à ce que Jenkins exécute.

```
branche : feat/acr-publish-provenance   (worktree, ahead 1 de origin/main)
commit  : b03467f
```

**Aucun `git push` n'a été fait** : `origin/main` de la bibliothèque est
toujours `a2427f82`, `origin/theme-vermeg-reconciled` de la plateforme toujours
`206a8a73`.

**Pour mettre en service**, il faut pousser cette branche (ou la fusionner dans
`main`) : Jenkins lit `defaultVersion = main` du dépôt distant, pas le clone
local. Tant que ce n'est pas poussé, **le pipeline en production est inchangé**.
Le clone local divergent devrait aussi être réconcilié.

**b) Les Jenkinsfile des applications** sont dans leurs propres dépôts
(`app-test-pfe-vermeg`, `pfe-app-test`, …). Aucun n'a besoin d'être modifié :
la publication est générique. Un projet qui veut un échec dur plutôt qu'un
`NOT_CONFIGURED` ajoute une ligne : `requireImagePublication = true`.

**c) WF1 est corrigé en source mais pas publié.** La moitié ingestion vit dans
`n8n-workflows/active/wf1-…json` (commit `fa706a5`) ; la publication vers n8n
reste **refusée par le garde-fou de session**, comme au tour précédent. Tant
qu'elle n'est pas publiée, les faits de publication ne traverseront pas
l'ingestion même après un build réussi.

---

## État honnête

```
IMPLEMENTE_PIPELINE        = OUI   AcrPublisher + etape + telemetrie + payload
IMPLEMENTE_INGESTION       = OUI (source)  WF1 transporte les faits ; publication n8n BLOQUEE
IMPLEMENTE_INTERFACE       = OUI   3 lignes et 1 etat, derives des nouveaux faits
TESTE_AVEC_MOCKS           = OUI   255 assertions, 0 identifiant, 0 push, 0 appel Azure
TESTE_EN_REEL              = NON   aucun build declenche, aucune image poussee,
                                   aucun digest reel resolu
EN_SERVICE                 = NON   la bibliotheque partagee n'est PAS poussee
                                   (consigne : aucun git push)
REGLAGES_RESTANTS          = 2 credentials Jenkins (bloquants), azureConfig par projet,
                             verification de `az` dans l'agent Jenkins
RESSOURCES_AZURE_MODIFIEES = AUCUNE   (artifacts=2, attempts=0, inchanges)
DISPATCH / HARNESS         = OFF / OFF
```

**La publication automatique n'est pas en service.** Elle est écrite, testée
hors ligne et commitée sur une branche non poussée. L'affirmer fonctionnelle
demanderait de pousser la bibliothèque, de créer les deux credentials, puis de
faire tourner un vrai build.
