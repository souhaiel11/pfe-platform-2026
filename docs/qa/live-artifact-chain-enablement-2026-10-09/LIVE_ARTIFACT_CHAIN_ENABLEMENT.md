# Mise en service de la chaîne d'artefact — R54

**Date** : 2026-10-09

> **Aucun build réel n'a été lancé. Aucun déploiement Azure.**
> `deployment_artifacts` = 2, `deployment_attempts` = 0, inchangés.
> Le backend a été remplacé, **puis remis en arrière** après détection d'une
> régression. L'état final est sain et identique à l'état initial.

---

## Étape 1 — jeu de release exact

```
CURRENT_RECONCILIATION_BRANCH = release/backend-source-reconciliation-r93
CURRENT_BACKEND_HEAD          = d3140693309bae15e4eacefe2e1d59616fa51fae
CURRENT_BACKEND_TREE          = 7122d084474fe2d27d9d391db6b41ffded697742
CURRENT_WF1_SOURCE_VERSION    = nœud Merge sha256 b06c628e8cbe8d39 (porte provenance_status)
CURRENT_SHARED_LIB_COMMIT     = 55a1a5a (feat/acr-publish-provenance)
LIVE_BACKEND_COMMIT           = f212d19 (arbre f84bdefa…)
LIVE_WF1_VERSION              = nœud Merge sha256 e30ccb82160c73e1 (sans provenance_status)
LIVE_SHARED_LIB_COMMIT        = a2427f8 (origin/main, sans AcrPublisher)
```

**L'image R93 était bien périmée**, comme l'avertissement le supposait : elle
portait `revision = 53c640d`, `tree = fd0594ed…`, soit **5 commits de retard**
sur HEAD (`81f94d1`, `50aca7a`, `28a855d`, `1e1de20`, `d314069`). Elle n'a donc
pas été déployée.

Une image neuve a été construite depuis HEAD, tests et build propres :

```
NEW_BACKEND_IMAGE        = local/pfe-backend-reconciled:r94
NEW_BACKEND_IMAGE_ID     = sha256:ff7b22d3ce8849f0ed677f5c1fa809815196455ddf815ddb6923f7f0a2f63b62
NEW_BACKEND_SOURCE_COMMIT= d3140693309bae15e4eacefe2e1d59616fa51fae
NEW_BACKEND_SOURCE_TREE   = 7122d084474fe2d27d9d391db6b41ffded697742
```

## Étape 2 — qualification : aucune régression détectée par la sonde

| Capacité | live | r94 |
|---|---|---|
| `artifact.failureCode` | 0 | **1** ✅ |
| `azureConfig.healthCheck` | 0 | **6** ✅ |
| repli plateforme Jenkins | 0 | **1** ✅ |
| `security_hotspots` Sonar | 0 | **2** ✅ |
| littéraux fabriqués | 0 | 0 |
| autorisation de déploiement, gouvernance, Phase 4G, WF6, migrations | identiques | identiques |

`BACKEND_CAPABILITY_REGRESSION = 0` **selon cette sonde** — et c'est précisément
là que la sonde était insuffisante (§3).

## Étape 3 — déploiement, puis RETOUR ARRIÈRE

Le remplacement a réussi et s'est vérifié d'abord parfaitement :

```
revision d314069 · tree 7122d084 · /healthz 200 · 0 redémarrage
7 projets servis · n8n HTTP 200 · session Azure valid=true
artifact.failureCode désormais exposé
```

Et la capacité nouvelle fonctionnait **réellement**, sur données réelles :

| Projet | `failureCode` exposé | Message écran |
|---|---|---|
| app-test-pfe-vermeg | `DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE` | **Image non publiée** |
| pfe-app-test | `null` + `provenanceVerified: true` | **Artefact prêt** |
| vuln-testapp | `DEPLOY_COMMIT_MISSING` | **Identité de build non résolue** |
| devsecops-testbed | `DEPLOY_COMMIT_MISSING` | idem |

Trois états distincts, en direct — le §13 prouvé sur des données réelles et non
sur des fixtures.

