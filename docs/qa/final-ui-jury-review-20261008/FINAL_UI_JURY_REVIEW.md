# 1 Executive Summary

Review date: 2026-10-08. Verdict: **B — READY_AFTER_MINOR_POLISH**. Les défauts factuels identifiés ont été corrigés dans le frontend. Aucun résultat inconnu n’a été remplacé par une réussite. Les trois réserves restantes sont P2 et sont décrites ci-dessous.

La validation concerne l’application réellement servie sur `http://127.0.0.1:4200`, ses cinq projets réels et ses contrats actuels. Elle ne certifie pas l’absence universelle de défauts ni la disponibilité future des systèmes externes. Aucun scanner, pipeline, remédiation, PR ou déploiement n’a été déclenché pour produire une démonstration favorable.

Périmètre mesuré : 285 entrées de provenance de champs importants (pas 285 instances de DOM), 732 interpolations de template inventoriées et 177 occurrences d’actions/navigation repérées. Le catalogue de composants comprend 26 composants. Les champs de résultats conditionnels ont été tracés dans le contrat ; les mutations correspondantes n’ont pas été exécutées. Les captures et lectures API constituent les preuves des valeurs effectivement observées.

# 2 Visible Platform Map

VISIBLE_PLATFORM_INVENTORY

La route et les sous-vues réelles, plutôt qu’un menu théorique, définissent le périmètre. Rôles : utilisateurs authentifiés en lecture ; éditeur/admin pour création/édition ; admin pour gestion des utilisateurs. Les opérations sensibles conservent leurs contrôles backend.

| ROUTE / vue | COMPONENT | PURPOSE | USER ROLES | MAIN DATA SHOWN | MAIN ACTIONS | API SOURCES |
|---|---|---|---|---|---|---|
| /login | Login | Authentification | Public | Erreur/session | Connexion | POST /auth/login |
| /dashboard | Dashboard | Synthèse multi-projet | Authentifiés | Incidents, états projets, observations disponibles, Jenkins | Projet, actualiser, notifications | /projects, /incidents, /dashboard/security-global, /dashboard/jenkins-global, /azure-deploy/ready/:id |
| /projects | Projects | Catalogue | Authentifiés ; édition autorisée | Identité, dépôt, état disponible | Ouvrir, créer, éditer, supprimer selon rôle | /projects, /dashboard/security-global |
| /projects/new ; /projects/:id/edit | ProjectForm | Configuration projet | Éditeur/admin | Général, CI/CD, Sonar | Sauvegarder/annuler | /projects, /projects/:id |
| /projects/:id?tab=rapport | ProjectDetail / ProjectOverview | État vérifié et rapport | Authentifiés | Dernier rapport, recommandations, preuves | Détails, navigation scanner | /projects/:id, /incidents?projectId, /projects/:id/reports |
| tab=jenkins | ProjectDetail / JenkinsfileOptimizer | CI et analyse du Jenkinsfile | Lecture ; actions selon rôle/contrat | Builds réels, tests, diagnostic IA enregistré | Jenkins externe, analyse/PR explicites | /projects/:id/jenkins-status, /jenkins/analyses, /jenkins/optimize |
| tab=sonarqube | ProjectDetail | Qualité du code | Authentifiés | Quality Gate, métriques disponibles, issues | Détail preuve | Incident.metadata.enrichedData.sonar |
| tab=docker | ProjectDetail / DockerfileOptimizer | Construction/publication et diagnostic | Authentifiés ; actions contrôlées | Build/push/image, propositions IA | Analyse/PR explicites | Incident.metadata.enrichedData.docker, /dockerfile/optimize |
| tab=securite | ProjectDetail / CveTable / ZapTable | Résultats scanner et remédiation | Authentifiés ; actions contrôlées | Trivy/OWASP/ZAP séparés, tâches/tentatives | Filtres, détail, créer/réessayer selon contrat | /manual-remediation, /manual-remediation/summary, incidents enrichis |
| tab=deploiement | ProjectDeployment | Décision gouvernée et cible configurée | Lecture ; autorisation selon rôle | READY/CONDITIONAL/CRITICAL_RISK/TECHNICALLY_IMPOSSIBLE, contrôles, identité cible | Actualiser, autoriser/déployer si éligible | /azure-deploy/ready/:id, /azure-deploy/governance/:id, authorize/deploy conditionnels |
| tab=incidents | ProjectDetail | Historique projet | Authentifiés | Statut et date persistés | Ouvrir incident | /incidents?projectId |
| tab=config | ProjectDetail | Configuration factuelle | Authentifiés | Dépôt, CI, paramètres fournis | Éditer selon rôle | /projects/:id |
| /incidents ; /incidents/:id | Incidents / IncidentDetail | Cycle et preuves de décision | Authentifiés ; actions contrôlées | Statut, guide, validation, données, PR | Filtrer, ouvrir panneaux, actions explicites | /incidents, /incidents/:id ; contrats dans action-inventory.json |
| /analysis | Analysis | Analyses des agents | Authentifiés | Décisions, confiance réellement fournie | Ouvrir rapport | /incidents |
| /security | Security | Observations de sécurité multi-projet | Authentifiés | Compteurs disponibles, manque de scanners | Ouvrir projet | /dashboard/security-global |
| /prediction | Prediction | Indicateurs de risque à règles | Authentifiés | Règles/points documentés | Ouvrir projet | /dashboard/risk-indicators |
| /settings | Settings | Configuration et diagnostics | Authentifiés ; modification contrôlée | Général, intégrations, sécurité, livraison, diagnostic par projet | Sélection projet, formulaires existants | /integrations, /dashboard/capabilities, /projects |
| /admin | Admin | Utilisateurs | Admin | Nom/email/rôle/date | Créer/administrer | /auth/users |
| Global | Layout / ChatWidget | Navigation, session, assistant | Authentifiés | Session, notifications, messages | Navigation, déconnexion, chat explicite | Session auth ; /chat/ask |
| /not-found ; ** | NotFound | Route inconnue | Authentifiés | Explication | Retour | Aucune donnée métier |

