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
  3. Le backend ne choisit JAMAIS containerName/image/cpu/memory/ports/RG —
     il envoie uniquement une clé `project` (ex: "devsecops-testbed") qui DOIT
     correspondre exactement à une entrée de PROJECTS ci-dessous. Tous les
     paramètres de déploiement viennent de CE dict fixe, jamais du corps de
     la requête. Le seul champ variable accepté est `imageTag`, validé par
     une regex stricte (charset des tags Docker) AVANT tout usage. Aucune
     commande shell n'est construite par concaténation de texte : tout appel
     touchant une valeur externe passe par subprocess avec une LISTE
     d'arguments (shell=False) — même une valeur qui passerait la regex par
     erreur ne pourrait pas être interprétée comme un séparateur de commande
     shell (;, &&, |, `, $()...), elle serait juste un argv invalide pour az.
  4. resourceGroup résolu (via PROJECTS, jamais fourni par l'appelant) doit
     être rg-pfe-devsecops — vérifié quand même explicitement, en profondeur.
  5. Session az invalide/expirée (`az account show` échoue) → erreur claire
     AZURE_SESSION_EXPIRED, jamais un crash, jamais une tentative de déploiement.

Lié UNIQUEMENT à 172.19.0.1 (gateway du bridge Docker "pfe-network"), jamais
à 0.0.0.0 — seuls les conteneurs de ce réseau peuvent l'atteindre, pas le LAN
(vérifié : 127.0.0.1:7799 refuse la connexion, seule 172.19.0.1:7799 écoute).
"""
import hmac
import json
import os
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

BIND_HOST = "172.19.0.1"
BIND_PORT = 7799

ALLOWED_RESOURCE_GROUP = "rg-pfe-devsecops"
ALLOWED_ACR = "acrpfedevsecops"

# ─────────────────────────────────────────────────────────────────────────
# REGISTRE FIXE DES PROJETS DÉPLOYABLES — la SEULE source des paramètres de
# déploiement. Ajouter un projet = ajouter une entrée ici (côté agent), pas
# un champ que le backend pourrait fournir librement.
# ─────────────────────────────────────────────────────────────────────────
PROJECTS = {
    "devsecops-testbed": {
        "resourceGroup": ALLOWED_RESOURCE_GROUP,
        "containerName": "aci-devsecops-testbed",
        "acrRepository": "devsecops-testbed",
        "cpu": "1",
        "memoryInGb": "1",
        "ports": ["8080"],
    },
}

# Charset des tags Docker : [A-Za-z0-9_][A-Za-z0-9._-]{0,127} — rejette tout
# séparateur shell (;, &, |, $, `, espace, retour à la ligne...).
IMAGE_TAG_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$")

AGENT_SECRET = os.environ.get("AZURE_DEPLOY_AGENT_SECRET")
if not AGENT_SECRET:
    raise SystemExit(
        "AZURE_DEPLOY_AGENT_SECRET absent — l'agent refuse de démarrer "
        "(fail-closed, même principe que N8N_CALLBACK_SECRET côté backend)."
    )


def run_fixed(cmd, timeout=120):
    """Commande ENTIÈREMENT constante (aucune donnée externe) — seul cas où
    shell=True est acceptable, car il n'y a rien à injecter."""
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, p.stdout.strip(), p.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", f"timeout après {timeout}s"


def run_argv(args, timeout=120):
    """Commande avec des valeurs externes (tag d'image, credentials...) —
    TOUJOURS une liste d'arguments, JAMAIS shell=True. Sans shell, un ';' ou
    un '&&' dans une valeur reste un caractère littéral du champ, jamais un
    séparateur de commande — l'injection shell est structurellement
    impossible ici, indépendamment de la qualité de la validation en amont."""
    try:
        p = subprocess.run(args, shell=False, capture_output=True, text=True, timeout=timeout)
        return p.returncode == 0, p.stdout.strip(), p.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "", f"timeout après {timeout}s"
    except FileNotFoundError as e:
        return False, "", str(e)


