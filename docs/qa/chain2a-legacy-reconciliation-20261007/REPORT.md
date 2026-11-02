# TRIVY_OWASP_LEGACY_RECONCILIATION_DECISION_REPORT

```text
BLOCKING_TASK_COUNT = 14
LIFECYCLE_GROUP_COUNT = 8
BLOCKING_TASKS = blocking-tasks.json (all requested fields, every row)
LIFECYCLE_GROUPS = lifecycle-groups.json (exact migration grouping)
PR37_CURRENT_EVIDENCE = OPEN/unmerged; no head CI/reviews; historical build+target closure retained, tests SKIPPED
PR38_CURRENT_EVIDENCE = OPEN/unmerged; no head CI/reviews; full validation INSUFFICIENT_EVIDENCE
PR39_CURRENT_EVIDENCE = OPEN/unmerged; no head CI/reviews; full validation INSUFFICIENT_EVIDENCE
PR40_CURRENT_EVIDENCE = OPEN/unmerged; no head CI/reviews; full validation INSUFFICIENT_EVIDENCE
PR41_CURRENT_EVIDENCE = Fresh API collection complete; OPEN/unmerged; no head CI/reviews; full validation INSUFFICIENT_EVIDENCE
PR42_CURRENT_EVIDENCE = Fresh API collection complete; OPEN/unmerged; no head CI/reviews; full validation INSUFFICIENT_EVIDENCE
IDENTICAL_PATCH_GROUPS = [38,40]
CONFLICTING_PATCH_GROUPS = [38,39], [39,40], [39,41] (incompatible values at the same POM control)
RECOMMENDED_LEGACY_OWNER = KEEP_PR_37
RECOMMENDATION_CONFIDENCE = MEDIUM
CURRENT_API_SUPPORTS_LEGACY_ROWS = NO
LEGACY_COMPATIBILITY_CHANGE_REQUIRED = YES
PROPOSED_RECONCILIATION_TRANSITIONS = Archive original legacy lifecycle with operator settlement evidence; retire active pointers; keep finding/task/scanner identity and status; explicitly authorize any future new modern lifecycle separately.
RETIRING_LEGACY_PR_MARKS_FINDING_FIXED = NO
FINDINGS_REMAIN_IN_BACKLOG = YES
FUTURE_MODERN_REMEDIATION_POSSIBLE = YES (structurally, after compatibility/new-lifecycle authorization and fresh normal eligibility; not a dispatch approval)
DRY_RUN_RECONCILIATION_PASS = YES (isolated model, hypothetical remote settlement)
ACTIVE_LEGACY_CLAIMS_AFTER_DRY_RUN = 0
FINDINGS_MARKED_FIXED = 0
NEW_ATTEMPTS_CREATED = 0 during reconciliation
ATTEMPT_COUNTS_FABRICATED = 0
4G_RECONCILIATION_GUARD_PASS = YES on simulated reconciled state, exact unchanged migration
SINGLE_WRITER_POST_RECONCILIATION_PROVEN = YES (actual production functions, isolated PostgreSQL)
READY_FOR_EXPLICIT_OPERATOR_APPROVAL = YES (decision/design only)
READY_FOR_LIVE_RECONCILIATION = NO
LIVE_CHANGED = NO
GITHUB_CHANGED = NO
DATABASE_CHANGED = NO (live database; disposable simulation wrote only isolated data)
WF6_CHANGED = NO
PR_CLOSED = NO
PR_MERGED = NO
MIGRATION_APPLIED = NO (live; exact migration executed only against disposable data)
REMEDIATION_DISPATCHED = NO
FINAL_VERDICT = B — LEGACY_COMPATIBILITY_IMPLEMENTATION_REQUIRED
```

## Operator decision to approve — not executed

Recommend **KEEP_PR_37 as a historical candidate/reference only**, not an active FILE writer, not a merge candidate approval and not evidence that its finding is fixed. It has the strongest retained, POM-bound build/target-closure evidence among these six, but tests were skipped and no new head CI exists. The confidence remains MEDIUM.

To achieve the required zero-active-legacy-claim end state, **no legacy PR may retain live authoring ownership, including PR37**. The reference can be preserved by its immutable PR/head/POM/evidence while its open authoring path is later settled under explicit authorization. Keeping PR37 open as an active owner would be incompatible with ACTIVE_LEGACY_CLAIMS=0 and reopening the FILE to modern work. Operator approval must expressly distinguish reference retention from active ownership. This pack does not close any PR.

