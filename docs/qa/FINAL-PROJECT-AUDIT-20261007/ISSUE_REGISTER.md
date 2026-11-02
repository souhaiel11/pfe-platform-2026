# ISSUE REGISTER — 2026-10-07

33 confirmed issues. Confidence is stated per issue; nothing speculative is marked CONFIRMED.
`BPV` = blocks practical validation. `BS` = blocks soutenance.

---

## P0 — MUST FIX BEFORE PRACTICAL VALIDATION

### AUD-001 — Deployed backend is missing the three routes the live ACTIVE WF2 requires
**Severity** CRITICAL · **Component** backend ↔ n8n WF2 · **Confidence** CONFIRMED · **Status** OPEN
**Size** S · **BPV** YES · **BS** YES

**Evidence**
- Live probe, `EVIDENCE/route-probe.txt`:
  `POST /api/incidents/<uuid>/remediation/<uuid>/pre-write-gate` → **404**;
  `…/execution-started` → **404**; `…/cancel` → **404**;
  `…/reconcile-stale-dispatch` → **401** (control: route exists, guard rejected);
  `GET /healthz` → **200** (control: service healthy).
- Live workflow `u3eeMwTuhCsetfcS` ("WF2 — Git Patch & PR v5 CANONICAL", **active**, 195 nodes,
  `updatedAt 2026-10-06T12:51:02Z`) contains nodes `Register WF2 Execution` → POST
  `…/remediation/{requestId}/execution-started` and `Pre-Git Cancellation Gate` → POST
  `…/remediation/{requestId}/pre-write-gate`, both with `onError` unset and `timeout: 15000`.
- Deployed route table extracted from `/app/dist/incidents/incidents.controller.js`: the three
  routes are absent; `reconcile-stale-dispatch` is present.
- Working tree *does* define them: `backend/src/incidents/incidents.controller.ts:134,139,144`.

**Observed** Any WF2 remediation stops at `Register WF2 Execution` with HTTP 404.
**Expected** The node returns 200 and the run proceeds.
**Impact** The WF2 (incident/code-remediation) path is non-functional end to end. It fails
*closed* — no GitHub write occurs — so there is no safety breach, but the flow cannot be
demonstrated. Last successful WF2 execution: 2026-10-04 21:02, i.e. before the current backend
was deployed on 2026-10-07 15:05.
**Reproduction** Run the probe above, or trigger WF2 and observe the first HTTP node.
**Root cause** The backend deployed on 2026-10-07 was built from `0957ab6`
(`release/chain4a-r1-scoped`), a lineage that never received the 2026-10-04 WF2
true-cancellation work, while the live WF2 was promoted on 2026-10-06 assuming it.
**Fix** Reconcile the lineage (see AUD-002), rebuild the backend from the reconciled tree and
redeploy. No code needs to be written — both halves already exist.
**Fix risk** Medium — requires a rebuild + redeploy, then re-running the regression manifest.

---

### AUD-002 — The branch about to be frozen is behind, and divergent from, what is running
**Severity** CRITICAL · **Component** release engineering · **Confidence** CONFIRMED · **Status** OPEN
**Size** M · **BPV** YES · **BS** YES

**Evidence**
- `git rev-parse HEAD` → `206a8a7` on `theme-vermeg-reconciled`; **413 dirty paths**
  (318 untracked, 90 modified, 3 renamed, 1 deleted).
- Running backend OCI label `org.opencontainers.image.revision = 0957ab63…`;
  `git merge-base --is-ancestor 0957ab6 HEAD` → **false**.
- `git merge-base --is-ancestor theme-vermeg-reconciled release/chain4a-r1-scoped` → **true**
  (fast-forward possible; gap = 2 commits, 140 files, +23 830 / −592 lines).
- Present in the deployed image, **absent from the working tree**:
  `/app/dist/manual-remediation/trusted-remediation-target.js`,
  `/app/dist/security-remediation/scoped-e2e-dispatch.js`.
