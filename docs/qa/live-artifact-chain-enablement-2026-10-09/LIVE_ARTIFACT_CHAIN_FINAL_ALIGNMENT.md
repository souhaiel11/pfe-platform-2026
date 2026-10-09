# Alignement final du runtime — R55

**Date** : 2026-10-09

> **Aucun build Jenkins n'a été lancé. Aucun déploiement Azure.**
> `deployment_artifacts` = 2, `deployment_attempts` = 0 — inchangés du début à la fin.
>
> Trois des quatre blocages sont **fermés et en service**. Les deux identifiants
> Jenkins restent la seule chose qui manque, et ils exigent un secret que je ne
> dois ni fabriquer ni prélever.

---

## Étape 0 — base de référence

```
backend        10c7951432be · image ca111a80 · revision f212d19 · 0 redémarrage
WF1            vNOQiEgnXg9Zqn2q · 50 nœuds · actif · Merge e30ccb82 · binaryMode separate
bibliothèque   defaultVersion=main · origin/main a2427f8 · feat 55a1a5a
artefacts 2 · tentatives 0 · DISPATCH OFF · HARNESS OFF
```

---

## P0 fermé — `project-reads` est devenu de la vraie source

### Inventaire et revue (étapes 1–2)

Deux fichiers seulement, et une dépendance unique au-delà de NestJS/TypeORM
(`JwtAuthGuard`). Routes réellement exposées, vérifiées dans la source et non
supposées :

```
@Controller('project-reads')  @UseGuards(JwtAuthGuard)
  @Get('incidents')
  @Get('reports')
```

Aucune autre route. `HealthController`, que le diff non commité ajoutait aussi,
**était déjà suivi** sur la ligne de release — il n'apparaissait `??` que parce
que l'arbre principal est sur la branche thème. Le seul manque réel était donc
`ProjectReadsModule`.

La revue de qualité a porté sur le contenu, pas sur l'intention :

| Exigence | Constat |
|---|---|
| portée projet dynamique | `projectId` **obligatoire** et validé UUID ; aucun chemin ne lit sans filtre de projet |
| injection SQL | requêtes **paramétrées** (`$1/$2/$3`) ; la seule valeur interpolée est l'union fermée `'incidents' \| 'reports'`, posée par le contrôleur, jamais par l'entrée |
| pagination | bornée (`pageSize ≤ 100`), refus explicite au lieu d'un rognage silencieux |
| lecture seule | transaction `REPEATABLE READ` + `SET TRANSACTION READ ONLY` ; aucune écriture, aucun chemin métier |
| absence vraie | une `aiAnalysis` illisible devient `'!invalid-analysis'`, jamais un résultat inventé ; seuls `build`/`decision` sont projetés |
| authentification | `JwtAuthGuard`, cohérent avec le reste de l'API (401 sans jeton) |
| valeurs factices / constantes projet / UUID / secrets / chemins locaux | **aucun** |

### Commit borné (étape 3)

```
PROJECT_READS_FILES_ADDED    = 3  (module, spec existante, nouvelle spec de reproductibilité)
APP_MODULE_CHANGE_INCLUDED   = oui (import + enregistrement, 2 lignes)
UNRELATED_FILES_INCLUDED     = 0
commit                       = bf0e677
```

### Test de non-régression (étape 4)

`project-reads-release-reproducibility.spec.ts` échoue si le module, l'une des
deux routes, le garde d'authentification **ou l'enregistrement dans AppModule**
disparaît de la source suivie — c'est le vrai défaut, pas le fichier manquant.
Il prouve aussi que les données de A ne peuvent pas fuir dans B (chaque requête
porte `"projectId" = $1` avec le projet demandé, et aucun identifiant n'est
interpolé), que la transaction est bien READ ONLY, et qu'aucune donnée de
production n'est requise.

Un de mes propres asserts était faux au premier jet : `/UPDATE/i` matchait la
colonne `"updatedAt"`. Corrigé en vérifiant la **forme de l'instruction**
(`SELECT`/`SET TRANSACTION`) plutôt que la présence d'un mot.

### Audit de parité source ↔ dist (étape 5) — la méthode qui manquait

L'audit précédent comparait des **branches suivies** et avait donc raté ce
module. La bonne comparaison est le **dist servi contre un build propre depuis
la source suivie**, au niveau **fichier** :

```
dist servi         : 196 fichiers .js
build propre       : 196 fichiers .js
dans le servi mais non reproductible : 0
dans le build mais non servi         : 0

UNEXPLAINED_RUNTIME_SOURCE_GAPS = 0
```