For PR38–PR42 propose future superseded/abandoned disposition after remote settlement. For both no-PR stale groups require independent proof that no branch, PR or writer remains; absence of a recorded PR is insufficient. All 14 findings stay DETECTED, never VERIFIED/FIXED. No legacy attempt counter or original history entry is edited, and retirement creates no new remediation attempt.

## Task inventory

All rows belong to project 3aa1c9b9-e114-40e4-884b-ebc7aa32e002 and trusted FILE pom.xml. MAX_ATTEMPTS=3 is the current modern policy; PR38's historical count 6 is retained, not normalized down. All have legacy numbered history but no UUID legacy attemptId and no modern attemptId. PR37 lacks both batch fields; the other thirteen have legacy batch strings. Those strings do not establish a modern identity.

| PR | Task ID | Scanner | CVE | Manual/remediation status | Historical count | Legacy batch | Last recorded execution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 37 | c8fb2207-c8de-40af-acd4-1d2f96896715 | TRIVY | CVE-2023-6378 | TODO/CANDIDATE_READY | 1 | NONE | 2060 |
| 38 | af1d6556-b782-4faf-b01b-4e87b119d033 | TRIVY | CVE-2022-25857 | TODO/CLOSED | 6 | sec-batch-c808d8203ba03491 | NONE |
| 39 | 9dc3706b-aabd-4b9a-a888-854641a2e64e | TRIVY | CVE-2022-31692 | TODO/CLOSED | 2 | sec-batch-a4646d8385306b84 | NONE |
| 39 | bd9dc6f2-2202-4280-933e-4adb824dc695 | TRIVY | CVE-2022-38752 | TODO/CLOSED | 2 | sec-batch-a4646d8385306b84 | NONE |
| 40 | 306e8b84-90fe-4344-8fd6-5c38fcabcf40 | OWASP | CVE-2022-25857 | TODO/CLOSED | 2 | sec-batch-215851539abb7f37 | NONE |
| 41 | ca8f57e7-3839-4914-8805-d518aafe4c4a | TRIVY | CVE-2024-22257 | TODO/CLOSED | 2 | sec-batch-fb980983352c6d7c | NONE |
| 42 | 10fe9043-86f9-42eb-a0a2-ce5abaf26631 | TRIVY | CVE-2022-45143 | TODO/CLOSED | 2 | sec-batch-181e0a6587c834e1 | NONE |
| 42 | 64deba0e-f6ab-4da8-a3c9-da8e1b0eb30d | TRIVY | CVE-2022-42004 | REOPENED/CLOSED | 2 | sec-batch-181e0a6587c834e1 | NONE |
| 42 | 6e6c3597-96bc-4f72-bcd8-eb0d4b8036db | TRIVY | CVE-2022-42252 | TODO/CLOSED | 2 | sec-batch-181e0a6587c834e1 | NONE |
| 42 | 70fd88ac-2011-437d-a387-57d0fb3fa65d | TRIVY | CVE-2023-41080 | TODO/CLOSED | 2 | sec-batch-181e0a6587c834e1 | NONE |
| 42 | a84a24c4-8673-4826-a4f2-4990ce7d118b | TRIVY | CVE-2022-42003 | TODO/CLOSED | 2 | sec-batch-181e0a6587c834e1 | NONE |
| 42 | f21b69ba-922b-4ccb-8851-c2a43d9ce7ca | TRIVY | CVE-2023-34034 | TODO/CLOSED | 2 | sec-batch-181e0a6587c834e1 | NONE |
| NONE | 83555b3a-efa1-45e1-90a8-008debddba92 | TRIVY | CVE-2022-38749 | TODO/TECHNICAL_FAILURE | 2 | sec-batch-d359edf8f878f1dd | NONE |
| NONE | b52ea617-f5c3-47a3-bc6e-6230ea648d63 | TRIVY | CVE-2022-38751 | TODO/TECHNICAL_FAILURE | 2 | sec-batch-bd22285c1649ea80 | NONE |

Complete per-task fields, including findingId, branch, PR status and execution state, are in blocking-tasks.json. All six PRs are freshly confirmed OPEN/unmerged. Execution2060 is in PR37's historical attempt but is no longer retained in current n8n execution storage; its current execution state is NOT_RETAINED. Other rows have no recorded executionId, so LAST_EXECUTION_STATE=NOT_RECORDED. No live running/waiting/new execution was observed. Task terminal status is not substituted for missing execution evidence.

## Exact lifecycle groups and conflicts

