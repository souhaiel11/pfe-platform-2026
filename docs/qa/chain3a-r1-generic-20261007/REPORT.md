# CHAIN3A_R1_GENERIC_PHASE4G_RELEASE_REPORT

Qualified a new tracked source baseline on `release/chain3a-r1-generic` in `/tmp/chain3a-r1-source`. The original working source was preserved; its existing unrelated changes were not staged. No live deployment or migration occurred.

```text
INVALID_HARDCODING_BEFORE = 1115 occurrences; exact files/lines in hardcoding-before.json
TARGET_RESOLUTION_DYNAMIC = YES
TARGET_RESOLVER_CONTRACT = TargetAdapter + TrustedTargetResolver.resolve(task, project, incident) -> FILE/trustedTargetPath/key
RESERVATION_KEY_FUNCTION = canonicalTarget: normalized project UUID + FILE + normalized relative path; PostgreSQL unique(projectId,targetKey)
TARGET_PATH_TRUST_SOURCE = Backend strategy selection + immutable repository Git tree at persisted incident sourceCommitSha; project/repository/incident ownership cross-checked
TARGET_PATH_VALIDATION = Nonempty canonical relative ASCII path; rejects traversal/absolute/aliases/.git; exact Git blob membership, regular mode, full object SHA; truncated tree rejected; retry target/repository binding stable
UNRESOLVED_TARGET_FAILS_CLOSED = YES
PHASE4G_PROJECT_AGNOSTIC = YES
ECOSYSTEM_ADAPTER_BOUNDARY = YES — strategy wired at module boundary; reservation layer has no ecosystem filename fallback
LEGACY_CATALOG_IN_RUNTIME = NO
RUNNER_MANIFEST_DRIVEN = YES
HARNESS_CVE_AGNOSTIC = YES
HARNESS_PROJECT_AGNOSTIC = YES
HARNESS_PLAN_DRIVEN = YES
HARNESS_DEFAULT_ENABLED = false
HARNESS_INERT_WHEN_DISABLED = YES
UNTRACKED_4G_FILES_BEFORE = ["backend/migrations/20261005_add_retry_e2e_test_plans.sql", "backend/migrations/20261006_add_remediation_target_reservations.down.sql", "backend/migrations/20261006_add_remediation_target_reservations.sql", "backend/src/manual-remediation/legacy-reconciliation-catalog.ts", "backend/src/manual-remediation/legacy-reconciliation.controller.ts", "backend/src/manual-remediation/legacy-reconciliation.dto.ts", "backend/src/manual-remediation/legacy-reconciliation.service.ts", "backend/src/manual-remediation/legacy-reconciliation.spec.ts", "backend/src/manual-remediation/legacy-reconciliation.ts", "backend/src/manual-remediation/legacy-remote-settlement.ts", "backend/src/manual-remediation/lifecycle-test-transaction.ts", "backend/src/manual-remediation/remediation-target-reservation.spec.ts", "backend/src/manual-remediation/remediation-target-reservation.ts", "backend/src/manual-remediation/retry-security-remediation.dto.ts", "backend/src/manual-remediation/security-remediation-bridge.spec.ts", "backend/src/manual-remediation/security-remediation-lifecycle.spec.ts", "backend/src/manual-remediation/security-remediation-lifecycle.ts", "backend/src/manual-remediation/target-reservation-test-query.ts", "backend/src/security-remediation/retry-e2e-harness.controller.ts", "backend/src/security-remediation/retry-e2e-harness.logic.ts", "backend/src/security-remediation/retry-e2e-harness.service.ts", "backend/src/security-remediation/retry-e2e-harness.spec.ts", "backend/src/security-remediation/retry-e2e-test-plan.entity.ts", "backend/src/security-remediation/target-reservation-entrypoints.spec.ts"]
UNTRACKED_4G_FILES_AFTER = []
MULTI_PROJECT_TEST_PASS = YES
PHASE4G_REGRESSION_PASS = YES
MODERN_RETRY_REGRESSION_PASS = YES
ONESHOT_RUNNER_REGRESSION_PASS = YES
WF6_PROJECT_AGNOSTIC_PAYLOAD = YES
INVALID_PERMANENT_RUNTIME_HARDCODING = []
SOURCE_COMMIT = 07c7421122fae809920742893e2e1d345d87aa3a
SOURCE_TREE_SHA = 0bc655a82290bb58a0e25adb04741bbf68a5be24
WORKTREE_CLEAN = YES — dedicated release worktree
EXECUTABLE_RUNTIME_REPRODUCIBLE = YES
RELEASE_ID = chain3a-r1-07c7421122fa
ARTIFACT_HASH = sha256:1021380f76c1d63e6a4950b257ea8c52a0211559053702a3a8d2a42d4f3b621b
CONTAINER_IMAGE_ID = sha256:1021380f76c1d63e6a4950b257ea8c52a0211559053702a3a8d2a42d4f3b621b
OCI_REVISION_MATCH = YES
RUNTIME_SMOKE_PASS = YES
LIVE_4G_GUARD_PASS = YES
DISPATCH_REMAINS_FROZEN = YES
LIVE_RUNBOOK_READY = YES
READY_FOR_PHASE4G_LIVE_ACTIVATION = YES — source qualification only; separate operator-controlled phase required
LIVE_CHANGED = NO
DATABASE_LIVE_CHANGED = NO
WF2_CHANGED = NO
WF6_CHANGED = NO
AZURE_CHANGED = NO
NO_REAL_REMEDIATION = YES
FINAL_VERDICT = A — GENERIC_REPRODUCIBLE_PHASE4G_RELEASE_QUALIFIED
```

