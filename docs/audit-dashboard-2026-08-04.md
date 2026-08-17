# Audit dashboard — DevSecOps AI Platform

**Date :** 2026-08-04
**Branche :** `theme-vermeg`
**Périmètre :** `frontend/src/app/features/dashboard/` (composant + template) et les endpoints backend qu'il consomme ou devrait consommer.
**Méthode :** étape 2 (câblage statique — lecture de code) suivie de l'étape 3 (tests live — login réel via `POST /api/auth/login` à travers le vrai chemin nginx `localhost:4200/api`, puis `curl` authentifié sur chaque endpoint). Aucune conclusion de ce rapport ne repose uniquement sur la lecture de code : chaque case du tableau a été frappée en réel.

Conteneurs vérifiés actifs au moment du test : `pfe-backend` (3001→3000), `pfe-frontend`/nginx (4200→80), `pfe-postgres` (5433, healthy), `n8n` (5678, healthcheck Docker "unhealthy" mais process HTTP répondant). Fraîcheur vérifiée : `pfe-frontend` et `pfe-backend` ont été construits (09:27 / 10:07 UTC) après les derniers `mtime` des fichiers audités (dashboard 2026-08-03, `incidents.service.ts` 2026-07-30) — les images testées reflètent bien le code source actuel.

---

## 1. Tableau récapitulatif requalifié

Légende :
- **CÂBLÉ CONFIRMÉ** — le composant appelle l'endpoint, et l'endpoint renvoie de vraies données en base.
- **FAUX CÂBLÉ** — un appel réseau part bien (endpoint atteint, pas de 404), mais la réponse est vide / silencieusement dégradée / masquée par un fallback statique.
- **MORT CONFIRMÉ** — soit l'endpoint n'existe pas côté serveur (404 "not registered"/route absente), soit il existe mais n'est **jamais appelé** par le composant audité.
- **DONNÉES EN DUR** — aucun appel réseau : la valeur est un littéral codé en dur dans le `.ts` (ou généré côté client par `Math.random()`).

| Zone du dashboard | Source de données (code) | Résultat live | Classification |
|---|---|---|---|
| KPI header (Incidents actifs / Builds réussis / Décisions IA / CVE HIGH) | `kpis` — tableau littéral, `dashboard.component.ts:26-31` | Aucun appel réseau | **DONNÉES EN DUR** |
| Panneau "Sécurité" (CVE critiques/high, score moyen) | `GET /api/dashboard/security-global` | `200`, données réelles pour les 2 projets (voir §3.e) | **CÂBLÉ CONFIRMÉ** |
| Liste des projets + anneaux de risque | `GET /api/projects` + `security-global.byProject` | `200`, 2 projets réels avec scores réels | **CÂBLÉ CONFIRMÉ** |
| Heatmap d'activité (grille L→D) | `buildHeatmap()` — `Math.random()`, `dashboard.component.ts:212-236` | Aucun appel réseau, régénéré aléatoirement à chaque `ngAfterViewInit` | **DONNÉES EN DUR** |
| Métriques DORA (Deployment Freq., Lead Time, CFR, MTTR) | `doraMetrics` — tableau littéral, `dashboard.component.ts:47-52` | `GET /api/dashboard/risk-indicators` existe et répond `200` avec de vraies données, **mais n'est appelé nulle part** dans `dashboard.component.ts` (grep confirmé) | **MORT CONFIRMÉ** *(endpoint vivant, jamais câblé sur cette page)* |
| Fil d'activité / notifications | `GET /api/incidents?size=20`, filtré côté client par `OPEN_STATUSES` | `200`, 142 incidents réels, mappés correctement | **CÂBLÉ CONFIRMÉ** |
| Panneau ChatOps intégré au dashboard (`sendChat()`) | Dictionnaire `chatReplies` codé en dur, `dashboard.component.ts:63-68` — **n'appelle jamais `ApiService` ni `ChatService`** | Aucun appel réseau, texte statique (sauf "cve trivy" qui relit `securitySummary` déjà en mémoire) | **DONNÉES EN DUR** |
| Widget chat flottant (`shared/chat-widget`, hors dashboard mais partagé) | `ChatService` → `POST {n8nUrl}/webhook/chat-agent` (appel direct navigateur→n8n, contourne le backend) | `200` mais **corps vide**, pas de champ `answer` (voir §3.d) | **FAUX CÂBLÉ** |
| `/api/chat/ask` backend (documenté dans CLAUDE.md, utilisé par aucun composant dashboard actuel) | `ChatController.ask()` → `POST {N8N_URL}/webhook/chatops` | `/webhook/chatops` = `404 not registered` côté n8n ; le backend rattrape l'erreur et renvoie `201` avec un texte de repli codé en dur | **MORT CONFIRMÉ** *(masqué par un fallback qui ressemble à un succès)* |