The guard groups by project and COALESCE(nonempty remediation.batchId, task.securityRemediationBatchId, task.id). These are eight independent legacy claims, not 14 writers. No live reservation table exists yet; CURRENT_OWNER_CLAIM therefore means retained legacy cutover claim, not a persisted 4G reservation owner.

| Group ID | PRs | Task count | CVEs |
| --- | --- | --- | --- |
| sec-batch-181e0a6587c834e1 | 42 | 6 | CVE-2022-42003, CVE-2022-42004, CVE-2022-42252, CVE-2022-45143, CVE-2023-34034, CVE-2023-41080 |
| c8fb2207-c8de-40af-acd4-1d2f96896715 | 37 | 1 | CVE-2023-6378 |
| sec-batch-215851539abb7f37 | 40 | 1 | CVE-2022-25857 |
| sec-batch-c808d8203ba03491 | 38 | 1 | CVE-2022-25857 |
| sec-batch-a4646d8385306b84 | 39 | 2 | CVE-2022-31692, CVE-2022-38752 |
| sec-batch-bd22285c1649ea80 | NONE | 1 | CVE-2022-38751 |
| sec-batch-fb980983352c6d7c | 41 | 1 | CVE-2024-22257 |
| sec-batch-d359edf8f878f1dd | NONE | 1 | CVE-2022-38749 |

Every group's canonical target is `(3aa1c9b9-e114-40e4-884b-ebc7aa32e002,["v1","FILE","pom.xml"])`. Every group conflicts at FILE ownership with all seven others, RECONCILIATION_REQUIRED=YES. REMOTE_MUTATION_POSSIBLE=YES for all: six have open remote PRs; the two uncertain stale groups cannot rule out unrecorded effects. See lifecycle-groups.json for full task lists and conflicting group IDs.

## Fresh GitHub evidence and exact patches

Fresh public API retrieval succeeded for PR37–PR42, files, exact-head check runs, statuses, Actions runs, reviews and POM contents. Initial observed core quota was 47 remaining; after the batch it was 4. No request in the batch failed. PR41/42's prior rate-limit gaps are now filled: their head check/run/review collections are empty, not successful validation.

All six are OPEN, MERGED=false, CHANGED_FILES=[pom.xml], zero check runs, zero individual commit statuses, zero Actions runs and zero reviews. GitHub aggregate status says pending because its statuses list is empty; this is **not proof that a CI job is running**. BUILD_STATUS and TEST_STATUS at each exact head are NOT_PROVEN. A read-only Jenkins build.xml search found no retained record referencing any of the six exact head SHAs; this does not establish that no external or deleted build ever existed.

| PR | HEAD_SHA | PR-reported BASE_SHA |
| --- | --- | --- |
| 37 | a27fc820efdb96a53d92834b17546f128392a735 | 7ae0f954f99628b69ce9b42f42c1e2acc8568d99 |
| 38 | 1097ba035e6b2d88cd12f6af7cc1285e889f8aed | 7ae0f954f99628b69ce9b42f42c1e2acc8568d99 |
| 39 | cd3ab899af5ea1fca5cfa5b10f80348f8803430d | 7ae0f954f99628b69ce9b42f42c1e2acc8568d99 |
| 40 | c5a3846d40f8358737d8d76085564fc5fb4edb4b | 7ae0f954f99628b69ce9b42f42c1e2acc8568d99 |
| 41 | cb1432c97f601ef1ffbf436a3f3f9215bdaa03f9 | 7ae0f954f99628b69ce9b42f42c1e2acc8568d99 |
| 42 | 7f57eec0f47b5b47c7320c65662348ec6b2404b4 | 7ae0f954f99628b69ce9b42f42c1e2acc8568d99 |

Fresh current main is 393816c250f73d907eb5a2dd43b2ec2288c7abcb. GitHub PR base SHA remains the older common base shown above; it must not be presented as today's main. Current main POM SHA256 ca4d5bc28596ded5fc06cd0e47586678e26d4aca5a497bf5a2fe0f11aa6f6d43 still matches the prior main POM exactly.

| PR | Exact POM controls changed | PATCH_ALREADY_ON_MAIN |
| --- | --- | --- |
| 37 | logback.version property 1.2.11→1.2.13; explicit logback-classic version 1.2.11→1.2.13 | NO |
| 38 | explicit snakeyaml 1.29→1.31 | NO |
| 39 | explicit spring-security-core 5.6.4→5.6.9 and snakeyaml 1.29→1.32 | NO |
| 40 | explicit snakeyaml 1.29→1.31 | NO |
| 41 | explicit spring-security-core 5.6.4→5.7.12 | NO |
| 42 | Spring Boot parent 2.7.0→2.7.18 | NO |

