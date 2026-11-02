#!/bin/bash
# Déploiement des correctifs backend par superposition sur l'image en service.
# Chaque fichier remplacé est sauvegardé en .orig avant écriture.
set -e
C=pfe-backend-r99
cd "$(dirname "$0")"

echo "— sauvegarde"
for f in common/security-score.js dashboard/dashboard.service.js projects/projects.service.js app.module.js; do
  docker exec -u root $C sh -c "[ -f /app/dist/$f.orig ] || cp /app/dist/$f /app/dist/$f.orig"
done

echo "— correctifs de score"
docker cp correctifs-score/security-score.js   $C:/app/dist/common/security-score.js
docker cp correctifs-score/dashboard.service.js $C:/app/dist/dashboard/dashboard.service.js
docker cp correctifs-score/projects.service.js  $C:/app/dist/projects/projects.service.js

echo "— module de test de configuration"
docker exec -u root $C mkdir -p /app/dist/config-check
for f in module controller service dto; do
  docker cp config-check-compile/config-check.$f.js $C:/app/dist/config-check/
done
docker exec -u root $C node -e '
const fs=require("fs"),p="/app/dist/app.module.js";let t=fs.readFileSync(p,"utf8");
if(t.includes("config_check_module_1")){console.log("  app.module déjà patché");process.exit(0)}
const a=`const source_evidence_module_1 = require("./source-evidence/source-evidence.module");`;
t=t.replace(a,a+`\nconst config_check_module_1 = require("./config-check/config-check.module");`);
t=t.replace("source_evidence_module_1.SourceEvidenceModule,","source_evidence_module_1.SourceEvidenceModule,\n            config_check_module_1.ConfigCheckModule,");
fs.writeFileSync(p,t);console.log("  app.module patché")'

echo "— redémarrage"
docker restart $C >/dev/null
sleep 12
echo "— contrôle"
docker exec $C sh -c 'ls /app/dist/config-check/ | tr "\n" " "'
echo
echo "terminé."
