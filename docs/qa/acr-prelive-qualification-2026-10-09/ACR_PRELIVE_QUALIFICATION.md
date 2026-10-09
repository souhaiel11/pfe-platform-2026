# Qualification pré-live de la publication ACR — R51

**Date** : 2026-10-09
**Branche** : `feat/acr-publish-provenance` (bibliothèque partagée, **non poussée**)
**Commits** : `b03467f` (implémentation) + `55a1a5a` (cette qualification)

> Rien n'a été poussé ni publié. Le pipeline en production est inchangé, le WF1
> vivant est inchangé, aucune image n'a été poussée, aucune ressource Azure
> modifiée.

---

## 1. Portée des identifiants — corrigée

### Le défaut

`ACR_CREDENTIALS` et `N8N_INTERNAL_SECRET` étaient liés dans le
`withCredentials` **global** du pipeline. Leur absence aurait fait échouer
**tous** les projets, y compris les quatre sans `azureConfig` qui n'ont jamais
demandé à publier. C'était la contradiction exacte signalée.

### Le correctif

Les deux sont retirés du bloc global. `AcrPublisher` les acquiert lui-même,
dans le chemin le plus étroit qui les utilise :

| Secret | Requis par | Acquis où |
|---|---|---|
| `N8N_INTERNAL_SECRET` | lecture de la config projet (`internal/by-job`), puis `POST /artifacts/provenance` | dans `publishImage()` et `recordProvenance()`, autour de ces appels seulement |
| `ACR_CREDENTIALS` | `docker login` + `docker push` | dans `publishImage()`, **uniquement après** qu'un registre a été trouvé |

Un identifiant absent est un **état de configuration**, pas un crash :
`isCredentialMissing()` ne reconnaît que `CredentialNotFoundException` (ou son
message). Une vraie erreur de push, un problème réseau, continuent de
propager — ce n'est jamais devenu un `catch` fourre-tout.

### Les trois cas, prouvés par test

| Cas | Comportement vérifié |
|---|---|
| **projet sans registre, identifiants absents** | build OK, image OK, `push_status = NOT_CONFIGURED`, **aucun identifiant ACR demandé**, aucun `docker login`, aucun push, aucun appel de provenance, aucun appel Azure CLI |
| **projet avec registre, identifiants présents** | chemin de publication activé, les deux identifiants demandés **là seulement**, push émis, `push_status = SUCCESS` |
| **`requireImagePublication = true`, identifiants manquants** | **échec dur** `ACR_PUBLISH_REQUIRED_BUT_UNAVAILABLE`, motif nommant l'identifiant manquant, `push_status = FAILED` |

Le test ne lit pas le code : `FakeSteps` **enregistre les identifiants
réellement demandés**, donc l'assertion « un projet non publiant ne demande
jamais l'identifiant ACR » porte sur le comportement.

Variante couverte aussi : secret interne absent → la lecture de config n'est
même pas tentée, `NOT_CONFIGURED`, et l'identifiant ACR n'est pas demandé non
plus.

---

## 2. Portée de `N8N_INTERNAL_SECRET`

Deux requêtes, et deux seulement, en ont besoin :

1. `GET /api/projects/internal/by-job/<jobName>` — la lecture de configuration.
   C'est elle qui **décide** si une publication a lieu ; sans elle on ne peut
   pas savoir si un registre existe, donc son absence dégrade honnêtement en
   `NOT_CONFIGURED` au lieu de casser le build.
2. `POST /api/azure-deploy/artifacts/provenance` — l'enregistrement.

Aucune n'est exécutée pour un projet sans registre configuré, et le secret
n'est plus lié globalement. Aucun projet n'échoue parce que la
publication/provenance ne fait pas partie de son pipeline.

---

## 3. Azure CLI dans le contexte d'exécution Jenkins réel

Qualification en lecture seule, dans le conteneur qui exécute réellement les
builds. Le pipeline utilise un `node { }` **sans label** et le contrôleur n'a
**aucun agent séparé** (`/var/jenkins_home/nodes` absent) : les builds tournent
donc sur le *built-in node*, c'est-à-dire dans le conteneur `jenkins` lui-même.

```
command -v az   →  AZ_NOT_FOUND
az version      →  sh: 1: az: not found
~/.azure        →  ABSENT  (aucune session)
docker          →  /usr/bin/docker, version 29.7.2   ← présent
```

```
JENKINS_AZ_AVAILABLE     = NO
JENKINS_AZ_SESSION_VALID = NO
JENKINS_ACR_READ_ACCESS  = NO
```

Aucune image poussée, aucune ressource Azure touchée, aucun jeton affiché.

À titre de comparaison, le chemin **déjà qualifié** fonctionne : l'agent hôte
a `AZURE_ALLOWED_ACRS=acrpfedevsecops`, son secret, et la session Azure de la
plateforme répond `valid=true`.

