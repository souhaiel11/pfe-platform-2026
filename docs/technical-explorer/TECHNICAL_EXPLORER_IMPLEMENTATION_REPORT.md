# RAPPORT D'IMPLÉMENTATION — MASTER PROJECT EXPLORER

**Date** : 2026-10-08
**Périmètre** : application d'apprentissage technique interactive, **en lecture seule**, construite
au-dessus de `docs/technical-understanding/`.
**Emplacement** : `platform/technical-explorer/`
**Verdict** : **A — conforme et complet**

---

## 1. Décision d'architecture : une application isolée, pas un onglet du frontend

La première question à trancher était l'emplacement. Elle a été tranchée par une mesure, pas par
une préférence :

```
docker inspect pfe-frontend
  → frontend/dist/devsecops-frontend/browser  ->  /usr/share/nginx/html   (bind mount)
```

Le `dist` du frontend est **monté en bind** dans le conteneur nginx servi. Autrement dit,
`ng build` du frontend **est** un déploiement : il n'existe aucune étape de publication
intermédiaire. Ajouter l'explorateur comme onglet de `frontend/src/app/features/` aurait donc
expédié en production une application d'apprentissage dès la première compilation — et aurait
exposé la plateforme au risque qu'un défaut de l'explorateur dégrade l'outil de pilotage.

L'explorateur vit donc dans `platform/technical-explorer/`, avec son propre `angular.json`, son
propre `dist/`, son propre `index.html`. Il ne partage avec le frontend que `node_modules`, par
lien symbolique, pour éviter une seconde installation de 519 paquets.

**Conséquence vérifiée** : aucun fichier de `frontend/`, `backend/`, `n8n-workflows/` ou des
fichiers Compose n'a été modifié.

---

## 2. Garantie de lecture seule — structurelle, pas déclarative

L'exigence était absolue : l'application ne doit jamais modifier l'état du backend, appeler un
endpoint d'écriture, déclencher n8n, déclencher Jenkins, lancer une remédiation, créer une
tentative, ouvrir une *pull request*, déployer sur Azure, modifier la base, modifier les sources
du projet, ni exposer un secret.

La garantie ne repose pas sur la discipline du code, mais sur trois verrous de conception :

| Verrou | Mécanisme | Effet |
|---|---|---|
| 1 | `provideHttpClient` **n'est pas fourni** dans `src/main.ts` | aucun composant ne peut injecter `HttpClient` ; `.post()`, `.put()`, `.patch()`, `.delete()` sont hors d'atteinte |
| 2 | Unique porte réseau : `DataService.readAsset()` | force `method: 'GET'`, `credentials: 'omit'`, `redirect: 'error'` ; refuse toute URL hors `assets/` ; n'accepte aucun corps de requête |
| 3 | Données = assets statiques | produits hors ligne par `tools/parse-docs.mjs` ; aucun n'est servi par le backend de la plateforme |

### Ce que le test de sûreté vérifie réellement

`tools/spec/read-only.spec.mjs` — **30 cas, tous passants** — contrôle le **code source** *et* le
**bundle compilé**, parce qu'une vérification limitée aux sources pourrait être contournée par une
dépendance :

- aucun `method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'` dans le code applicatif ;
- `@angular/common/http` jamais importé, `provideHttpClient` jamais fourni ;
- tous les `fetch` confinés dans `data.service.ts`, chacun forçant GET, omettant les
  identifiants, interdisant la redirection et sans corps ;
- aucune URL vers `/api/`, `:3001`, `:5678`, `:8082`, `webhook/`, `api.github.com`,
  `management.azure.com`, `postgres` **dans un littéral de chaîne** ;
- ni `XMLHttpRequest`, ni `sendBeacon`, ni `WebSocket`, ni `EventSource`, ni `Worker` ;
- aucun `<form action=…>` ;
- le bundle de production ne contient aucun verbe mutant et conserve uniquement des `GET`.

Les contrôles distinguent le **code** de la **prose** : expliquer en commentaire pourquoi
`provideHttpClient` est absent ne compte pas comme l'avoir fourni. C'est précisément ce qu'un
premier passage naïf avait signalé à tort, et qui a été corrigé en retirant les commentaires avant
analyse.

### Actions interdites — état constaté

