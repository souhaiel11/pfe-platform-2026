#!/usr/bin/env bash
# Démarre l'agent de déploiement Azure au premier plan (Ctrl+C pour l'arrêter).
# - charge le secret partagé (.env) et les listes d'autorisation (allowlists.env), jamais versionnés ;
# - ajoute l'Azure CLI Windows au PATH (session « az login » du poste) ;
# - s'exécute avec le groupe docker (connexion au registre et lecture des labels d'image).
# Prérequis : `az account show` doit répondre (sinon : `az login` côté Windows).
set -euo pipefail
cd "$(dirname "$0")"
exec sg docker -c 'set -a; . ./.env; . ./allowlists.env; set +a;
  export PATH="$PATH:/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin";
  exec python3 agent.py'
