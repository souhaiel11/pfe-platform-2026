# Audit Paramètres et dynamisme — 30 septembre 2026

## Inventaire avant modification

Inventaire établi avant toute modification du code. Aucun select ni toggle utilisateur n’existe dans le template actuel. Aucun lien Grafana ne subsiste. Les champs modèle IA et webhook sont en lecture seule, mais leurs valeurs sont fixes.

| SETTING | CURRENT_DISPLAY | CURRENT_SOURCE | REAL_PLATFORM_SUPPORT | ACTION | Editabilité | Preuve / limite |
| --- | --- | --- | --- | --- | --- | --- |
| Prometheus : carte, nom, icône, couleur, description | Métriques et surveillance — GET /-/healthy | HARDCODED_FRONTEND | PARTIAL | MAKE_DYNAMIC | READ_ONLY | Sonde de connexion réelle dans IntegrationsService ; aucune utilisation de ces paramètres par le pipeline constatée. Liste frontend toujours affichée même sans enregistrement. |
| Prometheus : URL | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | EDITABLE | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Prometheus : État de connexion | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | RENAME | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Prometheus : Réponse serveur | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Prometheus : Date de vérification | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Prometheus : Identifiant enregistré | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Prometheus : Présence d’un secret | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Prometheus : activé | enabled=true par défaut ; aucun toggle dans le template | HARDCODED_FRONTEND / BACKEND_API | PARTIAL | READ_ONLY | READ_ONLY | Champ persisté ; n’active pas le pipeline applicatif. |
| Prometheus : ouvrir/replier | Chevron ▸ | DERIVED | YES | KEEP | READ_ONLY | État local de présentation uniquement. |
| Prometheus : enregistrer | Enregistrer / Sauvegarde… | DERIVED | YES | KEEP | EDITABLE | POST/PUT /integrations → repository.save/update ; configuration utilisée par la sonde. |
| Prometheus : tester | Tester la connexion / Test en cours… | DERIVED | YES | FIX_DESCRIPTION | EDITABLE | PUT puis POST /integrations/:id/test → HTTP réel ; test met à jour état/date/métadonnées. Ne prouve pas une capacité du pipeline. |
| Prometheus : exemple URL | https://prometheus.example.internal | HARDCODED_FRONTEND | NO | REMOVE | READ_ONLY | Placeholder uniquement, ne pas présenter comme URL configurée. |
| Kubernetes : carte, nom, icône, couleur, description | Orchestration de conteneurs — GET /readyz | HARDCODED_FRONTEND | PARTIAL | MAKE_DYNAMIC | READ_ONLY | Sonde de connexion réelle dans IntegrationsService ; aucune utilisation de ces paramètres par le pipeline constatée. Liste frontend toujours affichée même sans enregistrement. |
| Kubernetes : URL | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | EDITABLE | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Kubernetes : État de connexion | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | RENAME | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Kubernetes : Réponse serveur | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Kubernetes : Date de vérification | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Kubernetes : Identifiant enregistré | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Kubernetes : Présence d’un secret | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Kubernetes : activé | enabled=true par défaut ; aucun toggle dans le template | HARDCODED_FRONTEND / BACKEND_API | PARTIAL | READ_ONLY | READ_ONLY | Champ persisté ; n’active pas le pipeline applicatif. |
| Kubernetes : ouvrir/replier | Chevron ▸ | DERIVED | YES | KEEP | READ_ONLY | État local de présentation uniquement. |
| Kubernetes : enregistrer | Enregistrer / Sauvegarde… | DERIVED | YES | KEEP | EDITABLE | POST/PUT /integrations → repository.save/update ; configuration utilisée par la sonde. |
| Kubernetes : tester | Tester la connexion / Test en cours… | DERIVED | YES | FIX_DESCRIPTION | EDITABLE | PUT puis POST /integrations/:id/test → HTTP réel ; test met à jour état/date/métadonnées. Ne prouve pas une capacité du pipeline. |
| Kubernetes : exemple URL | https://kubernetes.example.internal | HARDCODED_FRONTEND | NO | REMOVE | READ_ONLY | Placeholder uniquement, ne pas présenter comme URL configurée. |
| Kubernetes : jeton | Champ masqué, déjà configuré ou vide | BACKEND_API | YES | KEEP | EDITABLE | Secret write-only ; omission conserve le secret ; utilisé par Authorization Bearer de la sonde. |
| Nexus : carte, nom, icône, couleur, description | Dépôt d’artefacts — GET /service/rest/v1/status | HARDCODED_FRONTEND | PARTIAL | MAKE_DYNAMIC | READ_ONLY | Sonde de connexion réelle dans IntegrationsService ; aucune utilisation de ces paramètres par le pipeline constatée. Liste frontend toujours affichée même sans enregistrement. |
| Nexus : URL | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | EDITABLE | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Nexus : État de connexion | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | RENAME | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Nexus : Réponse serveur | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Nexus : Date de vérification | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Nexus : Identifiant enregistré | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Nexus : Présence d’un secret | Valeur API ou défaut vide/non configuré | BACKEND_API | YES | KEEP | READ_ONLY | GET /integrations ; URL persistée par POST/PUT ; état et métadonnées persistés par testConnection. |
| Nexus : activé | enabled=true par défaut ; aucun toggle dans le template | HARDCODED_FRONTEND / BACKEND_API | PARTIAL | READ_ONLY | READ_ONLY | Champ persisté ; n’active pas le pipeline applicatif. |
| Nexus : ouvrir/replier | Chevron ▸ | DERIVED | YES | KEEP | READ_ONLY | État local de présentation uniquement. |
| Nexus : enregistrer | Enregistrer / Sauvegarde… | DERIVED | YES | KEEP | EDITABLE | POST/PUT /integrations → repository.save/update ; configuration utilisée par la sonde. |
| Nexus : tester | Tester la connexion / Test en cours… | DERIVED | YES | FIX_DESCRIPTION | EDITABLE | PUT puis POST /integrations/:id/test → HTTP réel ; test met à jour état/date/métadonnées. Ne prouve pas une capacité du pipeline. |
| Nexus : exemple URL | https://nexus.example.internal | HARDCODED_FRONTEND | NO | REMOVE | READ_ONLY | Placeholder uniquement, ne pas présenter comme URL configurée. |
| Nexus : utilisateur | API ; placeholder admin | BACKEND_API / HARDCODED_FRONTEND | YES | RENAME | EDITABLE | Persisté et utilisé par Authorization Basic de la sonde. |
| Nexus : mot de passe | Champ masqué | BACKEND_API | YES | KEEP | EDITABLE | Secret write-only, utilisé par la sonde. |
| Configuration IA : Modèle Ollama | llama3.2:3b | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Aucune lecture de la configuration du workflow IA actif. |
| Configuration IA : URL webhook n8n | /webhook/jenkins-event (service n8n interne) | HARDCODED_FRONTEND | PARTIAL | REMOVE | READ_ONLY | Événement Jenkins ≠ endpoint du chat ; aucune source runtime. |
| Configuration IA : gouvernance | Texte CVE critique → blocage systématique ; correction proposée ; confiance informative | HARDCODED_FRONTEND | PARTIAL | FIX_DESCRIPTION | READ_ONLY | Description trop précise des règles ; afficher le rôle des contrôles sans recopier leur logique. |
| Informations plateforme : Angular | 17.x (Standalone) | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Versions/environnement non découverts ; identité éditoriale sans utilité opérationnelle. |
| Informations plateforme : NestJS | 10.x | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Versions/environnement non découverts ; identité éditoriale sans utilité opérationnelle. |
| Informations plateforme : n8n | 2.14.2 (self-hosted) | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Versions/environnement non découverts ; identité éditoriale sans utilité opérationnelle. |
| Informations plateforme : Modèle LLM | llama3.2:3b via Ollama | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Versions/environnement non découverts ; identité éditoriale sans utilité opérationnelle. |
| Informations plateforme : Base de données | PostgreSQL 16 | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Versions/environnement non découverts ; identité éditoriale sans utilité opérationnelle. |
| Informations plateforme : Environnement | WSL Ubuntu 22.04 | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Versions/environnement non découverts ; identité éditoriale sans utilité opérationnelle. |
| Informations plateforme : Auteur | Amri Souhaiel — ESPRIT / Vermeg | HARDCODED_FRONTEND | UNKNOWN | REMOVE | READ_ONLY | Versions/environnement non découverts ; identité éditoriale sans utilité opérationnelle. |
| Page : titre, sous-titre, labels de sections | Paramètres ; Configuration plateforme ; Intégrations Infrastructure ; Configuration IA ; Informations plateforme | HARDCODED_FRONTEND | YES | RENAME | READ_ONLY | Libellés statiques autorisés ; renommer les diagnostics pour ne pas prétendre activer une fonctionnalité. |
| Droits des boutons | admin/developer seulement | DERIVED | YES | KEEP | READ_ONLY | AuthService.currentUser + assertEditor backend ; les inputs restent actuellement éditables pour lecteur, à désactiver. |
| Échec du chargement | Silencieux ; cartes par défaut | HARDCODED_FRONTEND | NO | MAKE_DYNAMIC | READ_ONLY | Ajouter LOADING / EMPTY / ERROR / UNAVAILABLE ; ne jamais substituer une liste configurée au défaut API. |