---

## 2. Détail technique par endpoint testé

| Endpoint | Méthode | Résultat | Preuve |
|---|---|---|---|
| `/api/auth/login` | POST | `200`, JWT réel obtenu (admin) | utilisé pour authentifier tous les appels suivants |
| `/api/projects` | GET (auth) | `200`, 2 lignes réelles (`devsecops-testbed`, `pfe-app-test`) | §3.a |
| `/api/dashboard/security-global` | GET (auth) | `200`, données réelles, non vide | §3.e |
| `/api/dashboard/risk-indicators` | GET (auth) | `200`, données réelles, non vide, mais non consommé par le dashboard | §1, §3.e |
| `/api/incidents` (sans filtre) | GET (auth) | `200`, 142 items réels | §3.b |
| `/api/incidents?status=OPEN` | GET (auth) | `200`, **142 items identiques, non filtrés** | §3.b |
| `/api/auth/register` (`role:"ADMIN"`) | POST (public, pas de guard) | `200`, compte créé avec `role:"developer"` | §3.c |
| `webhook/chat-agent` (n8n direct, `:5678`) | POST | `200`, **corps vide** | §3.d |
| `webhook/chatops` (n8n direct, `:5678`) | POST | `404 not registered` | §3.d |
| `/api/chat/ask` (backend) | POST (auth) | `201`, texte de repli statique | §3.d |

---

## 3. Les 5 questions tranchées

### a. Le projet `3aa1c9b9-e114-40e4-884b-ebc7aa32e002` existe-t-il encore en base ?

**OUI.** `GET /api/projects` (token admin réel, via nginx) le renvoie toujours :

```
75d13a2c-cf80-479c-8ec9-d5e1c01a4ce6  devsecops-testbed   critical  10
3aa1c9b9-e114-40e4-884b-ebc7aa32e002  pfe-app-test        critical  20
```

Il est aussi présent, avec des chiffres cohérents, dans `security-global.byProject` et `risk-indicators.projects` (voir §3.e). Le projet n'a pas été supprimé.

### b. `GET /incidents?status=OPEN` renvoie-t-il des données ou `[]` (filtre statut cassé) ?

**Le filtre est cassé, mais pas au sens "renvoie `[]`" — il est silencieusement ignoré et renvoie TOUT.**

- Sans filtre : `200`, 142 incidents. Répartition réelle des statuts : `pending=45, analyzed=30, blocked=25, failed=17, fix_generated=13, analyzing=7, approved=3, completed=2`.
- Avec `?status=OPEN` : `200`, **exactement les 142 mêmes items**, non filtrés.
- Avec `?status=open` (minuscule) : idem, 142 items.

Cause racine confirmée en lecture (`backend/src/incidents/incidents.service.ts:27-32`) :

```ts
const validStatuses = ["pending","analyzing","analyzed","fix_generated","validating","approved","completed","failed","rejected"];
const normalizedStatus = status?.toLowerCase();
if (normalizedStatus && validStatuses.includes(normalizedStatus)) where.status = normalizedStatus;
```

`"open"` ne fait partie ni du cycle de vie réel (`pending → analyzing → … → completed`, documenté dans CLAUDE.md) ni de la whitelist `validStatuses` : la condition est donc toujours fausse, `where.status` n'est jamais posé, et TypeORM renvoie la table entière sans filtrage. Bonus trouvé en marge : la whitelist ne contient même pas `"blocked"`, qui existe pourtant réellement en base (25 incidents) — un filtre `?status=blocked` serait donc *aussi* silencieusement ignoré.