Les inventaires machine `visible-component-catalog.json`, `visible-binding-catalog.json` et `action-inventory.json` complètent cette carte, y compris boutons, filtres, panneaux, modales et endpoints trouvés. Leur extraction syntaxique n’est pas une preuve d’exécution de chaque action conditionnelle.

# 3 UI Data Provenance Matrix

Voir [UI_DATA_PROVENANCE_MATRIX.csv](UI_DATA_PROVENANCE_MATRIX.csv) et la version JSON : 285 lignes avec PAGE, UI_ELEMENT, DISPLAYED_VALUE, FRONTEND_FIELD, API_ENDPOINT, BACKEND_FIELD, ULTIMATE_SOURCE, REFRESH_MECHANISM, EMPTY_STATE, ERROR_STATE, CONFIDENCE.

La matrice est un registre de champs/chemins de contrat, pas une copie des valeurs de production pour chaque état conditionnel. Les chemins de groupes et alias de présentation se lisent avec les transformations du composant. Les valeurs mesurées et leurs identités exactes figurent dans `data-truth-spot-check.json` et `interaction-review.json`. PostgreSQL conserve les preuves historiques issues de Jenkins/Sonar/Trivy/Dependency-Check/ZAP ; un GET récent ne rend pas l’exécution du scanner récente. L’identité Azure est une configuration déclarée, pas une interrogation d’une ressource Azure active.

# 4 Fake / Hardcoded Data Audit

Recherche runtime : UUID, URLs, noms/projets, CVE, compteurs, statuts, mock/dummy/demo/fake/sample, Math.random, setTimeout, fixtures et nombres de repli. Registre : `runtime-pattern-classification.json`, audit initial : `runtime-pattern-audit.txt`. Les chaînes de primitives, endpoints, labels, sévérités et statuts constituent un contrat, pas des données fictives. Les UUID des scripts QA restent des fixtures de vérification hors bundle. Les fixtures de tests ne sont pas importées par le runtime. Math.random sert à des identifiants de requêtes, pas aux métriques ; les timers servent au polling, focus, toast ou rendu.

Aucun projet/CVE/cible Azure de démonstration n’a été injecté dans le frontend. Les valeurs optimistes et fallbacks fallacieux recensés étaient des défauts réels, désormais corrigés. Les occurrences encore marquées SUSPICIOUS dans le registre sont des points d’inspection, pas des faux métiers prouvés ; leur disposition est expliquée dans la section suivante. Aucun code de production n’a reçu les identités des projets QA.

# 5 Invalid Fallback Audit

- **Interdit pour une métrique affichée** : absence → 0, scanner ERROR → tableau vide propre, absence de score → 100, absence d’environnement → dev. Corrigé via `data-truth.ts` et états nullables.
- **Valide** : accumulateur initial d’un ensemble de lignes connues ; compteur d’événements effectivement chargés ; tri de CVSS manquant sans affichage de score ; largeur CSS nulle d’une barre explicitement indisponible ; identifiant technique absent pour contrôle de flux.
- **Sécurité** : une observation est exploitable seulement si le statut ne signale pas échec/non-exécution et si une preuve de résultat existe. Les anciennes preuves avec tableaux explicites restent lisibles selon le contrat historique. Un tableau vide isolé inventé par le frontend ne prouve rien.
- **Agrégats** : somme des scanners réellement disponibles, libellée observations ; aucune prétention de CVE uniques. L’agrégat moyen ambigu et les scores incomplets sont indisponibles.
- **Confiance et dates** : confiance absente nullable ; moyennes sur mesures présentes ; date invalide indisponible. L’heure frontend est uniquement utilisée pour le temps relatif, jamais comme date du scan.

Les 32 occurrences initialement SUSPICIOUS ont une disposition individuelle argumentée dans le registre ; elles ne sont pas laissées sans revue. Le ledger conserve les occurrences de contrôle interne de retry/éligibilité sans modifier leurs règles. Ces nombres de contrôle ne sont pas des preuves de succès scanner. Les contrats backend qui ne fournissent pas une métrique restent des limitations visibles.

