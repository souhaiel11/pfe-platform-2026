# 02 — INVENTAIRE DES COMPOSANTS

Une fiche par composant. **20 composants** documentés.

---

## 1. Frontend

| Champ | Valeur |
|---|---|
| **Type** | application web mono-page |
| **Emplacement** | `frontend/src/app/` (66 fichiers `.ts`, dont 26 composants) |
| **Technologie** | Angular standalone components, routes *lazy*, `provideRouter(withComponentInputBinding())` |
| **Responsabilité** | **présentation uniquement** : traduire les valeurs canoniques du backend en libellés FR |
| **Point d'entrée** | `frontend/src/app/app.routes.ts` |
| **Dépendances** | backend via `/api` (proxy nginx) |
| **Appelé par** | le navigateur |
| **Persistance** | aucune (pas de `localStorage` métier) |
| **Impact si indisponible** | la plateforme n'est plus pilotable, mais rien ne s'arrête côté backend |
| **Rôle sécurité** | **aucun** — c'est un client non fiable. `status-labels.ts` le dit : *« Ne modifie jamais la valeur canonique elle-même »* |

## 2. Backend

| Champ | Valeur |
|---|---|
| **Type** | API REST + WebSocket |
| **Emplacement** | `backend/src/` (347 fichiers `.ts`, 217 de runtime) |
| **Technologie** | NestJS 10, TypeORM, PostgreSQL, Passport-JWT |
| **Responsabilité** | **source de vérité unique** : décisions, autorisations, état, audit |
| **Point d'entrée** | `backend/src/main.ts` → `AppModule` |
| **Dépendances** | PostgreSQL, n8n, candidate-verifier, agent Azure |
| **Appelé par** | frontend, n8n (callbacks), Jenkins/Sonar/Trivy (webhooks) |
| **Persistance** | 16 tables PostgreSQL |
| **Impact si indisponible** | tout s'arrête ; WF2/WF6 échouent sur leurs portes → **fermé**, aucune écriture Git |
| **Rôle sécurité** | **détient tous les secrets** ; applique toutes les gardes et tous les rôles |

## 3. PostgreSQL

| Champ | Valeur |
|---|---|
| **Type** | SGBD relationnel |
| **Emplacement** | conteneur `pfe-postgres`, image `postgres:16-alpine` |
| **Responsabilité** | état durable **et application d'invariants** |
| **Entrée** | TCP 5432 interne, publié sur `0.0.0.0:5433` |
| **Persistance** | volume `postgres_data` |
| **Impact si indisponible** | `/healthz` échoue ; aucune réservation possible donc aucune remédiation |
| **Rôle sécurité** | **garant d'invariants** : l'écrivain unique est un index unique partiel, pas du code applicatif |

Détail complet : `20-DATABASE-TABLE-CATALOG.md`.

## 4. n8n

| Champ | Valeur |
|---|---|
| **Type** | moteur d'orchestration de workflows |
| **Emplacement** | conteneur `n8n`, image `n8nio/n8n:latest` |
| **Responsabilité** | exécuter les workflows WF1→WF6 et WF-Chat ; **seul détenteur** des écritures GitHub |
| **Entrée** | webhooks HTTP (`:5678`) |
| **Persistance** | volume `n8n_data` |
| **Impact si indisponible** | pas de remédiation ; le dispatch échoue en `DISPATCH_FAILED` (rejouable) |
| **Rôle sécurité** | détient le credential GitHub et la clé Anthropic ; **ne décide rien** sur le fond |

Détail : `03-N8N-COMPLETE-GUIDE.md`, `03b-N8N-NODE-CATALOG.md`.

## 5. WF2 — Git Patch & PR v5 CANONICAL

| Champ | Valeur |
|---|---|
| **ID** | `u3eeMwTuhCsetfcS` — **actif**, 195 nœuds (189 fonctionnels, 6 notes) |
| **Responsabilité** | corriger un **incident** (anomalie de code/qualité) avec l'aide d'un LLM, puis publier |
| **Déclencheur** | webhook `wf2-r22e-test`, **sans authentification** |
| **Appels sortants** | **4 × Anthropic**, 6 × backend, **4 nœuds mutants GitHub** |
| **Impact si indisponible** | la correction d'incident n'est plus proposée |