Source changes and trust boundary

The production admission, retry and ownership-check paths resolve the target through a backend adapter selected in module wiring. The reservation code receives a canonical FILE key and has no fallback descriptor name. Repository-tree membership at the exact persisted scan commit establishes workspace containment; arbitrary frontend/scanner path fields are not used. A missing adapter or safe target blocks admission before reservation, attempt, counter, batch or WF6 side effects. The persisted reservation target binds subsequent retries to the same file and repository. [Resolver contract and tests](/tmp/chain3a-r1-source/backend/src/manual-remediation/trusted-remediation-target.ts) and [real admission failure test](/tmp/chain3a-r1-source/backend/src/manual-remediation/trusted-remediation-target.spec.ts).

Only the existing root Maven candidate strategy is implemented. Its descriptor name belongs to the ecosystem adapter and existing Maven-specific provenance/patch strategies. Synthetic npm/Gradle/Python adapters prove target-contract extensibility; this release does not claim new ecosystem build/test/rescan support. Existing candidate verification and WF6 semantics remain covered by regression.

Normal runtime no longer registers or imports the project catalog or historical reconciliation controller/service. Generic archive/readmission checks and the legacy callback bridge remain. The operator-only runner is separate under `tools/legacy-oneshot`; it loads identities, fingerprints, target, groups and PR disposition from an explicit manifest. Counts and historical PR numbers are no longer code constants. Remote association checks also bind stored PR/branch/URL evidence to that manifest. Writer workflow IDs are supplied through `SECURITY_REMEDIATION_WRITER_WORKFLOW_IDS`; missing configuration fails closed. The original qualified CHAIN-2B-R2 artifact and historical audit evidence remain untouched. The revised tool was requalified, not substituted silently into the historical artifact. [Standalone manifest proof](generic-runner-manifest-proof.json), [14/8 qualification](oneshot-qualification.json).

Bundled offline project evidence moved to an explicit test fixture. The optional operator data configuration is `SECURITY_REMEDIATION_EVIDENCE_STORE_FILE`; absent evidence produces no validated recommendation and fails closed. No fixture evidence is bundled in the executable artifact. The disabled harness uses exact operator-authorized plan/task/project/attempt identity, expiry and consumed state, never CVE or repository selection. Its operator-secret guard remains required. Wrong identity, expired/corrupt plans and replay cases are covered; already-consumed hooks replay safe envelopes without another consumption.

Qualification evidence