# 6 Status Semantics Review

| État | Présentation / preuve |
|---|---|
| AVAILABLE | Valeur réelle et contexte source identifiable |
| NOT_AVAILABLE / UNKNOWN | Non disponible / Non vérifié, neutre |
| NOT_CONFIGURED | Non configuré, aucune santé inférée |
| NOT_EXECUTED | Non exécuté selon statut source |
| LOADING | Chargement, ancien projet effacé |
| EMPTY | Aucun résultat après réponse réussie uniquement |
| ERROR | Erreur de chargement / Indisponible, aucune valeur zéro inventée |
| STALE | Preuve historique avec identité de build/date ; ne prouve pas l’état live |
| BLOCKED | Bloqué / risque ou contrôle explicitement fourni |

Vert réservé aux réussites explicites. PR proposée, candidat validé, finding absent, fusion et déploiement restent des concepts distincts. Un résultat OPERATOR_TEST_STOPPED n’est pas une correction de production.

# 7 Page-by-Page Review

Toutes les routes de la carte ont été inspectées dans le source ; 97 états servis ont été visités. Pour chacun des cinq projets : rapport, Jenkins, SonarQube, Docker, sécurité, déploiement, incidents, configuration ; paramètres projet et sections d’édition. Les formulaires ont été ouverts sans sauvegarde. Trois incidents réels et leurs panneaux Guide/Validation/Données ont été inspectés. Connexion : contrat et composant relus ; aucune tentative de login/mutation nécessaire avec la session QA authentifiée.

Priorité de lecture : identité → état prouvé → preuve → action autorisée → détails. La page sans rapport ne présente plus de score synthétique. Le risque actuel de pfe-app-test reste visible, plutôt que d’embellir artificiellement la démonstration.

# 8 Navigation Review

Libellés Jenkins/CI/CD et Déploiement distincts ; onglet actif existant conservé ; route Incidents rendue accessible dans la navigation globale. Les liens externes Jenkins sont des preuves de build. Aucun parcours Azure n’est déclenché. Ancienne sidebar interne masquée supprimée car la navigation globale est déjà portée par Layout. Aucun endpoint métier n’a été remplacé par une navigation cosmétique.

Actions : `action-inventory.json`. Les filtres, onglets, panneaux et ouverture/annulation du formulaire admin ont été exercés. Les écritures de pipeline, utilisateurs, projet, remédiation, PR, chat, intégration et déploiement sont tracées dans le code mais non déclenchées. Le navigateur bloque POST/PUT/PATCH/DELETE par précaution ; aucun appel bloqué n’a été nécessaire lors du parcours de lecture. Pas de bouton mort identifié dans le périmètre effectivement rendu ; cela ne constitue pas une exécution destructive de tous les handlers.

# 9 Data Duplication Review

Cinq présentations redondantes/ambiguës retirées : sidebar interne masquée, graphique de sévérité mélangeant les scanners, barre de risque répétant le score voisin, code de capacité brut répétant son libellé français et code de décision brut répétant le badge gouvernance. Une répétition narrative involontaire corrigée en identifiant correctement les agents. **DUPLICATE_INFORMATION_REMOVED = 6**. Quatre familles de répétitions utiles conservées : identité dans l’en-tête et les preuves de build ; synthèse globale puis détail scanner ; statut de tâche et historique de tentative ; cible/configuration et contrôle de gouvernance. Ces répétitions servent la corrélation, sans recopier tous les champs partout.

# 10 Cross-project Review

Cinq projets : devsecops-platform-testbed, vuln-testapp, devsecops-testbed, pfe-app-test, remediation-retry-e2e-fixture. Identités exactes dans `final-browser.json`. Navigation SPA réutilisant le composant : ancien en-tête absent à 60 ms, nouvel en-tête attendu, cinq transitions réussies. Annulation des lectures par portée et test de réponse tardive A→B. Même précaution sur incident réutilisé. Paramètres sélectionnés pour chaque projet. Aucun if/switch dépendant d’une identité projet ajouté.

# 11 Security Presentation Review

SonarQube = qualité/code ; Trivy = image/paquets ; Dependency-Check = dépendances ; ZAP = sécurité dynamique. Sources affichées séparément. Les totaux globaux sont des **observations scanner**, susceptibles de compter une CVE dans plusieurs scanners. Projet sans analyse et scanner indisponible ne sont jamais présentés comme propres. Le champ medium global n’a pas une sémantique fiable : Non disponible. Les tableaux historiques de tâches restent consultables même sans rapport récent, avec état source explicite.

# 12 CI/CD Presentation Review

Jenkins live #151 SUCCESS, taux 100 % sur 15 builds disponibles pour pfe-app-test dans le contrôle. Le résultat ne signifie pas déploiement réussi. Job, URL, durée, date et numéro proviennent de Jenkins via backend ; aucun job fixe introduit. Diagnostics IA du Jenkinsfile : recommandations et score du **fichier original analysé**, non métriques du build actuel. Analyse enregistrée conservée ; sa date pourrait être plus saillante (P2).