- Deployed `manual-remediation.module.js` providers include
  `{ provide: TrustedTargetResolver, useFactory: productionTargetResolver }` and **no** `Legacy*`;
  working-tree `manual-remediation.module.ts:21-22` registers `LegacyReconciliationController`,
  `LegacyReconciliationService`, `LegacyRemoteSettlement` and **no** resolver.
- Two spec files named by `docs/qa/final-closure-r2-20261007/regressions-final.json` are missing
  from the working tree (`trusted-remediation-target.spec.ts`, `scoped-e2e-dispatch.spec.ts`).

**Observed** Freezing the current checkout would ship a baseline that is *less* capable and
*less* safe than what is deployed: `pom.xml` hardcoding instead of `TrustedTargetResolver`, a
build-error-swallowing Dockerfile, fail-open dispatch default, and the legacy reconciliation
path re-registered.
**Expected** The frozen source reproduces the running platform.
**Impact** The PFE deliverable would misrepresent the implemented system, and a rebuild from
the frozen source would regress it.
**Root cause** Parallel hardening (`chain3a`/`chain4a` release branches) and feature work
(WF2 cancellation, uncommitted) were never merged.
**Fix** 1) commit the working tree on a branch; 2) fast-forward/merge `release/chain4a-r1-scoped`;
3) resolve the two overlapping files (`manual-remediation.module.ts`,
`remediation-target-reservation.ts`); 4) rebuild + redeploy; 5) re-run the regression manifest.
**Fix risk** Medium — but it is the only change that makes every other finding coherent.

---

### AUD-003 — A repo-standard `docker compose up` starts with automatic dispatch ENABLED
**Severity** CRITICAL · **Component** backend config / Docker · **Confidence** CONFIRMED · **Status** OPEN (fixed on `chain4a`)
**Size** XS · **BPV** YES · **BS** NO

**Evidence**
- `backend/src/manual-remediation/security-remediation-lifecycle.ts:7-8`:
  ```ts
  const value = process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;
  if (value === undefined || value.trim().toLowerCase() === 'true') return;   // allows dispatch
  ```
  → **unset means enabled** (fail-open kill switch).
- `grep -n "SECURITY_REMEDIATION" platform/docker-compose.yml` → no match.
- `backend/.env` does not define it either, and comments: *"NODE_ENV is intentionally left unset
  in this environment (not 'production')"* while setting `INTEGRATION_FIXTURES_ENABLED`.
- The running container is safe **only** because `/tmp/r2-backend-config.private.json` injects
  `SECURITY_REMEDIATION_DISPATCH_ENABLED=false` and `NODE_ENV=production`.
- `git show release/chain4a-r1-scoped:backend/Dockerfile` bakes
  `ENV NODE_ENV=production SECURITY_REMEDIATION_DISPATCH_ENABLED=false
  SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=false DB_SYNCHRONIZE=false` — **the fix already exists.**

**Observed** Starting the stack the documented way produces a backend that will dispatch real
remediations (and therefore real GitHub writes) and exposes the integration-fixture routes.
**Expected** Safety-critical switches default to off.
**Impact** Accidental live remediation during demo preparation; fixture routes reachable.
**Fix** Adopt the `chain4a` Dockerfile (comes free with AUD-002) and/or add the three variables
explicitly to `docker-compose.yml`. Invert the guard to `value === 'true'`.
**Fix risk** Very low.

---

### AUD-004 — The live WF6 definition exists only as an untracked file
**Severity** HIGH · **Component** n8n · **Confidence** CONFIRMED · **Status** OPEN
**Size** XS · **BPV** NO · **BS** YES

**Evidence**
- Live `RdYyfjVpOm2LxS95`, **active**, 184 nodes, `updatedAt 2026-10-05T16:40:02Z`.
- Node-name sets and per-node `sha256(type + parameters)` compared:
  - `n8n-workflows/pending-live-update/WF6-SAFE-ATTEMPT-LIFECYCLE.OFFLINE.json` → **0 node diffs,
    0 parameter diffs** = byte-equivalent to live. `git ls-files` → **UNTRACKED**.
  - the only *tracked* export, `wf6-security-remediation-maven.OFFLINE-DRAFT.json`, has **149
    nodes** (35 missing) and **79 nodes with different parameters**, and is itself modified.