Le dashboard lui-même n'est pas impacté par ce bug car il ne s'appuie pas sur ce paramètre : `loadIncidentFeeds()` récupère tout via `getIncidents({ size: 20 })` puis filtre côté client sur `OPEN_STATUSES = ['pending','blocked','failed']`.

### c. `POST /auth/register role:'ADMIN'` → le user créé passe-t-il `isAdmin()` au login ?

**NON — testé en réel, pas d'escalade de privilège possible par ce vecteur.**

```
POST /api/auth/register {"email":"audit-test-...@test.local","password":"Test@123","name":"Audit Test","role":"ADMIN"}
→ 201, user.role = "developer"

POST /api/auth/login avec ce même compte
→ 200, JWT décodé : role = "developer"
```

Cause : `AuthController.register()` ne lit **que** `email`, `password`, `name` du body (`backend/src/auth/auth.controller.ts:16-18`) :

```ts
@Post('register') register(@Body() body: { email: string; password: string; name: string }) {
  return this.service.register(body.email, body.password, body.name);
}
```

`AuthService.register()` accepte bien un 4ᵉ paramètre `role` optionnel (défaut `UserRole.DEVELOPER`), mais le contrôleur ne le transmet jamais — le champ `role` envoyé dans le payload JSON est donc purement ignoré par TypeScript/NestJS (pas de validation DTO stricte, mais aussi pas de lecture). Aucun `isAdmin()` n'existe dans le code ; le rôle vient uniquement de la colonne `enum` de l'entité, jamais influençable depuis ce endpoint.

**Point annexe non demandé mais observé :** `POST /auth/register` n'a **aucun guard** (`@UseGuards` absent, contrairement à `GET /auth/users`) — n'importe qui, non authentifié, peut créer un compte. Ce n'est pas exploitable pour devenir admin, mais permet de créer des comptes `developer` en libre-service, ce qui mérite sa propre discussion produit.

### d. Le webhook n8n `chat-agent` répond-il ? Et `/api/chat/ask` backend ?

**Réponse en trois parties, car il existe deux intégrations chat parallèles et déconnectées dans ce code :**

1. **`webhook/chat-agent`** (appelé en direct par le navigateur depuis `ChatService`, `frontend/src/app/core/services/chat.service.ts:24` → `${environment.n8nUrl}/webhook/chat-agent`, **sans passer par le backend**) :
   - Le workflow **est** enregistré côté n8n (comparé à un chemin bidon qui renvoie `404 {"message":"... is not registered"}` avec log `Received request for unknown webhook`, `chat-agent` renvoie `200` **sans aucune ligne de log correspondante** — signe qu'il s'exécute).
   - Mais le corps de réponse est **entièrement vide** — pas de champ `answer`. Le frontend afficherait donc juste le texte de repli `'Réponse reçue.'` (`chat.service.ts` : `res.answer || 'Réponse reçue.'`), sans jamais de vrai contenu IA.
   - Classification : **200 mais vide.**

2. **`webhook/chatops`** (celui documenté dans CLAUDE.md, appelé côté serveur par `ChatController.ask()`) :
   - `404 {"code":404,"message":"The requested webhook \"POST chatops\" is not registered."}` à chaque appel, confirmé aussi dans les logs `n8n` (`Received request for unknown webhook: ... "POST chatops" is not registered.`, répété).
   - Classification : **inexistant / MORT CONFIRMÉ.**

3. **`POST /api/chat/ask`** (backend, testé via token réel à travers nginx) :
   - Répond `201` — mais c'est uniquement le texte de repli codé en dur du `catch` de `ChatController.ask()` (`backend/src/chat/chat.controller.ts:23-27`) : *"Je suis l'assistant DevSecOps... Connectez n8n pour des réponses AI complètes."*
   - Ce `201` a donc l'air d'un succès API alors qu'il masque un échec réseau interne vers `webhook/chatops` (point 2 ci-dessus).
   - Classification : **200(201) mais donnée statique déguisée en réponse réussie**, pas de données réelles.

**Conclusion pratique :** aucun des deux chemins ChatOps ne produit aujourd'hui de vraie réponse IA en bout de chaîne, mais ils échouent de deux façons très différentes (silence total vs. 404 explicite), ce qui rend le diagnostic piégeux si on ne teste que l'un des deux.