# 13 Remediation Presentation Review

DETECTED, tâche, tentative, candidat, validation, PR, clôture et correction de projet ne sont pas fusionnés. La tâche fixture contrôlée conserve DETECTED/TODO et OPERATOR_TEST_STOPPED malgré candidateEvaluationPassed=true : arrêt opérateur ≠ vulnérabilité corrigée en production. Les règles business, réservations, retry et callbacks sont intactes. Libellés et tooltips améliorés uniquement.

# 14 Deployment Presentation Review

GET ready et GET governance lus sans mutation. CRITICAL_RISK pour le projet contrôlé ; aucune autorisation/déploiement. États de capacité et d’exécution restent séparés. Azure aci-pfe-app-test / rg-pfe-devsecops / francecentral sont des valeurs backend de configuration. Ni santé live ni succès Azure n’en sont déduits. HTTP 200 sur la lecture ne signifie pas DEPLOYED. Les tests existants de gouvernance UI et sécurité de déploiement passent.

# 15 Loading / Empty / Error State Review

Réinitialisation des anciennes données lors du changement de projet ; spinner/erreur/absence distincts. Résumé manuel non affiché avant succès de chargement. Historique Jenkinsfile en erreur ne devient plus historique vide. Erreur clipboard gérée sans exception non interceptée. Les scanners absents/échoués n’alimentent plus de faux zéros. Les états d’échec attendus sont testés au niveau unitaire. Un 503 injecté exclusivement dans le navigateur sur la lecture Jenkinsfile confirme le message d’erreur et l’absence de faux historique vide (`jenkins-error-state-test.json`) ; aucun système externe n’a été mis en panne.

# 16 Visual / UX Consistency Review

Design existant conservé ; cartes et badges réutilisés, gris pour absence de preuve. Une page ne présente plus un mélange de CVE/code/ZAP comme un même risque quantifié. Résolutions testées : 1366×768, 1440×900, 1920×1080, sans débordement horizontal de page. Les tables peuvent conserver un défilement interne raisonnable. Aucun redesign, cache complexe ou nouvelle fonctionnalité.

# 17 Accessibility Review

Labels associés au formulaire admin ; aria-label boutons essentiels/chat/session/suppression ; entrée clavier sur lignes projet de sécurité ; soumission multiple bloquée ; texte accompagne les couleurs. Ouverture/annulation d’un dialogue admin vérifiée. Contraste exhaustif, focus trap de toutes les modales, lecteurs d’écran et audit WCAG complet non réalisés : réserve P2, pas de certification d’accessibilité.

# 18 Runtime Browser Review

Application servie, et non source seul : `final-browser.json`, captures `final-*.png`, `interaction-review.json`, `console-audit.json`. 97 états, cinq projets. Aucune exception non interceptée, erreur console, ressource HTTP >=400 ou requête échouée dans le smoke console enregistré. Les captures de gouvernance attendent la réponse plutôt que de compter un spinner comme validation. L’identité du bundle est enregistrée dans `frontend-release.json`.

# 19 Network/API Review

Aucun appel API en erreur durant le parcours enregistré ; aucune écriture envoyée. Deux lectures identiques du résumé sécurité ont été partagées par refresh ; appels Jenkins par projet inutiles retirés au profit du tableau global déjà chargé. Les requêtes distinctes pour décisions, incidents et preuves ne sont pas arbitrairement fusionnées. Polling de tentative/PR existant borné conservé, pas de nouveau polling. Les GET gouvernance peuvent être lents : attente explicite jusqu’à état rendu, sans fake loading ni succès supposé.

# 20 Data Truth Spot Checks

| Élément | UI = API / source persistée ou transformation |
|---|---|
| Identité | pfe-app-test ; 3aa1c9b9-e114-40e4-884b-ebc7aa32e002 ; souhaiel11/pfe-app-test = PostgreSQL |
| Jenkins | #151 SUCCESS = API live Jenkins via backend ; 100 % / 15 mesures |
| Sonar | Échec / 12 code smells = ERROR / 12 dans preuve du build |
| Trivy | 14 critiques, 111 observations = preuve COMPLETED persistée |
| OWASP Dependency-Check | 23 critiques, 146 observations = preuve COMPLETED persistée |
| ZAP | 0 hautes / 2 moyennes = résultat COMPLETED ; vrai zéro |
| Remédiation | Test opérateur terminé = OPERATOR_TEST_STOPPED ; finding toujours DETECTED |
| Incident | Bloqué = blocked pour 70bc8f46-5cd2-48a3-9f8b-169cf2ba250b |
| Gouvernance | Risque critique = CRITICAL_RISK, build 151 |
| Azure | aci-pfe-app-test / rg-pfe-devsecops = configuration API, pas état Azure live |
| Agrégat | 39 critiques / 109 hautes = somme des seules sources disponibles |