## Écarts globaux et actions

- Supprimées : anciennes pages hors routing Jenkins, SonarQube, Kubernetes et DORA. Elles contenaient des projets/builds/branches/URLs, métriques, problèmes, pods/services/événements, commandes et historiques inventés. Aucun import ni route ne les consommait.
- Supprimée : ancienne page Notifications hors routing et actions « marquer lu ». Le faux « tout marquer lu » exécutait seulement un GET ; les incidents n’ont aucun état de lecture persisté. Les alertes récentes du dashboard restent dérivées des incidents réels.
- Retirés du formulaire projet : choix GitLab CI/GitHub Actions/Azure DevOps, sans intégration implémentée au-delà des valeurs d’enum persistables ; toggles courriel/Slack et champs destinataire/canal, uniquement stockés dans DTO/entity et sans consommateur dans les workflows actifs ou services d’envoi. Le pipeline effectivement implémenté est Jenkins. Les valeurs préexistantes restent en base et ne sont plus écrasées par des defaults du formulaire.
- Retirés : badges « EN DIRECT » sans connexion vérifiée et état « En ligne » du chat sans source de santé. Le chat présente son état de réponse réel, sans annoncer la disponibilité d’un fournisseur.
- Remplacés : défauts `main` des assistants de PR par la branche rapportée lorsqu’elle existe, sinon saisie explicite. Les actions refusent une branche cible vide. Aucune règle WF4/WF5/WF6 ne change. Les noms propriétaires/projets et URLs d’exemple spécifiques sont remplacés par des indications neutres.
- Corrigés : état Jenkins « Connecté » avant réponse runtime, carte Docker assimilant réussite d’étape à découverte du Dockerfile, tests non exécutés assimilés à désactivation. Les cartes de résultats ne fabriquent plus de zéro pour les étapes sans résultat.
- Retiré : barème de risque recopié dans le frontend. Les règles effectivement appliquées et leurs points proviennent du backend ; le calcul du risque reste inchangé.
- Corrigé : URL GitHub calculée à partir d’une URL complète ou d’un propriétaire/dépôt, sans doubler son préfixe.
- Ajoutés : erreurs visibles et distinctes des listes vides sur Paramètres, accueil, analyses, indicateurs, projets, incidents, administration, sécurité et données secondaires du détail projet. Les diagnostics distinguent chargement, absence d’enregistrement, erreur et dernière vérification ; une erreur n’injecte aucune liste de secours.

