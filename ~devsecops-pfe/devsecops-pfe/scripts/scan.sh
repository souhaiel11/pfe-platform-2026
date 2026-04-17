#!/usr/bin/env bash
# Lancement manuel des scans de sécurité
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${CYAN}[DevSecOps PFE] Lancement des scans de sécurité...${NC}"

# ── 1. SAST: SonarQube ───────────────────────────────────────
echo -e "\n${CYAN}[1/3] SAST — SonarQube${NC}"
cd "$ROOT/app"
mvn sonar:sonar \
    -Dsonar.host.url=http://localhost:9000 \
    -Dsonar.login=admin \
    -Dsonar.password=admin \
    -Dsonar.projectKey=devsecops-pfe \
    -q
echo -e "${GREEN}✔ SonarQube scan terminé → http://localhost:9000${NC}"

# ── 2. SCA: OWASP Dependency Check ──────────────────────────
echo -e "\n${CYAN}[2/3] SCA — OWASP Dependency Check${NC}"
mvn org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=10 -q
echo -e "${GREEN}✔ OWASP DC terminé → target/dependency-check-report/${NC}"

# ── 3. Container Scan: Trivy ─────────────────────────────────
echo -e "\n${CYAN}[3/3] Container Scan — Trivy${NC}"
IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep devsecops-pfe | head -1)
if [ -z "$IMAGE" ]; then
    echo "Build de l'image Docker..."
    cd "$ROOT/app"
    docker build -t devsecops-pfe:local . -q
    IMAGE="devsecops-pfe:local"
fi
mkdir -p "$ROOT/security/trivy"
docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$ROOT/security/trivy:/reports" \
    aquasec/trivy:latest image \
    --severity HIGH,CRITICAL \
    --format table \
    "$IMAGE"
echo -e "${GREEN}✔ Trivy scan terminé${NC}"

echo -e "\n${GREEN}╔══════════════════════════════════════╗"
echo "║  ✅  Tous les scans sont terminés    ║"
echo -e "╚══════════════════════════════════════╝${NC}"
