#!/usr/bin/env python3
"""
Azure Deploy Agent — service hôte natif (PAS un conteneur).

Rôle : seul processus autorisé à toucher à ~/.azure. Le backend (conteneur
Docker) ne détient jamais de credential Azure — il appelle cet agent via
HTTP avec un secret partagé, exactement comme n8n -> backend utilise
N8N_CALLBACK_SECRET (voir backend/src/jenkins-optimizer/jenkins-optimizer.module.ts).

Garde-fous appliqués, dans cet ordre, à chaque requête :
  1. Secret partagé absent côté agent → fail-closed au démarrage (le process
     refuse même de démarrer, comme N8N_CALLBACK_SECRET côté backend).
  2. Secret fourni par l'appelant invalide/absent → 403, rien d'autre exécuté.
  3. resourceGroup demandé != rg-pfe-devsecops → 400, rejeté. Ce garde-fou
     applicatif restaure une partie du "moindre privilège" perdu en utilisant
     une session personnelle Owner-sur-toute-la-subscription : l'agent, LUI,
     refuse d'agir hors de ce RG, même si le compte sous-jacent le permettrait.
  4. Session az invalide/expirée (`az account show` échoue) → erreur claire
     AZURE_SESSION_EXPIRED, jamais un crash, jamais une tentative de déploiement.

Lié UNIQUEMENT à 172.19.0.1 (gateway du bridge Docker "pfe-network"), jamais
à 0.0.0.0 — seuls les conteneurs de ce réseau peuvent l'atteindre, pas le LAN.
"""
import hmac
import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

BIND_HOST = "172.19.0.1"
BIND_PORT = 7799

ALLOWED_RESOURCE_GROUP = "rg-pfe-devsecops"
ALLOWED_ACR = "acrpfedevsecops"

AGENT_SECRET = os.environ.get("AZURE_DEPLOY_AGENT_SECRET")
if not AGENT_SECRET:
    raise SystemExit(
        "AZURE_DEPLOY_AGENT_SECRET absent — l'agent refuse de démarrer "
        "(fail-closed, même principe que N8N_CALLBACK_SECRET côté backend)."
    )


def run(cmd, timeout=120):
    """Exécute une commande shell, retourne (ok, stdout, stderr)."""
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, p.stdout.strip(), p.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", f"timeout après {timeout}s"


