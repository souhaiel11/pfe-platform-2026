# Finalisation frontend avant E2E — 30 septembre 2026

Le frontend est testé et déployé sur http://127.0.0.1:4200. Ce lot modifie la présentation et les tests frontend uniquement. Les modifications backend, workflows et autres fichiers déjà présentes au début du travail ont été conservées. Aucun correctif, build Jenkins, déploiement Azure, PR, commit ou push n’a été déclenché. Les requêtes de modification étaient bloquées pendant la validation visuelle ; aucun appel bloqué n’a été tenté.

## Résultat demandé

```text
TRIVY_FILTERS_IMPLEMENTED: YES
TRIVY_FILTERS_MATCH_OWASP: YES
TRIVY_FILTER_COUNTS: Toutes 105; Disponibles 5; Intervention manuelle 89; En cours 1; Corrigées 10
OWASP_REGRESSION: PASS
GLOBAL_FRENCH_AUDIT: PASS — libellés, états, actions, erreurs et recommandations de présentation
ENGLISH_USER_VISIBLE_STRINGS_REMAINING: descriptions et preuves techniques originales des scanners / contenus historiques générés; noms de produits et commandes conservés
RAW_INTERNAL_ENUMS_VISIBLE: aucun enum V1.8 dans la présentation courante; données brutes accessibles dans les détails techniques
FRENCH_STATUS_MAPPING: PASS
BLOCK_REASON_PRESENTATION: PASS
GRAFANA_CLASSIFICATION: PARTIAL
GRAFANA_REMOVED_FROM_UI: YES
GRAFANA_INFRA_REMOVED: NOT_SAFE_TO_REMOVE
ACTUAL_PIPELINE_STAGES_FOUND: build, tests, sonar, owasp, docker, trivy, deploy, zap
CANONICAL_STAGE_ORDER: build → tests → sonar → owasp → docker → trivy → deploy (cible de validation) → zap
ZAP_POSITION_CORRECT: YES
FINAL_DEPLOYMENT_POSITION_CORRECT: YES — panneau Azure après les contrôles, distinct du déploiement Jenkins de la cible ZAP
UNKNOWN_STAGE_POLICY: fin de liste, rang 1000, tri déterministe par identifiant, libellé Autre étape, avertissement développeur
PIPELINE_ORDER_CENTRALIZED: YES
DATE_FORMAT_CONSISTENT: YES — dates françaises longues; heures HH:mm; durées h/min/s; nombres fr-FR
RESPONSIVE_UI: PASS
FRONTEND_TESTS: PASS — 14 fichiers de tests
FRONTEND_TYPECHECK: PASS
FRONTEND_PRODUCTION_BUILD: PASS
GIT_DIFF_CHECK: PASS
BACKEND_MODIFIED: NO — dans ce lot
N8N_MODIFIED: NO
WF1_WF6_MODIFIED: NO
DB_MODIFIED: NO
LIVE_FRONTEND_DEPLOYED: YES
READY_FOR_FINAL_E2E: YES — préparation frontend terminée; ce résultat ne signifie pas que les contrôles du projet sont déjà satisfaits
COMMIT: NO
PUSH: NO
```

## Filtres et versions

Une seule classification partagée fournit les états et les compteurs d’OWASP et de Trivy. Les décisions V1.8 bloquées, les alternatives nécessitant une intervention et les listes de versions cibles multiples ne sont pas classées comme corrections automatiques disponibles. Les corrections confirmées par une nouvelle analyse (`VERIFIED` et `NOT_DETECTED`) sont présentées comme corrigées. Les règles de sélection et de dispatch métier restent dans leurs modules existants ; la présentation masque les possibilités de sélection incohérentes avec une décision bloquée.

| Source chargée, projet pfe-app-test, build 149 | Toutes | Disponibles | Intervention manuelle | En cours | Corrigées |
| --- | ---: | ---: | ---: | ---: | ---: |
| Trivy | 105 | 5 | 89 | 1 | 10 |
| OWASP Dependency-Check | 146 | 11 | 134 | 0 | 1 |

Chaque bouton a été cliqué en lecture seule et son compteur comparé au nombre de lignes réellement affichées. Les filtres V1.8 disposent également de compteurs dynamiques. Les filtres de texte, de sévérité et de traitement existants continuent à s’appliquer par intersection.

