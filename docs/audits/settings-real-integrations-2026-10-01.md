# Paramètres : audit des intégrations réelles — 1 octobre 2026

Inventaire effectué avant modification de l’interface. Aucun déploiement ni diagnostic live n’est lancé par cet audit.

| Intégration | Source / configuration utilisée | Modifiable | Endpoint / validation / persistance / consommateur | Credentials | Diagnostic réel | Portée |
|---|---|---|---|---|---|---|
| GitHub | Project.githubRepo ; githubToken privé | Dépôt uniquement | PUT /projects/:id ; DTO chaîne ; repository TypeORM ; optimizers et appels GitHub | Token serveur, pas d’endpoint de remplacement ; présence seulement | Aucun diagnostic autonome fiable ; github-stats possède un fallback mock, exclu | Projet |
| Jenkins | jenkinsInternalUrl, jenkinsPublicUrl, jenkinsJobName, jenkinsJobPath ; fallback legacy jenkinsUrl | URLs et identité du job ; rotation admin | PUT /projects/:id ; validation URLs existante ; TypeORM ; getJenkinsStatus / lookup job / dispatch | PUT /projects/:id/jenkins-credentials admin, validation whoAmI avant persistance, jamais relu | POST /projects/:id/validate, dernier résultat daté ; rotation vérifie aussi la connexion | Projet |
| SonarQube | sonarqubeUrl, sonarqubeKey, sonarqubeToken | URL et clé publique | PUT /projects/:id ; DTO chaînes ; TypeORM ; getSonarMetrics / validateProject / corrélation | Token serveur ; aucun endpoint de remplacement, présence seulement | POST /projects/:id/validate ; résultat daté ; vérifier réellement valid + projet présent | Projet |
| OWASP Dependency-Check | Étapes et résultats des rapports normalisés | Lecture seule | GET /dashboard/capabilities, normalizeReport | Configuration d’exécution interne | Pas de sonde de disponibilité courante | Exécution/projet |
| Trivy | Rapports normalisés ; cache isolé builder-scanner | Lecture seule | GET /dashboard/capabilities et /config/effective ; métadonnées cache inaccessibles -> indisponibles | Interne, non exposé | Aucun diagnostic scanner accessible à cette page | Exécution/projet |
| OWASP ZAP | Étapes/rapports ; aucune cible ZAP persistée dans Project | Lecture seule | GET /dashboard/capabilities | Interne | Pas de sonde autonome | Exécution/projet |
| Azure | Project.azureConfig (provider, resourceGroup, targetName, registry, imageRepository, region...) ; environment | Cible existante modifiable ; environnement lecture seule ici | PUT /projects/:id ; normalizeAzureConfig allowlist / champs requis ; TypeORM ; AzureDeployController lit la cible | Identité Azure sur agent hôte ; présence du secret transport n’est pas statut credentials Azure, donc indisponible | Aucun test de connexion Azure dédié à afficher | Projet + agent global |
| V1.8 | Résolveur v1_8EnforcementMode et LIVE_WRITER_SUPPORTED_EDIT_TYPES | Lecture seule | GET /dashboard/capabilities ; aucune action administrative de changement de mode | Interne | Capacité de plan reste soumise aux preuves par vulnérabilité | Global + tâche |
| Diagnostics enregistrés | Integration en base ; uniquement adaptateurs supportés et rows renvoyées | URL / authentification selon adaptateur | PUT /integrations/:id ; DTO ; repo.update ; doTest lit la config sauvegardée | Write-only token/password ; booleans hasToken/hasPassword | POST /integrations/:id/test ; résultat daté, pas surveillance continue | Global |

La branche principale n’est pas persistée sur Project et github-stats ne la résout pas : pas de champ éditable ni valeur par défaut inventée. Aucun toggle scanner, ZAP, Azure, V1.8 ou notification. Les sections sécurité affichent des observations historiques, jamais une disponibilité instantanée inventée.

Les modifications backend de ce lot se limitent aux métadonnées de présence des credentials, à l’assainissement des diagnostics et à la validation des champs réellement édités. Aucun workflow, transition de remédiation, dispatch, scan ou déploiement n’est modifié.

## Implémentation et limites