The complete unedited GitHub hunks are in pr37-pom.patch through pr42-pom.patch; full XML is alongside them. PR38/40 have byte-identical full POMs and identical mutations. PR38/39 and PR39/40 disagree on SnakeYAML; PR39/41 disagree on Security core. Other pairs still collide at FILE ownership even where individual edits are compatible. PR42's parent change also alters dependency management; compatibility with explicit edits is not proven solely by disjoint XML controls.

## Independent validation assessment

| PR | BUILD_PASS | TESTS_EXECUTED / TESTS_PASS | TARGET_CVE_REMOVED | CANDIDATE_VERIFIER_PASS / SECURITY_RESCAN_PASS |
| --- | --- | --- | --- | --- |
| 37 | YES, historical POM-bound stored evidence only | NO, SKIPPED / NOT_ESTABLISHED | YES, historical target-only stored evidence | Historical target-closure evidence; full current verifier qualification NOT_ESTABLISHED |
| 38 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |
| 39 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |
| 40 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |
| 41 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |
| 42 | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |

PR37's freshly fetched POM hashes to f36d6ecdc90ca0f1964da7064b097b3f8450fea622ec8934b62bb31a26b370c6, exactly matching stored securityValidationEvidence.candidateContentSha256. Stored evidence explicitly records buildPassed=true, TARGET_CVE_CLOSED, targetCveMatchCount=0 and tests=SKIPPED, with evaluated base 7ae0f954f99628b69ce9b42f42c1e2acc8568d99, artifact/report digests and Trivy0.72.0. This revalidates content attribution, not a new scanner/build execution and not a full current gate pass. Confidence is not upgraded. PR38–PR42's persisted CLOSED/TARGET_CVE_CLOSED labels lack comparable retained validation payloads; labels and PR existence are not independent proof.

CURRENT_MAIN_STILL_VULNERABLE = YES at persisted-backlog/unchanged-POM evidence level for all selected tasks. Current findings remain DETECTED and main retains their historical dependency controls. No fresh scan of current main was run here, so new exact artifact/exploitability proof is NOT_ESTABLISHED. The qualified local Boot3 candidate is a separate branch/tree and is not substituted for main.

## API compatibility gap and minimal proposed change

Current POST /api/manual-remediation/:id/abandon-target requires expectedAttemptId equal to the modern current UUID, finishedAt and a non-inflight lifecycle. Legacy rows fail this precondition; PR/branch history also prevents assertNoSideEffect. Stale-dispatch reconciliation is only for active overdue dispatches and cannot settle these terminal rows. No approved LEGACY_SINGLE_WRITER_RECONCILIATION reason or legacy archive procedure was found. Existing REMEDIATION_ABANDONED is a status, not an approved history-preserving legacy claim release API.

Minimum proposed implementation (not applied): add one narrowly scoped admin-only group reconciliation operation in manual-remediation service/controller, with typed audit-event support in manual-remediation.entity.ts. Use the proposed reason LEGACY_SINGLE_WRITER_RECONCILIATION, explicitly pending operator/code approval. No 4G migration change is needed for the modeled archive transition. It must:

1. Accept expected exact task/lifecycle digests, an explicit group disposition and trusted remote settlement references; never accept an arbitrary scanner/status rewrite. Scope to the enumerated project/FILE group and legacy-only histories. No attemptId is fabricated to satisfy a modern API.
2. Serialize with admission using maintenance dispatch suspension plus project/FILE locking and stable task locks; recheck the whole group's membership/digests and no in-flight execution or reachable remote writer. Closing one PR is not sufficient. Reject missing, stale or ambiguous remote evidence, including both stale groups. Do not rely on client assertions alone.
3. Append one immutable typed reconciliation event per task containing its complete original securityFindingRemediation, original securityRemediationBatchId, exact snapshot digest, original attempt count/history, operator/time, group and remote settlement evidence. Existing scanner events remain intact.
4. Only after that archive is durable atomically clear the two **active pointers to SQL NULL**, not JSON null and not an empty object. Preserve task ID, findingId/fingerprint, CVE, source, snapshot, manual status, scannerStatus=DETECTED and verification fields. No historical counter is changed to zero or reduced. Retired legacy history remains queryable and nonretryable.
5. Fence old callbacks/retries: no active lifecycle means legacy callbacks and retry are rejected. Expose archived outcomes as superseded/abandoned reference in read presentation; never mark the finding fixed. Idempotent replay with matching digest/receipt is a no-op; mismatched or newer lifecycle is a conflict.
6. Require a separately explicit new-modern-lifecycle authorization/requalification before initial launch on an archived legacy row. Clearing a pointer must **not silently reset an automatic retry budget or auto-authorize a fresh run**. A future admitted modern lifecycle starts its own real numbered attempts while the original legacy counters remain unchanged in the archive. This generation/budget boundary needs explicit implementation and approval; it is not present in today's API. Full normal V1.8/repository/SHA gates and 4G admission still apply.

