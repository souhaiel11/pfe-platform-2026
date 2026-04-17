#!/usr/bin/env bash
# =============================================================
#  DevSecOps PFE — Script de setup complet
#  Usage: chmod +x scripts/setup.sh && ./scripts/setup.sh
# =============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail() { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════╗"
echo "║   DevSecOps PFE — Setup Automatique      ║"
echo "║   Java 17 · Jenkins · SonarQube · Docker ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Vérifications prérequis ───────────────────────────────────
log "Vérification des prérequis..."
command -v docker  >/dev/null 2>&1 || fail "Docker n'est pas installé."
command -v docker  >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 requis."
ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
ok "Docker Compose $(docker compose version --short)"

# ── vm.max_map_count pour SonarQube ──────────────────────────
log "Configuration kernel pour SonarQube (vm.max_map_count)..."
CURRENT=$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)
if [ "$CURRENT" -lt 262144 ]; then
    sudo sysctl -w vm.max_map_count=262144 2>/dev/null || warn "Impossible de modifier vm.max_map_count (SonarQube pourrait ne pas démarrer)"
fi
ok "vm.max_map_count OK"

# ── Démarrage des services ────────────────────────────────────
log "Démarrage de l'infrastructure Docker..."
cd "$(dirname "$0")/../docker"

docker compose pull --quiet
docker compose up -d postgres

log "Attente PostgreSQL..."
until docker exec devsecops-postgres pg_isready -U devsecops >/dev/null 2>&1; do
    sleep 2; printf "."
done
echo; ok "PostgreSQL prêt"

docker compose up -d sonarqube jenkins prometheus grafana
log "Attente SonarQube (peut prendre 60-90s)..."
until curl -s http://localhost:9000/api/system/status | grep -q '"status":"UP"'; do
    sleep 5; printf "."
done
echo; ok "SonarQube prêt"

# ── Build et démarrage de l'application ──────────────────────
log "Build de l'application Spring Boot..."
docker compose up -d --build app
log "Attente application..."
until curl -s http://localhost:8080/api/health | grep -q '"status":"UP"'; do
    sleep 3; printf "."
done
echo; ok "Application Spring Boot prête"

# ── Résumé ────────────────────────────────────────────────────
echo
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║              ✅  SETUP TERMINÉ                           ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "║  ${GREEN}Application${NC}  →  http://localhost:8080/api/health        ║"
echo -e "║  ${YELLOW}Jenkins${NC}      →  http://localhost:8090    admin/admin     ║"
echo -e "║  ${RED}SonarQube${NC}    →  http://localhost:9000    admin/admin     ║"
echo -e "║  ${CYAN}Prometheus${NC}   →  http://localhost:9090                   ║"
echo -e "║  ${CYAN}Grafana${NC}      →  http://localhost:3000    admin/admin123  ║"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
