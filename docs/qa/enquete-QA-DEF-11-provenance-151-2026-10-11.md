# Enquête QA-DEF-11 — provenance de `acrpfedevsecops.azurecr.io/pfe-app-test:151`

**Date :** 2026-10-11
**Nature :** investigation en lecture seule
**Question :** le tag ACR `pfe-app-test:151` provient-il réellement du pipeline Jenkins `pfe-app-test` #151 ?

> **Réponse courte.** Il faut séparer deux affirmations que le registre confond.
> L'**artefact** présent dans ACR **est** bien, cryptographiquement, celui
> construit par le build #151 — **prouvé**. Mais le **pipeline #151 n'a pas
> publié** cet artefact — **réfuté**. L'étiquette `source = JENKINS_PIPELINE`
> est donc **incorrecte** ; la valeur juste, dans le vocabulaire du système
> lui-même, est `MANUAL_REGISTERED`. L'**auteur** de la publication est
> **indéterminé** et le restera : aucun audit de poussée n'est conservé.

---

## 1. Faits prouvés

### 1.1 Identité du build #151

| Élément | Valeur | Source de la preuve |
|---|---|---|
| Contrôleur | `jenkins`, image `pfe-jenkins-with-docker-cli:2.568.1-jdk21`, Jenkins **2.568.1** | `docker inspect`, `lastExecVersion` |
| Job | `pipeline pfe-app-test` (`CpsScmFlowDefinition`) | `jobs/pfe-app-test/config.xml` |
| Nœud d'exécution | **built-in node** (pas d'agent ; `/var/jenkins_home/nodes` absent) | journal + `build.xml` sans `builtOn` |
| Démon Docker | **DinD** — `DOCKER_HOST=tcp://docker:2376` | env du conteneur `jenkins` |
| Début | **2026-10-06 16:07:38 UTC** (`timestamp=1791302858376`) | `build.xml` |
| Durée | **278 490 ms** → fin ≈ **16:12:16 UTC** | `build.xml` |
| Résultat | **SUCCESS** | `build.xml` |
| Branche | `main` | `hudson.plugins.git.util.BuildData` |
| Commit applicatif | **`393816c250f73d907eb5a2dd43b2ec2288c7abcb`** | `git checkout -f` dans le journal |
| Dépôts | `pfe-app-test.git` + bibliothèque partagée `pfe-devsecops-shared-library.git` (`pfe-devsecops@main`, *trusted*) | `BuildData`, `LibrariesAction` |
| **Déclencheur** | **`hudson.model.Cause$UserIdCause` → `userId = souhaiel`** → **déclenchement manuel par un humain** | `build.xml` |
| Paramètres | `JENKINS_HARD_GATE=false`, `CVSS_FAIL_THRESHOLD=9.0`, `PFE_VALIDATION_CONTEXT=` **(vide)** | `ParametersAction` |
| Étapes | 9 : `Init`, `Checkout`, `Build`, `SonarQube Analysis`, `Docker Build`, `Trivy Scan`, `OWASP Dependency Check`, `Kubernetes Target Check`, `ZAP DAST Scan` | journal |

`PFE_VALIDATION_CONTEXT` vide ⇒ ce n'était **pas** une exécution de validation de PR.

### 1.2 Ce que le build a réellement fait de l'image

Commande de construction, étiquettes OCI incluses (journal ligne 346) :

```
+ docker build \
    --label org.opencontainers.image.revision=393816c250f73d907eb5a2dd43b2ec2288c7abcb \
    --label org.opencontainers.image.source=https://github.com/souhaiel11/pfe-app-test.git \
    --label org.opencontainers.image.created=2026-10-06T16:08:04Z \
    -t pfe-app-test:151 .
```

Suite (lignes 496–587) :

```
#16 writing image sha256:12aba29ceacaf1411a272df99c5376cdc0dfd9baa98de2bcd2f2c1a0c9256777 done
#16 naming to docker.io/library/pfe-app-test:151 done
+ docker tag pfe-app-test:151 pfe-app-test:latest
+ docker save pfe-app-test:151 -o /tmp/trivy-test-151/image.tar
```