- `n8n-workflows/active/` contains **no** WF6 export at all.
- The qualified-source bundles that pin every deployed artifact
  (`docs/qa/*/qualified-source.bundle`) are **all untracked**.

**Observed** The core workflow of the project is not in version control.
**Expected** The live definition is committed and recoverable from a clone.
**Impact** Loss of the n8n volume loses WF6. A `git clone` cannot reconstruct the platform.
**Fix** Commit `WF6-SAFE-ATTEMPT-LIFECYCLE.OFFLINE.json` (and the WF2 live export, and the
qualified-source bundles). Pure addition — zero runtime risk.
**Fix risk** None.

---

## P1 — SHOULD FIX BEFORE SOUTENANCE

### AUD-005 — Four unauthenticated webhook routes accept arbitrary findings and incidents
**Severity** HIGH · **Component** backend security · **Confidence** CONFIRMED · **Size** S · **BPV** NO · **BS** NO
`backend/src/webhooks/webhooks.controller.ts` has **no** `@UseGuards` at class or method level
(verified: 4 routes / 0 guards, whereas `manual-remediation.controller.ts:10` shows the
class-level pattern used elsewhere). Routes: `POST /api/webhooks/sonarqube/:projectId`,
`/jenkins/:projectId`, `/jenkins/by-job/:jobName`, `/trivy/:projectId`, all `@Body() body: any`
(no DTO, so `ValidationPipe({whitelist:true})` has nothing to enforce). `handleSonarqube`
persists bugs; `handleJenkins` creates incidents and can trigger WF4/WF5. Backend is published
on `0.0.0.0:3001` with `origin:'*'`. **Fix** apply `InternalSecretGuard` (already written and
fail-closed) + real DTOs.

### AUD-006 — SSRF through the unauthenticated Jenkins webhook
**Severity** HIGH · **Component** backend security · **Confidence** CONFIRMED · **Size** S · **BPV** NO · **BS** NO
`backend/src/webhooks/webhooks.service.ts:82` —
`await fetch(\`${buildUrl}consoleText\`, { signal: AbortSignal.timeout(15000) })` where
`buildUrl = payload.build_url` comes straight from the unauthenticated body (line 76). No
scheme or host allowlist. The response is parsed and stored into `errorReason` on the incident,
so it is **SSRF with response reflection** reachable from the LAN against internal services
(`n8n:5678`, `sonarqube:9000`, `172.19.0.1:7799`, cloud metadata). Mitigations present: 15 s
timeout, only on `status=FAILURE`, extraction filter. **Fix** allowlist the configured Jenkins
base URL.

### AUD-007 — WF2, a Git-writing workflow, has an unauthenticated webhook on a LAN-exposed n8n
**Severity** HIGH · **Component** n8n security · **Confidence** CONFIRMED · **Size** XS · **BPV** NO · **BS** NO
Live `u3eeMwTuhCsetfcS` webhook: `path: wf2-r22e-test`, `httpMethod: POST`,
`authentication: <NONE>`, no credentials — contrast WF6, which correctly uses
`authentication: headerAuth` + `httpHeaderAuth`. n8n is published on `0.0.0.0:5678`. WF2 owns
two GitHub-mutating nodes. Also: the production dispatch target in `backend/.env` is this
*test*-named path. Currently mitigated only by AUD-001 (the flow dies at the 404) and by the
LLM/verification gates. **Fix** add header auth to the WF2 webhook; rename off `-test`.

### AUD-008 — Hardcoded JWT fallback secret in two places
**Severity** HIGH · **Component** auth · **Confidence** CONFIRMED · **Size** XS · **BPV** NO · **BS** NO
`backend/src/auth/auth.module.ts:18` and `backend/src/auth/jwt.strategy.ts:12` both
`config.get('JWT_SECRET', 'devsecops-secret-2024')`. If `JWT_SECRET` is unset the service signs
and accepts tokens with a secret published in the repository → admin-token forgery. The value
actually in use is also weak (`devsecops-super-secret-2026`) and appears in plaintext in
`/tmp/r2-backend-config.private.json`. `expiresIn: '7d'`, no revocation. **Fix** throw on
missing `JWT_SECRET`; rotate.