def check_azure_session():
    """Garde-fou session — jamais contourné, jamais mis en cache."""
    ok, out, err = run("az account show -o json", timeout=15)
    if not ok:
        return False, {
            "error": "AZURE_SESSION_EXPIRED",
            "message": "Session Azure expirée ou absente sur l'hôte — exécuter "
                       "`az login` dans le terminal WSL, puis réessayer.",
            "detail": err[:500],
        }
    try:
        account = json.loads(out)
    except json.JSONDecodeError:
        return False, {"error": "AZURE_SESSION_EXPIRED", "message": "Réponse az account show illisible."}
    return True, account


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        provided = self.headers.get("X-Agent-Secret", "")
        return hmac.compare_digest(provided, AGENT_SECRET)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return None

    def do_GET(self):
        if self.path == "/session-status":
            if not self._authorized():
                return self._send(403, {"error": "UNAUTHORIZED"})
            valid, info = check_azure_session()
            if not valid:
                return self._send(409, {"valid": False, **info})
            return self._send(200, {
                "valid": True,
                "user": info.get("user", {}).get("name"),
                "subscriptionId": info.get("id"),
                "subscriptionName": info.get("name"),
            })
        return self._send(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        if self.path != "/deploy":
            return self._send(404, {"error": "NOT_FOUND"})

        if not self._authorized():
            return self._send(403, {"error": "UNAUTHORIZED"})

        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "INVALID_JSON"})

        resource_group = body.get("resourceGroup")
        if resource_group != ALLOWED_RESOURCE_GROUP:
            return self._send(400, {
                "error": "RESOURCE_GROUP_NOT_ALLOWED",
                "message": f"Cet agent n'agit que sur {ALLOWED_RESOURCE_GROUP}.",
            })

        container_name = body.get("containerName")
        image = body.get("image")  # ex: devsecops-testbed:fixed-base-1.0.0 (repo:tag dans l'ACR)
        cpu = body.get("cpu", 1)
        memory = body.get("memoryInGb", 1)
        ports = body.get("ports", [8080])
        if not container_name or not image:
            return self._send(400, {"error": "MISSING_PARAMS", "message": "containerName et image sont requis."})

        # ── Garde-fou session : vérifié à CHAQUE déploiement, jamais mis en
        # cache d'un appel précédent (une session peut expirer entre deux). ──
        valid, info = check_azure_session()
        if not valid:
            return self._send(409, {"success": False, **info})

        steps = []

        ok, out, err = run(f"az acr login --name {ALLOWED_ACR}")
        steps.append({"step": "acr_login", "ok": ok, "detail": (out or err)[:300]})
        if not ok:
            return self._send(500, {"success": False, "error": "ACR_LOGIN_FAILED", "steps": steps})

        # ACI pull l'image lui-même (identité de service ACI, pas la session
        # CLI locale) — az acr login ne suffit pas, il faut lui donner des
        # credentials explicites. Admin user déjà activé sur cet ACR ; les
        # identifiants ne sont jamais loggés (detail tronqué au step name).
        # DETTE : passés en argument CLI à az container create ci-dessous,
        # donc visibles transitoirement dans `ps aux` sur l'hôte pendant
        # l'exécution — acceptable ici (machine mono-utilisateur, credential
        # scopé à cet ACR, pas le token Owner), à durcir si la machine devient
        # partagée (ex: variable d'env lue par un wrapper au lieu d'un argv).
        ok, out, err = run(f"az acr credential show -n {ALLOWED_ACR} -o json")
        steps.append({"step": "acr_credential_show", "ok": ok, "detail": "ok" if ok else err[:300]})
        if not ok:
            return self._send(500, {"success": False, "error": "ACR_CREDENTIAL_FETCH_FAILED", "steps": steps})
        cred = json.loads(out)
        registry_username = cred["username"]
        registry_password = cred["passwords"][0]["value"]

        full_image = f"{ALLOWED_ACR}.azurecr.io/{image}"
        ports_arg = " ".join(str(p) for p in ports)
        create_cmd = (
            f"az container create -g {resource_group} -n {container_name} "
            f"--image {full_image} --cpu {cpu} --memory {memory} "
            f"--ports {ports_arg} --os-type Linux --restart-policy Never "
            f"--registry-username {registry_username} --registry-password {registry_password} "
            f"-o json"
        )
        ok, out, err = run(create_cmd, timeout=180)
        steps.append({"step": "container_create", "ok": ok, "detail": (out if ok else err)[:500]})
        if not ok:
            return self._send(500, {"success": False, "error": "CONTAINER_CREATE_FAILED", "steps": steps})

        # ── Poll jusqu'à Running (ou échec explicite), jamais un sleep fixe aveugle ──
        state = None
        restart_count = None
        for _ in range(24):  # ~2 min max (24 x 5s)
            ok, out, err = run(f"az container show -g {resource_group} -n {container_name} -o json", timeout=15)
            if ok:
                data = json.loads(out)
                state = data.get("instanceView", {}).get("state")
                restart_count = data.get("containers", [{}])[0].get("instanceView", {}).get("restartCount")
                if state in ("Running", "Terminated", "Failed"):
                    break
            time.sleep(5)
        steps.append({"step": "poll_state", "ok": state == "Running", "state": state, "restartCount": restart_count})

        health = None
        health_ok = False
        if state == "Running":
            # az container exec ne fournit pas un vrai shell — un argument
            # avec guillemets imbriqués (/bin/sh -c "...") se fait tronçonner
            # en tokens séparés côté ACI plutôt qu'interprété. Une commande
            # simple, sans quoting interne, fonctionne (vérifié en direct).
            #
            # "Running" (état ACI) != application prête : le process du
            # conteneur a démarré mais Spring Boot met quelques secondes de
            # plus à ouvrir le port (~9s mesurés). Retry court plutôt qu'un
            # seul essai qui peut faussement rapporter "unhealthy".
            for attempt in range(6):  # jusqu'à 30s (6 x 5s)
                ok, out, err = run(
                    f"az container exec -g {resource_group} -n {container_name} "
                    f'--exec-command "curl -s http://localhost:8080/api/health"',
                    timeout=15,
                )
                health = (out or err)[:300]
                if ok and '"UP"' in (out or ''):
                    health_ok = True
                    break
                time.sleep(5)
            steps.append({"step": "health_check", "ok": health_ok, "detail": health, "attempts": attempt + 1})

        return self._send(200, {
            "success": state == "Running",
            "healthOk": health_ok,
            "containerName": container_name,
            "state": state,
            "restartCount": restart_count,
            "health": health,
            "steps": steps,
        })

    def log_message(self, fmt, *args):
        print(f"[azure-deploy-agent] {self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    server = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    print(f"[azure-deploy-agent] listening on {BIND_HOST}:{BIND_PORT} (RG={ALLOWED_RESOURCE_GROUP}, ACR={ALLOWED_ACR})")
    server.serve_forever()