→ construction locale, étiquetage local, export en archive pour le scan Trivy.
**Aucun nom de registre, aucune publication.**

### 1.3 Absence de publication — recherche exhaustive

Journal complet : **149 468 octets, 960 lignes**. Recherche sur l'ensemble des
mécanismes de publication connus :

```
docker push | docker login | az acr | acr login | buildx | skopeo | crane |
regctl | oras | podman push | "The push refers" | Pushed | "digest: sha256" |
"manifest digest"
→ 0 occurrence
```

Le journal ne contient en tout que **trois** `sha256:` :

| Digest | Rôle |
|---|---|
| `sha256:12aba29ceacaf…` | image construite (`writing image`) |
| `sha256:805f366910ae…` | image de base `openjdk-11` |
| `sha256:e7969cf962d7…` | couche/base intermédiaire |

Le digest du manifeste ACR, `sha256:6dc3cdba6959…`, **n'y figure pas** (0 occurrence).

La seule mention d'ACR dans tout le journal est une ligne de **listing**
(`docker images | grep pfe-app-test`, ligne 504) montrant le tag *précédent* :
`acrpfedevsecops.azurecr.io/pfe-app-test:150`.

### 1.4 Le manifeste ACR du tag 151

```
digest          : sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5
config.digest   : sha256:12aba29ceacaf1411a272df99c5376cdc0dfd9baa98de2bcd2f2c1a0c9256777
createdTime     : 2026-10-06T16:17:57.8015157Z
lastUpdateTime  : 2026-10-06T16:17:57.8015157Z   (identique ⇒ poussé une seule fois, jamais réécrit)
signed          : false                           (aucune signature / content trust)
layers          : 11 couches
```

### 1.5 La corrélation décisive : digest de configuration

> **Attention méthodologique.** Le digest affiché par `docker build`
> (`writing image sha256:…`) est le digest de **configuration** de l'image.
> Le digest d'un tag de registre (`sha256:6dc3cdba…`) est le digest du
> **manifeste**. Ce sont deux objets différents : leur non-correspondance ne
> prouve rien, et ils ne sont **pas** comparables directement. Le manifeste
> contient en revanche le digest de configuration, qui l'est.

| | Valeur |
|---|---|
| Build #151, journal ligne 496 | `sha256:12aba29ceacaf1411a272df99c5376cdc0dfd9baa98de2bcd2f2c1a0c9256777` |
| Manifeste ACR tag 151, `config.digest` | `sha256:12aba29ceacaf1411a272df99c5376cdc0dfd9baa98de2bcd2f2c1a0c9256777` |
| **Verdict** | **IDENTIQUES** |

Le digest de configuration est un hachage de la configuration complète de
l'image — diffIDs de toutes les couches, étiquettes, env, cmd, entrypoint.
Une égalité exacte signifie que **l'image présente dans ACR est bit à bit
l'artefact produit par le build #151**.

**Corollaire démontré, non supposé :** les étiquettes OCI contenues dans ce
blob de configuration sont nécessairement celles posées par le build —
`revision=393816c250f7…`, `source=https://github.com/souhaiel11/pfe-app-test.git`,
`created=2026-10-06T16:08:04Z`. La preuve de provenance invoquée par le backend
(« le label `revision` correspond au commit validé ») est donc **exacte**, et
désormais corroborée indépendamment par l'égalité des digests de configuration.

### 1.6 Où le nom de registre a été apposé

| Démon | `pfe-app-test:151` | `acrpfedevsecops.azurecr.io/pfe-app-test:151` |
|---|---|---|
| **DinD `jenkins-docker`** (celui qui a construit) | **présent** — `12aba29ceaca`, 2026-10-06 16:08:29 UTC | **ABSENT** |
| **Hôte** | présent — `12aba29ceaca` | **PRÉSENT** — `12aba29ceaca` |

