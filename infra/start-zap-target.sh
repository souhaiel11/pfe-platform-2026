#!/usr/bin/env bash
# Remet en route la cible DAST de ZAP après un redémarrage de la machine (2026-10-25).
# La bibliothèque pfe-devsecops lance ZAP dans un pod du namespace pfe-devsecops, contre le service
# projet-validation-vermeg:8080, via /var/jenkins_home/.kube/config (https://192.168.49.2:8443).
# Idempotent : peut être relancé sans risque.
set -euo pipefail
MINIKUBE="${MINIKUBE:-$HOME/.local/bin/minikube}"
HERE="$(cd "$(dirname "$0")" && pwd)"
D() { sg docker -c "$*" </dev/null; }

echo "== Cluster Minikube (192.168.49.2)"
D "$MINIKUBE start --driver=docker --cpus=2 --memory=3072 --static-ip=192.168.49.2 --wait=all"

echo "== Jenkins relié au réseau du cluster"
D "docker network connect minikube jenkins" 2>/dev/null || true

echo "== kubeconfig de Jenkins (certificats intégrés, adresse directe du cluster)"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
D "$MINIKUBE kubectl -- config view --flatten --minify" | sed -E 's#server: https://127\.0\.0\.1:[0-9]+#server: https://192.168.49.2:8443#' > "$tmp"
D "docker cp $tmp jenkins:/var/jenkins_home/.kube/config"
D "docker exec -u 0 jenkins sh -c 'chown jenkins:jenkins /var/jenkins_home/.kube/config && chmod 600 /var/jenkins_home/.kube/config'"

echo "== Application cible (image projet-validation-vermeg:local) et image ZAP en cache"
D "$MINIKUBE image ls" | grep -q 'projet-validation-vermeg:local' || D "$MINIKUBE image load projet-validation-vermeg:local"
D "$MINIKUBE ssh -- 'docker image inspect zaproxy/zap-stable:latest >/dev/null 2>&1 || docker pull -q zaproxy/zap-stable:latest'"
D "docker cp $HERE/zap-target.pfe-devsecops.yaml jenkins:/tmp/zap-target.yaml"
D "docker exec jenkins sh -c 'export KUBECONFIG=/var/jenkins_home/.kube/config; kubectl apply -f /tmp/zap-target.yaml && kubectl -n pfe-devsecops rollout status deploy/projet-validation-vermeg --timeout=180s && kubectl -n pfe-devsecops get svc projet-validation-vermeg'"
echo "OK : ZAP peut atteindre http://projet-validation-vermeg:8080 depuis le cluster."