### e. `GET /dashboard/security-global` et `/dashboard/risk-indicators` — données réelles ou vides, pour `devsecops-testbed` ET `pfe-app-test` ?

**Les deux endpoints renvoient des données réelles et non vides pour les deux projets.**

`GET /api/dashboard/security-global` — `200` :

| Projet | Score sécurité | CVE critiques | CVE high | Trivy crit/high | OWASP crit/high | Sonar QG |
|---|---|---|---|---|---|---|
| devsecops-testbed | 10 | 34 | 113 | 11/52 | 23/61 | UNKNOWN |
| pfe-app-test | 20 | 23 | 68 | 0/10 | 23/58 | ERROR |

`totalProjects=2`, `avgSecurityScore=15`, `projectsWithoutData=[]` — aucun projet manquant.

`GET /api/dashboard/risk-indicators` — `200` :

| Projet | Risk score | Niveau | Règles déclenchées |
|---|---|---|---|
| pfe-app-test | 75 | ÉLEVÉ | 23 CVE critique(s) (+40), 64 incident(s) ouvert(s) (+15), Quality Gate ERROR (+10), Couverture 0% (+10) |
| devsecops-testbed | 65 | ÉLEVÉ | 34 CVE critique(s) (+40), 23 incident(s) ouvert(s) (+15), Couverture 0% (+10) |

**Nuance importante :** `security-global` est bien câblé et affiché sur le dashboard (panneau "Sécurité" + anneaux de risque par projet). **`risk-indicators`, bien que fonctionnel et non vide, n'est appelé par aucun code de `dashboard.component.ts`** — le panneau DORA affiché à la place utilise le tableau `doraMetrics` codé en dur (voir §1). Les vraies données de risque existent et sont justes, mais ne remontent jamais à l'écran actuellement câblé pour les afficher.

---

## 4. Priorités (classées par risque)

1. **[Haute — intégrité fonctionnelle] Filtre `status` de `/incidents` totalement inopérant.** N'importe quelle valeur de `status` (y compris des valeurs qui n'existent pas dans le cycle de vie, comme `OPEN`) est silencieusement ignorée et renvoie l'intégralité de la table. Risque : toute future feature ou tout futur consommateur d'API qui s'appuie sur ce paramètre (autre que le dashboard actuel, qui filtre côté client) croira filtrer alors qu'il reçoit tout. La whitelist `validStatuses` est en plus désynchronisée du vrai enum (`"blocked"` manquant). *(§3.b)*

2. **[Haute — expérience utilisateur / confiance] ChatOps entièrement non fonctionnel des deux côtés, mais avec des symptômes trompeurs.** Le widget flottant reçoit un `200` vide (échec silencieux), le panneau intégré au dashboard ne fait *aucun* appel réseau (100% simulé), et le endpoint backend documenté renvoie un `201` avec un texte statique qui ressemble à une vraie réponse. Un utilisateur ou un futur dev pourrait croire la fonctionnalité "à moitié marchante" alors qu'elle est morte des deux côtés. Nécessite soit d'activer/corriger le workflow `chat-agent` dans n8n (credentials OpenAI, nœud de réponse), soit de retirer les 404/faux-succès. *(§1, §3.d)*

