# DEMONSTRATION READINESS — 2026-10-07

## Current posture

| Fact | Value | Source |
|---|---|---|
| Automatic dispatch | **OFF** (`SECURITY_REMEDIATION_DISPATCH_ENABLED=false`) | running container env |
| E2E retry harness | **OFF** | running container env |
| Deployment authorization | **required** (`DEPLOYMENT_AUTHORIZATION_REQUIRED=true`) | running container env |
| Integration fixtures | flag `true` but **neutralised** by `NODE_ENV=production` | `integration-fixtures.service.ts:24-26` |
| Active n8n workflows | 7 of 24 (WF1, WF2, WF3, WF4-Jenkinsfile, WF5, WF6, WF-Chat) | live n8n API |
| Last successful WF6 run | **2026-10-07 15:03** (twice, webhook, success) | n8n executions |
| Last successful WF2 run | 2026-10-04 21:02 — **before** the current backend was deployed | n8n executions |
| Live data | 5 projects, 248 incidents, 776 remediation tasks | Postgres |
| ZAP | all containers exited | `docker ps -a` |

## What will fail if demonstrated as-is

| Risk | Severity | Why | Avoid / mitigate |
|---|---|---|---|
| **WF2 "AI Fix" on an incident** | **BLOCKING** | First HTTP node 404s (AUD-001) | Do not demo WF2 until the backend is rebuilt from the reconciled tree |
| **"Cancel remediation" button** | **BLOCKING if clicked** | `POST …/cancel` → 404 (AUD-017) | Fixed by the same rebuild; otherwise do not open a cancellable incident |
| Launching a real remediation | HIGH | Dispatch is frozen → `503 SECURITY_REMEDIATION_TEMPORARILY_DISABLED` | Present it as a deliberate safety freeze and show the recorded evidence instead |
| ZAP findings page | MEDIUM | ZAP is not running; findings are historical | Frame as historical DAST evidence |
| "Why is this VERIFIED when the scanner is UNAVAILABLE?" | MEDIUM | 3 such rows exist | Answer ready: `verifiedBuild` (120/15/15) **>** `lastSeenBuild` (112/14/14) with a `verifiedAt` timestamp — verification is build-evidence-based; `scannerStatus` reports *current* scanner availability, not the verification |
| "Is CLOSED the same as corrected?" | LOW | Label says "Corrigée" (AUD-026) | Answer ready: only `CANDIDATE_READY` produces a proposal badge; historical `CLOSED` is never one |
| Two identically named WF2 workflows in n8n | LOW | Operator confusion on screen (AUD-022) | Open workflows by ID, not by name |
| Disk / dangling images | LOW | 150 dangling images, 2.2 GB tree | `docker image prune` **after** soutenance, never before |

## Recommended demonstration scenario

Designed around what is **proven working today**, with no live GitHub write.

1. **Platform map (1 min)** — `docker ps`: control plane (backend, Postgres, frontend), execution
   plane (candidate-verifier, builder-scanner), workflow plane (n8n), DevSecOps plane (Jenkins,
   Sonar, Nexus). State the key property up front: *the two execution-plane services are not
   published to the host, hold no database and no GitHub credential, and only one of them holds
   any elevated capability.*
2. **Scan → finding (2 min)** — Jenkins `pfe-app-test` build #151 → Sonar/Trivy/OWASP results in
   the project view. Show the **distinct** states: `DETECTED`, `NOT_DETECTED`, `UNAVAILABLE`
   ("Analyse indisponible"). Make the point explicitly: *a scanner that did not run is never
   rendered as clean.*
3. **Finding ≠ task (1 min)** — the same row carries `status` (task lifecycle) and `scannerStatus`
   (scanner truth) as **two separate columns**, with
   `UNIQUE (projectId, findingFingerprint)` preventing duplicate tasks.
4. **Decision (2 min)** — open a CVE and show the V1.8 compatibility decision: a finding absent
   from the evidence store returns `NOT_YET_SANDBOXED` with `requiresDeveloperReview: true` and
   the explicit text *"never fabricated as any other state"*. That is the fail-closed default.
5. **Remediation evidence (3 min)** — show the recorded attempt chain from the database
   (task `a390e383-…`):
   - attempt 1 — `attemptId 93c68aed…`, `batchId sec-batch-6172…`, `VERIFIER_TIMEOUT`,
     `retryable: true`
   - attempt 2 — `attemptId 39c77b06…`, `batchId sec-batch-4e6f…`, `OPERATOR_TEST_STOPPED`,
     `retryable: false`, and **no attempt 3**
   This single record demonstrates unique attempt identity, a new batch per retry, a
   single-increment attempt number, retry on a retryable technical failure, and no retry on a
   non-retryable one — while `scannerStatus` stayed `DETECTED` and the task stayed `TODO`.
6. **Single writer (2 min)** — `\d remediation_target_reservations`: show
   `UNIQUE (projectId, targetKey) WHERE state = 'ACTIVE'` and the `CHECK` that makes
   `ACTIVE` ⇒ non-empty claims + `releasedAt IS NULL` and `RELEASED` ⇒ empty claims +
   `releasedAt NOT NULL`. *The invariant is enforced by PostgreSQL, not by application code.*
7. **Security closure (3 min)** — `provesSecurityClosure()`: it requires the target CVE to be
   absent **and** every affected package to be *positively present at the fixed version*, inside
   `try { … } catch { return false }`. Then `cveTargets()`: it throws
   `INCOMPLETE_SECURITY_SCAN` / `MALFORMED_OR_FILTERED_SECURITY_SCAN` (the latter rejects reports
   carrying `ModifiedFindings`, i.e. suppressed findings). *An absent, failed, filtered or
   malformed scan can never be read as a fix.*
8. **The Git barrier (3 min)** — open live WF6 in n8n (184 nodes, all reachable, zero dangling
   edges, all 58 HTTP nodes with explicit timeouts and error handling). Trace webhook →
   `Create Missing Branch`: **39 gates**, ending in `Revalidate Before Write` →
   `Fresh Candidate Matches` → `Write Authorized?`. Show that each of the four GitHub-mutating
   nodes has exactly **one** predecessor, and that it is an IF gate.
9. **Safety freeze (1 min)** — attempt a dispatch and let it return
   `503 SECURITY_REMEDIATION_TEMPORARILY_DISABLED`. Frame it as the intended posture for the
   defence: the system can write to GitHub, and it is deliberately prevented from doing so right now.
10. **Provenance (1 min)** — `docker inspect pfe-backend` → the OCI
    `org.opencontainers.image.revision` label binding the running image to an exact commit, plus
    the `qualified-source.bundle` + per-run `REPORT.md` attestations under `docs/qa/`
    (65 QA campaigns).

**Do not include:** WF2 "AI Fix", the cancel button, enabling the harness, or any attempt at a
live GitHub write.

## Before demo day — in this order

1. AUD-002 → AUD-001: reconcile the lineage, rebuild the backend, redeploy, re-run the manifest.
   This single action also clears AUD-003, AUD-009, AUD-014, AUD-017 and AUD-019.
2. AUD-004 + AUD-011: commit the live WF6/WF2 exports and the qualified-source bundles.
3. Re-verify: 7 workflows active, `docker ps` all healthy, `GET /healthz` → 200, dispatch still
   `false`, and the route probe now returning 401 (not 404) on all four routes.
4. Rehearse steps 5–8 above from the database and from the live n8n canvas — they are the
   strongest material in the project.