### AUD-009 — `backend/Dockerfile` (the one compose uses) swallows build failures
**Severity** HIGH · **Component** Docker/build · **Confidence** CONFIRMED · **Size** XS · **BPV** NO · **BS** NO (fixed on `chain4a`)
`docker-compose.yml:77` is `build: ./backend`, so `backend/Dockerfile` is the production build
path. It contains
`RUN npm run build 2>/dev/null || npx @nestjs/cli build || true` — a compile error yields a
**green build with no/stale `dist`**. Also `npm install` (not `ci`), floating `FROM node:20-alpine`,
no `USER` (runs as **root**), `EXPOSE 3000` while the app listens on 3001. The `chain4a`
Dockerfile fixes all five. **Fix** adopt it (free with AUD-002).

### AUD-010 — No migration ledger; most migrations untracked on the freeze branch
**Severity** HIGH · **Component** database · **Confidence** CONFIRMED · **Size** S · **BPV** NO · **BS** NO
No `*migration*` table exists in `devsecops` (`pg_tables` query returned empty), confirming the
project's own `MIGRATION_LEDGER_EXISTS = NO`. 7 SQL files in `backend/migrations/`, only **3
tracked** on `theme-vermeg-reconciled`; the Phase 4G reservations, retry-E2E plans and
deployment-authorization migrations are untracked here (they are tracked on `chain4a`). Only one
`.down.sql` exists. Classification: **SCHEMA_PRESENT_WITHOUT_LEDGER** — the Phase 4G table is
live with correct constraints, but applied state is not recorded anywhere.
Idempotency is good (`IF NOT EXISTS` guards present in all but 2 DDL statements).
**Fix** commit all 7 + add a one-table ledger, or document the manual procedure explicitly.

### AUD-011 — Deployed artifacts' exact source is unreachable from any branch
**Severity** HIGH · **Component** reproducibility · **Confidence** CONFIRMED · **Size** S · **BPV** NO · **BS** YES
`git cat-file -t` fails for the candidate-verifier revision `62dd93fe…` and the builder-scanner
revision `9038f556…` — neither exists in the repository. Each is recoverable **only** from
`docs/qa/practical-closure-20261007/qualified-source.bundle` and
`docs/qa/final-closure-r2-20261007/qualified-source.bundle`, both of which are **untracked**.
The base images are local-only (`local/practical-verifier-base:pinned`,
`local/r2-builder-qualified:repro1`) and in no registry. **Fix** commit the bundles; create
branches/tags at those commits.

### AUD-012 — Runtime configuration lives in ephemeral `/tmp` files containing plaintext secrets
**Severity** HIGH · **Component** DevSecOps · **Confidence** CONFIRMED · **Size** S · **BPV** NO · **BS** NO
Compose labels: `com.docker.compose.project.config_files` =
`/tmp/r2-backend-config.private.json`, `/tmp/practical-verifier-deploy.private.json`,
`/tmp/r2-scanner-deploy.private.json`; `working_dir = /tmp`. These hold `JWT_SECRET`,
`N8N_API_KEY`, `N8N_CALLBACK_SECRET`, `N8N_INTERNAL_SECRET`, `AZURE_DEPLOY_AGENT_SECRET`,
`DB_PASS` in cleartext (mode 0600) and **are the only record of the running configuration**. A
reboot or `/tmp` sweep makes the current deployment unreproducible. **Fix** promote to a tracked
compose override + `.env.example`; rotate the secrets afterwards.

### AUD-013 — Backend harness flag and live WF6 barrier are out of sync
**Severity** MEDIUM · **Component** backend ↔ WF6 · **Confidence** CONFIRMED · **Size** XS · **BPV** NO · **BS** NO
`WF6-SAFE-RETRY-E2E-HARNESS.OFFLINE.json` (185 nodes) differs from live (184) by exactly one
node — `Operator Test Barrier?` — which is **not live**; all shared nodes are parameter-identical.
The backend still honours `SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED`
(`retry-e2e-harness.logic.ts:4`). Enabling the harness today would run without the
workflow-side barrier. Currently safe (flag = `false`). **Fix** do not enable the harness until
that WF6 revision is promoted.

