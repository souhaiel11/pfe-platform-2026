# RUNTIME / SOURCE DRIFT — 2026-10-07

Read-only audit. No source, container, workflow, DB row or Git state was modified.

## Repository topology (important)

Two nested Git repositories exist. The outer one is a decoy.

| Path | Commits | Tracked files | Role |
|---|---|---|---|
| `/home/souhaiel/pfe-2026/.git` | 3 | 117 | **Not the project repo.** 212 dirty paths, 51 deletions, the whole `platform/` tree effectively unmanaged (37 tracked backend `.ts` vs 347 on disk). |
| `/home/souhaiel/pfe-2026/platform/.git` | — | 690 | **The real repository.** `origin = github.com/souhaiel11/pfe-platform-2026`. Checked out branch `theme-vermeg-reconciled` @ `206a8a7`, **413 dirty paths** (318 untracked, 90 modified). |

All statements below refer to the inner (real) repository.

## The central drift: a forked release lineage

The running platform and the branch that is about to be frozen are **two different advances that were never merged**.

```
206a8a7  theme-vermeg-reconciled   <-- CHECKED OUT, + 413 dirty paths
   |                                    working tree adds: WF2 true cancellation (R91)
   |                                    working tree still registers: legacy reconciliation
   |
   +-- 07c7421  release/chain3a-r1-generic    (generic Phase 4G baseline)
        |
        +-- 0957ab6  release/chain4a-r1-scoped  <-- **THIS IS WHAT RUNS**
                                                  adds TrustedTargetResolver,
                                                  scoped-e2e-dispatch, hardened Dockerfile
```

`theme-vermeg-reconciled` can **fast-forward** to `release/chain4a-r1-scoped`
(`git merge-base --is-ancestor` → true; gap = 2 commits, 140 files, +23 830 lines).

### What the deployed backend has that the working tree does NOT

| Component | Working tree | Deployed (`0957ab6`) |
|---|---|---|
| `backend/src/manual-remediation/trusted-remediation-target.ts` | **absent** | present (`/app/dist/manual-remediation/trusted-remediation-target.js`) |
| `backend/src/security-remediation/scoped-e2e-dispatch.ts` | **absent** | present (`/app/dist/security-remediation/scoped-e2e-dispatch.js`) |
| Generic target resolution | `productionTarget()` hardcodes `'pom.xml'` | adapter-based, tree-verified, binding-immutable |
| Hardened Dockerfile | `|| true`, `npm install`, root, EXPOSE 3000 | digest-pinned, `npm ci`, fatal build, `USER node`, safe ENV defaults |
| Legacy reconciliation registered | **yes** (controller + 2 providers) | **no** (removed) |

Two spec files named by the authoritative regression manifest
(`docs/qa/final-closure-r2-20261007/regressions-final.json`) are **missing from the working
tree** for exactly this reason:
`backend/src/manual-remediation/trusted-remediation-target.spec.ts`,
`backend/src/security-remediation/scoped-e2e-dispatch.spec.ts`.

### What the working tree has that the deployed backend does NOT

The WF2 true-cancellation feature (dated 2026-10-04), which the **live, ACTIVE WF2
workflow depends on**:

- `@Post(':id/remediation/:requestId/execution-started')` — controller line 134
- `@Post(':id/remediation/:requestId/pre-write-gate')` — controller line 139
- `@Post(':id/remediation/:requestId/cancel')` — controller line 144
- `backend/src/incidents/wf2-cancellation.types.ts`, `wf2-cancellation.spec.ts` (both untracked)

Proven absent from the deployed runtime by live probe (`EVIDENCE/route-probe.txt`):

```
POST .../pre-write-gate            -> HTTP 404
POST .../execution-started         -> HTTP 404
POST .../cancel                    -> HTTP 404
POST .../reconcile-stale-dispatch  -> HTTP 401   <-- control: route exists, guard rejected
GET  /healthz                      -> HTTP 200   <-- control: service healthy
```

The 401 control proves the method is sound: a registered route returns 401 at the guard,
an unregistered route returns 404.

## SOURCE_RUNTIME_DRIFT_MATRIX

| Component | Source of record | Running artifact | Classification | Evidence |
|---|---|---|---|---|
| Backend | `0957ab6` on `release/chain4a-r1-scoped` | `sha256:8ee224f9…` | **DANGEROUS_DRIFT** — not an ancestor of the checked-out branch; breaks live WF2 | OCI label `org.opencontainers.image.revision`; `git merge-base`; route probe |
| Candidate verifier | `62dd93fe` — **not in the repository**, only inside `docs/qa/practical-closure-20261007/qualified-source.bundle` (untracked) | `sha256:947ceacf…` | **UNTRACKED_DRIFT** | `git cat-file -t 62dd93fe` → bad object; `git bundle list-heads` |
| Builder scanner | `9038f556` — **not in the repository**, only inside `docs/qa/final-closure-r2-20261007/qualified-source.bundle` (untracked) | `sha256:8581ec8d…` | **UNTRACKED_DRIFT** | same method |
| Frontend | working tree | bundle built 2026-10-06 12:18 | **MATCH** (0 source files newer than the bundle) | `find src -newermt` |
| WF6 (n8n) | untracked `n8n-workflows/pending-live-update/WF6-SAFE-ATTEMPT-LIFECYCLE.OFFLINE.json` | live `RdYyfjVpOm2LxS95`, 184 nodes, ACTIVE | **MATCH to the untracked file / UNTRACKED_DRIFT vs git** — 0 node and 0 parameter differences; the only *tracked* export has 149 nodes and 79 differing nodes | node+parameter SHA-256 comparison |
| WF2 (n8n) | tracked exports under `n8n-workflows/pending-live-update/` | live `u3eeMwTuhCsetfcS`, 195 nodes, ACTIVE, updated 2026-10-06 | **DANGEROUS_DRIFT** — requires backend routes that the deployed backend lacks | live API export + route probe |
| Runtime configuration | **none in the repository** | `/tmp/r2-backend-config.private.json`, `/tmp/practical-verifier-deploy.private.json`, `/tmp/r2-scanner-deploy.private.json` | **DANGEROUS_DRIFT** — ephemeral, plaintext secrets, lost on reboot | compose label `project.config_files` |
| DB schema | `backend/migrations/*.sql` (4 of 7 untracked on this branch) | 16 tables; Phase 4G table present with correct constraints | **SCHEMA_PRESENT_WITHOUT_LEDGER** | `\dt`; no `*migration*` table exists |
| Base images | not in any registry | `local/practical-verifier-base:pinned`, `local/r2-builder-qualified:repro1` | **UNKNOWN** — local-only; unrebuildable if pruned | `docker images` |

## Why the runtime is *better* than the freeze branch

This is the counter-intuitive and most important conclusion. `release/chain4a-r1-scoped`
(the deployed lineage) fixes, by its own `backend/RELEASE-SOURCE.md` and verified in the
image history:

- fail-open dispatch default → `ENV SECURITY_REMEDIATION_DISPATCH_ENABLED=false` baked in
- swallowed build errors → `RUN npm run build` with no `|| true`, `npm ci` + lockfile
- unpinned base image → `FROM node@sha256:2cf067cf…`
- root container → `USER node`
- `pom.xml` hardcoding → `TrustedTargetResolver` + `TargetAdapter`
- legacy reconciliation in the app image → moved to `tools/legacy-oneshot`

Freezing the current checkout therefore **regresses** the platform. The freeze must be
performed on the reconciled lineage, not on `theme-vermeg-reconciled` as it stands.