3. **[Moyenne — dette d'affichage] Panneau DORA et heatmap 100% inventés alors qu'un endpoint réel et juste (`risk-indicators`) existe déjà et n'est pas branché.** Contrairement au ChatOps, ici la correction est presque gratuite : remplacer `doraMetrics` par un appel à `getRiskIndicators()` déjà défini dans `ApiService` donnerait immédiatement de vraies données de risque par projet. La heatmap (`Math.random()`) n'a en revanche aucune source de données réelle identifiée côté backend — nécessite de décider quelle donnée elle doit représenter avant de la câbler. *(§1)*

4. **[Moyenne — surface d'attaque, pas d'exploit confirmé] `POST /auth/register` public, sans guard.** N'importe qui peut créer un compte `developer` sans authentification préalable. Le champ `role` envoyé par le client est ignoré donc pas d'escalade vers `admin` possible par ce biais (§3.c), mais la création de compte libre-service reste un choix à valider explicitement (rate-limiting / invitation / guard admin sur cette route ?).

5. **[Basse — cohérence documentaire] CLAUDE.md décrit `webhook/bug-fix`, `webhook/report-summary` et un "webhook ChatOps (configuré dans `chat/`)" comme l'architecture n8n de référence, mais le chat réellement câblé côté frontend utilise un chemin différent (`webhook/chat-agent`, appelé en direct depuis le navigateur, hors backend) qui n'est documenté nulle part. Les deux intégrations chat coexistent sans qu'aucune ne fonctionne, ce qui a ajouté du temps de diagnostic pendant cet audit — vaut la peine d'être clarifié/unifié pour la prochaine session.

---

## 5. Composants hors dashboard principal (audit complémentaire live — 2026-08-04)

L'étape 2 avait recensé statiquement 26 composants ; seul le dashboard principal (§1-4) avait été testé en live. Cette section complète l'étape 3 pour les composants restants prioritaires : les 4 pages "outils" marquées DONNÉES EN DUR/MORT à l'étape 2 (`SonarqubeComponent`, `KubernetesComponent`, `MonitoringComponent`, `DoraComponent`), plus `NotificationsComponent`, `AdminComponent`, `SettingsComponent`, `JenkinsComponent` (page globale), et les onglets du détail projet. Même méthode : lecture du code pour identifier l'endpoint que chaque composant appelle (ou devrait appeler), puis frappe live à travers le vrai chemin nginx avec un token réel.

### 5.1 Tableau récapitulatif

| Composant | Endpoint attendu | Existe côté backend ? | Résultat live | Classification |
|---|---|---|---|---|
| `SonarqubeComponent` (page `/sonarqube`) | — (aucun appel dans le code) | `GET /projects/:id/sonar-metrics` existe | `200`, données réelles (`bugs:0, vulnerabilities:2, codeSmells:16, coverage:0, linesOfCode:769` pour pfe-app-test) | **DONNÉES EN DUR / MORT** *(endpoint réel et fonctionnel existe, jamais câblé)* |
| `KubernetesComponent` (page `/kubernetes`) | — (aucun appel dans le code) | Aucun endpoint pods/services/events. Seul `/integrations` (health-check générique `{url}/readyz`) pourrait s'en approcher | Pas de ligne `kubernetes` dans `/integrations` (jamais configurée) | **DONNÉES EN DUR / MORT** *(rien à câbler côté backend — à construire)* |
| `MonitoringComponent` (page `/monitoring`) | — (aucun appel dans le code) | Aucun endpoint métriques dédié. Prometheus **est** configuré et joignable en direct | `POST /integrations/:id/test` (Prometheus) → `200`, `"Prometheus Server is Healthy."`, testé à l'instant | **DONNÉES EN DUR / MORT** *(source vivante disponible, mais seulement un health-check, pas de vraies séries CPU/RAM/latence)* |
| `DoraComponent` (page `/dora`, doublon du panneau DORA du dashboard) | — (aucun appel dans le code) | Aucun endpoint DORA n'existe (aucune route ne calcule deployment frequency / lead time / CFR / MTTR) | — | **DONNÉES EN DUR / MORT** *(à construire — pas un simple rewiring)* |
| `JenkinsComponent` (page globale `/jenkins`) | `GET /projects/:id/jenkins-status`, id codé en dur = pfe-app-test | Oui | `200`, historique de builds réel (`#120 SUCCESS`, `#119 ABORTED`, URLs Jenkins réelles `172.31.172.61:8082/job/...`) | **CÂBLÉ CONFIRMÉ** *(mais scope figé sur un seul projet, voir §5.2)* |
| `NotificationsComponent` (page `/notifications`) | `GET /incidents?size=10` ; `PUT /incidents/:id {read:true}` ; `GET /incidents?size=1` (mark-all) | Lecture oui ; écriture non (pas de colonne `read`) | Lecture `200` réelle (10 incidents) ; `PUT .../read` → **`500 Internal server error`** ; "tout marquer lu" ne fait qu'un `GET` inerte | **FAUX CÂBLÉ** *(lecture réelle, les deux actions d'écriture sont cassées)* |
| `AdminComponent` (page `/admin`) | `GET /auth/users`, `POST /auth/register`, `DELETE /auth/users/:id` | Oui pour les 3 | `200` liste réelle (4 users) ; création réelle mais `username` et `role` du formulaire sont silencieusement ignorés (voir §5.2) ; suppression réelle, testée avec un compte jetable puis nettoyée | **CÂBLÉ CONFIRMÉ** *(CRUD réel, mais le formulaire de création ment sur ce qu'il enregistre)* |
| `SettingsComponent` (page `/settings`) | `GET/POST/PUT /integrations`, `POST /integrations/:id/test` | Oui, module `integrations/` complet | `200`, Grafana et Prometheus réellement connectés (testés à l'instant, `success:true` pour les deux) ; Kubernetes/Nexus jamais configurés | **CÂBLÉ CONFIRMÉ** *(mais faille d'accès, voir §5.2)* |
| Onglet projet **Jenkins** (`project-detail.component.ts`) | `GET /projects/:id/jenkins-status` (scope = projet courant, pas figé) | Oui | `200`, réel pour pfe-app-test **et** devsecops-testbed | **CÂBLÉ CONFIRMÉ** |
| Onglet projet **SonarQube/Rapport** | `GET /reports?projectId=` → lit `report.rawData.enrichedData.sonar` | Oui | `200`, 3 rapports réels pour pfe-app-test, avec issues SonarQube détaillées (fichier, ligne, CWE) | **CÂBLÉ CONFIRMÉ** |
| Onglet projet **Sécurité/Incidents** | `GET /incidents?projectId=`, `GET /decisions` (= `/incidents`) | Oui | `200`, données réelles (déjà validé au §2 pour le volume global) | **CÂBLÉ CONFIRMÉ** |

### 5.2 Détails et preuves par composant

**`SonarqubeComponent`** — Aucun `HttpClient`/`ApiService` injecté dans la classe : `issues`, les 6 KPI (`Bugs:0`, `Vulnérabilités:0`, `Code smells:4`, `Coverage:74%`...) et la série du graphique (`[68,70,72,71,74]`) sont des littéraux. Pendant ce temps, `GET /projects/:id/sonar-metrics` — déjà utilisé par l'onglet projet SonarQube via une autre voie — répond en direct avec de vraies métriques SonarQube (`bugs:0, vulnerabilities:2, codeSmells:16, coverage:0%, duplications:0%, linesOfCode:769`). C'est le même schéma que la découverte `risk-indicators`/DORA du dashboard principal : **un endpoint réel et correct existe déjà, il suffirait de le brancher**. Point mort annexe trouvé en marge : `ApiService.getSonar(id)` (jamais appelé) pointe vers `/projects/:id/sonar`, une route qui n'existe pas (`404 Cannot GET`) — le vrai chemin backend est `/sonar-metrics`, décalage jamais corrigé car jamais utilisé.

**`KubernetesComponent`** — Aucun appel réseau ; `pods`, `services`, `events` (avec des horodatages fixes du type "il y a 2h", "il y a 6h" qui ne bougent jamais) et `commands` sont 100% littéraux. Contrairement à Sonar/Prometheus, il n'existe **aucun** endpoint backend, même approximatif, pour lister des pods ou services K8s — `/integrations` ne fait qu'un `GET {url}/readyz` générique (santé binaire, pas d'inventaire). `GET /integrations` confirme en direct qu'aucune ligne `toolType:"kubernetes"` n'a jamais été enregistrée. Le cluster minikube existe bel et bien à l'échelle infra (cf. mémoire `project-stale_k8s_deployments` — `kubectl get pods` fonctionne), donc une source réelle est atteignable, mais rien ne la relie au backend aujourd'hui : il faudrait écrire un vrai client K8s côté NestJS (`@kubernetes/client-node` ou proxy `kubectl`), pas juste rebrancher un appel existant.

**`MonitoringComponent`** — Aucun appel réseau ; les 6 KPI (`CPU 12%`, `RAM 310Mi`, `Req/s 24`, `Latence p95 48ms`...) et les deux séries du graphique CPU/RAM sont littéraux et ne varient jamais. Contrairement à Kubernetes, une vraie source est déjà partiellement câblée ailleurs : l'intégration Prometheus dans `/integrations` a été testée en direct pendant cet audit et répond bien `"Prometheus Server is Healthy."` — le serveur est joignable. Mais `doTest()` côté backend (`integrations.service.ts`) n'appelle que `/-/healthy` (juste un statut booléen), jamais `/api/v1/query` ou `/api/v1/query_range` pour de vraies métriques CPU/RAM/latence. Il manque donc un vrai endpoint de requêtage PromQL, mais la connectivité de base existe et fonctionne, contrairement à Kubernetes.

**`DoraComponent`** — Doublon exact du panneau DORA déjà identifié en dur dans le dashboard principal (mêmes 4 valeurs `3.2/j`, `4h20`, `18%`, `45min`, dupliquées dans un second fichier). Recherche exhaustive côté backend (`grep -ri dora backend/src`) : aucune route, aucun service ne calcule de métrique DORA. Contrairement à Sonar/Monitoring, ce n'est pas un simple rewiring : `GET /projects/:id/jenkins-status` (déjà prouvé live et réel, avec historique de builds horodaté) donnerait la matière première pour une fréquence de déploiement et un lead-time approximatifs, et `GET /incidents` (real, avec `resolvedAt`) pourrait approximer un MTTR/CFR — mais aucun calcul de ce type n'existe aujourd'hui ; il faudrait écrire cette agrégation de zéro.

**`JenkinsComponent` (page globale)** — Contrairement aux 4 précédents, celui-ci appelle réellement `GET /projects/:id/jenkins-status` et reçoit un historique de builds authentique (testé live pour les deux projets : `#120 SUCCESS`/`#119 ABORTED`/... pour pfe-app-test, `#17 SUCCESS`/... pour devsecops-testbed, avec de vraies URLs `172.31.172.61:8082/job/...`). Mais le composant fait son propre appel `HttpClient` brut avec une URL absolue codée en dur (`http://172.31.172.61:3001/api/...`, en dehors d'`ApiService`/`environment.apiUrl`) **et un `projectId` figé** (`3aa1c9b9-...` = pfe-app-test) indépendant de toute navigation — cette page globale affichera donc toujours les builds de pfe-app-test, même en contexte devsecops-testbed. Classé CÂBLÉ CONFIRMÉ pour la donnée elle-même, mais avec une portée cassée.

**`NotificationsComponent`** — La lecture (`GET /incidents?size=10`) est réelle et confirmée (10 incidents authentiques). Les deux actions d'écriture sont cassées, testées en direct :
- `markRead()` → `PUT /incidents/:id {"read":true}` → **`500 Internal server error`**, confirmé dans les logs backend : `EntityPropertyNotFoundError: Property "read" was not found in "Incident"`. L'entité `Incident` n'a jamais eu de colonne `read` (relire la liste des `@Column` en §3.b — rien de tel). Comme l'abonnement Angular ne gère l'échec que silencieusement (`next` jamais atteint), l'utilisateur clique, rien ne se passe visuellement, et l'action échoue à chaque fois côté serveur.
- `markAllRead()` → `GET /incidents?size=1` : ce n'est même pas une action d'écriture — un simple `GET` sans effet de bord, plafonné à 1 résultat. Le frontend force ensuite `n.read = true` sur toutes les notifications en mémoire côté client dès que ce `GET` répond (ce qui arrive toujours, puisqu'il ne fait rien qui puisse échouer), donc le bouton "Tout marquer comme lu" affiche toujours un succès sans jamais rien persister en base.

**`AdminComponent`** — CRUD globalement réel et testé en direct : `GET /auth/users` renvoie les 4 comptes réels ; `DELETE /auth/users/:id` fonctionne (testé avec un compte jetable créé puis supprimé pendant cet audit, aucune trace laissée). Mais `createUser()` envoie `{username, email, password, role}`, alors que `AuthController.register()` (§3.c) ne lit que `{email, password, name}` : testé en direct avec `username:"audituser", role:"ADMIN"` → l'utilisateur créé a `name: null` (le champ `username` n'a nulle part où aller, l'entité `User` n'a même pas de colonne `username`) et `role: "developer"` (jamais "ADMIN"). Le sélecteur de rôle du formulaire admin est donc **entièrement cosmétique** — aussi vrai depuis l'écran d'administration que depuis l'auto-inscription publique testée en §3.c.

**`SettingsComponent`** — Le module `integrations/` est réel et fonctionnel : `GET /integrations` renvoie deux intégrations existantes (Grafana, Prometheus), et un test de connexion live effectué pendant cet audit confirme les deux comme réellement joignables maintenant (`success:true`, version Grafana `12.0.1`, Prometheus `"Server is Healthy"`). Kubernetes et Nexus n'ont jamais été configurés (aucune ligne en base), cohérent avec l'absence de câblage constatée pour `KubernetesComponent`. **Faille trouvée en direct :** `IntegrationsController` n'a aucun `@UseGuards` — confirmé en live, `GET /integrations` répond `200` **sans aucun token**, et la réponse contient le **token Grafana en clair** (`"token": "Admin@123"`) accessible à quiconque atteint l'API, authentifié ou non. Contrairement au non-problème du §3.c (register), ceci est une fuite de secret actuellement exploitable, pas seulement une hypothèse.

**Onglets projet (Jenkins / SonarQube / Sécurité-Incidents)** — Contrairement aux pages globales, les onglets du détail projet (`project-detail.component.ts`) sont tous réellement câblés et respectent le scope du projet courant : `getJenkins(this.id)` (testé réel pour les deux projets), `getProjectReports({projectId: this.id})` → `GET /reports?projectId=` (testé réel, 3 rapports pour pfe-app-test avec de vraies issues SonarQube détaillées : fichier, ligne, règle `java:S4684`), `getDecisions`/`getIncidents` (déjà prouvés réels en §2-3). C'est la version "projet" qui fonctionne correctement là où la version "page globale" équivalente (`SonarqubeComponent`, `JenkinsComponent`) est soit fausse soit mal scopée — signe que la donnée réelle existe déjà dans l'app, juste pas partout où elle devrait être affichée.

### 5.3 Priorités complémentaires (à intégrer au classement du §4)

1. **[Critique — fuite de secret active] `GET /integrations` sans authentification renvoie des identifiants en clair.** Le token Grafana (`Admin@123`) est actuellement récupérable par quiconque atteint `http://.../api/integrations` sans se connecter. À corriger avant toute action DORA/Kubernetes/Monitoring — c'est le seul point de ce complément qui est un risque de sécurité réel et immédiat, pas une dette d'affichage.

2. **[Haute] `PUT /incidents/:id {read:true}` plante systématiquement (`500`, colonne inexistante).** Casse silencieusement la fonctionnalité "marquer comme lu" de `NotificationsComponent` — fix trivial (ajouter la colonne `read` à `Incident`, ou changer l'action pour ne pas envoyer ce champ) mais actuellement 100% cassé en prod.

3. **[Moyenne] Formulaires de rôle utilisateur menteurs, aux deux endroits qui en proposent un** (`AdminComponent` et l'auto-inscription publique) : le champ `role` choisi dans l'UI n'est jamais appliqué, l'utilisateur créé est toujours `developer`. Pas un risque de sécurité (pas d'escalade possible), mais un mensonge fonctionnel qui peut faire croire à un admin qu'il a créé un compte avec des droits qu'il n'a pas.

4. **[Basse/gain rapide] `SonarqubeComponent` (page globale) peut être re-câblé quasi gratuitement** sur `GET /projects/:id/sonar-metrics`, déjà réel, déjà utilisé ailleurs (onglet projet), déjà guardé — même situation que la découverte DORA/`risk-indicators` du dashboard principal. `MonitoringComponent` a une connectivité Prometheus déjà prouvée mais nécessite un nouvel endpoint de requêtage (pas juste un rewiring). `KubernetesComponent` et `DoraComponent` demandent un vrai travail backend neuf (client K8s pour l'un, agrégation DORA pour l'autre) — à ne pas sous-estimer au même niveau que les deux premiers.

---

*Rapport généré à l'issue de l'étape 3 (tests live) de l'audit dashboard démarré précédemment. Étape 2 (câblage statique) et étape 3 sont maintenant closes pour le dashboard principal (§1-4) et pour les 10 composants/onglets complémentaires testés en §5. 16 composants sur les 26 recensés à l'étape 2 restent à couvrir en live pour une clôture totale.*