La seule différence de répertoire restante, `seed`, est expliquée : 5 fichiers
source, compilés dans **aucun** des deux dist — ils s'exécutent par `ts-node`
via des scripts npm. Rien d'autre à expliquer.

---

## Backend R95 en service (étapes 6–8)

```
R95_SOURCE_COMMIT = bf0e6772412b0d1baa339f3bc3e79b43587d9b4d
R95_SOURCE_TREE   = 0826179eda54b2c22de9f82a12d374b04df0bc2d
R95_IMAGE         = local/pfe-backend-reconciled:r95
R95_IMAGE_ID      = sha256:d5aaa82c9ec0c0d33bc0663870635c38ba27a961358213f3096ac99e7f0c04be
```

Qualification avant remplacement — R95 contre le backend vivant :

| Capacité | live | R95 |
|---|---|---|
| routes `project-reads` | 2 | **2** |
| `ProjectReadsModule` dans AppModule | 1 | **1** |
| `artifact.failureCode` | 6 | 6 |
| endpoint de provenance | 1 | 1 |
| autorisation de déploiement | 12 | 12 |
| `azureConfig.healthCheck` | 0 | **6** ✅ gain |
| `resolveSonarToken` | 3 | 3 |
| littéraux fabriqués | 0 | 0 |
| Phase 4G · DTO WF6 | 3 · 9 | 3 · 9 |
| total `.js` | 196 | **196** |

`CAPABILITY_REGRESSIONS = 0`.

Remplacement effectué, conteneur précédent conservé
(`pfe-backend-rollback-f212d19`). Vérification immédiate :

```
revision bf0e677 · 0 redémarrage · /healthz 200
project-reads/incidents  HTTP 200   (1 élément sur 8)   ← la régression qui avait forcé le retour arrière R94
project-reads/reports    HTTP 200
7 projets · n8n HTTP 200 · session Azure valid=true
sonar : couverture 88.8 · hotspots 0 · ncloc 351
```

Les trois exemples vivants exigés :

| Projet | provenance | failureCode | sens écran | gouvernance |
|---|---|---|---|---|
| app-test-pfe-vermeg | false | `DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE` | **Image non publiée** | TECHNICALLY_IMPOSSIBLE |
| pfe-app-test | **true** | `null` | **Artefact prêt** | CRITICAL_RISK *(sécurité réelle)* |
| vuln-testapp | false | `DEPLOY_COMMIT_MISSING` | **Identité de build non résolue** | TECHNICALLY_IMPOSSIBLE |

```
BACKEND_R95_LIVE = YES
BACKEND_LIVE_SOURCE_MATCH = YES
```

---

## WF1 en service, `binaryMode` préservé (étapes 9–10)

La voie API avait été écartée au tour précédent : elle n'accepte qu'un
sous-ensemble de `settings`, y ajoute ses défauts, et aurait **perdu**
`binaryMode: separate` — or WF1 compte **6 nœuds** de manipulation binaire. Je
ne l'ai pas réessayée.

Voie retenue : **`n8n import:workflow`**, la commande officielle du CLI, qui
écrit le JSON complet. Ce n'est ni l'API lossy ni une recréation manuelle de
nœuds.

Séquence : export de secours par le CLI (141 725 octets, `binaryMode` intact) →
import → **réactivation** (le CLI prévient « Remember to activate later », et il
avait bien désactivé le workflow).

État final vérifié :

```
id vNOQiEgnXg9Zqn2q · 50 nœuds · ACTIF
settings {"executionOrder":"v1","binaryMode":"separate"}   ← PRÉSERVÉ
Merge sha256 b06c628e8cbe8d39                              = source qualifiée
provenance_status : présent · zapConfidence (R48) : présent
6 nœuds binaires inchangés (Fetch Trivy/ZAP/OWASP, Parse Trivy/ZAP/OWASP)
webhook jenkins-event : HTTP 403 → enregistré et actif (403 = son propre contrôle d'accès, pas « non enregistré »)
```

WF2 (`u3eeMwTuhCsetfcS`, 195 nœuds) et WF6 (`RdYyfjVpOm2LxS95`, 184 nœuds)
**actifs et intacts** ; WF3/WF4/WF5/Chat également.

```
WF1_LIVE = YES · WF1_NODE_COUNT = 50 · WF1_BINARY_MODE_PRESERVED = YES · WF1_TESTS = 7/7
```

---

## Identifiants Jenkins — le seul blocage restant (étapes 11–12)

```
ACR_CREDENTIALS      = ABSENT
N8N_INTERNAL_SECRET  = ABSENT
```