## Sources et editabilité après correction

`GET /api/dashboard/capabilities` est un endpoint JWT en lecture seule. Il lit les projets existants et le dernier rapport non archivé de chaque projet par la même source que les agrégats sécurité ; `normalizeReport` reste l’adaptateur scanner autoritatif. Seules les étapes scanner réellement présentes sont incluses. Une étape déclarée sans résultat complet est distinguée d’un résultat complet, y compris zéro vulnérabilité. Ces observations historiques ne sont **pas** une découverte de santé actuelle et ne prétendent pas qu’un workflow est actuellement actif.

Le mode V1.8 provient de `v1_8EnforcementMode()` ; les types d’édition proviennent de `LIVE_WRITER_SUPPORTED_EDIT_TYPES`. Aucun mode n’est décidé dans le frontend. Le nombre de projets Jenkins/Azure provient de la configuration réelle de ces projets. La présence de configuration de l’agent Azure est un booléen, sans secret ni URL interne exposés. Les règles de gate, dispatch, vérification, normalisation scanner et workflows restent inchangées.

Lecture seule : mode V1.8, types d’édition, observations scanner, nombres de projets configurés, présence de configuration de l’agent, dernière vérification/date/métadonnées des sondes. Les versions des services, modèle/fournisseur IA et disponibilité des workflows ne sont plus annoncés faute de source fiable de lecture.

