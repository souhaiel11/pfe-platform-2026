#!/bin/bash
# Met à jour le service de test de connexion dans le conteneur.
set -e
docker cp ~/pfe-2026/platform/backend/config-check-compile/config-check.service.js pfe-backend-r99:/app/dist/config-check/config-check.service.js
docker restart pfe-backend-r99 >/dev/null
echo "service mis à jour et backend redémarré"