| Action | Exécutée ? | Preuve |
|---|---|---|
| Écriture backend | **NON** | `HttpClient` absent ; aucun verbe mutant (RO-method-*) |
| Déclenchement n8n | **NON** | aucune URL `:5678` ni `webhook/` (RO-target-*) |
| Déclenchement Jenkins | **NON** | aucune URL `:8082` |
| Remédiation lancée | **NON** | aucun appel sortant possible |
| Tentative créée | **NON** | le laboratoire de reprise simule localement, sans réseau |
| *Pull request* ouverte | **NON** | aucune URL `api.github.com` |
| Déploiement Azure | **NON** | aucune URL `management.azure.com` |
| Base modifiée | **NON** | aucune connexion, aucune URL `postgresql://` |
| Sources du projet modifiées | **NON** | seuls 2 documents annotés (§5) et l'arbre neuf `technical-explorer/` |
| Secret exposé | **NON** | le tableau des credentials affiche type / emplacement / porteur, aucune valeur |

---

## 3. Le parseur — fidélité avant exhaustivité

`tools/parse-docs.mjs` lit les 26 documents et produit un modèle normalisé. Il ne contacte rien et
n'écrit que dans `src/assets/`.

### Trois défauts de parsing trouvés et corrigés

**a) `tables()` perdait toute table collée à la précédente.** Après avoir lu une table, le code
faisait `i = j`, puis la boucle incrémentait — sautant ainsi la ligne `j`. Corrigé en `i = j - 1`.

**b) Deux tables contiguës fusionnaient.** Le découpage par titre retire le `###` intermédiaire, de
sorte que la table « Cibles HTTP sortantes » et la table « Catalogue des nœuds » devenaient
adjacentes. La boucle de lecture des lignes avalait alors la seconde table comme des **lignes** de
la première — ce qui produisait `workflowNodes = 0` alors que le corps recomposé contenait bien
l'en-tête. Corrigé en deux points : une ligne de séparation `|---|---|` marque désormais le début
d'une **nouvelle** table et interrompt le balayage ; et la recomposition d'un bloc de workflow
conserve les titres de sous-section.

**c) `/ACTIF/i` classait « inactif » comme actif.** Le drapeau `active` valait `true` pour les 24
workflows. Corrigé en test sensible à la casse — `inactif` en minuscules ne contient pas `ACTIF`.
Résultat : 7 actifs, 17 inactifs, conforme à l'inventaire.

### Un écart de 13 nœuds — élucidé contre les workflows publiés

Après correction, le catalogue indexait 526 nœuds alors que l'inventaire en annonçait 539. L'écart
a été vérifié non pas par raisonnement, mais contre les **dumps live** des workflows publiés :

```
u3eeMwTuhCsetfcS   total=195   stickyNote=6    exécutables=189
RdYyfjVpOm2LxS95   total=184   stickyNote=7    exécutables=177
les 5 autres actifs            stickyNote=0    total = exécutables
                               ────────────────────────────────────
                   total=539   stickyNote=13   exécutables=526
```

n8n range les pense-bêtes du canevas (`n8n-nodes-base.stickyNote`) dans le **même tableau `nodes`**
que les nœuds exécutables. Les deux chiffres étaient donc justes : ils ne comptaient pas la même
chose. Le catalogue avait raison de n'indexer que les 526 exécutables — une annotation ne s'exécute
pas, ne reçoit aucune connexion, et ne peut apparaître dans aucun chemin d'exécution.

**Correction apportée à la documentation source** (seuls fichiers existants modifiés) :

- `03-N8N-COMPLETE-GUIDE.md` — un tableau explicite le total du canevas, les annotations et les
  nœuds exécutables, workflow par workflow ;
- `03b-N8N-NODE-CATALOG.md` — une note de périmètre en tête : le catalogue couvre les 526
  exécutables, et `526 + 13 = 539`.

