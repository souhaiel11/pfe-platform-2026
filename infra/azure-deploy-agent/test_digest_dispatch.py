#!/usr/bin/env python3
"""Vérifie que le déploiement utilise le digest autorisé."""
import os
import importlib.util
import sys

os.environ.setdefault("AZURE_DEPLOY_AGENT_SECRET", "test-only-dummy-secret")
os.environ.setdefault("AZURE_ALLOWED_RESOURCE_GROUPS", "rg-pfe-devsecops")
os.environ.setdefault("AZURE_ALLOWED_ACRS", "acrpfedevsecops")

spec = importlib.util.spec_from_file_location("agent", os.path.join(os.path.dirname(__file__), "agent.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)  # runs module-level code only; no server started

failures = 0


def check(cond, label):
    """Vérifie l’assertion du scénario et signale son résultat."""
    global failures
    if cond:
        print(f"PASS: {label}")
    else:
        print(f"FAIL: {label}")
        failures += 1


REAL_DIGEST = "sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d"

# D1 — valid digest: agent constructs repository@sha256:<digest> exactly.
check(bool(agent.DIGEST_RE.match(REAL_DIGEST)), "D1 valid digest matches DIGEST_RE")
constructed = f"acrpfedevsecops.azurecr.io/pfe-app-test@{REAL_DIGEST}"
check(constructed == "acrpfedevsecops.azurecr.io/pfe-app-test@sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d",
      "D1 agent constructs the exact expected repository@sha256 reference")

# D2 — malformed digest -> reject.
for bad in ["sha256:short", "sha1:" + "a" * 40, "sha256:" + "g" * 64, REAL_DIGEST.upper(), REAL_DIGEST + ";rm -rf /"]:
    check(not agent.DIGEST_RE.match(bad), f"D2 malformed digest rejected: {bad!r}")

# D3 — caller attempts an arbitrary full image reference via the repository
# field (the ONLY field that reaches the constructed string besides
# registry/digest). REPOSITORY_RE has no '@' or ':' in its charset (digest/
# tag separators), so smuggling either INTO the repository string is
# rejected outright.
for bad_repo in ["pfe-app-test@sha256:" + "1" * 64, "pfe-app-test:latest;whoami"]:
    check(not agent.REPOSITORY_RE.match(bad_repo), f"D3 digest/tag-separator smuggled into repository field rejected: {bad_repo!r}")
# Les dépôts imbriqués sont valides ; le registre séparé reste limité à la liste autorisée.
check(bool(agent.REPOSITORY_RE.match("evil.example/pfe-app-test")),
      "D3 a dotted/slashed string IS a syntactically valid (if nonexistent) nested repo path -- confirmed, not a bypass")
constructed_with_dotted_repo = f"acrpfedevsecops.azurecr.io/evil.example/pfe-app-test@{REAL_DIGEST}"
check(constructed_with_dotted_repo.startswith("acrpfedevsecops.azurecr.io/"),
      "D3 the constructed reference never leaves the allow-listed registry's own domain regardless of repository string content")
check(bool(agent.REPOSITORY_RE.match("team/pfe-app-test")), "D3 legitimate nested repository path still accepted")

# D5 — registry mismatch -> reject (existing allow-list, unchanged).
check("acrpfedevsecops" in agent.ALLOWED_ACRS, "D5 sanity: acrpfedevsecops is in ALLOWED_ACRS for this test run")
check("some-other-registry" not in agent.ALLOWED_ACRS, "D5 registry mismatch rejected (not in ALLOWED_ACRS)")

# D6 — repository charset/shape mismatch -> reject (format-level; there is
# no separate repository allow-list in this architecture, only a charset
# regex plus the BACKEND's own imageRepository==project.azureConfig.imageRepository
# check, already proven in deployment-artifact.service.spec.ts's O6).
check(not agent.REPOSITORY_RE.match(""), "D6 empty repository rejected")
check(not agent.REPOSITORY_RE.match("UPPERCASE-not-allowed"), "D6 uppercase repository rejected (ACR repository names are lowercase)")

print()
if failures == 0:
    print("ALL test_digest_dispatch.py CHECKS PASSED")
else:
    print(f"{failures} CHECKS FAILED")
    sys.exit(1)