Le DinD possède aussi `pfe-app-test:latest` (même ID) et le tag ACR du build
*précédent* (`:150`), mais **jamais** le tag ACR du 151.

→ **Le nommage pour ACR a eu lieu sur le démon de l'hôte, hors de Jenkins.**

### 1.7 Chronologie

| Heure (UTC) | Événement | Écart |
|---|---|---|
| 16:07:38 | début du build #151 | — |
| 16:08:04 | étiquette `org.opencontainers.image.created` posée | +26 s |
| 16:08:29 | image `pfe-app-test:151` créée (DinD et hôte) | +51 s |
| 16:12:16 | **fin du build #151** (278 s) | +4 min 38 s |
| 16:12:16 | incident `70bc8f46…` créé dans la base de **production** | — |
| **16:17:57** | **manifeste ACR du tag 151 créé** | **+5 min 41 s après la fin du build** |
| 16:19:13 | ligne de provenance écrite dans `deployment_artifacts` | +1 min 16 s après la poussée |

### 1.8 L'enregistrement de provenance du backend

```json
{
  "id": "008f1b22-7f96-4659-a88c-acc4df128b7e",
  "buildNumber": 151,
  "commitSha": "393816c250f73d907eb5a2dd43b2ec2288c7abcb",
  "registry": "acrpfedevsecops", "repository": "pfe-app-test", "tag": "151",
  "digest": "sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5",
  "source": "JENKINS_PIPELINE",
  "provenanceVerified": true,
  "provenanceEvidence": "org.opencontainers.image.revision=393816c250f7… matches validated commit (independently verified)",
  "createdAt": "2026-10-06T16:19:13.418647"
}
```

### 1.9 La plateforme se contredit elle-même

L'incident de production du build #151 (`70bc8f46-5cd2-48a3-9f8b-169cf2ba250b`)
contient, à `metadata.enrichedData.docker` :

```json
{ "image_tag": "pfe-app-test:151", "push_status": "NOT_ATTEMPTED", "build_status": "SUCCESS" }
```

**C'est le pipeline lui-même qui déclare n'avoir pas tenté de publication**, et
qui déclare un tag d'image **local** (`pfe-app-test:151`, sans registre). Ce
constat est repris dans un rapport antérieur du projet
(`docs/qa/docker-view-navigation-2026-10-09/DOCKER_VIEW_NAVIGATION_REPORT.md`,
ligne 111 : `publication | NOT_ATTEMPTED | « Non tentée »`).

Deux enregistrements de production se contredisent donc :

| Enregistrement | Affirmation |
|---|---|
| `deployment_artifacts.source` | `JENKINS_PIPELINE` |
| `incidents.metadata.enrichedData.docker.push_status` | `NOT_ATTEMPTED` |

### 1.10 Audit de cohérence du registre (lecture seule, exécuté ce jour)

Règle : toute ligne marquée `JENKINS_PIPELINE` doit correspondre à un build
dont le `push_status` rapporté vaut `SUCCESS`.

| tag | build | `source` | `push_status` rapporté | `image_tag` rapporté | verdict |
|---|---|---|---|---|---|
| `150` | 150 | `MANUAL_REGISTERED` | `NOT_ATTEMPTED` | `pfe-app-test:150` | cohérent |
| **`151`** | **151** | **`JENKINS_PIPELINE`** | **`NOT_ATTEMPTED`** | **`pfe-app-test:151`** | **INCOHÉRENT** |
| `10-f02b6fb4d2b2` | 10 | `JENKINS_PIPELINE` | `SUCCESS` | `app-test-pfe-vermeg:10` | cohérent |
| `9-f02b6fb4d2b2` | 10 | `JENKINS_PIPELINE` | `SUCCESS` | `app-test-pfe-vermeg:10` | cohérent |

**Une seule ligne sur quatre est incohérente, et c'est le tag 151.** La règle
se valide elle-même : elle accepte les deux artefacts de
`app-test-pfe-vermeg` — dont le pipeline **publie réellement** (étape
`Publish Image (ACR)`, `docker push` présent dans son journal) — et accepte la
ligne 150, honnêtement marquée `MANUAL_REGISTERED`.