Le modèle dérive ensuite l'écart **arithmétiquement** (`annotationNodeCount = nodeCount −
nodes.length`) : aucune valeur n'est codée en dur.

### Deux enrichissements, toujours sourcés

- **Déclencheurs** : `03` ne les déclare que pour 3 workflows sur 7. À défaut, le modèle les **lit**
  dans le catalogue `03b` — le nœud de profondeur 0 *est* le déclencheur. Le champ `triggerSource`
  dit toujours de quel document vient la valeur affichée. Les 7 workflows actifs ont désormais un
  déclencheur résolu et sourcé.
- **Rattachement nœud → bloc** : attribué uniquement sur **présence littérale** du nom du nœud dans
  la chaîne déclarée par le bloc. 14 nœuds sur 50 pour WF1, 19 sur 177 pour WF6 ; les autres
  affichent `Non déterminé` plutôt qu'une position devinée.

---

## 4. L'application — 29 écrans, tous sourcés

| Groupe | Écrans |
|---|---|
| Comprendre | tableau de bord, architecture, composants, détail d'un composant, scénarios |
| Orchestration n8n | workflows, détail d'un workflow, blocs, nœuds, cartographie n8n ↔ backend |
| Plateforme | backend, API, base de données, identifiants |
| Remédiation | chaîne de remédiation, laboratoire de reprise, concurrence (Phase 4G) |
| Chaîne outillée | sécurité, Jenkins, Docker, Git, Azure |
| Soutenance | matrice des pannes, entraînement jury + quiz, à ne pas confondre, glossaire |
| Documents | liste des 26 documents, lecteur intégré |
| Transversal | recherche globale |

### Choix de conception notables

**Divulgation progressive à quatre niveaux** (Idée / Lecture / Détail / Preuve). Le niveau ne cache
pas l'information : il la met en réserve. Les colonnes de table portent un niveau ; un lecteur qui
découvre la plateforme reste au niveau 1, un jury qui creuse monte au niveau 4. Le choix est
mémorisé.

**Citation de source sur chaque bloc.** `tx-cite` renvoie vers le lecteur intégré, section
comprise. Le test `A-05` échoue si une page n'offre aucune traçabilité.

**Les tableaux thématiques ne sont pas recopiés.** `tx-doctable` lit un tableau dans le modèle par
document et titre de section. Corriger un document et relancer `npm run parse` propage la
correction sans toucher un composant. Si un tableau est introuvable, l'écran l'écrit — il n'affiche
jamais un cadre vide.

**Deux laboratoires interactifs, sans réseau.** Le laboratoire de reprise déroule une chaîne de
tentatives (identité neuve à chaque fois, incrément unique, réservation retenue, borne à 3) ; la
page concurrence rejoue `normalizeTargetFile()` et l'index partiel unique pour montrer *pourquoi*
`pom.xml` et `POM.xml` sont deux cibles distinctes. Les deux annoncent explicitement qu'il s'agit
d'une simulation locale.

**Recherche globale sur 1 799 entrées**, insensible à la casse et aux accents, avec facettes par
famille. L'URL porte l'état (`?q=`), donc un résultat se partage par simple copie du lien.

**27 schémas Mermaid rendus en SVG.** La bibliothèque est un asset local (aucun CDN), chargée à la
demande, en `securityLevel: 'strict'`. Si le rendu échoue, le code source du schéma reste affiché.

### Un défaut de rendu trouvé et corrigé

Le lecteur de documents n'affichait aucun schéma : le binding `[innerHTML]` passe par
l'assainisseur Angular, qui supprime les attributs `data-*` — donc les emplacements
`data-tx-mermaid` où les SVG devaient être injectés. Corrigé par `bypassSecurityTrustHtml`, avec
une justification écrite dans le code : le HTML provient d'un asset produit par notre propre
parseur à partir de la documentation, aucune saisie utilisateur n'y entre.

---

## 5. Vérifications exécutées

### Build

```
ng build (production)
  Initial total : 295,30 kB  (84,06 kB transféré)
  29 chunks paresseux, un par écran
  0 erreur, 0 avertissement, aucun budget dépassé
  dist/technical-explorer : 6,3 Mo (dont 3,2 Mo de Mermaid, chargé à la demande)
```

### Tests

```
Sûreté — lecture seule              30 / 30
Modèle — fidélité aux sources       18 / 18
Application — cohérence             12 / 12
                                   ─────────