Le composant vulnérable et sa version installée restent séparés de l’éventuel propriétaire Maven. Pour un parent Spring Boot, la recommandation décrit explicitement « Spring Boot Parent : version du parent actuelle → version cible », et la version du composant provient du champ `installedVersion` de la preuve, jamais de `fromVersion` du parent. Les explications de blocage ne réaffichent pas les phrases anglaises ou les enums de l’evidence store.

## Étapes réelles et ordre

Le fichier WF1 local audité produit `build`, `tests`, `sonar`, `trivy`, `owasp`, `zap`, `deploy`. La réponse réelle de `/api/azure-deploy/ready/:projectId` produit également `docker` et arrivait dans l’ordre `zap, build, owasp, sonar, tests, trivy, deploy, docker`. Cet ordre API ne pilote plus l’affichage.

États du contrat : `PASSED`, `FAILED`, `WARNING`, `RUNNING`, `NOT_RUN`, `NOT_REACHED`. États observés sur le build 149 : build/docker réussis, tests/déploiement non exécutés, SonarQube/OWASP/Trivy en échec, ZAP en avertissement.

L’ordre et les libellés sont centralisés dans `frontend/src/app/shared/pipeline-stage-presentation.ts`. Les aliases incluent `JENKINS_BUILD`/`COMPILE` → build, `test` → tests, `sonarqube` → sonar et `docker`/`image` → container. Le rail, les cartes de préparation au déploiement et les incidents utilisent le même tri. Les états n’interviennent pas dans le tri. Les rapports anciens n’ajoutent pas d’étapes absentes de leurs données.

Le Jenkinsfile applicatif déploie la cible avant l’analyse DAST ZAP. Ce déploiement est étiqueté « Déploiement de la cible de validation ». Le déploiement final Azure existe dans un panneau distinct, déplacé après les contrôles de sécurité et de validation. Aucune étape backend fictive de staging/production/gate n’a été ajoutée.

Le projet reste correctement non prêt à déployer : tests non exécutés, analyses bloquantes, validation/corrélation non satisfaites et Azure non configuré. Ces états sont des résultats existants, pas des défauts introduits par ce lot frontend.

## Grafana

Audit : navigation `/monitoring`, route, composant, appel générique aux intégrations, carte de paramètres, placeholders, backend `integrations`, Compose principal extérieur à `platform`, configuration Prometheus et documentation d’audit. Aucun tableau de bord Grafana intégré ou JSON de dashboard provisionné utile n’a été identifié dans le frontend. Le composant ne fournissait qu’un lien externe.

Retirés : entrée de navigation, section Infrastructure devenue vide, route `/monitoring`, composant Monitoring, carte/configuration/placeholder Grafana dans les paramètres. Il ne reste aucune référence Grafana dans `frontend/src`.

Conservés : backend d’intégrations, conteneur/volume Grafana, Prometheus et configuration de collecte interne. Les conteneurs Grafana/Prometheus sont actifs ; la configuration de collecte vise l’application Spring Boot et Jenkins. La documentation rapporte aussi des tests de connexion réussis antérieurs. L’audit ne prouve donc pas que l’infrastructure est inutilisée : suppression non sûre. Les documents historiques restent des pièces d’audit, sans lien produit actif.

## Validation et preuves

