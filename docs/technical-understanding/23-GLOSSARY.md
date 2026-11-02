# 23 — GLOSSAIRE

À garder ouvert pendant la lecture du reste de la documentation.

---

## Sécurité applicative

| Terme | Définition | Dans ce projet |
|---|---|---|
| **CVE** | *Common Vulnerabilities and Exposures* — identifiant public d'une vulnérabilité | ex. `CVE-2022-45868` sur `com.h2database:h2` |
| **CWE** | *Common Weakness Enumeration* — classe de faiblesse | catégorisation des findings |
| **SCA** | *Software Composition Analysis* — analyse des composants tiers | **Trivy** et **OWASP Dependency-Check** |
| **SAST** | *Static Application Security Testing* — analyse du code sans l'exécuter | **SonarQube** |
| **DAST** | *Dynamic Application Security Testing* — analyse de l'application en marche | **ZAP** (non actif actuellement) |
| **Quality Gate** | seuil d'acceptation Sonar | un QG `ERROR` **ou indéterminé** est un motif de risque |
| **Finding** | une vulnérabilité ou anomalie individuelle | donnée du **scanner** |
| **Severity** | criticité (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) | 14 Trivy + 23 OWASP critiques sur le build #151 |
| **Fixed version** | version qui corrige une CVE | `v.FixedVersion` dans le rapport Trivy |
| **Suppression / filtrage** | exclusion d'un finding d'un rapport | **refusé** : `ModifiedFindings` ⇒ `MALFORMED_OR_FILTERED_SECURITY_SCAN` |
| **Provenance d'artefact** | preuve qu'une image correspond à un commit précis | `deployment_artifacts`, `provenanceVerified` |

## CI / CD

| Terme | Définition | Dans ce projet |
|---|---|---|
| **CI** | *Continuous Integration* — construire et tester à chaque changement | Jenkins, 8 jobs |
| **CD** | *Continuous Delivery/Deployment* | déploiement Azure **gouverné** |
| **Pipeline** | suite d'étapes de build | `build`, `tests`, `sonar`, `trivy`, `owasp`, `zap`, `docker`, `deploy` |
| **Build number** | numéro d'exécution Jenkins | **#151** pour `pfe-app-test` — identifiant de corrélation majeur |
| **Multibranche** | job Jenkins par branche | nom `<job>/<branche>`, d'où les routes en `(.*)` |
| **Workspace** | répertoire de travail d'un build | source d'accumulation disque côté Jenkins |
| **PR** | *Pull Request* — proposition de modification | une **proposition**, jamais une preuve |
| **Merge** | intégration d'une PR | ne ferme pas une vulnérabilité |
| **DinD** | *Docker-in-Docker* | `jenkins-docker`, **privileged** |

## Workflows

| Terme | Définition |
|---|---|
| **WF** | abréviation de *workflow* n8n |
| **WF1** | Incident Intake & Analysis (50 nœuds) |
| **WF2** | Git Patch & PR — correction d'incident assistée par LLM (195 nœuds) |
| **WF3** | Post-PR Validation (11 nœuds) — produit la validation de sécurité dont dépend la gouvernance |
| **WF4** | Jenkinsfile Optimizer (50 nœuds, 3 webhooks) |
| **WF5** | Dockerfile Optimizer (40 nœuds, 3 webhooks) |
| **WF6** | Security Remediation — remédiation de CVE prouvée (184 nœuds) |
| **WF-Chat** | assistant conversationnel (9 nœuds, Ollama) |
| **Webhook** | point d'entrée HTTP d'un workflow |
| **Nœud** | unité d'exécution n8n (`httpRequest`, `if`, `code`, `noOp`, `webhook`, `stickyNote`) |
| **Sticky note** | note documentaire sur le canevas — WF6 en porte 7, qui définissent ses zones |
| **Lane d'erreur** | sortie alternative d'un nœud en cas d'échec |
| **`onError` non défini** | comportement **par défaut** de n8n : arrêter l'exécution (donc *fail-closed*) |

## Modèle de remédiation