Conceptual transition for every group is `legacy CANDIDATE_READY/CLOSED/TECHNICAL_FAILURE + retained Git claims → archived original lifecycle with LEGACY_SINGLE_WRITER_RECONCILIATION + no active legacy pointers`. Manual finding state stays TODO or REOPENED, scanner stays DETECTED. PR37 reference retention does not exempt its active pointers from retirement. No destructive history deletion or synthetic attempt is part of the design.

## Exact operator procedure for all eight groups

First approve KEEP_PR_37 only as an immutable historical reference and the new-lifecycle budget boundary above. Then authorize a separately reviewed compatibility implementation and tests; this pack does not authorize a deploy or execution.

For each PR-associated group (PR37, PR38, PR39, PR40, PR41, PR42): snapshot PR head/base/files, all member tasks and original digests; establish no in-flight author; obtain explicit future remote supersession/closure disposition and proof that the branch can no longer act as an active writer. Preserve reference links/head/POM, especially PR37. Reconcile every group member atomically; a shared PR42 group contains six tasks and PR39 two, so partial retirement is forbidden. For the no-PR groups sec-batch-d359edf8f878f1dd and sec-batch-bd22285c1649ea80, prove the missing remote state separately; do not infer it from null fields or expired execution retention.

After all eight complete, re-evaluate the exact unchanged migration preflight and compare source/task/Git invariants. Only a later separately authorized phase may apply 4G. No current vulnerability is fixed by this administrative operation.

## Disposable dry-run and scope

An isolated PostgreSQL16 container ran with --network none, tmpfs data and no live volumes. The helper shared only that isolated network namespace, mounted repository read-only and used a sanitized copy of the 14 live task histories. It had no route/credentials to production. `dry-run.cjs` is an audit-only conceptual implementation, not a production compatibility patch or proof of trusted remote evidence acquisition. Its settlement receipt is explicitly SIMULATED_REMOTE_SETTLED: live PRs are still open.

The initial unchanged migration rejects the 14-task/8-lifecycle baseline. Merely setting lifecycle status REMEDIATION_ABANDONED still leaves 12 PR-associated claims selected because Git history is retained. The archive model preserves every original lifecycle/attempt count and prior event, then retires all 14 active pointers. Idempotent replay changes zero rows. JSON null is not sufficient because the guard uses SQL IS NOT NULL; the passing simulation uses true SQL NULL. This distinction is an explicit implementation requirement.

At the reconciliation checkpoint: ACTIVE_LEGACY_CLAIMS=0, FINDINGS_MARKED_FIXED=0, NEW_ATTEMPTS_CREATED=0 and ATTEMPT_COUNTS_FABRICATED=0. Every task/finding identity and status remains unchanged, every prior history matches its snapshot, and legacy callbacks/retries reject. The **exact unmodified 4G migration** then passes and backfills zero ACTIVE reservations. This is not a production migration.

A separate subsequent proof uses the actual current reserveTarget, bindTargetAttempt and reserveAttempt functions on the disposable reconciled rows. One TRIVY task owns the FILE; an OWASP sibling in the same project/pom.xml is rejected with REMEDIATION_TARGET_ALREADY_IN_PROGRESS before reserveAttempt. Exactly one ACTIVE reservation exists; sibling state and historical counters are unchanged. This later test creates one genuine disposable modern attempt solely to prove admission, separate from reconciliation's zero-new-attempt checkpoint. It does not run normal V1.8 business admission, WF6, verifier or Git and grants no live dispatch eligibility.

The dry-run establishes the model and migration compatibility. The production archive API, trusted settlement checks, presentation and explicit generation authorization remain to be implemented/qualified. Thus READY_FOR_EXPLICIT_OPERATOR_APPROVAL=YES for the disposition/design, while READY_FOR_LIVE_RECONCILIATION=NO and verdict B are deliberate.