### 1.11 Pourquoi le défaut est structurel, pas accidentel

`backend/src/azure-deploy/deployment-artifact.service.ts:274` :

```ts
source: options.requireVerifiedProvenance ? 'JENKINS_PIPELINE' : 'MANUAL_REGISTERED',
```

Le champ `source` **ne dérive d'aucune preuve de publication**. Il dérive
uniquement du point d'entrée appelé :

| Route | `requireVerifiedProvenance` | `source` écrit | Garde |
|---|---|---|---|
| `POST /api/azure-deploy/artifacts/register` | `false` | `MANUAL_REGISTERED` | `JwtAuthGuard` + **contrôle de rôle `admin` explicite** |
| `POST /api/azure-deploy/artifacts/provenance` | `true` | **`JENKINS_PIPELINE`** | `JwtOrInternalSecretGuard`, **aucun contrôle de rôle** |

Deux conséquences :

1. `source` enregistre **quel point d'entrée a été appelé**, pas **qui a
   publié l'image**. Le commentaire du code l'admet : *« A human with a valid
   JWT can also call it (same guard), but this endpoint exists for CI. »*
2. Recherche de `push_status` / `pushStatus` / `pushed` dans tout
   `backend/src/azure-deploy/` : **aucune occurrence**. Le champ de preuve qui
   aurait tranché existe déjà dans les données et **n'est jamais consulté**.

Observation de sécurité associée (lue dans le code, **non testée en direct**) :
la route qui estampille `JENKINS_PIPELINE` exige un rôle **moins** élevé que
celle qui estampille `MANUAL_REGISTERED`. Un utilisateur authentifié non
administrateur pourrait donc produire une ligne `JENKINS_PIPELINE`.

### 1.12 Aucune preuve d'auteur de la publication n'est récupérable

| Piste | Résultat |
|---|---|
| Paramètres de diagnostic sur le registre | **`[]`** — aucun. Donc aucun `ContainerRegistryRepositoryEvents` conservé, aucun journal de poussée. |
| Signature / content trust du manifeste | **`signed: false`** — aucune attestation cryptographique du publicateur. |
| Journal d'activité Azure | n'enregistre pas les opérations de plan de données (poussées) d'un ACR. |
| `adminUserEnabled` | **`true`** — le compte admin du registre est actif, donc une poussée anonyme quant à l'identité réelle est possible. |
| `anonymousPullEnabled` | `false` ; SKU `Basic` ; politique de quarantaine `disabled`. |

**L'identité du publicateur est définitivement non récupérable** pour cet
événement. C'est en soi un défaut de conception (voir §4.5).

---

## 2. Hypothèses — explicitement non prouvées

| # | Hypothèse | Éléments à l'appui | Pourquoi elle reste une hypothèse |
|---|---|---|---|
| H1 | La poussée a été faite **manuellement depuis l'hôte** par l'opérateur humain (le compte `souhaiel`, qui avait déjà déclenché le build à la main), vers 16:17:57 UTC. | Tag ACR présent **uniquement** sur le démon de l'hôte ; aucune poussée dans Jenkins ; écart de 5 min 41 s ; build déclenché manuellement par `souhaiel` ; un runbook **manuel** du même jour (`docs/qa/final-preflight-2b8-20261006/FIRST-DEPLOYMENT-RUNBOOK.md`) liste déjà `sha256:6dc3cdba…` et le commit `393816c2…` comme valeurs d'entrée attendues d'une procédure opérée par un humain. | Aucun audit ACR, aucune signature, aucun historique de commandes conservé. L'identité n'est pas démontrable. |
| H2 | L'image a atteint l'hôte via l'archive `docker save` du build (`/tmp/trivy-test-151/image.tar`) puis a été chargée et re-étiquetée. | Le build produit bien cette archive ; l'hôte porte le même ID d'image. | L'hôte pourrait tout aussi bien avoir obtenu l'image par un `docker pull` **après** la poussée — ce qui laisserait exactement la même trace. Indiscernable sans journaux. |
| H3 | La poussée faisait partie d'un exercice de qualification délibéré et documenté (« premier déploiement »), et non d'un contournement. | Le runbook existe, daté du même jour, et insiste sur « le backend résout commit/digest indépendamment ». | Le runbook décrit l'**autorisation de déploiement**, pas la poussée elle-même ; il ne contient aucune commande de publication. |