---

## 4. Architecture de résolution du digest

```
DIGEST_RESOLUTION_MODE = BACKEND_AGENT
```

Jenkins n'a pas de contexte Azure fiable, donc **aucun second modèle
d'authentification Azure n'y est ajouté**. La chaîne retenue est celle qui
existe et qui est éprouvée :

```
Jenkins  docker login + docker push        (aucun az)
   ↓
backend  POST /artifacts/provenance
   ↓
agent    /resolve-digest → az acr repository show --image repo:tag
   ↓
backend  digest autoritaire persisté dans deployment_artifacts
```

Le pipeline **ne revendique aucun digest**. Le DTO rend `digest` optionnel
précisément pour ça : un appelant qui ne peut pas interroger le registre de
façon autoritaire se tait plutôt que de deviner. Le backend reste l'autorité et
peut rejeter.

L'identité exacte de l'artefact n'est **pas** affaiblie : elle ne reposait
jamais sur le digest, mais sur les deux gardes locales ci-dessous.

---

## 5. Les deux gardes d'identité — préservées à l'identique

**A. Référence exacte.** `docker image inspect "$PFE_LOCAL_REF"` sur la
référence que *ce run* a construite. Aucun `docker images`, aucun `latest`,
aucune « plus récente ».

**B. Révision OCI.** `org.opencontainers.image.revision` lu sur cette référence
exacte doit égaler le commit **complet de 40 caractères** de ce run, sinon
refus **avant tout push**. Sans cette seconde garde, deux builds d'une même
branche partagent la forme `nom:BUILD_NUMBER` et une image locale périmée
serait publiable sous le tag d'un build neuf.

```
EXACT_IMAGE_GUARD    = PASS
COMMIT_REVISION_GUARD = PASS
```

Testé : image d'un autre commit → refusée, **aucun push émis** ; label absent →
refusée ; commit non prouvable → refusée avant tout appel shell.

---

## 6. Tag — inchangé

`<BUILD_NUMBER>-<12 hex du commit>`, ex. `8-a1b2c3d4e5f6`.

Le préfixe court est une **référence** d'affichage. Le commit autoritaire
transmis en provenance reste le **sha complet** (`commitSha`, 40 caractères),
que le backend re-dérive de son côté depuis `incident.metadata.sourceCommitSha`
et compare. Un test vérifie explicitement `sent.commitSha.length() == 40`.

---

## 7. Provenance — contrat existant, sans ajout

`POST /api/azure-deploy/artifacts/provenance` + `RegisterArtifactDto`. Corps
émis :

```json
{ "projectId": "…", "buildNumber": 8, "commitSha": "<40 hex>",
  "repository": "my-app", "tag": "8-a1b2c3d4e5f6" }
```

Tests d'absence : **pas** de `digest` (le backend en est l'autorité), **pas** de
`registry` (absent du DTO, le backend le lit du projet), **pas** de
`provenanceVerified` ni de `deployed`.

### Un risque de séquencement découvert pendant cette qualification

En vérifiant le contrat backend, j'ai trouvé que `registerArtifact()` re-dérive
l'identité de build depuis **l'incident que WF1 crée à partir du rapport de fin
de pipeline**. Un appel de provenance en milieu de pipeline aurait donc été
rejeté (`DEPLOY_COMMIT_MISSING`) **pour tous les projets** — la fonctionnalité
n'aurait jamais marché.

`publish()` est donc scindé :

| Étape | Quand | Pourquoi là |
|---|---|---|
| `publishImage()` | juste après le build Docker | l'artefact existe, le push ne dépend d'aucun état plateforme, et ses faits voyagent dans le rapport de ce build |
| `recordProvenance()` | **après** `reporter.send()` | le backend a besoin de l'incident issu de ce rapport ; l'ingestion étant asynchrone, 6 tentatives espacées de 15 s |

Conséquence assumée sur la télémétrie : le rapport porte
`provenance_status = PENDING` — vrai **au moment où il est émis**, ni un succès
ni un échec. L'autorité sur la provenance reste la ligne
`deployment_artifacts` du backend, que l'écran lit déjà pour le digest.

---

## 8. Sémantique des statuts — préservée

```
push_status        NOT_CONFIGURED | NOT_ATTEMPTED | SUCCESS | FAILED
provenance_status  NOT_ATTEMPTED  | PENDING | SUCCESS | FAILED
```

`NOT_ATTEMPTED` reste la valeur de `DockerRunner` quand l'étape de publication
n'a pas tourné du tout. Deux faits distincts, jamais fusionnés, et le cas qui
compte est testé :