Les métriques des scanners ont été comparées aux JSON stockés en base. Les objets API sont enrichis de liens/statuts de remédiation : ils ne sont pas strictement identiques au JSON brut, mais les métriques contrôlées le sont. Aucun nouveau scan ni interrogation indépendante directe de Sonar/Azure n’est revendiqué. Voir les preuves JSON pour champs, dates, digest et commit.

# 21 Jury Risks

Ne pas annoncer « projet sécurisé » sur la base d’un seul scanner, « corrigé » sur une PR, « déployé » sur une image ou « prédiction IA » pour les règles déterministes. Les données peuvent être historiques ; montrer l’identité du build sélectionné. Ne pas masquer un véritable Quality Gate en échec ou un risque critique pour embellir la soutenance. Les réserves P2 concernent accessibilité exhaustive, date d’analyse Jenkinsfile et budget CSS.

# 22 Changes Applied

Toutes les corrections portent sur le frontend, ses tests et cette preuve QA. `changes-applied.json` fournit les empreintes avant/après des sources par rapport à la copie de début de revue. Le workspace contenait déjà de nombreuses modifications : elles n’ont pas été annulées, ni engagées globalement. Le bundle qualifié a été publié dans le répertoire statique servi par nginx ; anciens chunks conservés pour les sessions ouvertes. Aucun backend/verifier/scanner/workflow redéployé.

## Registre des issues

### UI-01

- ID : UI-01
- PAGE : Projet / rapport
- COMPONENT : ProjectDetail
- SEVERITY : P0
- OBSERVED : Sans rapport, score initial 100/100 et risque faible.
- EXPECTED : Aucun score sans preuve.
- DATA_SOURCE : GET incidents, metadata.enrichedData
- ROOT_CAUSE : Valeurs initiales optimistes.
- FIX_APPLIED : Score nullable, état inconnu neutre ; reset à chaque projet.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-02

- ID : UI-02
- PAGE : Scanners / Sonar / tests
- COMPONENT : DataTruth / templates
- SEVERITY : P0
- OBSERVED : Compteurs absents ou scanner échoué pouvaient apparaître à zéro.
- EXPECTED : Zéro seulement si valeur réelle et résultat exploitable.
- DATA_SOURCE : Pipeline enrichi persistant
- ROOT_CAUSE : Fallbacks ||0 et ??0 sur métriques.
- FIX_APPLIED : Fonctions partagées scannerHasResult/scannerMetric/availableNumber ; états distincts.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-03

- ID : UI-03
- PAGE : Dashboard / sécurité globale
- COMPONENT : SecuritySummary
- SEVERITY : P0
- OBSERVED : 73 critiques / 226 hautes incluaient des scanners indisponibles.
- EXPECTED : Sommer uniquement les observations disponibles, expliquer les doublons.
- DATA_SOURCE : GET dashboard/security-global
- ROOT_CAUSE : Agrégat backend incluant des compteurs historiques de scanners manquants.
- FIX_APPLIED : Transformation frontend déterministe : 39 critiques / 109 hautes disponibles ; aucun changement backend.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-04

- ID : UI-04
- PAGE : Sécurité globale
- COMPONENT : SecuritySummary
- SEVERITY : P1
- OBSERVED : Champ medium résiduel regroupait également LOW/UNKNOWN.
- EXPECTED : Afficher uniquement une vraie métrique moyenne.
- DATA_SOURCE : GET dashboard/security-global
- ROOT_CAUSE : Contrat de compteur non suffisamment discriminé.
- FIX_APPLIED : Métrique moyenne masquée en Non disponible ; gap backend documenté.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-05

- ID : UI-05
- PAGE : Changement de projet
- COMPONENT : ProjectDetail
- SEVERITY : P1
- OBSERVED : Des réponses tardives pouvaient repeupler le projet suivant.
- EXPECTED : Annuler les lectures précédentes et réinitialiser les états.
- DATA_SOURCE : Lectures project/report/tasks/incidents/Jenkins/deployment
- ROOT_CAUSE : Subscriptions non bornées au projet.
- FIX_APPLIED : takeUntil par portée ; reset complet ; tests et navigation A→B réels.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-06

- ID : UI-06
- PAGE : Détail incident
- COMPONENT : IncidentDetail
- SEVERITY : P1
- OBSERVED : Réutilisation du composant pouvait conserver le précédent incident.
- EXPECTED : Recharger/couper le polling au changement identifiant.
- DATA_SOURCE : GET incidents/:id
- ROOT_CAUSE : Absence de cycle OnChanges.
- FIX_APPLIED : Reset et annulation du chargement/polling précédent.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-07

- ID : UI-07
- PAGE : Vue d’ensemble
- COMPONENT : ProjectOverview
- SEVERITY : P1
- OBSERVED : Recommandations automatiques présentées comme corrections appliquées.
- EXPECTED : Recommandation ≠ correction vérifiée.
- DATA_SOURCE : developerGuide.autoCount
- ROOT_CAUSE : Libellé trop affirmatif.
- FIX_APPLIED : Recommandations automatiques ; absence de guide explicite.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-08

