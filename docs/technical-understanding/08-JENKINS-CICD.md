# 08 — JENKINS / CI-CD

---

## 1. Ce que Jenkins est — et n'est pas

C'est **la** confusion la plus fréquente. À poser clairement :

| | Jenkins | n8n | candidate-verifier |
|---|---|---|---|
| **Rôle** | construire et **mesurer** le projet | **orchestrer** la correction | **prouver** un candidat |
| **Quand** | à chaque push / déclenchement | quand une correction est demandée | pendant l'évaluation |
| **Sur quoi** | le dépôt réel, branche réelle | rien (il coordonne) | un clone jetable au SHA exact |
| **Produit** | rapports, image, builds numérotés | branche, commit, PR | verdict de fermeture de sécurité |
| **Peut écrire dans Git ?** | ce que son pipeline fait | **oui** (4 nœuds WF6, 2 nœuds WF2) | **non, jamais** |
| **Décide d'une remédiation ?** | **non** | **non** | **non** (il mesure) |

**Formule pour le jury** : *« Jenkins mesure l'existant. Le candidate-verifier mesure une
hypothèse. n8n décide quoi publier. Le backend décide de tout le reste. »*

---

## 2. Les jobs réels

8 jobs dans `/var/jenkins_home/jobs/` :

| Job | Dernier build | État / rôle |
|---|---|---|
| `pfe-app-test` | **#151** (2026-10-06) | job principal du projet audité |
| `pfe-app-test-security-candidate` | **#1** (2026-10-06) | job dédié aux candidats de sécurité |
| `pfe-app-test-multibranch` | multibranche | builds par branche (dont `PR-33`) |
| `vuln-testapp` | — | application vulnérable de test |
| `devsecops-testbed` | — | banc d'essai |
| `devsecops-platform-testbed` | — | banc d'essai de la plateforme |
| `VermegPFE-Watcher` | **#3125** (2026-08-24) | job de surveillance, très gros historique |
| `PFE-VERMEG` | #109 (2026-04-20) | job historique |

**Le numéro de build est un identifiant de corrélation de premier plan** : `#151` est ce
qui relie un rapport, un commit, une analyse Sonar et une décision de gouvernance.
Voir `21-IDENTIFIER-DATA-FLOW.md`.

---

## 3. Comment Jenkins parle au backend

Jenkins **pousse**, le backend **n'interroge pas** Jenkins pour l'ingestion.

```
build Jenkins termine
   │
   ├─ POST /api/webhooks/jenkins/by-job/<job>/<branche>
   │     └─ WebhooksController.jenkinsByJob()
   │           └─ ProjectsService.resolveByJobName()   (gère le / du multibranche)
   │                 └─ WebhooksService.handleJenkins()
   │                       ├─ détermine buildNumber / status / jobName
   │                       ├─ si FAILURE : GET <build_url>consoleText  (timeout 15 s)
   │                       │     └─ extractErrorFromConsoleLog()
   │                       ├─ crée l'incident (COMPLETED si SUCCESS, FAILED sinon)
   │                       └─ routeToOptimizer()  → WF4/WF5, sous garde anti-boucle
   │
   └─ WF1 (n8n) analyse l'incident et corrèle Sonar
```

### Deux subtilités réellement implémentées

**La vraie cause d'échec.** Au niveau d'un `step sh`, Jenkins ne capture que
« script returned exit code N ». Le backend va donc lire le log console lui-même. Le
commentaire du code le dit explicitement. Et l'opération est *fail-safe* : si la lecture
échoue, on retombe sur `error_message` et l'incident est **quand même** créé.

**Les jobs multibranches.** `jobName` vaut `<job>/<branche>` ; tout ce qui suit le
premier segment est la branche réelle. D'où `@Post('jenkins/by-job/:jobName(.*)')` et
une résolution factorisée partagée avec `/api/projects/internal/by-job/...`.

---

## 4. Les étapes de pipeline telles que le backend les voit

`GET /api/azure-deploy/ready/:projectId` renvoie `requiredStages`. Relevé réel pour
`pfe-app-test` :

| Étape | Statut | Bloquante | Requise |
|---|---|---|---|
| `build` | `PASSED` | non | oui |
| `tests` | `NOT_RUN` | non | oui |
| `sonar` | `FAILED` | **oui** | oui |
| `trivy` | `FAILED` | **oui** | oui |
| `owasp` | `FAILED` | **oui** | oui |
| `zap` | `WARNING` | non | oui |
| `docker` | `PASSED` | non | oui |
| `deploy` | `NOT_RUN` | non | oui |

C'est **cette structure** qui alimente :
- la liste de contrôles de l'onglet Déploiement (`requiredStages` → `controlRows`) ;
- les motifs bloquants de la gouvernance (`Étape requise bloquante : sonar (FAILED)`).

Noter la distinction entre `NOT_RUN` et `FAILED` : elle est conservée de bout en bout et
**jamais** convertie en `PASSED`.

---

## 5. Docker-in-Docker

| Élément | Valeur |
|---|---|
| Conteneur | `jenkins-docker`, image `docker:dind` |
| Mode | **`privileged: true`** |
| Port | `0.0.0.0:2376` (TLS) |
| Volumes | `jenkins_certs`, `jenkins_home` |
| Pourquoi | Jenkins doit construire des images Docker |

**À savoir défendre** : c'est le composant le plus privilégié de la plateforme. Le
contre-argument est le contraste avec le plan de remédiation :
`platform/docker-compose.yml` **ne monte aucun `docker.sock`**, et le build des candidats
utilise **Podman rootless** dans `builder-scanner`. Autrement dit, le privilège DinD
est confiné au plan d'outillage et n'est jamais exposé au code venant d'un dépôt.

---

## 6. Limites constatées côté Jenkins

| Constat | Détail |
|---|---|
| Historique non borné | `VermegPFE-Watcher` à 3125 builds, sans rotation visible |
| Workspaces résiduels | `amri souhaiel` (57 Mo), `amri souhaiel@2` (56 Mo), `pfe-app-test-multibranch_PR-33@libs`, `test` |
| Jobs abandonnés | `PFE-VERMEG` inactif depuis avril |

Aucun n'affecte la démonstration ; le risque réel est la **saturation disque**, pas la
correction fonctionnelle.