- `cd frontend && npm run test:frontend-finalization` : 14/14 fichiers réussis, audit français réussi.
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json` : réussi.
- Build de production isolé dans `/tmp/frontend-final-build`, puis copie du bundle testé dans le montage nginx existant : réussi.
- `git diff --check` : réussi.
- 17 vues vérifiées à 1440 px et 390 px, plus captures de scanner, rail, cartes et chat : aucune erreur JavaScript, aucun débordement global, tableaux défilables horizontalement sur mobile.
- Régression de filtrage vérifiée avec les fixtures OWASP réelles et les décisions V1.8. Couverture des corrections disponibles/manuelles/en cours/corrigées, compteurs, versions du parent Maven, statuts bloqués, étapes inconnues, ordre indépendant des états, erreurs françaises, noms de produits, dates et nombres.

Le build signale l’avertissement de budget CSS existant du détail projet : 25,93 kB pour un seuil d’avertissement de 20 kB, sous le seuil d’échec de 26 kB. Le build réussit.

Les descriptions officielles des vulnérabilités, commandes, extraits de code, preuves et contenus historiques restent des données techniques sources. Les titres ZAP de la liste sont français ; le titre original est consultable dans le détail technique. Les libellés, états et raisons de blocage normaux n’affichent pas les enums V1.8. Les données brutes explicites restent consultables sans modifier les données stockées.

Les captures et journaux de validation restent des artefacts locaux et ne font pas partie de la documentation versionnée.

Le script `frontend/scripts/qa-frontend-finalization.mjs` permet de reproduire la passe avec une session temporaire fournie via `QA_SESSION_FILE`, un module Playwright disponible via `PLAYWRIGHT_MODULE`, et les variables optionnelles `QA_BASE_URL`, `QA_PROJECT_ID`, `QA_OUTPUT_DIR`. Le fichier de session temporaire utilisé pour cette passe a été supprimé ; aucune session ou secret n’est inclus dans les preuves. Le bundle précédent est conservé dans `/tmp/frontend-pre-finalization-backup`.

## Périmètre du commit frontend

Le rendu Markdown, le transport du chat et la dépendance `marked` préexistants restent hors de ce lot. Seule la transition visuelle du panneau de chat est incluse. L’option de lecture `includeV18` du service API est incluse pour fournir les preuves utilisées par la présentation.

Fichiers du lot code et tests :

- `frontend/package.json`
- `frontend/scripts/frontend-finalization.spec.mjs`
- `frontend/scripts/owasp-corrections-filter.spec.mjs`
- `frontend/scripts/owasp-remediation-presentation.spec.mjs`
- `frontend/scripts/owasp-task-matching.spec.mjs`
- `frontend/scripts/qa-french-ui.mjs`
- `frontend/scripts/qa-frontend-finalization.mjs`
- `frontend/scripts/security-scanner-filter.spec.mjs`
- `frontend/src/app/app.routes.ts`
- `frontend/src/app/core/http-error-message.ts`
- `frontend/src/app/core/services/api.service.ts`
- `frontend/src/app/features/admin/admin.component.html`
- `frontend/src/app/features/admin/admin.component.ts`
- `frontend/src/app/features/analytics/prediction.component.html`
- `frontend/src/app/features/auth/login.component.ts`
- `frontend/src/app/features/dashboard/dashboard.component.ts`
- `frontend/src/app/features/incidents/incident-detail.component.html`
- `frontend/src/app/features/incidents/incident-detail.component.ts`
- `frontend/src/app/features/projects/cve-table.component.ts`
- `frontend/src/app/features/projects/dockerfile-optimizer.component.ts`
- `frontend/src/app/features/projects/jenkinsfile-optimizer.component.ts`
- `frontend/src/app/features/projects/project-detail.component.html`
- `frontend/src/app/features/projects/project-detail.component.ts`
- `frontend/src/app/features/projects/project-form.component.html`
- `frontend/src/app/features/projects/project-form.component.ts`
- `frontend/src/app/features/projects/project-overview.component.ts`
- `frontend/src/app/features/projects/zap-table.component.ts`
- `frontend/src/app/features/settings/settings.component.html`
- `frontend/src/app/features/settings/settings.component.ts`
- `frontend/src/app/features/tools/monitoring.component.ts`
- `frontend/src/app/features/tools/security.component.ts`
- `frontend/src/app/features/tools/sonarqube.component.ts`
- `frontend/src/app/shared/chat-widget/chat-widget.component.scss`
- `frontend/src/app/shared/french-date.pipe.ts`
- `frontend/src/app/shared/french-format.ts`
- `frontend/src/app/shared/layout/layout.component.html`
- `frontend/src/app/shared/layout/layout.component.ts`
- `frontend/src/app/shared/owasp-remediation-presentation.ts`
- `frontend/src/app/shared/pipeline-stage-presentation.ts`
- `frontend/src/app/shared/presentation-label.pipe.ts`
- `frontend/src/app/shared/status-labels.ts`
- `frontend/src/app/shared/v1-8-compatibility-presentation.ts`

Validation du périmètre indexé avant commit : 12 fichiers de tests passent avec les seules sources frontend retenues et les références backend déjà versionnées ; audit français, typecheck et build de production réussis. La suite complète du workspace passe également (14 fichiers, dont 2 tests chat préexistants hors lot). Aucun fichier backend ni artefact local n’est inclus.