```
push SUCCESS + provenance FAILED
  → push_status reste SUCCESS          (le fait historique n'est pas réécrit)
  → provenance_status = FAILED
  → published_tag / published_reference restent vrais
  → le build échoue
```

---

## 9. Aucune sémantique de déploiement

Aucun champ de déploiement n'est écrit. Trois assertions le vérifient sur le
code (pas sur le vocabulaire — le publisher écrit délibérément « Published is
not deployed » dans sa sortie console, ce qui est le comportement voulu) :
aucune écriture `telemetry.docker.deployed|deployment|authorized|healthy`,
aucune clé de ce genre dans un payload, aucun appel `/deploy`.

---

## 10. WF1 — inchangé en production

Vérifié en direct pendant cette qualification :

```
WF1 vivant (vNOQiEgnXg9Zqn2q) : 50 nœuds, actif
contient les changements R48/R50 : NON
```

Les changements WF1 restent commités en source (`fa706a5`) et **non publiés**.
Les nouvelles métadonnées Docker **ne sont donc pas en ligne** côté ingestion,
et je ne le prétends pas.

---

## 11. Frontend — contrat vérifié, pas de nouvelle grosse modification

Une seule ligne ajoutée : l'état `PENDING` que le pipeline peut désormais
émettre (« En attente d'ingestion »), sans quoi l'écran aurait affiché la
chaîne brute. Le contrat final sait représenter les quatre faits demandés :

| Fait | Source | Absence |
|---|---|---|
| statut de publication | `ed.docker.push_status` | « Non disponible » |
| référence publiée | `ed.docker.published_reference` | ligne masquée |
| provenance enregistrée | `ed.docker.provenance_status` | « Non disponible » |
| digest | **artefact résolu par le backend** | « Provenance non vérifiée » |

Un test vérifie que `PENDING` reste distinct de `SUCCESS`, `FAILED`,
`NOT_ATTEMPTED` et `UNKNOWN`, et que le digest vient bien de l'artefact backend
et non du pipeline.

---

## Verdict

```
GLOBAL_CREDENTIAL_BINDING_REMOVED           = YES
UNCONFIGURED_PROJECT_REQUIRES_ACR_CREDENTIALS = NO
UNCONFIGURED_PROJECT_REQUIRES_N8N_SECRET      = NO
REQUIRE_PUBLICATION_FAILS_CLOSED            = YES

JENKINS_AZ_AVAILABLE                        = NO
JENKINS_AZ_SESSION_VALID                    = NO
JENKINS_ACR_READ_ACCESS                     = NO

DIGEST_RESOLUTION_MODE                      = BACKEND_AGENT

EXACT_IMAGE_GUARD                           = PASS
COMMIT_REVISION_GUARD                       = PASS

OFFLINE_TESTS                               = PASS — 287 assertions (3 harnais)
FRONTEND_TESTS                              = PASS — 34/34
WF1_TESTS                                   = PASS — 7/7

SHARED_LIBRARY_PUSHED                       = NO
WF1_PUBLISHED                               = NO
REAL_IMAGE_PUSH_EXECUTED                    = NO

READY_FOR_ONE_CONTROLLED_REAL_ACR_BUILD     = YES
FINAL_VERDICT = B — AZURE_CONTEXT_REQUIRES_BACKEND_DIGEST_RESOLUTION
```

**Pourquoi B et non A.** Les deux verdicts sont vrais de choses différentes et
je ne veux pas que le choix masque le fait technique : la qualification a
**établi** que Jenkins n'a ni `az` ni session Azure, et l'implémentation a été
**redessinée** en conséquence vers la résolution par le backend/agent. C'est
exactement ce que décrit B. Le code qui en résulte est, lui, prêt pour un build
réel contrôlé — d'où `READY_FOR_ONE_CONTROLLED_REAL_ACR_BUILD = YES`. Annoncer
A laisserait croire qu'aucune contrainte de contexte Azure n'a été rencontrée.

### Ce qu'il reste à faire pour le build réel contrôlé

1. **Pousser** `feat/acr-publish-provenance` (ou la fusionner dans `main`) :
   Jenkins lit `defaultVersion = main` du dépôt distant.
2. Créer les deux credentials Jenkins : `ACR_CREDENTIALS`
   (*Username with password*) et `N8N_INTERNAL_SECRET` (*Secret text*, même
   valeur que le backend). Ils ne sont plus bloquants pour les autres projets,
   mais la publication en a besoin.
3. **Publier WF1** pour que les métadonnées de publication traversent
   l'ingestion.
4. Lancer **un** build sur un projet avec ACR configuré et vérifier :
   `push_status = SUCCESS`, `provenance_status` passant de `PENDING` à
   `SUCCESS`, une ligne `deployment_artifacts` avec le digest résolu par le
   backend, et `deployment_attempts` toujours à 0 — publier n'est pas déployer.
```
