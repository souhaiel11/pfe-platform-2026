# 🛡️ DevSecOps PFE — CI/CD Pipeline Sécurisé

> Projet de Fin d'Études — Architecture DevSecOps complète avec pipeline CI/CD automatisé et sécurité intégrée (Shift-Left)

![Java](https://img.shields.io/badge/Java-17-orange?logo=openjdk)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.2-green?logo=springboot)
![Jenkins](https://img.shields.io/badge/Jenkins-LTS-red?logo=jenkins)
![SonarQube](https://img.shields.io/badge/SonarQube-10.3-blue?logo=sonarqube)
![Docker](https://img.shields.io/badge/Docker-Compose-blue?logo=docker)

---

## 📋 Table des matières

1. [Prérequis](#prérequis)
2. [Démarrage rapide](#démarrage-rapide)
3. [Structure du projet](#structure-du-projet)
4. [Pipeline CI/CD](#pipeline-cicd)
5. [Security Gates](#security-gates)
6. [Services & Ports](#services--ports)
7. [API Reference](#api-reference)
8. [Monitoring](#monitoring)

---

## Prérequis

- Docker Desktop 24+ avec Docker Compose v2
- Java 17 + Maven 3.9 (développement local)
- Git 2.40+

---

## Démarrage rapide

```bash
# 1. Cloner
git clone https://github.com/votre-user/devsecops-pfe.git
cd devsecops-pfe

# 2. Installer les git hooks (scan secrets pre-commit)
chmod +x scripts/install-hooks.sh && ./scripts/install-hooks.sh

# 3. Lancer toute l'infrastructure
chmod +x scripts/setup.sh && ./scripts/setup.sh

# 4. Tester l'application
curl http://localhost:8080/api/health
```

---

## Structure du projet

```
devsecops-pfe/
├── app/                       # Application Spring Boot 3.2
│   ├── src/main/java/         # Code source (Controller/Service/Repository/Model)
│   ├── src/test/java/         # Tests unitaires + intégration
│   ├── pom.xml                # Maven + plugins sécurité
│   └── Dockerfile             # Multi-stage, non-root
├── jenkins/
│   └── Jenkinsfile            # Pipeline déclaratif 10 stages
├── docker/
│   └── docker-compose.yml     # Tous les services
├── sonarqube/
│   └── sonar-project.properties
├── security/
│   ├── trivy/trivy.yaml       # Config scan container
│   ├── zap/zap-rules.conf     # Règles DAST (25 règles)
│   └── owasp/owasp-suppressions.xml
├── monitoring/
│   ├── prometheus/            # Config + alertes
│   └── grafana/               # Provisioning + dashboards
├── .github/workflows/         # GitHub Actions (alternative Jenkins)
└── scripts/                   # setup.sh / scan.sh / teardown.sh
```

---

## Pipeline CI/CD

| # | Stage | Outil | Condition | Gate |
|---|-------|-------|-----------|------|
| 1 | Checkout | Git | Toutes branches | — |
| 2 | Build | Maven compile | Toutes branches | Erreur = fail |
| 3 | Tests + Coverage | JUnit 5 + JaCoCo | Toutes branches | Coverage < 70% = fail |
| 4 | SAST | SonarQube 10.3 | Toutes branches | Quality Gate KO = fail |
| 5 | SCA | OWASP Dep. Check | Toutes branches | CVSS ≥ 7 = fail |
| 6 | Package | Docker multi-stage | Toutes branches | Build error = fail |
| 7 | Container Scan | Trivy | Toutes branches | HIGH/CRIT = fail |
| 8 | Deploy Staging | Docker Compose | `develop` only | — |
| 9 | DAST | OWASP ZAP | `develop` only | Critical alert = fail |
| 10 | Deploy Production | Docker Compose | `main` + approbation | Manuel |

---

## Security Gates

| Gate | Contrôle | Seuil de blocage |
|------|----------|-----------------|
| G1 | Couverture de code (JaCoCo) | < 70% |
| G2 | Quality Gate SonarQube | Statut KO |
| G3 | CVE dans dépendances (OWASP DC) | CVSS ≥ 7.0 |
| G4 | Vulnérabilités image Docker (Trivy) | HIGH ou CRITICAL |
| G5 | Tests dynamiques (OWASP ZAP) | Alerte Critical |
| G6 | Déploiement production | Approbation manuelle Jenkins |

---

## Services & Ports

| Service | URL | Credentials |
|---------|-----|-------------|
| 🟢 Application | http://localhost:8080 | Basic Auth |
| 🔵 Jenkins | http://localhost:8090 | admin / admin |
| 🔴 SonarQube | http://localhost:9000 | admin / admin |
| 🟡 PostgreSQL | localhost:5432 | devsecops / devsecops123 |
| 🟠 Prometheus | http://localhost:9090 | — |
| 🟣 Grafana | http://localhost:3000 | admin / admin123 |

---

## API Reference

```
GET    /api/tasks           Liste toutes les tâches
GET    /api/tasks/{id}      Récupère une tâche par ID
POST   /api/tasks           Crée une tâche (body JSON)
PUT    /api/tasks/{id}      Met à jour une tâche
DELETE /api/tasks/{id}      Supprime une tâche
GET    /api/tasks/status/{status}  Filtre par statut
GET    /api/health          Health check (public)
GET    /actuator/prometheus Métriques Prometheus
```

---

## Monitoring

Grafana est pré-configuré avec :
- **Dashboard JVM** — Heap, GC, threads, uptime
- **Dashboard HTTP** — Requêtes/s, latences p95, codes retour
- **Alertes Prometheus** — App down, erreurs 5xx, latence élevée, heap pressure

---

*Projet de Fin d'Études — Architecture DevSecOps · Shift-Left Security by Design*