Éditable : URL/authentification des intégrations **enregistrées**, pour admin/developer uniquement. `POST/PUT /integrations` persiste dans le repository ; `POST /integrations/:id/test` utilise ces valeurs dans un appel HTTP de diagnostic et persiste le résultat. Le test ne continue plus si la mise à jour échoue. Les champs de secrets restent write-only. Aucune sauvegarde ni sonde n’a été exécutée pendant cet audit. Les champs projets conservés ont les endpoints existants de création/modification et les consommateurs Jenkins/Sonar correspondants ; les credentials Jenkins conservent leur flux administrateur séparé.

Grafana est filtré des diagnostics utilisateur, sans suppression de son enregistrement ni de l’infrastructure. Prometheus n’est affiché que si son intégration est réellement enregistrée ; sa carte décrit une sonde, pas l’activation d’une surveillance applicative.

## Classification des constantes

Sont autorisés : libellés français, icônes/couleurs, schémas de champs des adaptateurs réellement implémentés, noms de colonnes, correspondances d’enums, poids d’ordre, formats et limites de chargement/polling du client. Un default de formulaire de création (par exemple environnement de développement) est une proposition éditable, jamais la valeur courante d’un projet existant. Le tag `latest` est une saisie de demande de déploiement éditable, jamais une affirmation sur l’image actuellement déployée.

Les listes de filtres scanner sont des définitions du contrat fermé `EnrichedData`, pas des annonces de disponibilité ; les résultats, comptes et états viennent des données chargées. La chronologie des étapes est une règle statique partagée, tandis que la liste d’étapes reste issue du pipeline réel. Les étapes absentes ne sont pas inventées. Les poids ne dépendent pas des états.

Les URLs GitHub/NVD/advisories sont des formats de liens de référence. Les CDN de polices/icônes/Chart.js sont des ressources de présentation, non des URLs de service opérationnel. Les API utilisent `/api` et la configuration environment. Les versions de dépendances des manifests/lockfiles décrivent la compilation, sans prétendre découvrir la version d’un service distant. Les IDs/versions/CVE/comptes des fixtures de tests ne sont importés par aucun composant de production.

Le scan reproductible `node frontend/scripts/audit-platform-hardcodes.mjs --write` couvre TS/HTML/SCSS/config et scripts. Son inventaire lexical contient chaque occurrence suspecte avec fichier, ligne et classification ; il compte aussi des tailles CSS, couleurs et valeurs de fixtures, **pas** uniquement des faits opérationnels. Les URLs de registry du lockfile sont exclues du total lexical, car elles décrivent exclusivement la résolution des dépendances. Les constats sémantiques et limites de ce scan figurent ci-dessus ; zéro correspond aux hardcodes opérationnels identifiés et vérifiés dans le périmètre UI, pas à une preuve universelle donnée par une regex.

## Limites et périmètre backend

Les anciens helpers backend `getMockGithubStats/getMockSonarMetrics/getMockTrivyReport` restent hors de ce lot : aucun composant de production conservé n’affiche leurs résultats ; les vues de sécurité utilisent les rapports/agrégats normalisés et les PR affichées utilisent les incidents/rapports réels. Cet audit n’autorise pas leur résultat comme donnée fiable ni n’annonce leur endpoint comme capacité produit. Les scanners/workflows historiques ne sont pas sondés : aucune requête de correction, pipeline Jenkins, PR ou déploiement Azure n’est déclenchée.

Le backend a uniquement reçu le nouvel endpoint et sa projection : controller/service Dashboard + helper et test. Les deux modules JavaScript déployés ont été comparés au runtime sauvegardé : seuls l’import/helper et la méthode/route de lecture diffèrent. Aucun autre changement backend préexistant n’a été déployé. Le redémarrage nécessaire charge ces trois modules ; il ne modifie aucune configuration ni logique WF1–WF6. Les accès SQL de cet audit sont des SELECT, dont la session QA en transaction READ ONLY ; aucun changement de base, migration ou credentials enregistré.

## Bilan du scan

HARDCODE_AUDIT_TOTAL : 9937 occurrences lexicales. LEGITIMATE_CONSTANTS : 2381. TEST_FIXTURES : 7317. DOCUMENTATION : 239. REMAINING_RUNTIME_HARDCODES : 0 dans le périmètre audité.