### La régression

```
GET /api/project-reads/incidents  →  HTTP 404
```

Cet endpoint alimente la liste d'analyses des onglets Rapport, Docker et
Sécurité. Sans lui, le frontend servi ne peut plus charger le détail d'un
projet.

**Cause racine, établie précisément** :

```
backend/src/project-reads/   →  status ?? (NON SUIVI)
  présent dans release/azure-governance-r1            : 0 fichier
  présent dans release/backend-source-reconciliation-r93 : 0 fichier
  présent dans theme-vermeg-reconciled (HEAD)         : 0 fichier
  présent dans l'arbre de travail                      : 2 fichiers
```

**Le backend en production dépend de code jamais commité.** `project-reads`
expose `@Controller('project-reads')` avec `@Get('incidents')` et
`@Get('reports')`, et il est câblé dans `app.module.ts` (2 références, fichier
lui-même modifié non commité). L'image R94, construite fidèlement depuis la
source commitée, en est donc légitimement dépourvue.

Conformément à l'étape 3 (« si le remplacement échoue : retour arrière
immédiat, vérifier l'ancien backend, STOP »), le retour arrière a été fait
immédiatement et vérifié :

```
revision f212d19 · /healthz 200 · 0 redémarrage
/project-reads/incidents → HTTP 200 · 7 projets · frontend HTTP 200
dispatch=OFF harness=OFF · artifacts=2 · attempts=0
```

### Ce que cela corrige dans ma conclusion R93

J'avais conclu que `r93` était un **sur-ensemble** de la release déployée. C'est
vrai des fichiers **suivis** — et c'était une comparaison incomplète : la
production tournait aussi sur un module **non suivi**. La comparaison correcte
est celle que j'ai faite ici : **les modules du `dist` servi contre la source**.
Le périmètre est heureusement borné — exactement **un** module :

```
dans le dist servi mais absent de r93 : project-reads   (seul)
dans r93 mais absent du dist servi    : seed            (dev-only, exclu du build prod, normal)
```

## Étape 4 — WF1 : publication refusée pour une bonne raison

Le diff est minimal et net : **un seul nœud change**, `Merge All Fetched Data`,
50 nœuds de part et d'autre. Export de secours sauvegardé (280 261 octets).

La publication par l'API publique a été **rejetée** :

```
HTTP 400 — request/body/settings must NOT have additional properties
```

Sonde sur un workflow jetable (créé puis supprimé) : l'API n'accepte qu'un
sous-ensemble de `settings` et **y ajoute ses propres défauts**. Publier ainsi
**perdrait `binaryMode: separate`**.

Or WF1 dépend réellement du binaire : **6 nœuds** de manipulation de fichiers
(`Fetch Trivy/ZAP/OWASP Report`, `Parse Trivy/ZAP/OWASP JSON`) et 3 références
binaires dans le nœud Merge. Changer ce réglage sans l'avoir qualifié n'est pas
acceptable, et l'API ne permet pas de le restaurer ensuite.

**WF1 vivant est resté intact** (le 400 a échoué du bon côté) : 50 nœuds,
actif, `settings` d'origine, nœud Merge `e30ccb82…`.

## Étape 5 — identifiants Jenkins

```
ACR_CREDENTIALS      présent = NON
N8N_INTERNAL_SECRET  présent = NON
```

`N8N_INTERNAL_SECRET` **existe** dans le runtime autorisé (backend, 64
caractères, valeur jamais lue ni affichée). Mais le créer dans Jenkins exige
l'UI ou `jenkins-cli` avec un compte administrateur — que je n'ai pas. Je ne
peux donc pas l'approvisionner, même en disposant de la valeur.

Pour `ACR_CREDENTIALS` : aucun identifiant ACR/Azure/registre n'existe dans
Jenkins. L'agent hôte, lui, obtient les identifiants du registre lui-même via
`az acr credential show`. **Je ne les ai pas récupérés à cette fin** : ce sont
les identifiants *administrateur* du registre, et les déposer dans Jenkins
élargirait leur exposition bien au-delà de l'usage restreint de l'agent.

