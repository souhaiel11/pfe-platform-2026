# 🛡️ DevSecOps AI Platform v2.0

Plateforme DevSecOps intelligente avec gestion de projets, monitoring en temps réel, correction AI des bugs et ChatOps.

## 🚀 Démarrage rapide

```bash
docker-compose up -d
```

| Service | URL | Credentials |
|---|---|---|
| **Frontend** | http://localhost:4200 | admin@devsecops.local / Admin@123 |
| **Backend API** | http://localhost:3000/api | JWT Token |
| **API Docs** | http://localhost:3000/api/docs | — |
| **n8n** | http://localhost:5678 | admin / admin123 |

---

## 🗂️ Fonctionnalités

### 📁 Gestion de Projets
- CRUD complet avec GitHub, SonarQube, Jenkins, Trivy
- Score de sécurité calculé automatiquement
- Tags et environnements (dev/staging/prod)
- Statut global (healthy/warning/critical)

### 📊 Dashboard Grafana-like
- Métriques SonarQube (bugs, vulnérabilités, coverage, code smells)
- Scan Trivy (CVEs par sévérité CRITICAL/HIGH/MEDIUM/LOW)
- Status Jenkins pipeline avec historique
- GitHub PRs ouvertes/mergées
- Score de sécurité global avec jauge visuelle

### 🐛 Bug Manager AI
- Détection automatique via webhooks SonarQube/Trivy/Jenkins
- **Bouton "🤖 AI Fix"** → déclenche workflow n8n → analyse OpenAI → crée PR GitHub
- Explication en langage naturel (français)
- Score de confiance du fix (0-100%)
- Filtre par sévérité / statut / projet / source
- Lifecycle: open → ai_fixing → pr_created → resolved

### 📋 Reports Center
- Rapports lisibles avec résumé AI en français
- Score de risque global calculé (0-100%)
- Niveau de risque: LOW / MEDIUM / HIGH / CRITICAL
- Historique par projet et par type

### 💬 ChatOps AI
- Assistant DevSecOps en français
- Connecté à n8n → OpenAI GPT-4
- Contexte aware (projets, bugs, métriques)
- Mode démo local sans backend

### ⚡ Incidents
- Lifecycle complet: pending → analyzing → analyzed → fix_generated → approved → completed
- Création automatique via webhooks Jenkins/SonarQube
- Suivi des PRs générées

---

## 🔧 Configuration n8n

### 1. Importer les workflows
1. Aller sur http://localhost:5678
2. Se connecter (admin / admin123)
3. Import > From file > sélectionner les fichiers dans `n8n-workflows/`

### 2. Configurer OpenAI
1. Dans n8n → Credentials → Add New
2. Choisir "OpenAI API"
3. Entrer votre clé API OpenAI
4. Assigner aux nodes OpenAI des workflows

### 3. Webhooks disponibles
| Endpoint | Usage |
|---|---|
| POST `/api/webhooks/sonarqube/:projectId` | Rapport SonarQube |
| POST `/api/webhooks/jenkins/:projectId` | Build Jenkins |
| POST `/api/webhooks/trivy/:projectId` | Scan Trivy |
| POST `/api/bugs/:id/ai-fix` | Déclencher AI Fix |

---

## 🏗️ Architecture

```
Frontend (Angular-like SPA)
    │ HTTP/WebSocket
    ▼
Backend (NestJS)
    ├── Auth (JWT + RBAC)
    ├── Projects (CRUD + métriques)
    ├── Bugs (AI Fix lifecycle)
    ├── Incidents (lifecycle complet)
    ├── Reports (avec AI summary)
    ├── Dashboard (métriques agrégées)
    ├── Webhooks (SonarQube/Jenkins/Trivy)
    └── ChatOps (proxy vers n8n)
    │
    ├── PostgreSQL (données)
    │
    └── n8n (orchestration AI)
            ├── Bug Fix Workflow (OpenAI → PR GitHub)
            ├── ChatOps Workflow (Assistant GPT-4)
            └── Report Summary Workflow
```

---

## 📦 Stack Technique

- **Backend**: NestJS 10, TypeORM, PostgreSQL, JWT, Socket.IO, Swagger
- **Frontend**: SPA vanilla JS/CSS avec Chart.js, design dark enterprise
- **Orchestration**: n8n avec workflows AI (OpenAI GPT-4)
- **Infra**: Docker Compose, Nginx
- **Intégrations**: GitHub (Octokit), SonarQube, Jenkins, Trivy

---

## 🔐 Credentials par défaut

| Rôle | Email | Password |
|---|---|---|
| Admin | admin@devsecops.local | Admin@123 |
| Developer | dev@devsecops.local | Dev@123 |

---

## 💡 Idées d'extension (PFE)

- [ ] **Blast Radius**: visualiser l'impact d'une CVE sur tous les services
- [ ] **Risk Timeline**: évolution du score de sécurité dans le temps
- [ ] **Auto-Triage AI**: priorisation automatique des bugs par impact business
- [ ] **DAST Integration**: intégration OWASP ZAP
- [ ] **Slack/Teams Notifications**: alertes ChatOps
- [ ] **Multi-tenant**: isolation par équipe/organisation