### AUD-014 — The freeze branch re-registers the legacy reconciliation path
**Severity** MEDIUM · **Component** backend architecture · **Confidence** CONFIRMED · **Size** XS · **BPV** NO · **BS** NO
Working-tree `manual-remediation.module.ts:21-22` registers `LegacyReconciliationController`
(`@Controller('manual-remediation/legacy-reconciliation')`), `LegacyReconciliationService` and
`LegacyRemoteSettlement`. `chain4a` removes all three — and its `RELEASE-SOURCE.md` states the
intent: *"No normal application provider imports or registers historical legacy reconciliation
catalogs/services… Operator reconciliation tooling is separately located in
tools/legacy-oneshot and is never copied into the application image."* Classification:
**DANGEROUS_LEGACY_PATH** (admin-only and guarded by `DISPATCH_ENABLED === 'false'`, so not
currently exploitable). **Fix** comes free with AUD-002.

### AUD-015 — PostgreSQL published on all interfaces with a weak password
**Severity** MEDIUM · **Component** Docker/DB · **Confidence** CONFIRMED · **Size** XS
`docker ps` → `pfe-postgres 0.0.0.0:5433->5432/tcp`; `DB_PASS=devsecops123`, `DB_USER=devsecops`.
Trivially brute-forceable from the LAN; the database is the system of record for every
remediation decision. **Fix** bind to `127.0.0.1:5433`.

### AUD-016 — Permissive HTTP posture: CORS `*` + credentials, public Swagger, 100 MB bodies, no rate limiting
**Severity** MEDIUM · **Component** backend security · **Confidence** CONFIRMED · **Size** S
`backend/src/main.ts:16` `app.enableCors({ origin: '*', credentials: true })` (an invalid and
over-broad combination); line 25 mounts Swagger at `api/docs` with no guard — full API
disclosure; lines 13-14 `json({limit:'100mb'})` on every route — DoS surface; and
`grep -E "helmet|throttler|csurf|rate-limit" backend/package.json` → **none**. **Fix** restrict
the origin, guard or disable Swagger in production, lower the limit on non-report routes,
add `helmet` + `@nestjs/throttler`.

### AUD-017 — The deployed UI's "cancel remediation" control 404s
**Severity** MEDIUM · **Component** frontend ↔ backend · **Confidence** CONFIRMED · **Size** XS · **BPV** NO · **BS** YES
The served bundle contains the call (`grep` hit in
`/usr/share/nginx/html/chunk-KOZ4Q64Q.js`), wired from
`incident-detail.component.html:71` (`*ngIf="canCancelFix()"`) →
`incident-detail.component.ts:891` → `api.service.ts:110` →
`POST …/remediation/{requestId}/cancel`, which the deployed backend answers **404**
(AUD-001). A visible dead button if an incident reaches a cancellable state during the demo.
**Fix** resolved by AUD-001/002.

### AUD-018 — `README.md` is stale and in places misleading
**Severity** MEDIUM · **Component** documentation · **Confidence** CONFIRMED · **Size** S · **BPV** NO · **BS** YES
`README.md` advertises the backend and Swagger on **port 3000** (actual: 3001); credits bug
fixing to **"analyse OpenAI"** while the live WF2 calls `api.anthropic.com/v1/messages` (3
nodes); presents `docker-compose up -d` as the quick start, which yields the unsafe
configuration of AUD-003 and omits the three required secrets (`JWT_SECRET`,
`POSTGRES_PASSWORD`, `BUILDER_INTERNAL_SECRET`, with **no `.env.example`** anywhere); publishes
default credentials; describes a bug lifecycle (`open → ai_fixing → pr_created → resolved`) that
does not exist in `manual_remediation_tasks`; and never mentions WF6, the candidate verifier,
the builder-scanner or Phase 4G — i.e. the entire core of the project. **Fix** rewrite against
the real architecture before the report references it.

