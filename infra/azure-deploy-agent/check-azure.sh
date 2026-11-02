#!/usr/bin/env bash
# Vérification en lecture seule de tout ce dont l'agent de déploiement Azure a besoin.
# À lancer depuis le terminal WSL de l'utilisateur (là où `az` fonctionne).
cd "$(dirname "$0")"
set -a; . ./allowlists.env; set +a
export PATH="$PATH:/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin"
RG="${AZURE_ALLOWED_RESOURCE_GROUPS%%,*}"; ACR="${AZURE_ALLOWED_ACRS%%,*}"
ok=0; ko=0
check() { local label="$1"; shift; local out; if out="$("$@" 2>&1)"; then echo "OK  $label ${out:+→ $(echo "$out" | head -1 | cut -c1-110)}"; ok=$((ok+1)); else echo "KO  $label → $(echo "$out" | tail -2 | tr '\n' ' ' | cut -c1-200)"; ko=$((ko+1)); fi; }

check "az disponible"                 az version --query '"azure-cli"' -o tsv
check "session az (compte)"           az account show --query '[name, user.name]' -o tsv
check "jeton ARM valide"              az account get-access-token --query expiresOn -o tsv
check "groupe de ressources $RG"      az group show -n "$RG" --query properties.provisioningState -o tsv
check "registre ACR $ACR"             az acr show -n "$ACR" --query loginServer -o tsv
check "jeton ACR (expose-token)"      sh -c "az acr login -n '$ACR' --expose-token -o tsv --query loginServer"
check "dépôts dans l'ACR"             sh -c "az acr repository list -n '$ACR' -o tsv | tr '\n' ' '"
check "admin ACR (credential show)"   sh -c "az acr credential show -n '$ACR' --query username -o tsv"
check "fournisseur ContainerInstance" az provider show -n Microsoft.ContainerInstance --query registrationState -o tsv
check "conteneurs ACI existants"      sh -c "az container list -g '$RG' --query '[].[name,instanceView.state]' -o tsv | tr '\n' ' '; true"
check "docker (groupe docker)"        sg docker -c "docker version --format '{{.Server.Version}}'"
check "secret de l'agent (.env)"      sh -c "grep -q '^AZURE_DEPLOY_AGENT_SECRET=.' .env && echo présent"
agent_status() {
  local secret; secret="$(sed -n 's/^AZURE_DEPLOY_AGENT_SECRET=//p' .env)"
  curl -sS -m 60 -w ' [HTTP %{http_code}]' -H "X-Agent-Secret: $secret" http://172.19.0.1:7799/session-status \
    | grep -q '"valid": *true' && echo "session Azure valide vue par l'agent"
}
check "agent /session-status (172.19.0.1:7799)" agent_status

echo "== $ok OK, $ko KO"