Aucune commande `docker push` visant `pfe-app-test:151` n'est documentée nulle
part dans le dépôt ni dans `docs/`.

---

## 3. Verdict sur la provenance `JENKINS_PIPELINE`

Il faut distinguer trois affirmations que le champ `source` amalgame :

| # | Affirmation | Verdict | Preuve |
|---|---|---|---|
| A | L'artefact du tag ACR `151` **est** celui construit par le build Jenkins #151 | **PROUVÉ** | Égalité exacte du digest de configuration (§1.5) : `sha256:12aba29ceacaf…` des deux côtés |
| B | Le code source de cet artefact est bien le commit validé `393816c2…` | **PROUVÉ** | Étiquette OCI `revision`, posée par le build (§1.2) et nécessairement contenue dans le blob de configuration dont le digest correspond (§1.5) |
| C | **Le pipeline Jenkins #151 a publié ce digest dans ACR** | **RÉFUTÉ** | 0 occurrence de publication sur 960 lignes de journal (§1.3) ; le pipeline `pfe-app-test` n'a pas d'étape de publication ; le tag ACR n'existe pas sur le démon qui a construit (§1.6) ; le pipeline déclare lui-même `push_status: NOT_ATTEMPTED` (§1.9) ; manifeste créé 5 min 41 s après la fin du build (§1.7) |
| D | Identité de l'auteur de la publication | **INDÉTERMINÉE** | Aucun audit, aucune signature (§1.12) |

### Conclusion

**La provenance `JENKINS_PIPELINE` est RÉFUTÉE.** La valeur juste, dans le
vocabulaire du système lui-même, est **`MANUAL_REGISTERED`** — exactement comme
la ligne 150, qui décrit honnêtement la même situation.

**Le tag ne doit pas être marqué comme vérifié au titre du pipeline :** le
pipeline n'a pas publié le digest correspondant.

Nuance importante à ne pas perdre : `provenanceVerified: true` reste une
affirmation **vraie et utile** — elle porte sur l'identité du **code source**
de l'artefact (affirmation B), pas sur l'acte de publication. Le défaut n'est
pas que la provenance soit fausse ; c'est que **deux affirmations de nature
différente partagent un seul champ**, et que la plus forte des deux n'est
adossée à aucune preuve.

---

## 4. Nature du build #151 : build de production historique

**Verdict : build de production historique, déclenché manuellement — pas un
essai isolé.**