- Sélecteur de projet chargé par GET /projects puis GET /projects/:id ; lecture seule pour les viewers, édition pour admin/developer et rotation Jenkins uniquement admin.
- Sauvegarde des seules propriétés modifiées via PUT /projects/:id ; validation UI et DTO backend ; confirmation après réponse ; échec conserve les modifications ; annulation restaure la configuration chargée. Azure fusionne les propriétés éditées avec la cible existante, sans créer de cible imaginaire ni effacer les autres propriétés.
- Les URLs de service refusent les credentials et paramètres embarqués. Les anciennes URLs contenant ces données ne sont jamais renvoyées par les projections assainies. Les résultats historiques sont libellés et datés ; les erreurs distantes ne sont plus retournées en clair.
- GitHub/SonarQube : seulement booleans de présence de token ajoutés à sanitizeProject. Pas de formulaire de token car aucun endpoint de remplacement n’existe. Azure : état des credentials de l’agent inconnu, explicitement indisponible, sans assimiler le secret de transport à une identité Azure.
- Diagnostics : les nouveaux paramètres doivent être enregistrés avant test. SonarQube valide réellement la réponse d’authentification et la présence de la clé ; zéro diagnostic exécuté ne devient plus un succès global.
- Types de correction et mode V1.8 proviennent de /dashboard/capabilities ; aucun contrôle de changement. Sécurité : observations réelles des rapports ; fraîcheur/seuils Trivy et disponibilité courante restent inconnus, sans valeur par défaut.
- Les quatre faux contrôles globaux étaient déjà absents avant ce lot. La sauvegarde implicite précédant les diagnostics est retirée ; aucune sonde n’est déclenchée par un chargement de page.

Validation : tests frontend, test backend de persistance/validation/assainissement/diagnostics, test existant sanitizeProject, contrôles TypeScript et build production PASS. Warning CSS préexistant du détail projet conservé. Aucun déploiement, commit, push, workflow, dispatch ou écriture de base live. Les tests utilisent des repositories et réponses HTTP locaux simulés. Le mode du futur E2E est désormais explicitement fixé à ENFORCED par l’utilisateur ; ce lot ne change pas le mode runtime.

Bilan final : 19/19 fichiers de tests frontend PASS ; nouveau test backend d’intégrations et tests existants sanitizeProject / jenkins-credentials PASS ; typechecks backend et frontend PASS ; build production PASS ; git diff --check PASS. Les propriétés Azure retournées sont limitées aux champs publics attendus, y compris pour des données historiques. Les travaux préexistants hors lot sont conservés par vérification SHA-256.


## Préparation des commits et gel E2E

Mode E2E souhaité : ENFORCED, confirmé explicitement. Vérification en lecture seule le 1 octobre 2026 : la configuration chargée par NestJS contient V1_8_SECURITY_ENFORCEMENT=ENFORCED ; le résolveur effectif retourne ENFORCED ; GET /api/dashboard/capabilities retourne ENFORCED ; les Paramètres live affichent « Contrôle appliqué ». Sans JWT et avec JWT invalide : HTTP 401. Aucun changement de configuration ni requête de mutation.

Le commit runtime inclut aussi le module /config/effective et son intégration dans AppModule : la page le charge réellement, il ne doit pas rester une dépendance locale non versionnée. Les tests sont vérifiés sur une copie isolée de l’index, sans les fichiers dirty/untracked étrangers. Le lot contient 15 fichiers de tests frontend ; les 19 fichiers du workspace incluent quatre tests préexistants de chat, chargement et polling hors du commit. Aucun secret, capture, session JWT ou artefact dist versionné.

### Fichiers du commit d’implémentation

- `backend/src/app.module.ts`
- `backend/src/common/sanitize-project.ts`
- `backend/src/effective-config/effective-config.controller.ts`
- `backend/src/effective-config/effective-config.module.ts`
- `backend/src/effective-config/effective-config.service.spec.ts`
- `backend/src/effective-config/effective-config.service.ts`
- `backend/src/integrations/dto/create-integration.dto.ts`
- `backend/src/integrations/integrations.service.ts`
- `backend/src/projects/dto/create-project.dto.ts`
- `backend/src/projects/projects.service.ts`
- `backend/src/projects/settings-integration.spec.ts`
- `frontend/scripts/effective-config.spec.mjs`
- `frontend/scripts/platform-dynamicity.spec.mjs`
- `frontend/scripts/settings-integrations.spec.mjs`
- `frontend/src/app/core/services/api.service.ts`
- `frontend/src/app/features/settings/settings.component.html`
- `frontend/src/app/features/settings/settings.component.ts`

### État live après préparation des commits

La vérification de mode est réussie, mais le nouveau lot n’est pas déployé : la lecture authentifiée de /api/config/effective retourne HTTP 404 et les Paramètres live ne contiennent pas le sélecteur de projet ajouté. Le code committé est testé et prêt pour un push normal ; l’E2E de cette nouvelle interface nécessite encore un déploiement et sa vérification. Aucun déploiement ni E2E n’a été exécuté pendant la préparation Git.
