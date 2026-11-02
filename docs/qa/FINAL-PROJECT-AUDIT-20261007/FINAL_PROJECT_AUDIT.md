# FINAL PROJECT AUDIT — PFE DevSecOps AI Remediation Platform
**Date** 2026-10-07 · **Scope** full architecture / code / DevSecOps / security / runtime
**Mode** READ-ONLY. No source, container, workflow, Git ref, DB row, migration, secret or
Jenkins job was modified. No remediation was dispatched. All mutating tests were declined and
are recorded as missing proof.

Companion documents: `SYSTEM_ARCHITECTURE.md` · `ISSUE_REGISTER.md` · `RUNTIME_DRIFT.md` ·
`DEMO_READINESS.md` · `EVIDENCE/`

---

# 1. Executive Summary

## Overall project status: **ORANGE**

The engineering is genuinely strong — the security-critical logic is rigorous, fail-closed and
proven on live data — but the platform is currently running a *different and more advanced*
source lineage than the branch about to be frozen, and that mismatch has already broken one of
the two remediation flows end to end.

This is not a quality problem. It is a **release-management** problem, and the fix is mostly
mechanical: the deployed lineage (`release/chain4a-r1-scoped`) is a **fast-forward** away from
the checked-out branch.

Three facts define the situation:

1. **The runtime is better than the freeze candidate.** The deployed backend contains a generic,
   tree-verified `TrustedTargetResolver`, a scoped E2E dispatch policy and a hardened,
   digest-pinned Dockerfile with safe defaults baked in. **None of these exist in the working
   tree.** Freezing the current checkout would *regress* the platform.
2. **One flow is broken right now.** The live, active WF2 workflow calls three backend routes
   that the deployed backend does not expose — proven by live probe (404, against a 401 control).
   WF2 fails *closed* (no GitHub write), so nothing is unsafe; it simply cannot be demonstrated.
3. **The system is not reproducible from a clone.** The live WF6 definition, the qualified-source
   bundles pinning every deployed artifact, and the entire runtime configuration are untracked or
   live only in `/tmp`.

Everything genuinely difficult about this project — the pre-Git barrier, the DB-enforced
single-writer invariant, scanner-failure semantics, retry identity — is **done, and done well**.

**Totals: 33 confirmed issues — P0 = 4, P1 = 14, P2 = 9, P3 = 6.**

---

# 2. Project Architecture

See `SYSTEM_ARCHITECTURE.md` for the component inventory, the text diagram, the per-transition
contract tables (flows A–L) and `ALL_GIT_WRITERS`.

The shape is a four-plane architecture with a deliberately asymmetric trust model:

- **Control plane** — Angular frontend + NestJS backend + PostgreSQL. Holds every credential,
  makes every decision, and performs **no** Git mutation itself.
- **Workflow plane** — n8n (WF1–WF6). Owns all GitHub mutation, behind gate chains.
- **Execution plane** — `candidate-verifier` (builds and tests untrusted repository code at zero
  elevated capability, holding no database and no GitHub credential) and `builder-scanner` (the
  only process that execs `podman`/`trivy`, the only one with `CAP_SYS_ADMIN`). Neither is
  published to the host.
- **DevSecOps plane** — Jenkins + DinD, SonarQube, Nexus, Prometheus/Grafana.

The privilege gradient — decisions at zero capability, capability at zero decision authority —
is the single best architectural idea in the project and is enforced by compose configuration,
network isolation and a structural test (`candidate-verifier/isolation.spec.ts`), not merely by
convention.

---

# 3. Runtime Truth

Full matrix in `RUNTIME_DRIFT.md`. Summary of what is *actually* running:

| Service | Image | Source revision | In the repo? |
|---|---|---|---|
| `pfe-backend` | `sha256:8ee224f9…` | `0957ab6` (`release/chain4a-r1-scoped`) | yes — **but not an ancestor of the checked-out branch** |
| `pfe-candidate-verifier` | `sha256:947ceacf…` | `62dd93fe` | **no** — only inside an untracked bundle |
| `pfe-builder-scanner` | `sha256:8581ec8d…` | `9038f556` | **no** — only inside an untracked bundle |
| `pfe-frontend` | `nginx:alpine` | bundle built 2026-10-06 12:18 | **matches source** |
| n8n WF6 | live, active, 184 nodes | byte-equivalent to an **untracked** file | tracked export is 149 nodes / 79 param diffs |
| Postgres | `postgres:16-alpine` | 16 tables, Phase 4G constraints live | no migration ledger exists |

All three execution-plane services are configured from **ephemeral `/tmp` private compose JSON
files** holding plaintext secrets. Those files are the only record of the running configuration.

Two findings deserve credit even inside the drift story: every image carries an OCI
`org.opencontainers.image.revision` + `platform.source-tree` label, and every deployed artifact
has a matching `qualified-source.bundle`. The provenance discipline is excellent — the bundles
simply were never committed.

---

# 4. Verified Strengths

Each item below was **actively verified in this audit**, not read from documentation.

### Scanner-failure semantics are correct — the hardest thing to get right
`backend/src/security-remediation/security-artifact-scan.ts`:

- `provesSecurityClosure()` (line 101) requires the target CVE to be absent **and** every
  affected package to be *positively observed at the fixed version*. An empty or missing report
  fails `found.length > 0`. The whole body is wrapped in `try { … } catch { return false }`.