**Recommandation** : un principal de service limité à `AcrPush`, pas le mot de
passe administrateur du registre.

## Étape 6 — bibliothèque partagée publiée, `main` intacte

287 assertions vertes, avance nette de 2 commits sur `origin/main`, aucun
retard.

Configuration Jenkins : `defaultVersion = main`, `implicit = false`,
**`allowVersionOverride = true`**.

Décision retenue : **pousser la branche de fonctionnalité, laisser `main`
inchangée**.

```
origin/feat/acr-publish-provenance = 55a1a5a   ← publiée
origin/main                        = a2427f8   ← INCHANGÉE
```

Pourquoi : `main` est chargée par **tous** les projets. Deux blocages
indépendants (WF1, identifiant ACR) rendent l'E2E impossible aujourd'hui ;
activer sur `main` du code CI qu'aucun build ne peut valider de bout en bout
serait un risque sans contrepartie. `allowVersionOverride = true` permet au test
contrôlé d'épingler `@Library('pfe-devsecops@feat/acr-publish-provenance')`, ou
à l'opérateur de fusionner quand il le décidera. La révision est donc
**publiée et disponible**, sans être la version par défaut.

## Étape 7 — porte d'alignement : NON franchie

```
BACKEND_RELEASE_LIVE      = NO   (déployé puis remis en arrière)
WF1_LIVE                  = NO   (publication refusée : binaryMode)
SHARED_LIBRARY_LIVE       = NO   (main inchangée ; branche publiée)
JENKINS_CREDENTIALS_READY = NO   (les deux absents)
```

La porte échouant, **l'étape 9 n'a pas été exécutée** : aucun build Jenkins
déclenché. Les étapes 10 à 14 n'ont donc aucune preuve réelle, et je n'en
revendique aucune.

Vérifications d'intégrité faites malgré tout, après retour arrière : 7 projets
chargent, trois projets vérifiés sans fuite inter-projet (aucun digest réutilisé),
`dispatch = OFF`, `harness = OFF`.

---

## Verdict