def check_azure_session():
    """Garde-fou session — jamais contourné, jamais mis en cache."""
    ok, out, err = run_fixed("az account show -o json", timeout=15)
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
        if self.path == "/projects":
            if not self._authorized():
                return self._send(403, {"error": "UNAUTHORIZED"})
            # Expose la liste des clés déployables — jamais les valeurs
            # brutes utiles à un attaquant (noms exacts non secrets de toute
            # façon, mais principe de minimalité).
            return self._send(200, {"projects": list(PROJECTS.keys())})
        return self._send(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        if self.path != "/deploy":
            return self._send(404, {"error": "NOT_FOUND"})

        if not self._authorized():
            return self._send(403, {"error": "UNAUTHORIZED"})

        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "INVALID_JSON"})

        # ── Le backend ne fournit QUE ces deux champs. Tout le reste vient
        # exclusivement de PROJECTS (registre fixe côté agent). ────────────
        project_key = body.get("project")
        image_tag = body.get("imageTag")

        project = PROJECTS.get(project_key)
        if not project:
            return self._send(400, {
                "error": "UNKNOWN_PROJECT",
                "message": f"Projet '{project_key}' non déclaré dans le registre fixe de l'agent.",
                "available": list(PROJECTS.keys()),
            })

        if not image_tag or not IMAGE_TAG_RE.match(image_tag):
            return self._send(400, {
                "error": "INVALID_IMAGE_TAG",
                "message": "imageTag requis, charset restreint (lettres/chiffres/._-), pas de séparateur shell.",
            })

        resource_group = project["resourceGroup"]
        if resource_group != ALLOWED_RESOURCE_GROUP:
            # Ne devrait jamais arriver (PROJECTS est fixe et codé en dur),
            # mais vérifié quand même explicitement — défense en profondeur,
            # jamais une confiance aveugle même dans notre propre config.
            return self._send(500, {"error": "PROJECT_MISCONFIGURED", "message": "resourceGroup interne invalide."})

        container_name = project["containerName"]
        acr_repository = project["acrRepository"]
        cpu = project["cpu"]
        memory = project["memoryInGb"]
        ports = project["ports"]

        # ── Garde-fou session : vérifié à CHAQUE déploiement, jamais mis en
        # cache d'un appel précédent (une session peut expirer entre deux). ──
        valid, info = check_azure_session()
        if not valid:
            return self._send(409, {"success": False, **info})

        steps = []

        ok, out, err = run_fixed(f"az acr login --name {ALLOWED_ACR}")
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
        ok, out, err = run_fixed(f"az acr credential show -n {ALLOWED_ACR} -o json")
        steps.append({"step": "acr_credential_show", "ok": ok, "detail": "ok" if ok else err[:300]})
        if not ok:
            return self._send(500, {"success": False, "error": "ACR_CREDENTIAL_FETCH_FAILED", "steps": steps})
        cred = json.loads(out)
        registry_username = cred["username"]
        registry_password = cred["passwords"][0]["value"]

        # ── Seule ligne de toute la fonction qui contient une valeur fournie
        # par le backend (image_tag) : liste d'arguments, shell=False. ─────
        full_image = f"{ALLOWED_ACR}.azurecr.io/{acr_repository}:{image_tag}"
        create_args = [
            "az", "container", "create",
            "-g", resource_group,
            "-n", container_name,
            "--image", full_image,
            "--cpu", cpu,
            "--memory", memory,
            "--ports", *ports,
            "--os-type", "Linux",
            "--restart-policy", "Never",
            "--registry-username", registry_username,
            "--registry-password", registry_password,
            "-o", "json",
        ]
        ok, out, err = run_argv(create_args, timeout=180)
        steps.append({"step": "container_create", "ok": ok, "detail": (out if ok else err)[:500]})
        if not ok:
            return self._send(500, {"success": False, "error": "CONTAINER_CREATE_FAILED", "steps": steps})

        # ── Poll jusqu'à Running (ou échec explicite), jamais un sleep fixe aveugle ──
        state = None
        restart_count = None
        for _ in range(24):  # ~2 min max (24 x 5s)
            ok, out, err = run_fixed(f"az container show -g {resource_group} -n {container_name} -o json", timeout=15)
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
            # Entièrement fixe (aucune donnée externe) → run_fixed est sûr ici.
            #
            # "Running" (état ACI) != application prête : le process du
            # conteneur a démarré mais Spring Boot met quelques secondes de
            # plus à ouvrir le port (~9s mesurés). Retry court plutôt qu'un
            # seul essai qui peut faussement rapporter "unhealthy".
            for attempt in range(6):  # jusqu'à 30s (6 x 5s)
                ok, out, err = run_fixed(
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
            "project": project_key,
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
    print(f"[azure-deploy-agent] listening on {BIND_HOST}:{BIND_PORT} (projects={list(PROJECTS.keys())})")
    server.serve_forever()