- ID : UI-08
- PAGE : Vue d’ensemble
- COMPONENT : ProjectOverview
- SEVERITY : P1
- OBSERVED : Graphique de sévérités additionnait des sources incompatibles.
- EXPECTED : Conserver des résultats scanner distincts.
- DATA_SOURCE : Sonar/Trivy/OWASP/ZAP
- ROOT_CAUSE : Agrégat visuel ambigu.
- FIX_APPLIED : Graphique retiré ; quatre résultats spécialisés conservés.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-09

- ID : UI-09
- PAGE : En-tête / dashboard
- COMPONENT : ProjectDetail / Dashboard
- SEVERITY : P1
- OBSERVED : Environnement dev, santé Stable ou risque faible pouvaient être des valeurs de repli.
- EXPECTED : Configuration absente et santé inconnue restent neutres.
- DATA_SOURCE : Project et dashboard
- ROOT_CAUSE : Valeurs par défaut métier.
- FIX_APPLIED : Non configuré / Non vérifié / Non disponible selon le champ.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-10

- ID : UI-10
- PAGE : SonarQube
- COMPONENT : QualityGatePresentation
- SEVERITY : P1
- OBSERVED : État inconnu pouvait être assimilé à échec ou succès.
- EXPECTED : Badge vert seulement pour gate explicitement réussi.
- DATA_SOURCE : sonar.quality_gate / status
- ROOT_CAUSE : Condition binaire sans état inconnu.
- FIX_APPLIED : Présentation explicite succès/échec/inconnu ; scanner échoué prioritaire.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-11

- ID : UI-11
- PAGE : Docker diagnostic
- COMPONENT : PhaseDiagnostics
- SEVERITY : P1
- OBSERVED : Construction pouvait être décrite comme publication réussie sans preuve de push.
- EXPECTED : Construction et publication distinctes.
- DATA_SOURCE : docker.build_status/push_status
- ROOT_CAUSE : Repli du push sur build.
- FIX_APPLIED : Publication non confirmée si preuve absente.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-12

- ID : UI-12
- PAGE : Dashboard réseau
- COMPONENT : Dashboard
- SEVERITY : P2
- OBSERVED : Deux lectures identiques du résumé sécurité et lectures Jenkins supplémentaires par projet.
- EXPECTED : Partager les lectures du rafraîchissement courant.
- DATA_SOURCE : security-global / jenkins-global
- ROOT_CAUSE : Souscriptions indépendantes.
- FIX_APPLIED : shareReplay local au refresh et réutilisation du tableau Jenkins global.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-13

- ID : UI-13
- PAGE : Rapport agents
- COMPONENT : ProjectDetail
- SEVERITY : P2
- OBSERVED : Le nom SecurityConfig.java pouvait déclencher un mauvais texte agent.
- EXPECTED : Identifier l’agent par libellé.
- DATA_SOURCE : aiAnalysis.agentActions
- ROOT_CAUSE : Recherche non ancrée et repli positionnel.
- FIX_APPLIED : Correspondance ancrée ; pas de duplication du récit général.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-14

- ID : UI-14
- PAGE : Statuts remédiation
- COMPONENT : StatusLabels / tables
- SEVERITY : P1
- OBSERVED : Clôturé ou PR proposée pouvait évoquer une correction acquise.
- EXPECTED : PR / candidat / absence vérifiée / déploiement distincts.
- DATA_SOURCE : Task.scannerStatus et securityFindingRemediation
- ROOT_CAUSE : Labels génériques trop affirmatifs.
- FIX_APPLIED : Clôturé neutre ; proposition bleue ; explication Compatibilité ; logique PROJECT_FIX_VERIFIED préservée.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-15

- ID : UI-15
- PAGE : Agents / incident
- COMPONENT : Analysis / IncidentDetail
- SEVERITY : P1
- OBSERVED : Confiance absente affichée 0 %.
- EXPECTED : Absence ≠ confiance nulle.
- DATA_SOURCE : aiAnalysis.confidenceScore
- ROOT_CAUSE : Repli numérique.
- FIX_APPLIED : Valeur nullable ; moyenne des seules mesures disponibles.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-16

- ID : UI-16
- PAGE : Navigation / identité
- COMPONENT : Layout
- SEVERITY : P2
- OBSERVED : Incidents peu accessibles ; nom lisait username non fourni.
- EXPECTED : Navigation cohérente et identité de session réelle.
- DATA_SOURCE : Auth.user.name / route incidents
- ROOT_CAUSE : Mapping incorrect et lien absent.
- FIX_APPLIED : name ; lien Incidents ; suppression sidebar masquée redondante.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-17

- ID : UI-17
- PAGE : Formulaires / icônes
- COMPONENT : Admin / ProjectForm / Chat
- SEVERITY : P2
- OBSERVED : Soumission multiple et champs/icônes insuffisamment nommés.
- EXPECTED : Garde de soumission et noms accessibles.
- DATA_SOURCE : Actions auth/projects/chat
- ROOT_CAUSE : Manque de garde/label.
- FIX_APPLIED : Garde loading ; labels administrateur ; aria-label boutons essentiels.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-18