---

## P2 — ACCEPTABLE LIMITATION / DOCUMENT IN THE REPORT

### AUD-019 — Target resolution is Maven-only; the freeze branch hardcodes `pom.xml`
**Confidence** CONFIRMED · **Size** M (do **not** attempt before soutenance)
Working tree `backend/src/manual-remediation/remediation-target-reservation.ts:29-32`:
`productionTarget()` returns `canonicalTarget(task.projectId, 'pom.xml', …)` for every task,
with the honest comment *"A future multi-module dispatcher must supply its trusted resolved
file here."* The key *shape* is generic (`JSON.stringify(['v1','FILE',file])`) and includes
`projectId`, so cross-project concurrency is correct, but two findings in different Maven
modules of the same project collapse onto one key → **over-serialization** (safe, not unsafe).
The deployed `chain4a` build replaces this with an adapter-based `TrustedTargetResolver`;
`RELEASE-SOURCE.md` is explicit that *"the admission/worker pipeline still supports Maven only;
cross-ecosystem resolver tests demonstrate extensibility, not new ecosystem remediation
support."* Classification: **VALID documented limitation**, not `INVALID_RUNTIME_HARDCODING`,
provided the report states it.

### AUD-020 — Two thirds of the spec files are outside the authoritative regression manifest
**Confidence** CONFIRMED · **Size** S
287 spec files exist (backend 130, candidate-verifier 41, builder-scanner 16, frontend 28,
n8n scripts 72); `regressions-final.json` names **87**. Independent re-run (this audit,
`EVIDENCE/independent-regression-run.json`): **72 passed, 0 failed**, 13 skipped
(builder-scanner — needs Docker + `SYS_ADMIN`), **2 missing** (AUD-002). So what is in the
manifest is genuinely green; the gap is execution coverage, not failing tests.

### AUD-021 — No standard test entry point
**Confidence** CONFIRMED · **Size** XS
`backend/package.json` scripts are `build/start/start:dev/seed/seed:clean` — **no `test`**.
Tests run as `node -r ts-node/register <file>` (Node's native runner) orchestrated by per-QA-run
ad-hoc Python (`docs/qa/*/run-regressions.py`). A new engineer cannot run the suite from the
repo. **Fix** add a `test` script that walks the manifest.

### AUD-022 — Debug/probe workflows and a duplicate-named WF2 remain in the n8n instance
**Confidence** CONFIRMED · **Size** XS
Of 24 workflows: 6 are `R52–R60-SONAR-*-PROBE-TEMP (safe to delete)`, plus
`DEBUG-create-pr-only` (a bare 6-node **PR-creating** workflow), `DEBUG-github-fetch-probe` and
`My workflow`. All inactive. Two workflows share the name *"WF2 — Git Patch & PR v5 CANONICAL
(R22E + Brique 5)"* — `DSwtkgWBK6qm2z8A` (inactive, 186 nodes) and `u3eeMwTuhCsetfcS` (active,
195). `N8N_WF2_ID` correctly targets the active one, but the duplicate name is an operational
hazard during a live demo.

### AUD-023 — Logging is unstructured and uncorrelated; no metrics endpoint
**Confidence** CONFIRMED · **Size** M (defer)
212 `console.{log,warn,error}` calls in `backend/src`, no `winston`/`pino`/`nestjs-pino`
dependency, no request-id or correlation middleware, and no Prometheus exporter despite
`prometheus` + `grafana` running. Offsetting strength: `GET /healthz` performs a real
`SELECT 1`, and per-finding history is reconstructable from the database (see main report §4).

### AUD-024 — Accumulated runtime resources
**Confidence** CONFIRMED · **Size** XS
150 dangling Docker images; Jenkins `VermegPFE-Watcher` at build **#3125** with no visible
rotation; stale workspaces `amri souhaiel` (57 MB), `amri souhaiel@2` (56 MB),
`pfe-app-test-multibranch_PR-33@libs`, `test`; `platform/` occupies 2.2 GB. No cleanup needed
before soutenance, but disk exhaustion is the most likely way to break a demo day.