| Terme | Définition |
|---|---|
| **Détection** | exécution d'un scanner — un **événement** |
| **Tâche de remédiation** | un finding promu en élément de travail suivable (`manual_remediation_tasks`) |
| **Tentative (*attempt*)** | une exécution d'une remédiation ; jusqu'à 3 |
| **Lot (*batch*)** | ensemble de tâches dispatchées ensemble ; **nouveau `batchId` à chaque tentative** |
| **Candidat** | le projet modifié dans un espace jetable |
| **Fermeture de sécurité** | preuve que la CVE a disparu **et** que le paquet est à la version corrigée |
| **Barrière pré-Git** | les 39 portes de WF6 avant la première mutation GitHub |
| **Réservation** | verrou d'**écrivain unique** sur `(projectId, targetKey)` |
| **Claim** | revendication d'une tâche dans une réservation |
| **Quarantaine** | réservation non libérée parce qu'un effet de bord Git est non résolu |
| **Phase 4G** | nom interne du mécanisme d'écrivain unique |
| **Empreinte de finding** | `findingFingerprint` — clé d'idempotence stable |
| **Digest de source suivie** | `trackedSourceDigest()` — empreinte des fichiers suivis par Git dans l'espace de travail |

## Concepts distribués

| Terme | Définition | Dans ce projet |
|---|---|---|
| **Idempotence** | rejouer une opération ne change pas le résultat | `UNIQUE (projectId, findingFingerprint)`, `completionDigest`, `requestId` |
| **Callback périmé** | réponse d'une opération obsolète arrivant après une plus récente | détecté par `attemptId` + `batchId` + `verifyWf6AttemptContext()` |
| **Callback dupliqué** | la **même** réponse livrée deux fois | absorbé par `completionDigest` |
| **Fail-closed** | en cas de doute, **refuser** | `provesSecurityClosure()`, `InternalSecretGuard`, `onError` par défaut |
| **Fail-open** | en cas de doute, **autoriser** | à éviter ; 2 cas historiques identifiés et atténués |
| **Rejouable (*retryable*)** | un échec technique peut être réessayé | `VERIFIER_TIMEOUT`, `DISPATCH_FAILED` |
| **Verrou pessimiste** | verrouiller la ligne avant de lire/écrire | `lock: { mode: 'pessimistic_write' }` |
| **Verrouillage optimiste** | déclarer l'état attendu et refuser s'il a changé | `expectedAttemptId` au retry |
| **Réconciliation** | remettre d'accord un état distribué incohérent | `reconcileStaleWf6Dispatch()` (admin) |
| **TOCTOU** | *Time-Of-Check to Time-Of-Use* — l'état change entre vérification et usage | contré par la revalidation juste avant écriture et le recalcul au dispatch |
| **Dérive (*drift*)** | l'état réel diverge de l'état attendu | `CANDIDATE_DRIFTED`, `DEPLOY_AUTHORIZATION_IDENTITY_CHANGED` |

## Conteneurs et infrastructure

| Terme | Définition | Dans ce projet |
|---|---|---|
| **Image** | artefact immuable, identifié par un **digest** | l'objet scanné par Trivy |
| **Conteneur** | exécution d'une image | 14 en marche |
| **Digest** | `sha256:…` — identité **immuable** d'une image | utilisé pour le dispatch |
| **Tag** | étiquette **mutable** d'une image | affichage et audit seulement |
| **Registre** | dépôt d'images | `acrpfedevsecops` (ACR) |
| **Rootless** | exécution sans privilège root | **Podman** dans `builder-scanner` |
| **`CAP_SYS_ADMIN`** | capacité Linux étendue | accordée **au seul** `builder-scanner` |
| **`docker.sock`** | socket du démon Docker — équivaut à un accès root hôte | **monté nulle part** dans le plan de remédiation |
| **Bind mount** | montage d'un répertoire hôte | le frontend servi par nginx |
| **Volume** | stockage persistant Docker | `postgres_data`, `n8n_data`, `jenkins_home`… |
| **Healthcheck** | sonde de disponibilité | `/healthz` fait un vrai `SELECT 1` |
| **`init: true`** | tini comme PID 1, pour réaper les zombies | sur `builder-scanner` |
| **ACI** | *Azure Container Instances* — conteneurs managés Azure | cible de déploiement |
| **ACR** | *Azure Container Registry* | `acrpfedevsecops` |
| **Service principal** | identité applicative Azure | **impossible** : bloqué par la politique du tenant |
| **Resource group** | regroupement logique Azure | `rg-pfe-devsecops` |

## Gouvernance du déploiement

| Terme | Définition |
|---|---|
| **`READY`** | aucun motif ; déploiement normal possible |
| **`CONDITIONAL`** | une étape en avertissement non bloquante ; exige motif + acceptation |
| **`CRITICAL_RISK`** | risques connus ; **admin seul**, motif + 3 reconnaissances + phrase exacte |
| **`TECHNICALLY_IMPOSSIBLE`** | identité non résolue ; **non contournable** |
| **Capacité de déploiement** | état de **configuration**, distinct de la décision de gouvernance |
| **Autorisation** | droit d'agir : TTL 15 min, **usage unique**, instantané gelé |
| **Instantané (*snapshot*)** | identité et risque figés au moment de l'autorisation |
| **Succès sémantique** | `success === true` **et** `healthOk === true` — jamais un HTTP 200 seul |
| **Phrase de confirmation** | `DEPLOYER MALGRÉ LES RISQUES` — exacte, caractère pour caractère |