- ID : UI-18
- PAGE : Jenkinsfile historique
- COMPONENT : JenkinsOptimizer
- SEVERITY : P1
- OBSERVED : Erreur de lecture historique affichée comme absence d’analyse.
- EXPECTED : Erreur de chargement distincte d’un historique vide.
- DATA_SOURCE : GET jenkins/analyses
- ROOT_CAUSE : Gestion d’erreur silencieuse.
- FIX_APPLIED : Message de chargement impossible ; correction finale requalifiée.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-19

- ID : UI-19
- PAGE : Accessibilité
- COMPONENT : Modales existantes
- SEVERITY : P2
- OBSERVED : Pas de qualification exhaustive du focus trap, Escape et lecteur d’écran.
- EXPECTED : Audit clavier/lecteur d’écran complet.
- DATA_SOURCE : Composants de dialogue existants
- ROOT_CAUSE : Portée des contrôles automatiques limitée.
- FIX_APPLIED : NON — limitation restante ; labels améliorés, aucune certification WCAG revendiquée.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-20

- ID : UI-20
- PAGE : Jenkinsfile historique
- COMPONENT : JenkinsOptimizer
- SEVERITY : P2
- OBSERVED : Diagnostic du fichier original persisté ; date de cet historique peu visible.
- EXPECTED : Date/révision d’analyse plus immédiatement visibles.
- DATA_SOURCE : JenkinsAnalysis persistée
- ROOT_CAUSE : Hiérarchie historique perfectible.
- FIX_APPLIED : NON — score explicitement du fichier original ; ne pas présenter comme build live.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

### UI-21

- ID : UI-21
- PAGE : Styles projet
- COMPONENT : ProjectDetail SCSS
- SEVERITY : P2
- OBSERVED : 25,97 kB dépassent le budget avertissement 20 kB.
- EXPECTED : Réduire les styles lors d’un polish séparé.
- DATA_SOURCE : Production Angular build
- ROOT_CAUSE : Styles existants volumineux.
- FIX_APPLIED : NON — build passe, aucune refonte CSS risquée.
- EVIDENCE : sources dans changes-applied.json ; frontend-tests.log ; final-browser.json/captures ; interaction-review.json ; build.log selon le cas.

# 23 Remaining Limitations

Trois issues P2 ouvertes : UI-19, UI-20, UI-21. Autres limites de preuve : mutations volontairement non exercées ; pas de certification WCAG ; aucune nouvelle exécution des scanners/pipelines ; état Azure déclaré non interrogé en direct. Le contrat de medium global et les métriques absentes restent affichés indisponibles, sans modification backend. La matrice suit les champs de contrat, pas chaque cellule d’un historique arbitrairement long. Les rôles non-admin ont été relus dans les guards/handlers, pas parcourus avec tous les comptes réels. Le build offline conserve la configuration production et rend les polices disponibles localement ; ce n’est pas une validation d’un déploiement cloud.

## Scorecard /10

| Dimension | Score |
|---|---:|
| Data truthfulness | 8,5 |
| Data provenance | 8,5 |
| Project genericity | 9 |
| Navigation | 8,5 |
| Information hierarchy | 8 |
| Security clarity | 8 |
| Remediation clarity | 8,5 |
| CI/CD clarity | 8 |
| Deployment clarity | 8,5 |
| Error handling | 8 |
| Loading/empty states | 8 |
| Visual consistency | 8 |
| Accessibility | 7 |
| Cross-project safety | 9 |
| Demo readiness | 8 |

Ces scores décrivent le périmètre vérifié, sans extrapolation à une certification.

# 24 Recommended Soutenance Navigation

Projets → pfe-app-test → Rapport/vue d’ensemble → Jenkins (build et preuve externe) → SonarQube (Quality Gate réel) → Sécurité (Trivy, Dependency-Check, ZAP séparés) → détail d’une tâche/tentative (candidat et arrêt opérateur distincts de correction) → Déploiement (gouvernance/contrôles, sans lancer) → autre projet pour prouver la généricité → sécurité globale pour expliquer les observations et états manquants.

Préférer des preuves réelles imparfaites à une démonstration artificiellement verte. Le fixture est une preuve technique dédiée, pas un projet de production prétendument corrigé.

## Mandatory final results