Jenkins exige une authentification (`/api/json` non authentifié → 403) et aucun
jeton d'administration Jenkins n'est disponible : le backend n'en détient aucun,
et les `jenkinsToken` stockés par projet sont des identifiants d'intégration
plateforme — les détourner pour créer des identifiants serait une élévation de
privilège hors de leur usage prévu. La création programmatique est donc
impossible, **y compris pour `N8N_INTERNAL_SECRET` dont la valeur existe** dans
le runtime autorisé (64 caractères, jamais lue ni écrite nulle part).

Pour `ACR_CREDENTIALS`, le blocage est en outre **matériel** : aucune identité
à portée `AcrPush` n'existe. L'agent hôte sait obtenir les identifiants du
registre (`az acr credential show`), mais ce sont les identifiants
**administrateur** ; les déposer dans Jenkins élargirait leur exposition bien
au-delà de l'usage restreint de l'agent. Je ne les ai pas prélevés.

### Vérification de portée (étape 13) — l'absence ne casse rien

287 assertions vertes, dont les trois cas exigés :

- **projet sans registre + identifiants absents** → build normal,
  `push_status = NOT_CONFIGURED`, **l'identifiant ACR n'est jamais demandé**,
  aucun `docker login`, aucun push, aucun appel de provenance, aucun appel Azure ;
- **projet avec registre + identifiants présents** → chemin activé, les deux
  identifiants demandés **là seulement** ;
- **publication exigée + identifiant manquant** → échec explicite nommant
  l'identifiant.

L'absence actuelle des deux identifiants ne dégrade donc **aucun** projet.

---

## Bibliothèque partagée (étapes 14–15)

`origin/main` **inchangée** depuis le dernier audit (`a2427f8`). La branche de
fonctionnalité est 2 commits devant, 0 derrière : **avance rapide valide**,
aucun conflit à résoudre, donc aucun choix `ours`/`theirs`.

```
SHARED_LIBRARY_TESTS = PASS (287 assertions)
CONTROLLED_LIBRARY_MODE = PINNED_FEATURE_BRANCH
SHARED_LIBRARY_COMMIT = 55a1a5a (origin/feat/acr-publish-provenance, publiée)
SHARED_LIBRARY_CONTROLLED_VERSION_READY = YES
```

`main` n'est **pas** mise à jour, conformément à l'étape 15 : Jenkins a
`allowVersionOverride = true`, donc le premier build contrôlé peut épingler
`@Library('pfe-devsecops@feat/acr-publish-provenance')` et prouver la chaîne
sans toucher la version que **tous** les projets chargent. L'intégration dans
`main` se finalisera après l'E2E.

---

## Étape 16 — porte d'alignement

```
BACKEND_R95_LIVE                        = YES ✅
BACKEND_LIVE_SOURCE_MATCH               = YES ✅
WF1_LIVE                                = YES ✅
WF1_BINARY_MODE_PRESERVED               = YES ✅
SHARED_LIBRARY_CONTROLLED_VERSION_READY = YES ✅
DISPATCH                                = OFF ✅
HARNESS                                 = OFF ✅
N8N_INTERNAL_SECRET_PRESENT             = NO  ❌
ACR_CREDENTIALS_PRESENT                 = NO  ❌
```

La porte échoue sur les deux identifiants → **aucun build déclenché**, étapes 17
à 21 non exécutées, aucune de leurs preuves revendiquée.

---

## Verdict