Les familles de faits runtime retirées sont : configuration par défaut des diagnostics ; versions Angular/NestJS/n8n ; modèle IA ; version PostgreSQL ; environnement hôte ; webhook fixe ; projet et identifiant Jenkins ; URLs Jenkins/API/Sonar ; branche fixe ; affirmation de déploiement Kubernetes ; métriques/évolution/problèmes Sonar inventés ; pods/services/événements/commandes Kubernetes spécifiques ; métriques/objectifs/historiques DORA inventés ; branche cible des assistants imposée ; barème de risque dupliqué ; outils CI non implémentés ; préférences de notification sans consommateur ; faux état de lecture des notifications ; disponibilité chat/en-direct non prouvée ; connexion Jenkins avant lecture ; zéro résultats pour scanner non exécuté. Les autres suppressions (exemples de placeholders et auteur) sont des nettoyages de présentation, pas des faits runtime comptés.

## Validation finale et déploiement

La validation commencée le 30 septembre s’est terminée le 1 octobre 2026, heure de Paris.

- Tests frontend : 15/15 fichiers PASS, audit français PASS.
- Typecheck frontend : PASS.
- Build frontend de production : PASS ; avertissement CSS préexistant du détail projet (25,93 kB, seuil warning 20 kB, sous seuil erreur 26 kB).
- Typecheck ciblé des modules backend de projection : PASS ; test `platform-capabilities.spec.ts` : PASS (sources V1.8 autoritatives, changements de mode, types, scanner déclaré sans résultat, second projet, absence de secret).
- `git diff --check` : PASS.
- Endpoint live `GET /api/dashboard/capabilities` : HTTP 200. Mode réellement observé : ENFORCED ; types : DEPENDENCY_VERSION, PARENT_VERSION, PROPERTY_VERSION. Ce résultat est une observation datée, jamais un default frontend.
- Paramètres live : une intégration utilisateur enregistrée affichée, Prometheus ; aucune carte Grafana. Les observations scanner portent sur les derniers rapports de quatre projets. Quatre projets Jenkins et un projet Azure sont configurés ; cela n’annonce pas leur santé actuelle.
- 20 vues/scénarios validés à 1440 px et 390 px : Paramètres, accueil, projets, sécurité/configuration/détail projet, formulaire, analyses, risque, sécurité plateforme, empty/unavailable, erreur API, mode/types/scanners modifiés, second projet/dépôt. Aucune erreur JavaScript, aucune tentative de requête d’écriture. Les assertions vérifient aussi la lisibilité du nom d’intégration et la visibilité des boutons du formulaire mobile, pas seulement le débordement global.
- Une lecture temporaire de l’utilisateur QA et une session JWT limitée ont permis l’inspection ; le fichier de session est supprimé après validation. Les captures, rapports browser et backups runtime restent sous `/tmp`, sans secret dans les documents du projet.
- Bundle frontend testé déployé dans le montage nginx existant, index copié en dernier. Backend : seuls les trois fichiers JavaScript dashboard nécessaires ont été déployés, après sauvegarde et comparaison au runtime. Aucune image backend complète construite depuis les modifications préexistantes.
- Les fichiers dirty/untracked sans rapport ont été vérifiés par hash et conservés. L’unique fichier chat déjà modifié touché par ce lot reçoit seulement le remplacement du faux badge « En ligne » ; son rendu Markdown préexistant est préservé.
- Aucun n8n, workflow, dispatch, génération de PR, migration, écriture DB, commit ou push de ce lot. Préparation UI terminée pour l’E2E ; cette mention ne signifie pas que les projets sont prêts à déployer en production.

Le script `frontend/scripts/qa-platform-dynamicity.mjs` accepte `QA_SESSION_FILE`, `PLAYWRIGHT_MODULE`, `QA_BASE_URL` et `QA_OUTPUT_DIR`. Ses réponses synthétiques de test restent dans le navigateur de QA et ne modifient aucune donnée backend.


## Gel de configuration pré-E2E — 1 octobre 2026

Configuration réellement chargée par NestJS : `ConfigModule.forRoot({ isGlobal: true })` charge le fichier `.env` du backend. La variable n’est pas présente dans l’environnement initial d’un processus `docker exec`, mais le fichier chargé contient `V1_8_SECURITY_ENFORCEMENT=ENFORCED`. Après ce chargement, le résolveur canonique retourne ENFORCED. Une lecture sans chargement du fichier aurait donné SHADOW par défaut : elle ne représente pas le processus applicatif.