```text
TOTAL_VISIBLE_DATA_ELEMENTS_AUDITED = 285 entrées de champs importants ; 732 bindings inventoriés
DATA_WITH_KNOWN_SOURCE = 285 chemins de contrat/source tracés
DATA_WITH_UNKNOWN_SOURCE = 0 dans ce registre
INVALID_RUNTIME_FAKE_DATA = 0 identifié après correction
INVALID_RUNTIME_FAKE_DATA_COUNT = 0 identifié après correction
HARDCODED_BUSINESS_DATA = 0 identifié après correction
MISLEADING_ZERO_FALLBACKS = 0 identifié restant dans les métriques auditées
FALSE_SUCCESS_STATES = 0 identifié restant
STALE_CROSS_PROJECT_RISKS = 0 reproduit après correction ; tests de réponse tardive PASS
UNNECESSARY_DUPLICATES_FOUND = 6
UNNECESSARY_DUPLICATES_REMOVED = 6
NECESSARY_DUPLICATES_RETAINED = 4 familles ; identité, scanner, historique de tentative, gouvernance/cible
BROKEN_OR_DEAD_BUTTONS = 0 identifié dans les états rendus ; mutations non exécutées
LEGACY_NAVIGATION_PATHS = 0 identifié restant
FRONTEND_TESTS = PASS ; 29 fichiers spec, aucune erreur
FRONTEND_BUILD = PASS ; avertissement SCSS documenté
SERVED_APP_VALIDATED = YES
ALL_REAL_PROJECTS_CHECKED = YES ; 5/5
UI_API_SOURCE_SPOT_CHECK = PASS ; preuves historiques et transformations précisées
P0_REMAINING = 0 connu
P1_REMAINING = 0 connu
P2_REMAINING = 3
DATA_TRUTHFULNESS = PASS dans le périmètre vérifié
MULTI_PROJECT_UI = PASS
JURY_PRESENTATION_READY = YES avec limites exposées
SAFE_TO_FREEZE_FRONTEND = YES pour le périmètre pratique ; P2 documentés
FINAL_VERDICT = B — READY_AFTER_MINOR_POLISH
WF2_CHANGED = NO
WF6_CHANGED = NO
REMEDIATION_LOGIC_CHANGED = NO
RETRY_LOGIC_CHANGED = NO
PHASE4G_CHANGED = NO
AZURE_GOVERNANCE_LOGIC_CHANGED = NO
AZURE_DEPLOYMENT_EXECUTED = NO
HARNESS_AFTER = false
NORMAL_DISPATCH_AFTER = false
UNRELATED_BUSINESS_STATE_CHANGED = NO
```

Comparaison avant/après : mêmes 5 projets, 777 tâches, 249 incidents, 63 rapports, 2 réservations historiques, 2 plans historiques ; empreintes de toutes les lignes identiques. Les nombres historiques ne sont pas des réservations/plans actifs. Le contrôle final (`final-active-state.json`) confirme 0 réservation active, 0 plan actif et uniquement 775 tâches sans tentative / 2 tâches OPERATOR_TEST_STOPPED, donc aucun writer actif. Identités des composants et définitions des workflows identiques. Le backend au début de cette revue était f212d19b086966b4b146c47f7cc48aeb7c8e466c ; il n’a pas été remplacé par la révision d’un ancien message.


## Identité de la release frontend

Index servi SHA-256 : `a77d50d0a2b848a0ca5acd55c228fa0bd6f5a87b43ce0b6412845446ac6c5bc9`. Manifest complet : `frontend-release.json`.

## Final human-readable summary

PLATFORM_UI_STATUS = Cohérent et vérifié sur les parcours servis ; trois réserves de polish.

WHAT_WAS_WRONG =
1. Absences/échecs convertis en score optimiste ou zéro.
2. Agrégats ambigus et recommandations présentées comme corrections.
3. Risques de données anciennes au changement de projet et états d’erreur insuffisants.

WHAT_WAS_FIXED =
1. États indisponible/non exécuté/non configuré explicites et valeurs nullables.
2. Observations scanner disponibles uniquement, statuts et preuves distincts.
3. Annulation des anciennes lectures, navigation/labels/accessibilité et erreurs améliorés.

FAKE_DATA_REMAINING = 0 identifié
UNKNOWN_SOURCE_DATA_REMAINING = 0 dans le registre audité
P0_REMAINING = 0 connu
P1_REMAINING = 0 connu

TOP_5_JURY_VISIBLE_STRENGTHS =
1. Cinq projets réels et changement de contexte vérifié.
2. Sources scanner et échecs clairement distingués.
3. Jenkins et Sonar visibles avec preuves réelles.
4. Remédiation, candidat, PR et correction non confondus.
5. Gouvernance Azure explicite sans succès artificiel.

TOP_REMAINING_LIMITATIONS =
1. Audit exhaustif clavier/lecteur d’écran non réalisé.
2. Date du diagnostic Jenkinsfile enregistré peu saillante.
3. Budget CSS projet en avertissement ; métriques backend absentes honnêtement indisponibles.

BEST_SOUTENANCE_DEMO_FLOW = Projets → Rapport → Jenkins → SonarQube → Sécurité → Remédiation → Gouvernance de déploiement → autre projet.
SAFE_TO_FREEZE_FRONTEND = YES
FINAL_VERDICT = B — READY_AFTER_MINOR_POLISH
REPORT_PATH = docs/qa/final-ui-jury-review-20261008/FINAL_UI_JURY_REVIEW.md
