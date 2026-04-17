#!/usr/bin/env bash
# Arrêt et nettoyage de l'infrastructure
set -euo pipefail
echo "[DevSecOps PFE] Arrêt de l'infrastructure..."
cd "$(dirname "$0")/../docker"
docker compose down -v --remove-orphans
echo "✔ Tous les conteneurs et volumes supprimés."