- Valeur configurée : ENFORCED ; valeur effective : ENFORCED.
- API `/api/dashboard/capabilities` authentifiée : ENFORCED.
- Paramètres en cours d’exécution : « Contrôle appliqué » ; cohérence PASS.
- Sans JWT et avec JWT invalide : HTTP 401. Réponse authentifiée limitée aux observations scanner, types d’édition canoniques, mode, nombres de projets configurés et présence de configuration de l’agent. Aucun token, credential, URL privée ou dump de configuration.
- Aucun changement de mode effectué. L’intention pré-E2E reste **REQUIRES_USER_DECISION** : le mode observé ne prouve pas qu’il a été volontairement conservé pour l’E2E. Aucun E2E lancé.
- Le lot runtime est isolé dans l’index. Les modifications préexistantes de chat Markdown, dépendances, remédiation, builder/candidate-verifier, n8n et les artefacts restent hors des commits. Pour le HTML du chat, seul le faux badge « En ligne » est remplacé.
- Les captures et sessions temporaires ne sont pas versionnées. L’inventaire JSON est un artefact reproductible du script d’audit, hors du commit documentaire.

### Fichiers du commit runtime et tests

- `backend/src/dashboard/dashboard.controller.ts`
- `backend/src/dashboard/dashboard.service.ts`
- `backend/src/dashboard/platform-capabilities.spec.ts`
- `backend/src/dashboard/platform-capabilities.ts`
- `frontend/scripts/audit-platform-hardcodes.mjs`
- `frontend/scripts/platform-dynamicity.spec.mjs`
- `frontend/scripts/qa-platform-dynamicity.mjs`
- `frontend/src/app/app.routes.ts`
- `frontend/src/app/core/services/api.service.ts`
- `frontend/src/app/features/admin/admin.component.html`
- `frontend/src/app/features/admin/admin.component.ts`
- `frontend/src/app/features/analysis/analysis.component.html`
- `frontend/src/app/features/analysis/analysis.component.ts`
- `frontend/src/app/features/analytics/dora.component.ts`
- `frontend/src/app/features/analytics/prediction.component.html`
- `frontend/src/app/features/analytics/prediction.component.ts`
- `frontend/src/app/features/dashboard/dashboard.component.html`
- `frontend/src/app/features/dashboard/dashboard.component.ts`
- `frontend/src/app/features/incidents/incident-detail.component.html`
- `frontend/src/app/features/incidents/incident-detail.component.ts`
- `frontend/src/app/features/incidents/incidents.component.html`
- `frontend/src/app/features/incidents/incidents.component.ts`
- `frontend/src/app/features/notifications/notifications.component.ts`
- `frontend/src/app/features/projects/dockerfile-optimizer.component.ts`
- `frontend/src/app/features/projects/jenkinsfile-optimizer.component.ts`
- `frontend/src/app/features/projects/project-detail.component.html`
- `frontend/src/app/features/projects/project-detail.component.ts`
- `frontend/src/app/features/projects/project-form.component.html`
- `frontend/src/app/features/projects/project-form.component.ts`
- `frontend/src/app/features/projects/project-overview.component.ts`
- `frontend/src/app/features/projects/projects.component.html`
- `frontend/src/app/features/projects/projects.component.ts`
- `frontend/src/app/features/settings/settings.component.html`
- `frontend/src/app/features/settings/settings.component.scss`
- `frontend/src/app/features/settings/settings.component.ts`
- `frontend/src/app/features/tools/jenkins.component.ts`
- `frontend/src/app/features/tools/kubernetes.component.html`
- `frontend/src/app/features/tools/kubernetes.component.scss`
- `frontend/src/app/features/tools/kubernetes.component.ts`
- `frontend/src/app/features/tools/security.component.ts`
- `frontend/src/app/features/tools/sonarqube.component.ts`
- `frontend/src/app/shared/chat-widget/chat-widget.component.html`
- `frontend/src/app/shared/layout/layout.component.html`
- `frontend/src/app/shared/layout/layout.component.ts`
- `frontend/src/app/shared/platform-capability-presentation.ts`

Validation du périmètre propre à committer : 13/13 fichiers de tests frontend et audit français PASS (les deux tests chat préexistants ne font pas partie du lot), test backend de capacités PASS, typecheck backend complet PASS, typecheck frontend PASS, build frontend production PASS et `git diff --check` PASS. Les 15/15 de la validation historique portent sur le workspace incluant ces deux tests chat indépendants. Le build conserve uniquement le warning CSS préexistant documenté ci-dessus.