- Backend regression files: 66/66 pass. Native node:test cases: 123 pass across 6 native-test files, plus 60 assertion-driven script suites. Script assertion totals are not fabricated. [Exact per-file results](regressions.json), [logs](tests/).
- Real PostgreSQL production-service paths: migration up/reapply/down/up; independent-process single winner; unchanged sibling counts/no attempt/no batch/no transport; retry-owner retention; terminal/operator abandon/test-stop release; unknown side-effect retention; stale detection/quarantine without expiry; different-file and different-project concurrency. [Core evidence](phase4g-postgres.log). Test tree responses and transports are isolated fixtures; reservation and task transactions are the actual production services.
- Standalone runner: real command dry-run/apply, exactly 14 tasks/8 groups, zero dry-run changes, rollback, idempotency, independent-process concurrency, corrupted-modern rejection, all history/counters/timestamps preserved, findings DETECTED, zero claims after retirement; real new migration follows reconciliation with no intervening repair. [Runner evidence](oneshot-qualification.json), [command log](runner-postgres.log).
- Harness PostgreSQL concurrency and one-shot replay: [evidence](harness-postgres.log). Harness-disabled tests prove return before DB access and no timeout/pre-Git/test-stop injection. No real retry E2E or WF6 run occurred.
- Live modern WF6 version `0470ab42-713a-4097-a9a7-72c8f00bacde` corresponds to workflow `RdYyfjVpOm2LxS95`. Its intake expression was evaluated only in a local VM for two arbitrary project identities, forwarding exact IDs/batch/attempt correlations. Scanner and repository are resolved server-side rather than supplied by the caller. Existing PR36 safety guards remain unchanged; the entire WF6 is not claimed to be free of historical guard literals. [Contract proof](wf6-contract-proof.json).
- Every searched source occurrence is classified with exact file/line in [before](hardcoding-before.json) and [after](hardcoding-after.json). No invalid permanent runtime occurrence remains. Maven strategy constants are classified as ecosystem configuration, not reservation fallback. The exact built application JavaScript was also scanned: [compiled proof](compiled-runtime-hardcoding-proof.json).

Reproducible artifact

Two independent clean `git archive` contexts from `07c7421122fae809920742893e2e1d345d87aa3a` used a digest-pinned Node base, npm ci, the tracked lockfile and fatal build checks. Both run Node v20.20.2. All 178 application JS files and all 534 dist files match byte-for-byte, as do all 11,446 application/dependency JS/CJS/MJS/native addon executable files. Image IDs differ because creation/history timestamps and filesystem layer metadata differ; executable bytes do not. OCI revision/tree labels match the final source. [Identity](artifact-identity.json), [independent build evidence](build-reproducibility.json), [source bundle](qualified-source.bundle), [bundle verification](source-bundle-identity.json).

The exact release image started on an isolated PostgreSQL network, with schema synchronized only in its disposable database. Health, completed finding ingestion, incident/finding/remediation reads passed. Frozen launch returned HTTP 503, with zero reservations and attempt pointers. Both dispatch and harness were false. No real worker/Git transport was invoked. [Runtime smoke](runtime-smoke.json). Initial local fixture failures were corrected in test infrastructure: scanner-completion metadata, harness reservation schema and exclusive audit-directory reuse. They did not alter production state or weaken assertions.

Release scope is a new known backend baseline, not a byte-for-byte reconstruction or minimal delta from historical live overlays. Tests, generators and historical admin scripts are excluded from runtime compilation. Pending WF2 cancellation, chat and Azure source changes were not transplanted; these source paths remain at the parent Git baseline. This is remediation qualification, not a claim of full historical-runtime behavior equivalence across unrelated workstreams. [Protected source proof](source-protected-invariants.json), [explicit staged files](explicit-source-stage-list.json), [tracked hashes](tracked-source-hashes.json).

Fresh live read-only checks passed the exact two guard queries from the new migration, with zero legacy pointers/claims/writers. All 977 historical live dist hashes, including 330 JS files, and all workflow hashes remained unchanged. Dispatch is false and no active n8n execution was observed. Neither 4G nor the harness was activated. [Live preflight](live-preflight.json).

[Prepared CHAIN-3B runbook](LIVE-RUNBOOK.md) is not executed. Activation requires its separate approval and fresh live gates. STOPPED with dispatch frozen.

Durable release export: [qualified image archive](qualified-backend-image.tar.gz), SHA256 `df68e1c960f0e0da8fbfc0a872869d6dff30513c5667b44435b329b4c354132d`. Its archived image configuration independently matches the qualified image ID. [Archive identity verification](artifact-archive-identity.json).