```
P0_PROJECT_READS_FIXED            = YES
PROJECT_READS_TRACKED_FILES       = 3 (+ enregistrement AppModule)
UNEXPLAINED_RUNTIME_SOURCE_GAPS   = 0

R95_SOURCE_COMMIT = bf0e6772412b0d1baa339f3bc3e79b43587d9b4d
R95_SOURCE_TREE   = 0826179eda54b2c22de9f82a12d374b04df0bc2d
R95_IMAGE         = local/pfe-backend-reconciled:r95 (sha256:d5aaa82c9ec0)

BACKEND_R95_LIVE              = YES
BACKEND_LIVE_SOURCE_MATCH     = YES
PROJECT_READS_INCIDENTS_LIVE  = PASS
PROJECT_READS_REPORTS_LIVE    = PASS
ARTIFACT_FAILURE_CODE_LIVE    = YES

WF1_LIVE                  = YES
WF1_NODE_COUNT            = 50
WF1_BINARY_MODE_PRESERVED = YES
WF1_TESTS                 = PASS 7/7

N8N_INTERNAL_SECRET_PRESENT = NO
ACR_CREDENTIALS_PRESENT     = NO
ACR_CREDENTIAL_PRIVILEGE    = UNKNOWN (aucune identite creee ; cible AcrPush recommandee)

SHARED_LIBRARY_CONTROLLED_VERSION_READY = YES
CONTROLLED_LIBRARY_MODE                 = PINNED_FEATURE_BRANCH
SHARED_LIBRARY_COMMIT                   = 55a1a5a
SHARED_LIBRARY_TESTS                    = PASS (287 assertions)

RUNTIME_FULLY_ALIGNED     = NO  (3 blocages sur 4 fermes ; identifiants restants)
CONTROLLED_BUILD_EXECUTED = NO
CONTROLLED_BUILD_NUMBER   = n/a

IMAGE_BUILT                 = NO
IMAGE_PUSHED_TO_ACR         = NO
PUBLISHED_REFERENCE         = n/a
OCI_COMMIT_MATCH            = NOT_EXECUTED
WF1_BUILD_INGESTED          = NO
PROVENANCE_PENDING_OBSERVED = NO
PROVENANCE_SUCCESS          = NO
BACKEND_DIGEST_RESOLVED     = NO
RESOLVED_DIGEST             = n/a

DEPLOYMENT_ARTIFACT_DELTA = 0   (attendu +1 apres le build)
ARTIFACT_SOURCE           = n/a
DEPLOYMENT_ATTEMPT_DELTA  = 0   ✅ conforme

DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE = YES pour app-test-pfe-vermeg (aucun artefact : blocage legitime)
                                          NO pour pfe-app-test (artefact verifie)
GOVERNANCE_RESULT = TECHNICALLY_IMPOSSIBLE (app-test-pfe-vermeg)
                    CRITICAL_RISK          (pfe-app-test — securite, pas identite)

DOCKER_UI_SOURCE_API_UI_MATCH = NOT_EXECUTED (aucun nouvel artefact a comparer ;
                                 PASS aux tours precedents, contrat inchange)
CROSS_PROJECT_ARTIFACT_LEAK   = NO
MANUAL_DB_ARTIFACT_CREATED    = NO
SECRETS_IN_PIPELINE_LOGS      = 0
AZURE_DEPLOYMENT_EXECUTED     = NO
DISPATCH_FINAL_STATE          = OFF
HARNESS_FINAL_STATE           = OFF

P0_REMAINING = 0
P1_REMAINING = 2
   (a) ACR_CREDENTIALS absent — exige une identite a portee AcrPush (secret non fabricable)
   (b) N8N_INTERNAL_SECRET absent de Jenkins — valeur disponible dans le runtime,
       mais creation impossible sans compte administrateur Jenkins
P2_REMAINING = 2
   (a) main de la bibliotheque non fusionnee (volontaire : epinglage prefere pour le 1er build)
   (b) 7 workflows sondes temporaires inactifs a nettoyer dans n8n

READY_FOR_CONTROLLED_AZURE_DEPLOYMENT = NO
FINAL_VERDICT = B — SOURCE_AND_RUNTIME_READY_OPERATOR_CREDENTIAL_ACTION_REQUIRED
```

---

## Les deux actions opérateur, exactement

**1. `N8N_INTERNAL_SECRET`**

```
Manage Jenkins → Credentials → (global)
  Add Credentials
  Kind:   Secret text
  Secret: la valeur de la variable N8N_INTERNAL_SECRET du conteneur pfe-backend
          (à recopier sans l'afficher ; elle existe déjà, ne pas en générer une
           nouvelle — le backend valide celle-là)
  ID:     N8N_INTERNAL_SECRET
```

**2. `ACR_CREDENTIALS`**

```
Créer d'abord une identité dédiée, à portée minimale :
  az ad sp create-for-rbac --name jenkins-acr-push \
    --role AcrPush \
    --scopes <id-de-ressource-du-registre-acrpfedevsecops>

Puis, dans Jenkins :
  Manage Jenkins → Credentials → (global)
  Add Credentials
  Kind:     Username with password
  Username: appId du principal
  Password: secret du principal
  ID:       ACR_CREDENTIALS
```

**Ne pas** utiliser le mot de passe administrateur du registre : `AcrPush`
suffit pour pousser, et limite l'exposition.

Ensuite, épingler la bibliothèque pour le seul build contrôlé, dans le
Jenkinsfile d'`app-test-pfe-vermeg` :

```groovy
@Library('pfe-devsecops@feat/acr-publish-provenance') _
```

Puis **un** build. Les étapes 17 à 21 deviennent alors observables, et je peux
reprendre à la preuve d'artefact.

### Retours arrière disponibles

```
backend  : conteneur pfe-backend-rollback-f212d19 (arrêté) + image ca111a80
WF1      : export CLI complet, 141 725 octets, binaryMode intact
           → n8n import:workflow --input=<export> puis réactivation
```
