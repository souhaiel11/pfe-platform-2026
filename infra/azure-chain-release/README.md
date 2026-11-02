# Livraison ciblée Azure

Ne pas reconstruire tout le backend depuis ce checkout : consulter `docs/qa/azure-chain-20261014/validation.md` pour les écarts entre sources et runtime.

Le Dockerfile conserve le runtime qualifié et remplace seulement ProjectsService, avec son nouveau module pur de dérivation. Les deux fichiers de `dist/` sont les artefacts compilés livrés. Pour les régénérer, exécuter le build backend avec succès, puis copier uniquement :

- `backend/dist/projects/projects.service.js` vers `dist/projects/projects.service.js` ;
- `backend/dist/azure-deploy/default-deployment-target.js` vers `dist/azure-deploy/default-deployment-target.js`.

Construire depuis la racine avec `docker build -t local/pfe-azure-chain:20261014 infra/azure-chain-release`. Vérifier avant construction que l'image de base porte l'ID documenté. Le déploiement utilise les fichiers `docker-compose.yml` et `docker-compose.r99.yml`.