```
BACKEND_SOURCE_COMMIT     = d3140693309bae15e4eacefe2e1d59616fa51fae
BACKEND_IMAGE             = local/pfe-backend-reconciled:r94 (sha256:ff7b22d3ce88) — construite, qualifiee, PAS en service
BACKEND_RELEASE_LIVE      = NO   (deployee puis remise en arriere : regression project-reads)
BACKEND_LIVE_SOURCE_MATCH = NO   (live = f212d19, ancienne release)

WF1_LIVE                  = NO
WF1_VERSION               = e30ccb82160c73e1 (live, inchangee)

SHARED_LIBRARY_LIVE       = NO   (main = a2427f8, inchangee)
SHARED_LIBRARY_LIVE_COMMIT= n/a ; branche publiee : origin/feat/acr-publish-provenance = 55a1a5a

ACR_CREDENTIALS_PRESENT     = NO
N8N_INTERNAL_SECRET_PRESENT = NO
JENKINS_CREDENTIALS_READY   = NO

RUNTIME_FULLY_ALIGNED     = NO
CONTROLLED_BUILD_EXECUTED = NO
CONTROLLED_BUILD_NUMBER   = n/a

IMAGE_BUILT               = NO (aucun build lance)
IMAGE_PUSHED_TO_ACR       = NO
PUBLISHED_REFERENCE       = n/a
OCI_COMMIT_MATCH          = n/a (non execute)
WF1_BUILD_INGESTED        = NO
PROVENANCE_PENDING_OBSERVED = NO
PROVENANCE_SUCCESS        = NO
BACKEND_DIGEST_RESOLVED   = NO
RESOLVED_DIGEST           = n/a

DEPLOYMENT_ARTIFACT_DELTA = 0   (attendu +1 ; aucun build)
DEPLOYMENT_ATTEMPT_DELTA  = 0   (conforme)
ARTIFACT_SOURCE           = n/a

DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE = YES pour app-test-pfe-vermeg (aucun artefact : blocage legitime)
                                          NO pour pfe-app-test (artefact qualifie)
AZURE_CONFIGURATION_RESOLVED = YES (registry acrpfedevsecops, imageRepository app-test-pfe-vermeg,
                                    target aci-app-test-pfe-vermeg, region francecentral)
GOVERNANCE_RESULT            = TECHNICALLY_IMPOSSIBLE (app-test-pfe-vermeg)
                               CRITICAL_RISK          (pfe-app-test, bloque par la securite)

DOCKER_UI_SOURCE_API_UI_MATCH = PASS (verifie aux tours precedents ; inchange)
DOCKER_REDIRECTS_TO_JENKINS   = NO
CROSS_PROJECT_ARTIFACT_LEAK   = NO
MANUAL_ARTIFACT_CREATED       = NO
AZURE_DEPLOYMENT_EXECUTED     = NO
SECRETS_IN_PIPELINE_LOGS      = 0
DISPATCH_FINAL_STATE          = OFF
HARNESS_FINAL_STATE           = OFF

P0_REMAINING = 1
   backend/src/project-reads/ (2 fichiers) n'est commite sur AUCUNE branche alors
   que la production en depend : tout deploiement depuis la source echoue tant
   que ce n'est pas corrige.
P1_REMAINING = 3
   (a) ACR_CREDENTIALS absent — exige un secret de registre reel (principal AcrPush)
   (b) N8N_INTERNAL_SECRET absent de Jenkins — valeur disponible mais creation
       impossible sans compte admin Jenkins
   (c) WF1 non publiable par l'API publique sans perdre binaryMode: separate
P2_REMAINING = 1
   main de la bibliotheque partagee non fusionnee (volontaire)

READY_FOR_CONTROLLED_AZURE_DEPLOYMENT = NO
FINAL_VERDICT = C — RUNTIME_ALIGNMENT_INCOMPLETE
```

**Pourquoi C et non B.** B dirait que le seul blocage restant est l'identifiant
ACR fourni par l'opérateur. Ce n'est pas le cas : trois blocages indépendants
subsistent, dont un **P0 que cette opération a révélé** — la production dépend
de code non commité, donc aucun déploiement depuis la source ne peut réussir en
l'état. C'est le résultat le plus utile de ce tour, et il n'aurait pas été
trouvé sans tenter le déploiement.

---

## Actions opérateur, dans l'ordre

1. **P0 — commiter `backend/src/project-reads/`** (2 fichiers) sur
   `release/backend-source-reconciliation-r93`, avec la modification
   correspondante de `app.module.ts`. Je ne l'ai pas fait moi-même : c'est du
   code non relu qui vous appartient et qui définit une surface d'API publique
   (`project-reads/incidents`, `project-reads/reports`) ; il mérite une relecture
   avant d'entrer dans une branche de release. Reconstruire ensuite l'image
   (r95) et redéployer — l'image r94 et le conteneur
   `pfe-backend-r94-rolledback` sont conservés pour diagnostic.

2. **Publier WF1 par l'UI n8n** (Import from File depuis
   `n8n-workflows/active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json`),
   pas par l'API : l'UI préserve `binaryMode: separate`. Export de secours
   disponible.

3. **Créer les deux identifiants Jenkins** :
   - `N8N_INTERNAL_SECRET` (*Secret text*) — la valeur est celle de la variable
     du même nom du conteneur backend, à recopier sans l'afficher ;
   - `ACR_CREDENTIALS` (*Username with password*) — **principal de service limité
     à `AcrPush`**, pas le mot de passe administrateur du registre.

4. **Activer la bibliothèque** : soit fusionner
   `feat/acr-publish-provenance` dans `main`, soit épingler
   `@Library('pfe-devsecops@feat/acr-publish-provenance')` pour le seul build
   contrôlé (`allowVersionOverride` est actif).

Puis un build d'`app-test-pfe-vermeg`, et les étapes 9 à 14 deviennent
observables.