## Technologies

| Terme | Définition | Rôle |
|---|---|---|
| **NestJS** | framework Node.js structuré (modules, DI, décorateurs) | backend |
| **TypeORM** | ORM TypeScript | `synchronize=false` : ne modifie jamais le schéma |
| **Angular standalone** | composants sans NgModule | frontend |
| **`withComponentInputBinding()`** | injecte les paramètres de route dans les `@Input()` | **la clé du multi-projet** |
| **JWT** | jeton signé d'authentification | `JwtAuthGuard` |
| **DTO** | objet de transfert, validé par `class-validator` | `whitelist: true` supprime tout champ non déclaré |
| **jsonb** | type JSON binaire indexable PostgreSQL | `claims`, `securityFindingRemediation`, `azureConfig` |
| **Index unique partiel** | index unique restreint par une clause `WHERE` | **l'écrivain unique** |
| **LLM** | *Large Language Model* | Anthropic (WF2/WF4/WF5), Ollama (chat) |
| **n8n** | moteur d'orchestration à base de nœuds | plan de workflow |
| **Podman** | moteur de conteneurs sans démon | build des candidats |
| **Maven** | build Java | compile et teste les candidats |
| **Mermaid** | diagrammes en texte | utilisé dans cette documentation |

## Statuts, codes et drapeaux

| Code | Signification |
|---|---|
| `INCOMPLETE_SECURITY_SCAN` | scan structurellement incomplet — **jamais** un succès |
| `MALFORMED_OR_FILTERED_SECURITY_SCAN` | rapport filtré ou altéré |
| `VERIFIER_TIMEOUT` | le vérificateur n'a pas répondu — **rejouable** |
| `DISPATCH_FAILED` | n8n injoignable — **rejouable** |
| `TARGET_CVE_STILL_OPEN_AFTER_PATCH` | le candidat ne corrige pas — non rejouable |
| `INVALID_CANDIDATE` | candidat structurellement invalide |
| `CANDIDATE_DRIFTED` | la base a bougé |
| `REMEDIATION_TARGET_ALREADY_IN_PROGRESS` / `TARGET_BUSY` | un autre écrivain détient la cible |
| `REMEDIATION_TARGET_PATH_INVALID` | chemin refusé (traversée, alias, `.git`) |
| `CANCELLATION_TOO_LATE` | les écritures GitHub ont déjà commencé |
| `SECURITY_REMEDIATION_TEMPORARILY_DISABLED` | dispatch gelé (503) |
| `DEPLOY_AUTHORIZATION_REQUIRED` | `POST /deploy` sans `authorizationId` (409) |
| `DEPLOY_AUTHORIZATION_CONSUMED` / `_EXPIRED` / `_REVOKED` / `_NOT_FOUND` | états d'autorisation |
| `DEPLOY_AUTHORIZATION_IDENTITY_CHANGED` | dérive de commit/digest/registre/environnement |
| `DEPLOY_AUTHORIZATION_RISK_CHANGED` | la décision de gouvernance a changé |
| `DEPLOY_AUTHORIZATION_PHRASE_MISMATCH` / `_ACKNOWLEDGEMENT_MISSING` / `_REASON_REQUIRED` / `_ROLE_FORBIDDEN` / `_MODE_MISMATCH` | préconditions d'autorisation non satisfaites |
| `DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE` | aucun mode ne peut satisfaire cette décision |
| `AGENT_TRANSPORT_FAILED` / `AGENT_HTTP_ERROR` / `AGENT_RESULT_INVALID` / `AGENT_DEPLOYMENT_FAILED` / `AGENT_HEALTH_FAILED` | taxonomie d'échec du dispatch |
| `NOT_YET_SANDBOXED` | finding absent du magasin de preuves — **jamais fabriqué en autre état** |
| `SECURITY_RESCAN_NOT_RUN` | rescan OWASP non exécuté (`null`, pas `0`) |

| Drapeau | Valeur sûre |
|---|---|
| `SECURITY_REMEDIATION_DISPATCH_ENABLED` | `false` (⚠ absent ⇒ **autorisé**) |
| `SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED` | `false` |
| `DEPLOYMENT_AUTHORIZATION_REQUIRED` | `true` |
| `DB_SYNCHRONIZE` | `false` |
| `NODE_ENV` | `production` |