## 6. WF6 — Security Remediation (Maven)

| Champ | Valeur |
|---|---|
| **ID** | `RdYyfjVpOm2LxS95` — **actif**, 184 nœuds (177 fonctionnels, 7 notes) |
| **Responsabilité** | remédier une **CVE** : évaluer un candidat, prouver la fermeture, publier |
| **Déclencheur** | webhook `wf6-security-remediation-evaluate`, **`headerAuth`** |
| **Qualité structurelle mesurée** | 177/177 nœuds atteignables, **0** arête pendante, **0** nœud désactivé, **58/58** nœuds HTTP avec timeout **et** gestion d'erreur explicites |
| **Barrière pré-Git** | **39 portes** avant la première mutation GitHub |

## 7. Jenkins

| Champ | Valeur |
|---|---|
| **Type** | serveur d'intégration continue |
| **Emplacement** | conteneur `jenkins`, image `pfe-jenkins-with-docker-cli:2.568.1-jdk21` |
| **Responsabilité** | **construire et scanner** le projet audité ; produire des rapports |
| **Jobs** | 8, dont `pfe-app-test` (build #151) et `pfe-app-test-security-candidate` |
| **Communication** | pousse vers `POST /api/webhooks/jenkins/by-job/:jobName` |
| **Rôle sécurité** | fournit la **preuve de build** ; n'a aucun droit sur l'état de remédiation |

**À ne pas confondre avec n8n** : Jenkins *construit et mesure*, n8n *orchestre et
corrige*. Voir `08-JENKINS-CICD.md`.

## 8. Candidate Verifier

| Champ | Valeur |
|---|---|
| **Type** | worker du plan d'exécution |
| **Emplacement** | `candidate-verifier/`, conteneur `pfe-candidate-verifier` |
| **Technologie** | Node 20 sur Debian bookworm + JDK 17 + Maven + Gradle 8.10.2 + Python 3.11 + Podman + Trivy |
| **Responsabilité** | matérialiser un espace jetable au **SHA exact**, appliquer le patch, compiler, tester, empaqueter |
| **Entrée** | `POST :4100/verify` — **aucun port publié sur l'hôte** |
| **Détient** | **un seul** secret : `BUILDER_INTERNAL_SECRET`. Ni DB, ni JWT, ni jeton GitHub |
| **Capacité élevée** | **aucune** (`privileged` non défini, aucune `cap_add`) |
| **Impact si indisponible** | `VERIFIER_TIMEOUT` → tentative rejouable |

## 9. Builder Scanner

| Champ | Valeur |
|---|---|
| **Emplacement** | `builder-scanner/`, conteneur `pfe-builder-scanner` |
| **Responsabilité** | **seul** processus autorisé à exécuter `podman` et `trivy` |
| **Entrée** | `POST :4200` — aucun port publié |
| **Capacité** | `cap_add: SYS_ADMIN` **uniquement** (requis par Podman rootless), `init: true` pour réaper les zombies |
| **Détient** | `BUILDER_INTERNAL_SECRET`, vérifié *fail-closed* dans `builder-scanner/src/internal-auth.ts` ; émis par `candidate-verifier/src/remote-builder-artifact-validator.ts`, injecté par `platform/docker-compose.yml` |
| **Pourquoi séparé du vérificateur** | pour garder le processus **décisionnel** à capacité nulle. C'est tout l'intérêt de la séparation |

## 10. Trivy

| Champ | Valeur |
|---|---|
| **Version** | **0.72.0**, épinglée et vérifiée par SHA-256 depuis l'upstream |
| **Cible** | archive d'image (`mode: 'TRIVY_IMAGE_ARCHIVE'`) |
| **Responsabilité** | prouver la disparition de la CVE **et** la présence du paquet à la version corrigée |
| **Rôle sécurité** | juge déterministe n°1 de la fermeture de sécurité |

## 11. OWASP Dependency-Check

| Champ | Valeur |
|---|---|
| **Version** | plugin Maven **12.2.2**, pré-téléchargé dans l'image du vérificateur |
| **Cible** | arbre de dépendances du projet |
| **Rôle** | juge déterministe n°2, sur un axe différent de Trivy |

## 12. SonarQube

| Champ | Valeur |
|---|---|
| **Emplacement** | conteneur `sonarqube`, image `sonarqube:latest` |
| **Rôle** | qualité et sécurité du code ; **Quality Gate** |
| **Particularité** | le backend distingue *analyse soumise* de *Quality Gate corrélé* via `ceTaskId` |

## 13. ZAP

| Champ | Valeur |
|---|---|
| **État réel** | **non actif**. Les conteneurs `sec4c/4d/4f-zap` sont `Exited`. |
| **Données** | les findings ZAP en base sont **historiques** |
| **Conséquence** | la gouvernance voit `zap: WARNING` comme étape **non bloquante** |

## 14. Docker / Podman

| Usage | Outil | Où | Pourquoi |
|---|---|---|---|
| orchestration des services | Docker Compose | hôte | 2 fichiers : plan plateforme (5 services) et plan outillage (9) |
| builds de la CI | Docker-in-Docker **privileged** | `jenkins-docker` | Jenkins doit construire des images |
| build des **candidats** | **Podman rootless** | `builder-scanner` | éviter d'exposer le démon Docker au plan d'exécution |

**Le choix de Podman est un argument de soutenance** : construire une image depuis un
dépôt potentiellement hostile sans jamais monter `docker.sock`.

## 15. Git / GitHub

| Champ | Valeur |
|---|---|
| **Rôle** | dépôt du projet audité et **cible des publications** |
| **Écrivains** | 4 nœuds WF6 + 2 nœuds WF2 + 1 workflow DEBUG inactif |
| **Le backend n'écrit jamais dans Git** | il détient le jeton mais ne crée ni branche, ni commit, ni PR |

Détail : `13-GIT-GITHUB-INTEGRATION.md`.

## 16. Sous-système de déploiement Azure

| Champ | Valeur |
|---|---|
| **Emplacement** | `backend/src/azure-deploy/` (28 fichiers) |
| **Responsabilité** | gouvernance, autorisation, dispatch, classification du résultat |
| **Révision déployée** | `f212d19b…`, image `sha256:3835d850…` |
| **Secrets** | **aucun credential Azure** côté backend |

Détail : `14-AZURE-DEPLOYMENT.md`.

## 17. Agent de déploiement Azure (hôte)

| Champ | Valeur |
|---|---|
| **Type** | processus **hôte**, hors Docker |
| **Emplacement** | `infra/azure-deploy-agent/agent.py` |
| **Écoute** | `172.19.0.1:7799` — **jamais** `0.0.0.0` |
| **Responsabilité** | seul à lire `~/.azure` et à exécuter `az` |
| **Authentification** | `X-Agent-Secret` |

## 18. Ollama (LLM local)

| Champ | Valeur |
|---|---|
| **Emplacement** | conteneur `ollama`, `:11434` |
| **Usage réel** | **aucun**. Vérifié : aucune URL de workflow publié ni de code backend ne pointe vers le service `:11434` |
| **Pourquoi il reste** | capacité LLM locale installée pendant le développement ; WF1 porte encore des variables nommées `ollamaBodyString`, vestiges de cette période, mais les requêtes partent vers Anthropic |

## 19. Prometheus / Grafana

| Champ | Valeur |
|---|---|
| **État** | conteneurs en marche |
| **Limite constatée** | le backend n'expose **pas** d'endpoint `/metrics` ; l'observabilité réelle passe par la base |

## 20. Nexus

| Champ | Valeur |
|---|---|
| **Emplacement** | conteneur `nexus`, `:8081` |
| **Usage** | dépôt d'artefacts |
| **Rôle dans la chaîne de remédiation** | aucun rôle décisionnel observé dans le code de remédiation |