| Critère | Constat |
|---|---|
| Contrôleur | l'**unique** contrôleur Jenkins de l'installation (il n'existe aucune instance de test — vérifié : un seul conteneur Jenkins) |
| Job | `pfe-app-test`, le job de production du projet, dans sa numérotation continue (#151 est le dernier) |
| Branche | `main` |
| Effet sur la production | a créé l'incident `70bc8f46…` **dans la base de production** à 16:12:16, via le webhook de la plateforme |
| Étapes | les 9 étapes de production, dont `Kubernetes Target Check` contre minikube et un scan ZAP réel dans le pod |
| Artefact | enregistré dans le registre d'artefacts de **production** et référencé par le runbook de déploiement |
| Déclencheur | **manuel** (`UserIdCause: souhaiel`) et non un webhook SCM |

Le déclenchement manuel ne le rend pas « isolé » : il a tourné sur
l'infrastructure de production, avec les identifiants de production, et ses
effets sont persistés en production. La seule réserve honnête est qu'il ne
s'agissait pas d'un build automatique déclenché par un commit.

---

## 5. Correction de conception proposée

### 5.1 Séparer les deux affirmations dans le modèle de données

Remplacer le champ unique `source` par deux champs indépendants :

| Champ | Signifie | Prouvé par |
|---|---|---|
| `artifactIdentitySource` | d'où viennent les octets | étiquette OCI `revision` + égalité du digest de configuration |
| `publicationSource` | qui a publié dans le registre | reçu de poussée vérifié (ci-dessous) |

Valeurs de `publicationSource` : `PIPELINE_VERIFIED`, `MANUAL_ATTESTED`,
**`UNKNOWN`** (défaut).

### 5.2 Dériver `publicationSource` d'une preuve, jamais du point d'entrée appelé

Le rappel CI doit transmettre un **reçu de poussée** et le backend doit le
recouper, en refusant à défaut :

1. Le digest de **manifeste** tel que retourné par `docker push`
   (`digest: sha256:…`) — **doit** être égal au digest résolu dans le registre.
2. L'URL et le numéro du build Jenkins.
3. **Le `push_status` du build doit valoir `SUCCESS`.** Ce champ existe déjà,
   à `incidents.metadata.enrichedData.docker.push_status`, et n'est aujourd'hui
   jamais consulté.

Si l'une des trois conditions manque → `publicationSource = UNKNOWN`, jamais
`PIPELINE_VERIFIED`. *Fail-closed*, dans l'esprit du reste de la plateforme.

### 5.3 Refuser `UNKNOWN` au moment de l'autorisation de déploiement

`evaluateProvenDeploymentArtifact` / la politique d'autorisation doivent
traiter `publicationSource = UNKNOWN` comme un refus dur, au même titre
qu'une provenance non vérifiée — de sorte qu'un artefact dont la publication
n'est pas attestée ne puisse pas être déployé.

### 5.4 Corriger l'écart d'autorisation entre les deux routes

`POST /artifacts/provenance` estampille la valeur la plus forte avec la garde
la plus faible. Deux options :

- retirer la branche JWT et n'accepter que le secret interne (route
  strictement CI) ; **ou**
- ajouter le même contrôle de rôle `admin` que `/artifacts/register`.

### 5.5 Rendre l'auteur d'une poussée auditable

- Activer les **paramètres de diagnostic** du registre
  (`ContainerRegistryRepositoryEvents`, `ContainerRegistryLoginEvents`) vers un
  espace de travail Log Analytics. Sans cela, l'identité d'un publicateur est
  irrécupérable — cette enquête le démontre.
- Donner à chaque publicateur une **identité distincte** (jeton de portée
  `push` par pipeline, comme `jenkins-acr-push` l'est déjà pour
  `app-test-pfe-vermeg`) et **désactiver `adminUserEnabled`**.
- Envisager la signature des images (content trust / cosign) : aujourd'hui
  `signed: false`, donc aucune attestation cryptographique du publicateur.

### 5.6 Aligner le pipeline sur celui qui fonctionne déjà

Ajouter à `pfe-app-test` les étapes `Publish Image (ACR)` et
`Record Image Provenance` qui existent **déjà** dans `app-test-pfe-vermeg` —
dont les deux artefacts passent l'audit du §1.10. Le pipeline deviendrait alors
réellement le publicateur, et `PIPELINE_VERIFIED` serait mérité.

### 5.7 Régulariser la ligne existante

Requalifier la ligne du tag `151` en `MANUAL_REGISTERED` (ou
`publicationSource = UNKNOWN` après migration), en conservant
`provenanceVerified: true` — qui, lui, est exact. **Non effectué :** ce serait
une écriture dans la base de production.

---

## 6. Tests nécessaires

### 6.1 Tests unitaires — attribution de `publicationSource`

Table de cas sur `registerArtifact` :

| Entrée | Attendu |
|---|---|
| aucun reçu de poussée | `UNKNOWN` |
| reçu dont le digest de manifeste ≠ digest résolu dans le registre | `UNKNOWN` + `failureCode: PUSH_RECEIPT_DIGEST_MISMATCH` |
| reçu valide mais `push_status = NOT_ATTEMPTED` | `UNKNOWN` + `failureCode: PIPELINE_DID_NOT_PUBLISH` |
| reçu valide et `push_status = SUCCESS` | `PIPELINE_VERIFIED` |
| appel via `/artifacts/register` avec un reçu valide | reste `MANUAL_ATTESTED` (le point d'entrée ne confère jamais la valeur forte) |

### 6.2 Tests unitaires — autorisation

- Un JWT humain **non administrateur** appelant `/artifacts/provenance` ne doit
  jamais produire `PIPELINE_VERIFIED`.
- Un JWT humain **administrateur** non plus, en l'absence de reçu.
- Seul le secret interne accompagné d'un reçu valide y parvient.

### 6.3 Test de politique de déploiement

`publicationSource = UNKNOWN` doit être refusé par
`evaluateProvenDeploymentArtifact` et par la création d'autorisation, avec un
code d'échec explicite — même quand `provenanceVerified = true`.

### 6.4 Test de non-régression reproduisant exactement QA-DEF-11

Fixture rejouant la situation du 151 :

- journal de build **sans** aucune publication ;
- `push_status = NOT_ATTEMPTED` ;
- digest de manifeste ACR `sha256:6dc3cdba…` dont le `config.digest` **égale**
  celui écrit par le build.

**Attendu :** `artifactIdentitySource = PIPELINE_BUILT` (l'identité est
prouvée) **et** `publicationSource = UNKNOWN` (la publication ne l'est pas).
Le test échoue si le résultat est `PIPELINE_VERIFIED`.

C'est précisément le test qui aurait empêché ce défaut.

### 6.5 Audit de données, à exécuter en continu

La requête du §1.10 est directement utilisable comme contrôle périodique :
pour toute ligne `source = JENKINS_PIPELINE`, vérifier que le `push_status` du
build correspondant vaut `SUCCESS`. Elle est auto-validante (elle accepte les
trois lignes légitimes et signale la seule fautive) et détecte aujourd'hui
**1 incohérence sur 4 lignes**.

### 6.6 Test en direct (nécessite un ACR d'essai dédié)

Sur un registre d'essai séparé, avec une identité de poussée dédiée :

- une poussée réelle **par le pipeline** → doit donner `PIPELINE_VERIFIED` ;
- une poussée manuelle du même artefact → doit donner `MANUAL_ATTESTED` ;
- une poussée manuelle suivie d'un rappel CI mensonger → doit être **refusée**.

Ce test est aujourd'hui **BLOCKED** : il n'existe ni abonnement ni registre
Azure d'essai.

---

## 7. Contrôles d'intégrité de cette enquête

| Contrôle | Résultat |
|---|---|
| Opérations ACR | **lecture seule** : `az acr show`, `az acr manifest show`, `az acr manifest show-metadata`, `az acr token list`, `az monitor diagnostic-settings list`. Aucune poussée, aucun import, aucune suppression. |
| ACR après enquête | 3 dépôts, 2 manifestes chacun, manifeste le plus récent `2026-10-09T21:08:36Z` — inchangé. |
| Base de production | **lecture seule** (`SELECT` uniquement). `deployment_artifacts` : 4 lignes, plus récente `2026-10-09 22:07:36` — inchangée. |
| Jenkins | lecture du système de fichiers du conteneur uniquement. Aucun build déclenché, aucune configuration modifiée. |
| Dépôt Git | aucune modification. Seul ajout : ce rapport dans `docs/qa/`. |
| Azure | aucune écriture, aucune ressource créée ou modifiée. |
| Secrets | aucun lu ni affiché. L'identifiant `jenkins-acr-push` figure dans un journal Jenkins préexistant ; son mot de passe passe par `--password-stdin` et n'apparaît nulle part. Aucun jeton de registre n'a été récupéré. |

---

*Fait le 2026-10-11. Aucune valeur de secret n'est consignée dans ce document.*