- `cveTargets()` (line 47) throws `INCOMPLETE_SECURITY_SCAN` when the build did not pass, the
  mode is wrong, digests are malformed, the schema is not 2, results are empty, or no `jar`
  packages are present; `MALFORMED_OR_FILTERED_SECURITY_SCAN` when a result carries
  `ModifiedFindings` — i.e. **suppressed/filtered reports are rejected outright**.

**`NO_FINDINGS`, `SCAN_FAILED`, `SCAN_NOT_RUN` and `SCAN_TIMEOUT` are structurally
unconflatable.** This directly satisfies the audit's third review principle.

### The single-writer invariant is enforced by PostgreSQL
`\d remediation_target_reservations`:

```
"remediation_target_one_active" UNIQUE, btree ("projectId","targetKey") WHERE state = 'ACTIVE'
CHECK (state='ACTIVE'   AND claims <> '{}' AND "releasedAt" IS NULL
    OR state='RELEASED' AND claims  = '{}' AND "releasedAt" IS NOT NULL)
```

Acquisition is `INSERT … ON CONFLICT ("projectId","targetKey") WHERE state='ACTIVE' DO NOTHING`
followed by `SELECT … FOR UPDATE` and a claims-ownership check
(`remediation-target-reservation.ts:34-47`). `settleTargetClaim()` **quarantines** rather than
releases whenever any unresolved Git side effect exists — fail-closed. Contradictory reservation
states are impossible at the storage layer.

### Retry and attempt identity — proven on live production data
From `manual_remediation_tasks` (task `a390e383-42b7-4348-894c-5e02a7e5f98d`):

| # | attemptId | batchId | status | retryable |
|---|---|---|---|---|
| 1 | `93c68aed-…` | `sec-batch-61727477-…` | `TECHNICAL_FAILURE` / `VERIFIER_TIMEOUT` | true |
| 2 | `39c77b06-…` | `sec-batch-4e6f6ec2-…` | `OPERATOR_TEST_STOPPED` | false |

Proven: unique `attemptId` per attempt ✓ · **new `batchId` per retry** ✓ · `attemptNumber`
increments exactly once ✓ · a retryable technical failure produces a new attempt ✓ · a
non-retryable one produces **no** attempt 3 ✓ · the task-level `securityRemediationBatchId`
tracks the latest batch ✓ · `scannerStatus` stayed `DETECTED` while remediation ended
`OPERATOR_TEST_STOPPED` ✓ · `status` stayed `TODO` — no false completion ✓.

### `finding ≠ task` and `task ≠ attempt` are schema-level facts
`manual_remediation_tasks` carries `status` (task lifecycle) and `scannerStatus` (scanner truth)
as **separate columns**, with `UNIQUE (projectId, findingFingerprint)` providing DB-level
idempotency, FKs to `incidents` (`SET NULL`) and `projects` (`CASCADE`), an `events` jsonb audit
trail, and attempts nested in `securityFindingRemediation`.

### `VERIFIED` has deterministic evidence
The only state combination that looked contradictory — `VERIFIED` + `scannerStatus=UNAVAILABLE`
(3 rows) — is correctly grounded: each row has `verifiedBuild` (120, 15, 15) strictly greater
than `lastSeenBuild` (112, 14, 14), a `verifiedAt` timestamp, and `completedAt IS NULL` (not
falsely attributed to a human). Verification rests on build evidence; `scannerStatus` reports
*current* scanner availability. The invariant holds.

### The pre-Git barrier is real, deep, and has no bypass
Live WF6 (184 nodes, **active**): 177 functional nodes, **all reachable**, **zero** dangling
edges, **zero** disabled nodes, a single webhook entry, and 7 sticky-note documentation zones.
All **58** HTTP nodes have an explicit `timeout` **and** explicit error handling —
`0` exceptions.

The shortest path from the webhook to the first GitHub mutation is **39 gates**, including
candidate-ready and trusted-candidate validation, base-commit existence, repository metadata,
default-branch head, ancestry evidence, PR36 protection (target and resolved PR), historical PR
shape/head validation, and finally `Revalidate Before Write` → `Fresh Candidate Matches` →
`Write Authorized?`.

Each of the four GitHub-mutating nodes has **exactly one** predecessor, and it is an IF gate:
`Write Authorized? (New Branch)` → `Create Missing Branch`; `Branch Created Exactly?` →
`Write File To Branch`; `Authorized Branch Unchanged?` → `Create Pull Request`;
`Created PR Head Exact?` (false branch) → `Close Drifted Created PR` (compensating cleanup).
**No path reaches a Git write without passing its gate.**