### AUD-025 — Vestigial column and missing foreign keys on the reservation table
**Confidence** CONFIRMED · **Size** XS
`remediation_target_reservations.expiresAt` exists but is pinned by
`CHECK ("expiresAt" IS NULL)` — dead schema. The table has **no** foreign keys on `projectId`
or `ownerTaskId` (unlike `manual_remediation_tasks`, which has both), so orphan rows are
possible. Also `releaseTargetClaim`/`settleTargetClaim` filter on `(projectId, state, claims ? taskId)`
without `targetKey`; harmless while one reservation per project exists (AUD-019) but worth
tightening when multi-module support lands.

### AUD-026 — `CLOSED` is labelled "Corrigée"
**Confidence** CONFIRMED · **Size** XS
`frontend/src/app/shared/status-labels.ts:22` maps `CLOSED → 'Corrigée'` ("Corrected"). The
guard rails are correct elsewhere — `wf6-remediation-badge.ts` states *"Historical CLOSED is
never a proposal"* and only `CANDIDATE_READY` yields a positive badge — but a jury probing the
"CLOSED ≠ the project is corrected" invariant will see that word first. Prepare the answer, or
relabel to "Clôturée".

### AUD-027 — Host-plane Docker-in-Docker is privileged with a published port
**Confidence** CONFIRMED · **Size** S (do not change before soutenance)
`/home/souhaiel/pfe-2026/docker-compose.yml:163` — `docker-dind`, `privileged: true`,
`0.0.0.0:2376`. Standard for Jenkins DinD and TLS-protected, but it is a host-compromise
surface. **Note the contrast and use it in the report:** the *remediation* plane
(`platform/docker-compose.yml`) mounts **no** `docker.sock` anywhere, keeps
candidate-verifier at zero elevated capability, and grants `SYS_ADMIN` to builder-scanner only.

---

## P3 — POST-SOUTENANCE

- **AUD-028** Unused `bcrypt` dependency — only `bcryptjs` is imported
  (`backend/src/auth/auth.service.ts:6`); both `bcrypt` and `bcryptjs` plus both `@types` are
  declared. Native build fragility and image bloat for nothing. CONFIRMED.
- **AUD-029** `InternalSecretGuard` compares with `===`
  (`backend/src/auth/internal-secret.guard.ts`) — not constant-time. Low risk over an internal
  network; the guard is otherwise correctly **fail-closed**. CONFIRMED.
- **AUD-030** `countHighCriticalVulnerabilities` (`security-artifact-scan.ts:88-100`) returns
  `0` on a malformed report, and `dependency-compatibility-decision.ts:85` treats `> 0` as
  `REJECTED` — so a malformed report reads as "no regression". Mitigated because `null` is
  correctly distinguished (`:84 → NOT_TESTED / SECURITY_RESCAN_NOT_RUN`) and because
  `cveTargets()` throws on malformed reports earlier in the same flow. **SUSPECTED** as a
  practical risk; the asymmetry is real and worth closing.
- **AUD-031** Dead frontend method `updateUser` → `PUT /api/auth/users/:id`
  (`api.service.ts:88`): no backend route (auth exposes only `login`, `register`, `GET users`,
  `DELETE users/:id`) **and no caller** — dead code, not a dead button. CONFIRMED.
- **AUD-032** Three controllers are declared inside `*.module.ts`
  (`jenkins-optimizer.module.ts:85` `@Controller('jenkins')`,
  `dockerfile-optimizer.module.ts:64` `@Controller('dockerfile')`,
  `azure-deploy.module.ts:60` `@Controller('azure-deploy')`). Harmless, but it defeats
  file-based route discovery — it produced seven false positives in this audit's first
  contract scan. CONFIRMED.
- **AUD-033** The outer repository `/home/souhaiel/pfe-2026/.git` (3 commits, 117 tracked
  files, 212 dirty paths, 51 staged deletions) nests the real repository and will mislead
  anyone who clones or inspects the wrong level. CONFIRMED.
