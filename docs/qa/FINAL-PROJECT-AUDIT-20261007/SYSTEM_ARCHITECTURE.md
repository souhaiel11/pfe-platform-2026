# SYSTEM ARCHITECTURE — reconstructed from source + runtime, 2026-10-07

## SYSTEM_COMPONENT_INVENTORY

| Component | Responsibility | Stack | Runtime | Incoming | Outgoing | Persistence | Security boundary | Status |
|---|---|---|---|---|---|---|---|---|
| Frontend | Presentation only; translates canonical backend values to FR labels | Angular (standalone, lazy routes) | `pfe-frontend` nginx:alpine, `0.0.0.0:4200` | browser | `/api` via nginx proxy | none | JWT in browser; route guards `authGuard`/`editorGuard`/`adminGuard` | **RUNNING, matches source** |
| Backend | Decisions, persistence, authorization, orchestration, the only GitHub-token holder on the control plane | NestJS 10 + TypeORM | `pfe-backend`, `0.0.0.0:3001`, non-root | frontend, n8n, Jenkins/Sonar/Trivy webhooks | Postgres, n8n, candidate-verifier, GitHub, Azure agent | Postgres | JWT, `InternalSecretGuard` (fail-closed), service-layer role checks | **RUNNING from `0957ab6`, ahead of freeze branch** |
| PostgreSQL | System of record | postgres:16-alpine | `pfe-postgres`, `0.0.0.0:5433` | backend | — | 16 tables | DB creds; **LAN-exposed** | **RUNNING, healthy** |
| n8n | Workflow execution plane (WF1–WF6) | n8nio/n8n:latest | `n8n`, `0.0.0.0:5678` | webhooks | backend, GitHub, Anthropic | own volume | WF6 webhook = headerAuth; **WF2 webhook = none** | **RUNNING, 7 active of 24** |
| Candidate verifier | Exact-SHA workspace materialization, Maven/Gradle/Python build + test, candidate identity. Owns no DB, no JWT, no GitHub write | Node 20 + TS, Debian | `pfe-candidate-verifier`, port 4100 **not published**, zero elevated capability | backend | builder-scanner | ephemeral workspaces | one secret only (`BUILDER_INTERNAL_SECRET`) | **RUNNING from `62dd93fe` (not in repo)** |
| Builder scanner | The only process that execs `podman` + `trivy` | Node 20 + Podman + Trivy 0.72.0 (pinned, SHA-verified) | `pfe-builder-scanner`, port 4200 **not published**, `cap_add: SYS_ADMIN`, `init: true` | candidate-verifier | registries | caches in volumes | one shared secret, fail-closed if unset | **RUNNING from `9038f556` (not in repo)** |
| Trivy | Image-archive CVE scanning | binary 0.72.0 inside builder-scanner | — | builder-scanner | Trivy DB | cache volume | — | **ACTIVE, pinned** |
| OWASP Dependency-Check | Dependency CVE rescan | maven plugin 12.2.2 | inside verifier image | verifier | NVD data | maven cache | — | **ACTIVE, pinned** |
| SonarQube | Code quality / QG | sonarqube:latest | `sonarqube`, `:9000` | Jenkins | backend webhook | own DB | token | **RUNNING, unpinned tag** |
| Jenkins | CI; 8 jobs | pfe-jenkins-with-docker-cli:2.568.1-jdk21 | `jenkins`, `:8082`, `:50000` | SCM/webhooks | backend, Sonar, DinD | `jenkins_home` | credentials store | **RUNNING** |
| Docker-in-Docker | Jenkins build engine | docker:dind | `jenkins-docker`, **privileged**, `:2376` | Jenkins | — | volumes | TLS certs | **RUNNING, privileged** |
| ZAP | DAST (historical findings present in DB) | zap image | containers all **exited** | — | — | — | — | **NOT RUNNING** |
| Nexus / Grafana / Prometheus / Ollama | Artifacts, dashboards, metrics, local LLM | various `:latest` | running | — | — | volumes | — | **RUNNING, peripheral** |
| Azure deploy agent | Host-side agent; sole holder of `~/.azure` | Python | host process on `172.19.0.1:7799` | backend | Azure | — | `X-Agent-Secret` | referenced; host-dependent IP |

## Text architecture

```
                         ┌──────────────┐
  browser ──────────────►│  Frontend    │  nginx :4200   (presentation only)
                         └──────┬───────┘
                                │ /api  (JWT)
                                ▼
 Jenkins ─┐              ┌──────────────────────────────────────────┐
 Sonar   ─┼─ webhooks ──►│              BACKEND  :3001              │
 Trivy   ─┘ (NO AUTH!)   │  decisions · authz · state · audit trail │
                         │  the only GitHub-token holder here       │
                         └──┬────────┬──────────────┬───────────────┘
                            │        │              │
                 Postgres ◄─┘        │              └─► Azure agent (host)
              (16 tables,            │
               DB-enforced           ▼
               invariants)   ┌───────────────┐   headerAuth
                             │   n8n :5678   │◄──────────── backend dispatch
                             │ WF1 … WF6     │
                             └──┬─────────┬──┘
                   Anthropic ◄──┘         │ callbacks (X-Internal-Secret)
                   (WF2 LLM)              ▼
                                   ┌──────────────────┐   no published port
                                   │ candidate-verifier│  zero capability
                                   │  build + test     │  no DB, no secrets
                                   └─────────┬────────┘
                                             │ BUILDER_INTERNAL_SECRET
                                             ▼
                                   ┌──────────────────┐   no published port
                                   │ builder-scanner  │   CAP_SYS_ADMIN only
                                   │ podman + trivy   │
                                   └──────────────────┘
                                             │
                                   ═══════ PRE-GIT BARRIER ═══════
                                   39 sequential gates before the
                                   first GitHub mutation (WF6)
                                             ▼
                                        GitHub (branch/commit/PR)
```

