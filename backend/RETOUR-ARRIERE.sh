#!/bin/bash
# Annule la superposition : restaure chaque fichier depuis sa sauvegarde .orig.
set -e
C=pfe-backend-r99
for f in common/security-score.js dashboard/dashboard.service.js projects/projects.service.js app.module.js; do
  docker exec -u root $C sh -c "[ -f /app/dist/$f.orig ] && cp /app/dist/$f.orig /app/dist/$f && echo '  restauré $f' || true"
done
docker exec -u root $C rm -rf /app/dist/config-check
docker restart $C >/dev/null
echo "retour arrière terminé."