TOTAL                               60 / 60      TESTS = PASS
```

### Rendu réel — 29 routes dans Chrome sans interface

Chaque route a été chargée et son DOM inspecté : titre présent, contenu non vide, aucun
« Modèle indisponible », aucun « Tableau introuvable », aucun « Rendu du schéma indisponible ».

Le lecteur intégré rend le nombre exact de schémas que contient chaque document :

| Document | Schémas attendus | Rendus |
|---|---|---|
| `01-GLOBAL-ARCHITECTURE.md` | 3 | 3 |
| `11-REMEDIATION-LIFECYCLE.md` | 4 | 4 |
| `12-RETRY-CONCURRENCY-IDEMPOTENCY.md` | 4 | 4 |
| `14-AZURE-DEPLOYMENT.md` | 3 | 3 |

Recherche vérifiée sur des termes réels — `attemptId` (21), `targetKey` (11),
`provesSecurityClosure` (16), `stickyNote` (1), `WF6` (80 affichés sur 241). Les liens profonds
vers une section citée retombent bien sur l'ancre attendue (`id="la-cle-de-propriete"`), la
fonction de *slug* du lecteur ayant été alignée sur celle du parseur, troncature à 80 caractères
comprise.

---

## 6. Ce que l'explorateur ne prétend pas savoir

Les 5 points non tranchés de la documentation sont **affichés tels quels** sur le tableau de bord,
et non dissimulés : 4 URL n8n assemblées par expression, l'intention d'origine des 13 nœuds non
atteignables de WF2, le contenu exact des prompts LLM de WF4/WF5, l'usage de `subscriptionRef`, et
la provenance de 2 lignes de réservation.

Le tableau de bord confronte par ailleurs ce que la documentation **annonce** et ce que le parseur
**extrait**, écarts affichés sans lissage : un écart est une information sur la documentation, pas
un défaut à masquer.

Partout ailleurs, une valeur que la source ne permet pas d'établir s'affiche `Non déterminé` — en
italique grisé, avec une infobulle qui l'explique. Le test `M-15` échoue si un champ textuel est
vide, parce qu'un vide ressemble à un défaut d'affichage alors que `Non déterminé` est une
information.

---

## 7. Empreinte exacte sur le dépôt

**Créé** : `platform/technical-explorer/` — 67 fichiers suivis (hors assets dérivés,
`node_modules` et `dist`), dont 29 écrans, 7 composants partagés, 6 services, 1 parseur, 3 suites
de test, 1 serveur statique local, 1 README.

**Modifié** : 2 fichiers, tous deux de documentation, pour expliciter l'écart des 13 annotations de
canevas — `docs/technical-understanding/03-N8N-COMPLETE-GUIDE.md` et
`docs/technical-understanding/03b-N8N-NODE-CATALOG.md`.

**Non touché** : `frontend/`, `backend/`, `n8n-workflows/`, `Jenkinsfile`, `docker-compose*.yml`,
`Dockerfile*`, toute configuration, tout secret, toute donnée.

---

## MÉTRIQUES FINALES

```
APP_BUILD                        = PASS
TESTS                            = PASS  (60/60)
READ_ONLY_VERIFIED               = YES   (30/30, source + bundle)

PAGES_IMPLEMENTED                = 29
DOCUMENTS_PARSED                 = 26
SECTIONS_INDEXED                 = 481
DIAGRAMS_RENDERED                = 27

COMPONENTS_DOCUMENTED            = 20
N8N_WORKFLOWS_INDEXED            = 24   (7 actifs, 17 inactifs)
N8N_CANVAS_OBJECTS_ACTIVE        = 539
N8N_ANNOTATION_NODES_ACTIVE      = 13   (stickyNote, non exécutables)
N8N_EXECUTABLE_NODES_ACTIVE      = 526
N8N_ACTIVE_NODES_INDEXED         = 100 %  (526 / 526)
N8N_WORKFLOW_BLOCKS              = 14
N8N_BACKEND_MAPPINGS             = 29

BACKEND_FILES_CATALOGUED         = 255
API_ENDPOINTS_DOCUMENTED         = 119
DB_TABLES_DOCUMENTED             = 16
IDENTIFIERS_TRACKED              = 22
REMEDIATION_STEPS                = 18
STATE_MACHINES                   = 6
SOURCE_TABLES_REUSED             = 249
SCENARIOS                        = 10
FAILURE_MODES                    = 25
CONFIGURATION_FLAGS              = 37
JURY_QUESTIONS                   = 61
CONFUSION_PAIRS                  = 27
GLOSSARY_TERMS                   = 120
SEARCH_ENTRIES                   = 1 799
UNRESOLVED_POINTS_DISPLAYED      = 5

BACKEND_STATE_MUTATIONS          = 0
N8N_EXECUTIONS_TRIGGERED         = 0
REMEDIATION_ATTEMPTS_CREATED     = 0
PULL_REQUESTS_OPENED             = 0
AZURE_APPLICATION_DEPLOYMENT_EXECUTED = NO
DATABASE_ROWS_MODIFIED           = 0
PLATFORM_SOURCE_FILES_MODIFIED   = 0
DOCUMENTATION_FILES_CORRECTED    = 2
SECRETS_EXPOSED                  = 0

VERDICT                          = A — conforme et complet
```