## Control flows (as actually implemented)

### A — Normal scan → D — dispatch
| Transition | Producer | Consumer | Transport | Auth | Correlation | On failure | Retry | Idempotency |
|---|---|---|---|---|---|---|---|---|
| Jenkins build → findings | Jenkins | `POST /api/webhooks/jenkins/:projectId` | HTTP | **NONE** | `projectId`, `buildNumber` | incident created regardless | none | `routed_builds` hash + 24 h TTL guard |
| Finding → task | backend | Postgres | SQL | — | `findingFingerprint` | tx | — | **UNIQUE (projectId, findingFingerprint)** |
| Task → batch dispatch | `launchBatchRemediation()` | n8n WF6 webhook | HTTP | headerAuth | `attemptId`, `attemptNumber`, `batchId` | `assertSecurityRemediationDispatchEnabled()` → 503 | `MAX_AUTOMATIC_ATTEMPTS = 3` | target reservation (single writer) |
| Reservation | backend | `remediation_target_reservations` | SQL `ON CONFLICT … DO NOTHING` + `FOR UPDATE` | — | `(projectId, targetKey)` | `REMEDIATION_TARGET_ALREADY_IN_PROGRESS` | `WAITING_RETRY` claim | **partial UNIQUE index WHERE state='ACTIVE'** |

### E–H — candidate generation, build, Trivy, OWASP
| Transition | Producer | Consumer | Auth | Correlation | On failure |
|---|---|---|---|---|---|
| WF6 → evaluate | n8n | `POST /api/internal/security-remediation/…` | internal secret | `attemptId` | typed technical-failure branch, never "clean" |
| backend → verifier | backend | `candidate-verifier:4100/verify` | none needed (network-isolated, no secrets held) | candidate digest + base SHA | `VERIFIER_TIMEOUT` → retryable |
| verifier → scanner | verifier | `builder-scanner:4200` | `BUILDER_INTERNAL_SECRET` | artifact digest | fail-closed if secret unset |
| scanner → Trivy/OWASP | podman/trivy | report JSON | — | `reportDigest`, `artifactDigest` | `INCOMPLETE_SECURITY_SCAN` / `MALFORMED_OR_FILTERED_SECURITY_SCAN` thrown |
| closure decision | `provesSecurityClosure()` | orchestrator | — | target CVE + affected packages | `try/catch → false` (**fail-closed**) |

### I — retry
New `attemptId` **and** new `batchId` per attempt; `attemptNumber` increments once;
non-retryable reasons never produce another attempt. Proven on live data — see the main
report, §4.

### J–K — Git write and final verification
Four GitHub-mutating nodes in live WF6, each with exactly **one** predecessor, each an
`IF` gate: `Write Authorized? (New Branch)` → `Create Missing Branch`;
`Branch Created Exactly?` → `Write File To Branch`; `Authorized Branch Unchanged?` →
`Create Pull Request`; `Created PR Head Exact?` (false branch) → `Close Drifted Created PR`
(compensating cleanup). No bypass path exists.

### L — deployment
`azure-deploy` module with `DEPLOYMENT_AUTHORIZATION_REQUIRED=true`, a
`deployment_authorizations` table and a governance-decision policy. Implemented;
the Azure agent is a host process, not a container.

## ALL_GIT_WRITERS

| Writer | Trigger | Preconditions | Validation gates before mutation | Possible bypass |
|---|---|---|---|---|
| WF6 `Create Missing Branch` | live WF6 webhook (headerAuth) | candidate verified, base SHA resolvable, ancestry proven, PR36 protection, revalidated | **39 gate hops**, incl. `Revalidate Before Write` + `Fresh Candidate Matches` + `Write Authorized?` | none found |
| WF6 `Write File To Branch` | WF6 | branch created exactly as authorized | `Branch Created Exactly?` | none found |
| WF6 `Create Pull Request` | WF6 | authorized branch unchanged | `Authorized Branch Unchanged?` | none found |
| WF6 `Close Drifted Created PR` | WF6 | created PR head not exact | compensating action, not a content write | n/a |
| WF2 `Create Missing Branch` | **unauthenticated** webhook `wf2-r22e-test` | LLM plan + candidate verification + write guard + head-drift guard + pre-git cancellation gate | several, but **the pre-git gate currently 404s** → node errors → workflow stops (fail-closed) | **webhook itself is unauthenticated and LAN-reachable** |
| WF2 `Create Pull Request1` | WF2 | as above | as above | same |
| `DEBUG-create-pr-only` (n8n, 6 nodes) | manual | none | **none** | **inactive**, but it is a bare PR-creating workflow left in the instance |
| Backend | — | no backend code path creates a branch, commit or PR; GitHub writes are exclusively n8n-side | — | — |

The backend holding the GitHub token while performing **no** Git mutation itself, and all
mutation living behind the WF6 gate chain, is the strongest architectural property of the
system.