### The fail-closed default for unknown findings refuses to fabricate
`v1_8-compatibility-decision.service.ts:23-35` returns `NOT_YET_SANDBOXED` with
`requiresDeveloperReview: true`, empty `evidenceId`/`validationRunId` (*"never a real-looking
id"*) and the explicit note *"never fabricated as any other state"*.
`dependency-compatibility-decision.ts:84` separates a missing rescan
(`NOT_TESTED / SECURITY_RESCAN_NOT_RUN`) from a failed one.

### Privilege and secret segregation in the execution plane
`platform/docker-compose.yml` mounts **no** `docker.sock` anywhere; `candidate-verifier` runs at
zero elevated capability; `builder-scanner` receives `CAP_SYS_ADMIN` **only**, with
`privileged` unset, default seccomp, no `pid: host`, no published ports, and exactly one secret.
Both Dockerfiles pin and SHA-256-verify Trivy 0.72.0 and Gradle 8.10.2 from upstream, run as
`USER node`, and configure rootless Podman deliberately. The inline rationale in these files is
of professional quality.

### Defence in depth on the fixture gate
`integration-fixtures.service.ts:24-26` refuses service when `NODE_ENV === 'production'`
**or** the flag is not `'true'`, *and* requires an admin role, *and* validates finding paths
against traversal. The running container has the flag `true` but `NODE_ENV=production` — so the
routes are closed. Two independent conditions, either sufficient.

### The frontend displays backend truth
`status-labels.ts` is explicitly presentation-only (*"Ne modifie jamais la valeur canonique
elle-même"*) with distinct labels for `NOT_RUN`, `NOT_ATTEMPTED`, `NOT_REACHED`,
`SCANNER_UNAVAILABLE`, `NOT_YET_SANDBOXED`, `UNKNOWN`.
`wf6-remediation-badge.ts` grants a positive badge **only** for `CANDIDATE_READY` and states
*"Historical CLOSED is never a proposal"* — so **PR existence alone never renders as fixed**.
No `bypassSecurityTrustHtml` / `DomSanitizer` escape anywhere; `[innerHTML]` uses Angular's
sanitiser. No hardcoded URLs or secrets; config is relative (`apiUrl: '/api'`).
Automated contract scan: **49 of 50** frontend API calls match a backend route; the single
mismatch is an *uncalled* dead method (AUD-031).

### Sonar correlation distinguishes "unavailable" from "failed"
`common/phase-diagnostics.ts:73` and `common/scanner-diagnostics.ts:65-70` explicitly model
`analysisSubmitted` vs `qualityGateResolved` diverging, with the operator-facing message *"…la
corrélation quality gate est donc indisponible pour ce build, ce n'est pas un défaut du code
analysé."* Exactly the right semantics.

### The test suite is real and green — independently re-run
This audit re-ran the authoritative manifest (`docs/qa/final-closure-r2-20261007/regressions-final.json`)
from scratch: **72 passed, 0 failed**, 13 skipped (builder-scanner, requires Docker +
`SYS_ADMIN`), 2 missing (AUD-002). Spot checks: `remediation-target-reservation.spec.ts` 4/4,
`security-remediation-lifecycle.spec.ts` 44/44. The specs test real behaviour — reservation
conflicts, retry taxonomy, callback contracts — not mocks of the behaviour under test.
Evidence: `EVIDENCE/independent-regression-run.json`.

### QA discipline
65 dated QA campaigns under `docs/qa/`, each with structured machine-readable attestations, and
a `qualified-source.bundle` + image hash for every deployed artifact. This is better release
evidence than most production teams maintain.

---

# 5. Critical Findings (P0 / P1)

Full evidence in `ISSUE_REGISTER.md`.

## P0
| ID | Title | Blocks validation | Blocks soutenance |
|---|---|---|---|
| **AUD-001** | Deployed backend lacks the three routes live WF2 requires → WF2 broken end to end (404 vs 401 control) | YES | YES |
| **AUD-002** | Freeze branch is 2 commits behind and divergent from the deployed lineage; `TrustedTargetResolver` and `scoped-e2e-dispatch` exist only in the running container | YES | YES |
| **AUD-003** | Repo-standard `docker compose up` enables automatic dispatch (fail-open kill switch, unset ⇒ enabled) | YES | NO |
| **AUD-004** | Live WF6 definition exists only as an untracked file; tracked export is 149 vs 184 nodes | NO | YES |

## P1
AUD-005 unauthenticated webhooks (4 routes, arbitrary finding/incident injection, can trigger
WF4/WF5) · AUD-006 SSRF with response reflection via `payload.build_url` · AUD-007 WF2's
Git-writing webhook is unauthenticated on a LAN-exposed n8n · AUD-008 hardcoded JWT fallback
secret in two files · AUD-009 `backend/Dockerfile` swallows build failures with `|| true`, runs
as root, `EXPOSE 3000` ≠ 3001 · AUD-010 no migration ledger, 4 of 7 migrations untracked here ·
AUD-011 verifier/scanner source commits unreachable from any branch; bundles untracked;
base images local-only · AUD-012 runtime configured from ephemeral `/tmp` files with plaintext
secrets · AUD-013 harness flag live while WF6's `Operator Test Barrier?` node is not ·
AUD-014 freeze branch re-registers the legacy reconciliation path · AUD-015 PostgreSQL on
`0.0.0.0:5433` with a weak password · AUD-016 CORS `*` + credentials, public Swagger, 100 MB
bodies, no helmet/rate-limiting · AUD-017 deployed UI's cancel button 404s · AUD-018 README
stale and misleading.

---

# 6. Component-by-Component Audit

**Frontend — 8/10.** Angular standalone, lazy routes, four guards, presentation-only discipline,
no sanitiser bypass, no hardcoded endpoints, 49/50 contract match. Deductions: the cancel
control 404s against the deployed backend (AUD-017); one dead service method (AUD-031);
`CLOSED → "Corrigée"` is loose phrasing (AUD-026).

**Backend — 8/10.** 347 TypeScript files across 24 modules; 78 guard applications; role checks
enforced in the **service** layer (defence in depth, not just controllers); typed exceptions with
French operator messages and stable machine codes; explicit transaction and locking use in the
reservation path; `MAX_AUTOMATIC_ATTEMPTS` bounded and validated. Deductions: unauthenticated
webhooks (AUD-005), SSRF (AUD-006), hardcoded JWT fallback (AUD-008), fail-open dispatch default
(AUD-003), permissive HTTP posture (AUD-016), legacy path re-registered (AUD-014). No SQL
injection found — all dynamic SQL is parameterised (`$1…$n`); no command injection found in the
backend (process execution lives in the execution plane, which uses `execFileSync` with argument
arrays, never a shell string).

**Database — 8/10.** 16 tables; DB-enforced single-writer invariant and state coherence checks;
`UNIQUE (projectId, findingFingerprint)` idempotency; sensible FKs and indexes
(`batchId`, `incidentId`, `(projectId,status)`); `DB_SYNCHRONIZE=false`. Deductions: no
migration ledger (AUD-010); vestigial `expiresAt` and missing FKs on the reservation table
(AUD-025). No orphan or contradictory rows found in the live data.

**n8n — 7/10.** WF6 is immaculate (see §4). Deductions: WF2's webhook is unauthenticated
(AUD-007) and 13 of its 26 HTTP nodes lack explicit timeouts with 3 lacking error handling —
materially weaker than WF6's perfect record; the live WF6 definition is untracked (AUD-004);
8 debug/probe workflows and a duplicate-named WF2 remain in the instance (AUD-022).

**WF6 contract — 9/10.** The backend↔WF6 payload carries `projectId`, `taskId`, `attemptId`,
`attemptNumber`, `batchId`, repository, base SHA, scanner data and target data with consistent
types. `callbackContract()`
(`security-remediation-lifecycle.ts:16-20`) selects v2 on *any* partial modern identity and
documents that it *"can never fall back to v1"* — an explicitly closed legacy door, which is the
right way to retain backward compatibility. Node-set and parameter hashing confirm live WF6 is
byte-equivalent to its offline draft.

**Candidate verifier — 9/10.** Exact-SHA materialisation, per-candidate workspaces, tracked-source
digest binding (`trackedSourceDigest` rejects non-regular files), explicit deadline budgets, no
secrets, no database, no GitHub write capability, zero elevated capability, and a structural
isolation test. The Dockerfile's COPY allowlist is deliberately minimal with a documented
rationale for every entry. Deduction: its exact source commit is not in the repository (AUD-011).

**Builder scanner — 8/10.** Sole `podman`/`trivy` executor; rootless Podman with an explicit
registry policy; pinned SHA-verified Trivy; `init: true` with a precise zombie-reaping rationale
plus an application-level orphan sweep; `CAP_SYS_ADMIN` only; no published port; fail-closed
shared-secret auth. Deductions: source commit not in the repository; base image local-only.

**Docker — 6/10.** The remediation plane is exemplary and self-documenting (no `docker.sock`
anywhere, minimal capability, network segmentation, named volumes, healthchecks). Deductions:
two generations of `backend/Dockerfile` coexist and compose points at the **bad** one (AUD-009);
runtime configured from `/tmp` (AUD-012); `:latest` tags on Sonar/Nexus/Grafana/n8n/Prometheus;
privileged DinD with a published port (AUD-027); 150 dangling images (AUD-024); no
`platform/.dockerignore`.

**Jenkins — 6/10.** 8 jobs including a dedicated `pfe-app-test-security-candidate` job (build #1,
2026-10-06) and a multibranch job; `pfe-app-test` at build #151. Deductions: `VermegPFE-Watcher`
at build #3125 with no visible rotation; stale workspaces (`amri souhaiel` 57 MB, `@2` 56 MB,
`PR-33@libs`, `test`); `PFE-VERMEG` abandoned since April. No Jenkins job was found that can
mutate remediation state directly — it reaches the platform only through the webhook, which is
the correct boundary (though that webhook is unauthenticated, AUD-005).

**GitHub — 9/10.** `ALL_GIT_WRITERS` (see `SYSTEM_ARCHITECTURE.md`) is a closed set of 6 live
nodes plus 1 inactive debug workflow. **No backend code path creates a branch, commit or PR.**
Git mutation is strictly after validation in WF6, with revalidation immediately before the write
and a compensating close on head drift. Deduction: the inactive `DEBUG-create-pr-only` workflow
is an ungated PR creator sitting in the instance (AUD-022).

**Trivy — 9/10.** Pinned 0.72.0, SHA-256 verified, invoked only from builder-scanner against an
image archive (`mode: 'TRIVY_IMAGE_ARCHIVE'`), report digest-bound, filtered reports rejected,
fixed-version correlation explicit, fail-closed throughout. Deduction: DB freshness is not
asserted as a first-class state.

**OWASP Dependency-Check — 8/10.** Plugin `12.2.2` pinned and pre-fetched into the verifier image
(`QualifiedArtifact.Dockerfile`), real baseline and candidate logs captured
(`baseline-owasp.log`, `real-owasp-candidate.log`), rescan wired into the orchestrator.
Deduction: NVD data freshness and the offline/unavailable case are less explicitly modelled than
Trivy's.

**SonarQube — 7/10.** `ceTaskId`/`analysisId` correlation modelled, quality-gate state carried
through to the dashboard, and the "analysis submitted but gate uncorrelated" case explicitly
distinguished from a code defect. Deductions: `:latest` image; six leftover Sonar probe
workflows in n8n.

**Security — 6/10.** Genuinely strong where it is architectural: secret segregation proven by
test, capability minimisation, fail-closed internal guard, no `docker.sock`, parameterised SQL,
path-traversal rejection on every externally supplied path, no sanitiser bypass. Genuinely weak
at the HTTP edge: unauthenticated webhooks (AUD-005), SSRF (AUD-006), unauthenticated
Git-writing workflow webhook (AUD-007), hardcoded JWT fallback (AUD-008), LAN-exposed Postgres
(AUD-015), CORS/Swagger/body-limit/rate-limit posture (AUD-016).

**Tests — 7/10.** 287 spec files; 87 in the authoritative manifest; **72/72 runnable passed on
independent re-run**. The specs exercise production paths and real invariants, and several
(`isolation.spec.ts`, the Postgres gate scripts) are structural rather than behavioural — a
mature choice. Deductions: two thirds of specs are outside the manifest (AUD-020); no `npm test`
(AUD-021); two manifest entries missing (AUD-002); builder-scanner specs need privileged Docker.

**Observability — 5/10.** The database is an excellent forensic record: `events` jsonb plus the
per-attempt chain means *"what happened to finding X?"* is fully reconstructable, as
demonstrated in §4. `GET /healthz` performs a real `SELECT 1`. Deductions: 212 unstructured
`console.*` calls, no logging library, no correlation-ID middleware, no metrics endpoint despite
Prometheus and Grafana running (AUD-023).

---

# 7. Cross-Component Contract Problems

1. **backend ↔ WF2 (CONFIRMED, P0)** — live WF2 requires `execution-started`, `pre-write-gate`
   and `cancel`; the deployed backend returns 404 for all three. Fails closed. (AUD-001)
2. **frontend ↔ backend (CONFIRMED, P1)** — the served bundle calls `…/cancel`; 404. (AUD-017)
3. **backend ↔ WF6 harness (CONFIRMED, P1)** — the backend honours the harness flag; live WF6
   lacks the `Operator Test Barrier?` node that bounds it. (AUD-013)
4. **source ↔ runtime evidence-store contract (resolved, worth noting)** — the deployed backend
   resolves the evidence store from `SECURITY_REMEDIATION_EVIDENCE_STORE_FILE` and degrades to an
   empty store when unset (⇒ `NOT_YET_SANDBOXED`, fail-closed). The **working tree** still uses
   `join(__dirname, 'v1_8-evidence-store.json')` with an unguarded `readFileSync`. The asset
   *is* declared in `nest-cli.json` and both are tracked, so a correct build works — but the
   deployed variant is the better design and `RELEASE-SOURCE.md` documents it as intentional.
   Another reason the freeze must target the reconciled lineage.
5. **frontend ↔ backend, everything else (CLEAN)** — 49/50 calls match; the one mismatch is
   uncalled dead code.

---

# 8. Runtime / Source Drift

See `RUNTIME_DRIFT.md`. Classification tally:
**MATCH 1** (frontend) · **UNTRACKED_DRIFT 3** (verifier, scanner, WF6) ·
**DANGEROUS_DRIFT 3** (backend, WF2, runtime configuration) ·
**SCHEMA_PRESENT_WITHOUT_LEDGER 1** (database) · **UNKNOWN 1** (local-only base images).

---

# 9. Security Findings

Reported by type and location only; **no secret value is reproduced here.**

| Secret | Location | Storage | Risk |
|---|---|---|---|
| `JWT_SECRET` | `platform/.env`, `backend/.env`, `/tmp/r2-backend-config.private.json` | plaintext files, 0600 | weak value; hardcoded fallback in two source files (AUD-008) |
| `DB_PASS` | same | plaintext | weak; Postgres LAN-exposed (AUD-015) |
| `N8N_API_KEY` / `N8N_CALLBACK_SECRET` / `N8N_INTERNAL_SECRET` | `backend/.env`, `/tmp` config | plaintext | rotation noted as debt in the file's own comments |
| `AZURE_DEPLOY_AGENT_SECRET` | `backend/.env`, `/tmp` config | plaintext | agent is the sole holder of `~/.azure` — correct design |
| `BUILDER_INTERNAL_SECRET` | `platform/.env` | plaintext, injected to two services only | correctly scoped, fail-closed |
| GitHub / Jenkins / Sonar credentials | n8n credential store, Jenkins credential store | managed stores | **never** given to the execution plane — verified |

`.env` files are correctly git-ignored. There is **no `.env.example`** anywhere except
`infra/azure-deploy-agent/allowlists.env.example`, so a clone cannot be configured (AUD-018).

OWASP-style summary: **A01 Broken Access Control** — AUD-005, AUD-007;
**A02 Cryptographic Failures** — AUD-008 (hardcoded fallback), AUD-015;
**A05 Security Misconfiguration** — AUD-003, AUD-009, AUD-016, AUD-027;
**A07 Identification and Authentication Failures** — AUD-008 (7-day tokens, no revocation);
**A10 SSRF** — AUD-006. No injection (A03) found: SQL is parameterised and process execution
uses argument arrays.

---

# 10. Reliability / Concurrency Findings

**Failure-injection review** (by inspection and isolated test; nothing was injected into the
running system):

| Failure | Behaviour | Class |
|---|---|---|
| DB unavailable | `/healthz` fails (real `SELECT 1`); reservation acquisition cannot proceed | SAFE |
| n8n unavailable | dispatch fails; `DISPATCH_FAILED` recorded | RETRYABLE |
| WF6 timeout | `VERIFIER_TIMEOUT` → retryable; new `attemptId`+`batchId` — **observed in live data** | RETRYABLE |
| Jenkins unavailable | webhook simply never arrives; console-log fetch is wrapped in try/catch with a warning | SAFE |
| GitHub unavailable | gate node errors; WF6 nodes all have explicit error handling | SAFE (fails closed) |
| Registry unavailable | `podman build` fails → `INCOMPLETE_SECURITY_SCAN` | NONRETRYABLE, fails closed |
| Trivy unavailable / malformed | throws; `provesSecurityClosure → false` | SAFE (fails closed) |
| OWASP unavailable | rescan not run → `newHighCriticalCount: null` → `NOT_TESTED` | SAFE |
| Sonar unavailable | `qualityGateResolved: null`, distinguished from a code defect | SAFE |
| Worker crash mid-build | `init: true` reaps; application-level orphan sweep SIGKILLs live orphans | SAFE |
| Duplicate callback | `completionDigest` + attempt-scoped matching | SAFE (idempotent) |
| Stale callback | `callbackContract()` v2 identity + attempt correlation | SAFE |
| Backend restart mid-attempt | reservation stays `ACTIVE`; `reconcile-stale-dispatch` route exists (401-verified live); `remediation_target_stale` index supports detection | RETRYABLE, operator-assisted |
| Malformed Trivy report feeding the HIGH/CRITICAL counter | counts `0` ⇒ reads as "no regression" | **FAIL-OPEN** (AUD-030, mitigated upstream) |
| `SECURITY_REMEDIATION_DISPATCH_ENABLED` unset | dispatch **enabled** | **FAIL-OPEN** (AUD-003) |

Two fail-open paths exist out of fifteen; one is config (AUD-003, already fixed on `chain4a`) and
one is a telemetry counter with upstream mitigation (AUD-030). Everything on the security-decision
path is fail-closed.

**Performance / resources** — no unbounded query patterns found on the hot paths (the
remediation queries are indexed and bounded); `MAX_FINDINGS_PER_REMEDIATION_BATCH` caps batch
size; the `routed_builds` hash+TTL guard prevents webhook-driven workflow storms. Risks are
custodial, not algorithmic: 100 MB body limit (AUD-016), 150 dangling images, 3125-build Jenkins
job, unbounded n8n execution retention, 2.2 GB working tree (AUD-024).

---

# 11. Testing Gaps

- **Not covered by any test:** the unauthenticated webhook surface (AUD-005) and the SSRF path
  (AUD-006) — the two most serious security findings have no regression test.
- **Covered but not executed in the manifest:** ~200 of 287 spec files (AUD-020).
- **Unrunnable without privileged Docker:** 13 builder-scanner specs.
- **Referenced but absent:** 2 manifest entries (AUD-002).
- **No end-to-end test of the WF2 backend contract** — exactly the contract that is now broken
  (AUD-001). A single contract test asserting the three route shapes would have caught it.
- **No test asserting the safe default** of `SECURITY_REMEDIATION_DISPATCH_ENABLED` when unset.
- No tests found that always pass, mock away the behaviour under test, or depend on stale
  fixtures. Fixtures are explicitly dated and refreshed (e.g. *"refresh #149 fixture to reflect
  post-resync identity state"*).

---

# 12. Demo / Soutenance Risks

See `DEMO_READINESS.md` for the full table and the recommended 10-step scenario.
Blocking: WF2 "AI Fix" (404), the cancel button (404). Expected-and-explainable: dispatch frozen
(503 by design), ZAP not running, `VERIFIED` + `scannerStatus=UNAVAILABLE`, `CLOSED` labelled
"Corrigée", duplicate WF2 names in the n8n list.

---

# 13. Known Limitations (defensible in the report)

1. **Maven-only remediation pipeline.** The ownership key and resolver are generic by design and
   the deployed build resolves targets through pluggable adapters, but only the Maven strategy is
   implemented. `backend/RELEASE-SOURCE.md` already states this honestly: *"cross-ecosystem
   resolver tests demonstrate extensibility, not new ecosystem remediation support."* State it
   the same way in the report. (AUD-019)
2. **Multi-module Maven over-serialises.** On the freeze branch all findings in a project map to
   `pom.xml`, so two modules cannot be remediated concurrently. Over-serialising is *safe*.
3. **No migration ledger.** Schema changes are applied by operator procedure with per-run QA
   attestations instead of a ledger table. (AUD-010)
4. **Single-node, non-HA deployment** on WSL2 with host-dependent addresses
   (`AZURE_DEPLOY_AGENT_URL=http://172.19.0.1:7799`).
5. **LLM-dependent patch generation in WF2.** Mitigated by independent semantic review nodes plus
   deterministic verification, but non-deterministic by nature. The deterministic router
   (`classify()`) explicitly never auto-routes a real vulnerability.
6. **Azure deployment requires a host agent** because tenant policy blocks App Registration —
   documented in `infra/DEPLOY.md`. A legitimate external constraint.
7. **ZAP/DAST is historical**, not continuously running.

---

# 14. Recommended Fix Order (maximum safety / minimum change)

**Step 1 — reconcile the lineage (the only structural change). Do this first; it clears six issues.**
1. Commit the current working tree on a new branch (do not discard — it holds the WF2
   cancellation feature the live workflow needs).
2. Merge/fast-forward `release/chain4a-r1-scoped`. Expect conflicts in exactly two files:
   `backend/src/manual-remediation/manual-remediation.module.ts` (keep `TrustedTargetResolver`,
   **drop** the `Legacy*` registrations) and
   `backend/src/manual-remediation/remediation-target-reservation.ts`.
3. Keep `chain4a`'s `backend/Dockerfile`, `nest-cli.json` and the
   `v1_8-compatibility-decision.service.ts` env-based variant.
4. Re-run the regression manifest; expect 87/87 runnable green (the 2 missing specs return).
5. Rebuild and redeploy the backend. Verify with the route probe: all four routes must now return
   **401, not 404**.
→ Resolves **AUD-001, AUD-002, AUD-003, AUD-009, AUD-014, AUD-017**; converts AUD-019 to a
documented limitation.

**Step 2 — commit what the runtime depends on (pure addition, zero runtime risk).**
`WF6-SAFE-ATTEMPT-LIFECYCLE.OFFLINE.json` (the live WF6), the live WF2 export, all four
`qualified-source.bundle` files, the four untracked migrations, and a tag or branch at
`62dd93fe` / `9038f556`.
→ Resolves **AUD-004, AUD-011**; most of AUD-010.

**Step 3 — close the HTTP edge (three small, surgical changes).**
Add the existing `InternalSecretGuard` to `WebhooksController`; allowlist the Jenkins base URL
before the `build_url` fetch; add header auth to the WF2 webhook.
→ Resolves **AUD-005, AUD-006, AUD-007**.

**Step 4 — two one-line safety changes.**
Make `JWT_SECRET` mandatory (throw instead of defaulting); bind Postgres to `127.0.0.1:5433`.
→ Resolves **AUD-008, AUD-015**.

**Step 5 — promote the runtime configuration out of `/tmp`.**
Convert the three private compose JSONs into a tracked override plus a committed
`.env.example`, then rotate the exposed secrets.
→ Resolves **AUD-012**.

**Step 6 — documentation.** Rewrite `README.md` against the real architecture (correct ports,
Anthropic not OpenAI, required secrets, WF6/verifier/scanner/Phase 4G, and the safe start
procedure).
→ Resolves **AUD-018**.

Everything else is P2/P3 and belongs in the report as a known limitation or after soutenance.

---

# 15. What NOT to Change Before Soutenance

- **Do not refactor the target resolver for multi-ecosystem support.** The genericity work is
  already deployed; what remains is a Maven-only pipeline, which is a *documented limitation*,
  not a defect. Touching it risks the Phase 4G invariant that is this project's best result.
- **Do not touch the WF6 graph.** 184 nodes, all reachable, zero dangling edges, every HTTP node
  timed out and error-handled, 39 gates before the first write. It is correct. Leave it alone.
- **Do not promote the retry-E2E-harness WF6 revision, and do not enable the harness flag.**
  (AUD-013)
- **Do not enable `SECURITY_REMEDIATION_DISPATCH_ENABLED`** for the demo. The frozen state *is*
  the demonstrable safety property.
- **Do not prune Docker images, Jenkins workspaces or n8n executions before the defence.** Those
  150 dangling images include the local-only base images the execution plane cannot be rebuilt
  without (AUD-011). Clean up afterwards.
- **Do not add helmet/rate-limiting/CSRF middleware now.** Globally applied middleware can break
  the n8n callback paths; this is post-soutenance work.
- **Do not delete the legacy reconciliation code** — remove it via the `chain4a` merge, which was
  already tested, rather than by hand.
- **Do not restructure the nested repositories**, and do not `git clean` anything: 318 untracked
  files include the live WF6 definition and every artifact provenance bundle.
- **Do not reformat or "tidy" the Dockerfile and compose comments.** That inline rationale is
  among the strongest evidence of engineering judgement in the deliverable.

---

# 16. PFE Freeze Recommendation

## **C — NOT_READY_CRITICAL_FIXES_REQUIRED**

Not because the platform is weak — it is strong — but because freezing today would freeze the
**wrong source**. The branch in the working directory is behind the deployed runtime, is missing
two production components that the running container has, and does not satisfy the live WF2
contract. Step 1 of §14 is the whole of the critical work, and it is a merge plus a rebuild, not
a redesign.

After Steps 1–2 the recommendation becomes **A — READY_TO_FREEZE**.

---

# 17. Final Scorecard

| Dimension | Score | Basis |
|---|---|---|
| Architecture | **8/10** | Four-plane design with an enforced privilege gradient; forked release lineage and a Maven-only pipeline |
| Backend | **8/10** | Rigorous, typed, well-tested, parameterised SQL; unauthenticated webhook edge and a fail-open dispatch default |
| Frontend | **8/10** | Presentation-only discipline, guards, no sanitiser bypass, 49/50 contract match; one broken control at runtime |
| Database | **8/10** | Invariants enforced in PostgreSQL, good indexes and FKs; no migration ledger |
| n8n | **7/10** | WF6 immaculate; WF2 unauthenticated with 13 untimed HTTP nodes; live definition untracked; probe clutter |
| DevSecOps | **6/10** | Outstanding provenance (OCI labels, source bundles, 65 QA campaigns); ephemeral `/tmp` config, local-only images, two Dockerfile generations |
| Security | **6/10** | Excellent secret segregation and capability minimisation; unauthenticated webhooks, SSRF, hardcoded JWT fallback, CORS `*` |
| Reliability | **7/10** | Fail-closed gates, quarantine-on-doubt, proven retry invariants; 2 of 15 fail-open paths, custodial resource growth |
| Testing | **7/10** | 72/72 independently verified green on real behaviour; two thirds of specs outside the manifest, no `npm test`, no test for the broken contract |
| Observability | **5/10** | Database forensics are genuinely complete and `healthz` is real; unstructured logs, no correlation IDs, no metrics |
| Reproducibility | **4/10** | A clone cannot rebuild the running platform: untracked WF6 and bundles, `/tmp` config, local-only base images, no `.env.example` |
| Multi-project capability | **6/10** | Generic key + tree-verified adapter resolver deployed; Maven-only pipeline, `pom.xml` hardcoded on the freeze branch |
| Demo readiness | **6/10** | WF6 path demonstrable and strong; WF2 broken, dispatch frozen by design |
| Maintainability | **8/10** | Exceptional inline rationale and QA discipline; legacy duplication, branch sprawl, 65 QA directories |

**Weighted overall: 6.9 / 10** — a strong engineering project held back by release hygiene
rather than by design or implementation quality.

---

# 18. Final Verdict

```
TOTAL_CONFIRMED_ISSUES = 33
P0 = 4
P1 = 14
P2 = 9
P3 = 6

CONFIRMED_SECURITY_ISSUES     = 9
CONFIRMED_FUNCTIONAL_ISSUES   = 5
CONFIRMED_ARCHITECTURE_ISSUES = 9
CONFIRMED_RUNTIME_DRIFT_ISSUES = 5
(plus testing 2, observability 1, reliability 2 — primary category per issue, no double counting)

PRACTICAL_PLATFORM_FUNCTIONAL = PARTIAL
   WF6 / security-remediation: functional (executed successfully 2026-10-07 15:03)
   WF2 / incident-remediation: BROKEN against the deployed backend (404, CONFIRMED)

PRACTICAL_DEMO_READY = YES_WITH_PRECAUTIONS
   Demonstrate the WF6 path, the database invariants and the Git barrier.
   Avoid WF2 and the cancel control until Step 1 of §14 is done.

SAFE_TO_START_FINAL_REPORT = YES
   The architecture, the verified strengths and the limitations are stable and
   well evidenced. Write §4 and §13 of this audit into the report as they stand.

SAFE_TO_FREEZE_DEVELOPMENT = NO
   Freezing today would freeze a baseline that is behind the deployed runtime
   and incompatible with the live WF2 workflow.

FINAL_VERDICT = C — CRITICAL_FIXES_REQUIRED
   Scope of the critical work: one branch merge, one rebuild, one redeploy and
   a set of file commits. No redesign, no refactor.
```

## 19. Cross-component consistency challenge (§39)

Each question answered explicitly against evidence:

- **Could frontend and backend disagree?** **Yes, and they do.** The deployed bundle calls
  `…/cancel`, which the deployed backend 404s (AUD-017). Everything else matches (49/50).
- **Could backend and n8n disagree?** **Yes, and they do.** Live WF2 requires three routes the
  deployed backend lacks (AUD-001, CONFIRMED by probe). WF6's contract is consistent.
- **Could n8n and candidate verifier disagree?** Not observed. WF6 reaches the verifier only
  through the backend, with digest- and SHA-bound payloads.
- **Could DB state claim something different from scanner evidence?** Not on the remediation
  path: closure requires positive package-at-fixed-version evidence. At the *ingestion* edge,
  **yes in principle** — the unauthenticated webhooks accept arbitrary findings (AUD-005), so DB
  content is only as trustworthy as network access to port 3001.
- **Could retry cause duplicate writes?** No. New `attemptId`+`batchId` per attempt, a
  `completionDigest` for callback idempotency, and a reservation that *quarantines* rather than
  releases whenever a Git side effect is unresolved.
- **Could Git be reached before validation?** **No.** 39 gates; each of the four mutating nodes
  has exactly one IF-gate predecessor; `Revalidate Before Write` re-checks immediately prior.
  The one ungated PR-creating workflow in the instance (`DEBUG-create-pr-only`) is inactive.
- **Could a failed scanner appear clean?** **No** on the decision path — `cveTargets()` throws on
  incomplete/malformed/filtered reports and `provesSecurityClosure()` catches to `false`. One
  narrow asymmetry remains in the HIGH/CRITICAL *counter* (AUD-030, SUSPECTED, mitigated
  upstream).
- **Could a candidate be validated without both scanners?** No. Trivy closure is mandatory and
  positive-evidence-based; a missing OWASP rescan yields `null → NOT_TESTED`, never a pass.
- **Could runtime differ from source?** **Yes — this is the central finding.** See §3 and
  `RUNTIME_DRIFT.md`.
- **Could test-only behaviour be active in production?** The running backend carries
  `INTEGRATION_FIXTURES_ENABLED=true`, but `NODE_ENV=production` closes those routes
  independently — **not active**. The deployed backend *does* contain a `scoped-e2e-dispatch`
  policy absent from the freeze branch; it requires both the harness flag (`false`) and an
  authorised, unexpired, one-shot plan under the operator-secret guard, and the live plan count
  is **0**. Not active, but it must be committed and documented rather than existing only in a
  container.
- **Could one project-specific assumption break another project?** The reservation key includes
  `projectId`, so cross-project interference is impossible. Within a project, the freeze
  branch's `pom.xml` hardcoding over-serialises multi-module Maven (safe) and would mis-name the
  lock file for a non-Maven project (AUD-019). A grep for hardcoded project IDs, `pfe-app-test`,
  specific CVEs, PR numbers and Jenkins job names found occurrences only in fixtures, tests,
  QA evidence and documentation — classified **VALID_FIXTURE / VALID_TEST /
  VALID_DOCUMENTATION**. The single
  **INVALID_RUNTIME_HARDCODING** in permanent runtime code is `productionTarget()`'s `'pom.xml'`,
  and the deployed build has already replaced it.
