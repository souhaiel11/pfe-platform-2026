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
  3. Le backend résout la configuration non sensible depuis le Project. L'agent
     la valide contre ses allow-lists d'environnement avant tout usage. Aucune
     commande shell n'est construite par concaténation de texte : tout appel
     touchant une valeur externe passe par subprocess avec une LISTE
     d'arguments (shell=False) — même une valeur qui passerait la regex par
     erreur ne pourrait pas être interprétée comme un séparateur de commande
     shell (;, &&, |, `, $()...), elle serait juste un argv invalide pour az.
  4. resourceGroup et registry doivent appartenir aux allow-lists de l'agent.
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

ALLOWED_RESOURCE_GROUPS = {x.strip() for x in os.environ.get("AZURE_ALLOWED_RESOURCE_GROUPS", "").split(",") if x.strip()}
ALLOWED_ACRS = {x.strip() for x in os.environ.get("AZURE_ALLOWED_ACRS", "").split(",") if x.strip()}

# ─────────────────────────────────────────────────────────────────────────
# Les allow-lists sont opérationnelles et non sensibles. Une cible projet ne
# peut jamais sortir de ces périmètres, même avec un body forgé.
# ─────────────────────────────────────────────────────────────────────────
# Charset des tags Docker : [A-Za-z0-9_][A-Za-z0-9._-]{0,127} — rejette tout
# séparateur shell (;, &, |, $, `, espace, retour à la ligne...).
IMAGE_TAG_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$")
AZURE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$")
REPOSITORY_RE = re.compile(r"^[a-z0-9][a-z0-9._/-]{0,254}$")
# Phase 2A.6 — digest charset for /inspect-artifact's optional `digest`
# input (same algorithm the backend's own DIGEST_RE enforces).
DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")


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
    # `az account show` ne prouve que la présence du cache local. Forcer
    # l'obtention d'un token ARM détecte notamment une MFA expirée avant que
    # l'utilisateur confirme un déploiement.
    arm_ok, _, arm_err = run_argv([
        "az", "account", "get-access-token",
        "--resource", "https://management.azure.com/",
        "--query", "expiresOn", "-o", "tsv",
    ], timeout=20)
    if not arm_ok:
        return False, {
            "error": "AZURE_SESSION_EXPIRED",
            "message": "Session Azure ARM expirée — exécuter `az login` avant E1.",
            "detail": arm_err[:500],
        }
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
            return self._send(200, {"mode": "per-project-config", "configured": bool(ALLOWED_RESOURCE_GROUPS and ALLOWED_ACRS)})
        return self._send(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        # ── Phase 2A — Strong Deployment Identity. Read-only digest lookup
        # (`az acr repository show`), never a deploy: given a registry/
        # repository/tag, resolves the immutable digest that tag currently
        # points to, so the backend can prove artifact provenance instead
        # of trusting a free-text tag (see deployment-identity.ts's
        # evaluateArtifactIdentity). Own branch, own body shape — kept
        # separate from /deploy's below so this never touches the
        # container-create path or its target/resource-group validation.
        if self.path == "/resolve-digest":
            if not self._authorized():
                return self._send(403, {"error": "UNAUTHORIZED"})
            digest_body = self._read_json_body()
            if digest_body is None:
                return self._send(400, {"error": "INVALID_JSON"})
            digest_registry = digest_body.get("registry")
            digest_repository = digest_body.get("repository")
            digest_tag = digest_body.get("tag")
            if not ALLOWED_ACRS or digest_registry not in ALLOWED_ACRS:
                return self._send(403, {"error": "REGISTRY_NOT_ALLOWED"})
            if not digest_repository or not REPOSITORY_RE.match(digest_repository):
                return self._send(400, {"error": "INVALID_IMAGE_REPOSITORY"})
            if not digest_tag or not IMAGE_TAG_RE.match(digest_tag):
                return self._send(400, {"error": "INVALID_IMAGE_TAG"})
            valid, info = check_azure_session()
            if not valid:
                return self._send(409, {"found": False, **info})
            # Read-only attribute lookup -- no credential fetch, no
            # container create. A missing tag/repo is a normal "not found"
            # (200, found:false), never a 500: the caller (backend) treats
            # found:false as DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE,
            # fail-closed either way.
            ok, out, err = run_argv([
                "az", "acr", "repository", "show",
                "-n", digest_registry, "--image", f"{digest_repository}:{digest_tag}",
                "-o", "json",
            ], timeout=20)
            if not ok:
                return self._send(200, {"found": False, "registry": digest_registry, "repository": digest_repository, "tag": digest_tag, "detail": err[:300]})
            try:
                attrs = json.loads(out)
            except json.JSONDecodeError:
                return self._send(200, {"found": False, "registry": digest_registry, "repository": digest_repository, "tag": digest_tag})
            digest = attrs.get("digest")
            return self._send(200, {
                "found": bool(digest), "registry": digest_registry, "repository": digest_repository,
                "tag": digest_tag, "digest": digest,
            })

        # ── Phase 2A.6 — read-only OCI config inspection. Given a registry/
        # repository + EITHER a tag OR a digest, resolves the digest (if a
        # tag was given) and returns the image's OCI config labels —
        # notably org.opencontainers.image.revision, the ONLY thing that
        # can turn a DeploymentArtifact into provenanceVerified=true (see
        # deployment-artifact.service.ts). Uses `docker buildx imagetools
        # inspect`, which fetches ONLY the manifest + small config blob —
        # verified interactively (2026-10-05) to add 0 bytes to local
        # image storage, never a layer pull. Same security boundaries as
        # /resolve-digest: shared secret, registry allow-list, repository/
        # tag/digest charset validation, argv-only subprocess, no
        # shell=True, no caller-controlled arbitrary CLI arguments — the
        # only variable parts (registry/repository/tag/digest) are each
        # validated BEFORE being placed into a fixed argv list.
        if self.path == "/inspect-artifact":
            if not self._authorized():
                return self._send(403, {"error": "UNAUTHORIZED"})
            inspect_body = self._read_json_body()
            if inspect_body is None:
                return self._send(400, {"error": "INVALID_JSON"})
            insp_registry = inspect_body.get("registry")
            insp_repository = inspect_body.get("repository")
            insp_tag = inspect_body.get("tag")
            insp_digest = inspect_body.get("digest")
            if not ALLOWED_ACRS or insp_registry not in ALLOWED_ACRS:
                return self._send(403, {"error": "REGISTRY_NOT_ALLOWED"})
            if not insp_repository or not REPOSITORY_RE.match(insp_repository):
                return self._send(400, {"error": "INVALID_IMAGE_REPOSITORY"})
            if bool(insp_tag) == bool(insp_digest):
                return self._send(400, {"error": "EXACTLY_ONE_OF_TAG_OR_DIGEST_REQUIRED"})
            if insp_tag and not IMAGE_TAG_RE.match(insp_tag):
                return self._send(400, {"error": "INVALID_IMAGE_TAG"})
            if insp_digest and not DIGEST_RE.match(insp_digest):
                return self._send(400, {"error": "INVALID_DIGEST"})

            valid, info = check_azure_session()
            if not valid:
                return self._send(409, {"found": False, **info})

            # Resolve the digest first (if only a tag was given) via the
            # SAME read-only command /resolve-digest uses — never assume
            # the caller's tag->digest claim.
            resolved_digest = insp_digest
            if insp_tag:
                ok, out, err = run_argv([
                    "az", "acr", "repository", "show",
                    "-n", insp_registry, "--image", f"{insp_repository}:{insp_tag}",
                    "-o", "json",
                ], timeout=20)
                if not ok:
                    return self._send(200, {"found": False, "registry": insp_registry, "repository": insp_repository, "tag": insp_tag, "detail": err[:300]})
                try:
                    attrs = json.loads(out)
                except json.JSONDecodeError:
                    return self._send(200, {"found": False, "registry": insp_registry, "repository": insp_repository, "tag": insp_tag})
                resolved_digest = attrs.get("digest")
                if not resolved_digest:
                    return self._send(200, {"found": False, "registry": insp_registry, "repository": insp_repository, "tag": insp_tag})

            # `az acr login` configures docker's credential helper for this
            # registry via the current az session — read-only, no
            # credential is ever placed in an argv list or logged.
            ok, _, err = run_argv(["az", "acr", "login", "--name", insp_registry], timeout=30)
            if not ok:
                return self._send(502, {"found": False, "error": "ACR_LOGIN_FAILED", "detail": err[:300]})

            image_ref = f"{insp_registry}.azurecr.io/{insp_repository}@{resolved_digest}"
            ok, out, err = run_argv([
                "docker", "buildx", "imagetools", "inspect", image_ref,
                "--format", "{{json .Image.Config.Labels}}",
            ], timeout=30)
            if not ok:
                return self._send(200, {"found": False, "registry": insp_registry, "repository": insp_repository, "digest": resolved_digest, "detail": err[:300]})
            try:
                labels = json.loads(out) if out.strip() else {}
            except json.JSONDecodeError:
                labels = {}
            if not isinstance(labels, dict):
                labels = {}
            return self._send(200, {
                "found": True, "registry": insp_registry, "repository": insp_repository,
                "digest": resolved_digest,
                "revision": labels.get("org.opencontainers.image.revision"),
                "source": labels.get("org.opencontainers.image.source"),
                "created": labels.get("org.opencontainers.image.created"),
                "labels": labels,
            })

        if self.path not in {"/deploy", "/validate-target"}:
            return self._send(404, {"error": "NOT_FOUND"})

        if not self._authorized():
            return self._send(403, {"error": "UNAUTHORIZED"})

        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "INVALID_JSON"})

        # ── Le backend ne fournit QUE ces champs. Tout le reste vient
        # exclusivement de PROJECTS (registre fixe côté agent). ────────────
        project_id = body.get("projectId")
        request_id = body.get("requestId")
        image_tag = body.get("imageTag")
        # Phase 2B.2.1 §9-13 — digest-pinned dispatch. When present, THIS
        # is what selects deployment content -- imageTag becomes display/
        # audit metadata only (§13's own invariant: a tag moving after
        # authorization can never change what gets deployed). Absent,
        # behavior is byte-identical to before this phase (tag-based,
        # legacy-compatible).
        artifact_digest = body.get("artifactDigest")
        target = body.get("target") or {}

        if artifact_digest is not None and not DIGEST_RE.match(artifact_digest):
            return self._send(400, {
                "error": "INVALID_ARTIFACT_DIGEST",
                "message": "artifactDigest doit être sha256:<64 hex>.",
            })
        if not image_tag or not IMAGE_TAG_RE.match(image_tag):
            return self._send(400, {
                "error": "INVALID_IMAGE_TAG",
                "message": "imageTag requis, charset restreint (lettres/chiffres/._-), pas de séparateur shell.",
            })

        resource_group = target.get("resourceGroup")
        registry = target.get("registry")
        container_name = target.get("targetName")
        acr_repository = target.get("imageRepository")
        cpu = str(target.get("cpu") or "1")
        memory = str(target.get("memoryInGb") or "1")
        ports = [str(p) for p in (target.get("ports") or ["8080"])]
        if target.get("provider") != "azure-container-instances":
            return self._send(400, {"error": "UNSUPPORTED_PROVIDER"})
        if not ALLOWED_RESOURCE_GROUPS or resource_group not in ALLOWED_RESOURCE_GROUPS:
            return self._send(403, {"error": "RESOURCE_GROUP_NOT_ALLOWED"})
        if not ALLOWED_ACRS or registry not in ALLOWED_ACRS:
            return self._send(403, {"error": "REGISTRY_NOT_ALLOWED"})
        if not container_name or not AZURE_NAME_RE.match(container_name):
            return self._send(400, {"error": "INVALID_TARGET_NAME"})
        if not acr_repository or not REPOSITORY_RE.match(acr_repository):
            return self._send(400, {"error": "INVALID_IMAGE_REPOSITORY"})
        if cpu not in {"0.5", "1", "2", "4"} or memory not in {"0.5", "1", "1.5", "2", "3", "4", "8"}:
            return self._send(400, {"error": "INVALID_COMPUTE_LIMIT"})
        if not ports or any(not p.isdigit() or not 1 <= int(p) <= 65535 for p in ports):
            return self._send(400, {"error": "INVALID_PORTS"})

        # Même validation que /deploy, avec arrêt garanti avant toute
        # commande Azure : utilisé par le préflight et les tests UI/backend.
        if self.path == "/validate-target":
            return self._send(200, {
                "valid": True,
                "projectId": project_id,
                "requestId": request_id,
                "provider": target.get("provider"),
                "resourceGroupAllowed": True,
                "registryAllowed": True,
                "targetName": container_name,
            })

        # ── Garde-fou session : vérifié à CHAQUE déploiement, jamais mis en
        # cache d'un appel précédent (une session peut expirer entre deux). ──
        valid, info = check_azure_session()
        if not valid:
            return self._send(409, {"success": False, **info})

        steps = []

        ok, out, err = run_argv(["az", "acr", "login", "--name", registry])
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
        ok, out, err = run_argv(["az", "acr", "credential", "show", "-n", registry, "-o", "json"])
        steps.append({"step": "acr_credential_show", "ok": ok, "detail": "ok" if ok else err[:300]})
        if not ok:
            return self._send(500, {"success": False, "error": "ACR_CREDENTIAL_FETCH_FAILED", "steps": steps})
        cred = json.loads(out)
        registry_username = cred["username"]
        registry_password = cred["passwords"][0]["value"]

        # ── Les seules valeurs fournies par le backend utilisées ici
        # (image_tag et/ou artifact_digest) ne sont JAMAIS une référence
        # d'image complète acceptée telle quelle (§9/§11) -- chacune est
        # déjà validée par un charset strict ci-dessus (DIGEST_RE/IMAGE_TAG_RE),
        # et c'est TOUJOURS cette fonction qui construit la référence,
        # jamais une chaîne arbitraire fournie par l'appelant. Liste
        # d'arguments, shell=False, comme tout le reste de ce fichier. ─────
        if artifact_digest:
            full_image = f"{registry}.azurecr.io/{acr_repository}@{artifact_digest}"
        else:
            full_image = f"{registry}.azurecr.io/{acr_repository}:{image_tag}"
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
            ok, out, err = run_argv(["az", "container", "show", "-g", resource_group, "-n", container_name, "-o", "json"], timeout=15)
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
                ok, out, err = run_argv([
                    "az", "container", "exec", "-g", resource_group, "-n", container_name,
                    "--exec-command", "curl -s http://localhost:8080/api/health",
                ], timeout=15)
                health = (out or err)[:300]
                if ok and '"UP"' in (out or ''):
                    health_ok = True
                    break
                time.sleep(5)
            steps.append({"step": "health_check", "ok": health_ok, "detail": health, "attempts": attempt + 1})

        return self._send(200, {
            "success": state == "Running",
            "healthOk": health_ok,
            "projectId": project_id,
            "requestId": request_id,
            "containerName": container_name,
            "state": state,
            "restartCount": restart_count,
            "health": health,
            "steps": steps,
            # §12 — echoed back so the caller can assert
            # authorization.artifactDigest == this value without guessing
            # which dispatch form was actually used.
            "imageReference": full_image,
            "artifactDigest": artifact_digest,
        })

    def log_message(self, fmt, *args):
        print(f"[azure-deploy-agent] {self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    server = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    print(f"[azure-deploy-agent] listening on {BIND_HOST}:{BIND_PORT} (per-project targets)")
    server.serve_forever()
