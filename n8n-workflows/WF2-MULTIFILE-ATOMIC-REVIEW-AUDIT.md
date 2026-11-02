# WF2 atomic candidate review and Task.user audit

**Follow-up:** this records the atomic-review step. The [relationship source-grounding audit](WF2-RELATIONSHIP-SOURCE-GROUNDING-AUDIT.md) supersedes its source-context limitation and final node count: the combined local artifact now has **155 nodes**, with a required dependency fetch/validation stage before planning.

Local review artifact, 2026-09-15. No deployment, retry, commit, push, application-source change, or Git/GitHub mutation was performed.

## Evidence and original topology

Execution: **1999**. Request: `591853f3-9538-4df7-9b2d-7df1f8fca1f8`, attempt **3**.
WF2 version: `a00679af-2f34-4e45-ae01-5f275dbae0d2`.
Frozen source SHA: `4c9537d51ab6c560c0e1c53a7e07e922a844f3e6`.

The pre-change promotion artifact's nodes and connections exactly matched the locally captured post-restart R24 workflow. Execution evidence came from the existing local `exec1999-unflattened.json`; no live execution was queried or started. Original Java sources were read with `git show <frozen-sha>:<path>` from the existing local `pfe-app-test` repository. The three sources fetched by execution 1999 were compared byte-for-byte with those Git objects and matched. The checked-in fixture contains the audit evidence and original rejected controller, without execution credentials or the webhook payload.

```text
PLAN_FILE_LOOP_NODE = Merge Effective File Results (splitInBatches, batchSize=1)
PATCH_GENERATION_NODE = Prepare - Code Patch Body → de Patch - HTTP Request → Parse - Code Patch Output
PREFLIGHT_NODE = Generic Candidate Preflight
SEMANTIC_REVIEW_NODE = Independent Semantic Review
CURRENT_CANDIDATE_ACCUMULATION = Accumulate Candidate File → loop; done output → Prepare Candidate Manifest
CURRENT_REVIEW_GRANULARITY = PER_FILE
CURRENT_SEQUENCE = generate → parse → preflight → review → enforce → hash file → accumulate → next file
```

The preflight success edge immediately invoked review. Accumulation and the loop-back edge occurred only after review acceptance. Therefore the first controller candidate was submitted alone; rejecting it prevented generation of TaskService and TaskDTO. The review context contained only `candidateCode`, one `originalCode`, and applicable plans. It did not include sibling candidate code. Execution 1999's recorded review explicitly identified the absent DTO/service submissions and the missing `setUser` in `toEntity`.

## Selected implementation and atomic contract

```text
SELECTED_DESIGN = A
NEW_NODE_REQUIRED = NO
EXPECTED_NODE_COUNT = 152
EXPECTED_CANDIDATE_COUNT == GENERATED_VALID_CANDIDATE_COUNT before semantic review
```

Reuse the existing generation loop, accumulation, and manifest preparation. This needs three changed connection entries, no additional loop or storage node, and no workflow-global/static state.

```text
For every planned file:
  generate → parse → Generic Candidate Preflight → Hash Candidate File Content
  → Accumulate Candidate File → next planned file
Loop done:
  Prepare Candidate Manifest [completeness guard + full batch review request]
  → Independent Semantic Review [one request]
  → Enforce Independent Review [whole-batch verdict]
  → Hash Candidate Manifest → Assemble Candidate Manifest
  → Call Candidate Verification → Call Write Guard → existing guarded write flow
```

`Prepare Candidate Manifest` reads expected paths/operations from `Validate Generic Remediation Plan`, independently of candidate declarations. Its deterministic guard rejects zero/missing/extra candidates, duplicate canonical paths, unsafe paths, contradictory path aliases, operation mismatches, missing preflight success, empty candidate content, invalid content-hash shape, and inconsistent candidate bases. Canonicalization handles slash direction and repeated separators; absolute paths and dot traversal are rejected.

Set failures use `CANDIDATE_SET_INCOMPLETE`, `CANDIDATE_SET_PREFLIGHT_FAILED`, or `CANDIDATE_SET_BASE_MISMATCH`. Metadata contains only `plannedCount`, `generatedCount`, `missingPaths`, and `unexpectedPaths`; each path list is capped at 12 entries, each path at 240 characters. The reused failure envelope bounds the persisted summary to 500 characters. No source or candidate code enters this summary. Duplicate/operation failures retain the same bounded metadata schema.

Generation or preflight errors take the existing failure route without advancing the file loop. The guard has an explicit error output to the existing manifest failure envelope. No failure route reaches review, verification, or writes. Thus a partial generation run may stop before reaching the guard at all; directly supplying a partial batch to the guard also fails closed.

The review request includes the complete normalized remediation plan, expected paths/operations, every candidate's full code and original code, original source snapshots, findings, forbidden changes, applicable per-file plans, and preflight/build evidence. The original reviewer system criteria, model, transport, and retry remain; additional instructions require cross-file symbol resolution and association tracing. A sibling CREATE DTO is evaluated as part of the candidate repository. Genuine missing mappings, incompatible signatures, persistence coupling, enum errors, or dropped relationships still require rejection. Insufficient source evidence requires INCONCLUSIVE.

Only an accepted batch gets per-file accepted finding IDs and the same batch review evidence, including reviewed sibling paths. Candidate Verification receives the complete reviewed manifest. Hashing still binds every file's exact content and the canonical manifest. Review-only request data is removed before verification.

## Frozen Task.user model and correct mapping

```text
TASK_USER_FIELD_TYPE = com.pfe.devsecops.model.User
TASK_USER_RELATION_ANNOTATION = @ManyToOne; @JoinColumn(name = "user_id")
TASK_GETUSER = User getUser(), generated by Lombok @Data
TASK_SETUSER = void setUser(User), generated by Lombok @Data
CURRENT_CREATE_BEHAVIOR = set createdAt; save supplied Task, including its supplied user
CURRENT_UPDATE_BEHAVIOR = load existing Task; copy title/description/status/priority; set updatedAt; save existing
CURRENT_USER_RESOLUTION_API = UserRepository extends JpaRepository<User, Long>; inherited findById(Long) returns Optional<User>
TASKDTO_USER_FIELD_EXPECTED = nullable Long userId; no persistence-entity field
CORRECT_USER_MAPPING_LAYER = SERVICE
CORRECT_USER_MAPPING_MECHANISM = inject proven UserRepository; resolve supplied create userId with findById; set the resolved User on Task
CREATE_RELATIONSHIP_BEHAVIOR = preserve nullable association; resolve non-null userId; reject unknown ID rather than silently dropping it
UPDATE_RELATIONSHIP_BEHAVIOR = preserve existing Task.user; do not add reassignment or clearing
GENERATOR_SHOULD_FAIL_RATHER_THAN_GUESS = YES
```

`Task.user` has no explicit `optional=false` or `nullable=false`. `User.id` is `Long`; `User.tasks` is the inverse `@OneToMany(mappedBy="user", cascade=CascadeType.ALL)`. No `UserService` exists at this SHA. `UserRepository` declares username/email lookup and existence APIs in addition to its inherited ID lookup. `AuthService` demonstrates actual repository injection/use. Existing DTOs are login/register types; no TaskDTO existed.

The old update never reads `updatedTask.user`. The reviewer correctly found association loss in creation, but its suggestion that this mapper necessarily clears ownership on update is not supported by the original service implementation. New mapping must retain that distinction. Rejecting an unknown create-time user ID is a fail-closed mapping choice; the frozen sources do not establish a dedicated HTTP exception/status convention for this case.

Execution 1999 supplied only TaskController, Task, and TaskService as source context. It did **not** supply UserRepository or User. This change does not expand source-fetch scope: planner/generator instructions require the missing API evidence or fail rather than guess. The good relationship fixture explicitly supplies the frozen repository/model evidence. Availability in this audit must not be mistaken for availability in a future generation request.

Both planner and generator now require an association inventory, explicit create/update behavior, preservation of association fields, proven resolution APIs, and no fake/stub entity construction unless supported by supplied conventions. Planner insufficiency routes to `MANUAL_OR_SPECIALIST`/`CONTEXT_REQUIRED`; generation insufficiency must stop without a speculative patch. Existing DTO-decoupling instructions remain intact.

## Verification

All of these commands passed:

| Suite | Artifact exercised |
|---|---|
| `wf2-dto-entity-decoupling.spec.mjs` | Updated promotion target |
| `wf2-source-context-completeness.spec.mjs` | Updated promotion target |
| `wf2-preflight-rawcast.spec.mjs` | Updated promotion target |
| `wf2-resilience.spec.mjs` | Updated promotion target |
| `wf2-canonical-final.spec.mjs` | Existing canonical/R22E artifacts |
| `wf2-r22e-two-pass.spec.mjs` | Existing R22E artifact/baseline |
| `wf2-promotion-identity.spec.mjs` | Updated target against canonical identity/safety baseline |
| `wf2-verification-evidence.spec.mjs` | Updated target and canonical routing baseline |
| `qa-wf2-lifecycle.mjs` | Existing active artifact, read from disk only |
| `wf2-multifile-candidate-review.spec.mjs` | Updated target; evaluated Code nodes, full graph, Java behavior fixtures |
| `wf2-patch-truncation.spec.mjs` | Updated promotion target |
| `git diff --check` | Local tracked diff |

The two baseline topology assertions were updated to assert precisely the new three edge entries and shared error route before comparing all remaining routing to the baseline. Identity, credentials, untouched nodes, and Git guards still have strict parity checks.

The new suite checks 0/3, 1/3, 2/3, duplicates, extras, unsafe and canonical paths, alias/operation mismatches, 3/3 with a failed preflight, and 3/3 passing preflight. It checks full sibling/original/plan context, whole-batch rejection and inconclusive outcomes, accepted evidence on every file, and mandatory verification/write gates across all graph outputs. It also passes the real rejected controller through actual preflight and places it in the complete review context.

Java fixture tests execute the real original create/update method bodies and the real rejected `toEntity` body with explicitly modeled dependency doubles. They expose the BAD mapper's null association, validate resolution to the existing User instance for the GOOD mapper, preserve nullable creates, reject unknown IDs, and prove updates preserve ownership even if the incoming object has a different user. These fixtures are test data; application source was not edited.

Limits: model verdicts are mocked to test enforcement. No external semantic-review request or live n8n execution ran. The tests prove deterministic topology, request content, verdict handling, and relationship fixture semantics; they cannot guarantee that an LLM always detects arbitrary future semantic defects.

## Preserved hardening and final status

```text
CURRENT_REVIEW_GRANULARITY = PER_FILE (before change); BATCH (local result)
ROOT_STRUCTURAL_CAUSE_CONFIRMED = YES
SELECTED_DESIGN = A
ALL_CANDIDATES_GENERATED_BEFORE_SEMANTIC_REVIEW = YES
CANDIDATE_SET_COMPLETENESS_GUARD = YES
PARTIAL_BATCH_CAN_REACH_SEMANTIC_REVIEW = NO
PER_FILE_PREFLIGHT_PRESERVED = YES
FULL_SIBLING_CONTEXT_VISIBLE_TO_REVIEWER = YES
RELATIONSHIP_DROP_PREVENTED = YES at generation/review contract and fixture-test level; no claim of universal LLM detection
DTO_DECOUPLING_INTACT = YES
R23_COMPLETENESS_INTACT = YES
CANDIDATE_VERIFICATION_INTACT = YES
WRITE_GUARD_INTACT = YES
EXPECTED_NODE_COUNT = 152
TEST_RESULTS = 11 suites PASS; git diff --check PASS
REAL_FIXREQUEST_UNTOUCHED = YES
ATTEMPT_COUNT = 3, from frozen execution evidence; no attempt 4 started
READY_FOR_REVIEW = YES (local artifact)
```

Preserved byte-for-byte: Generic Candidate Preflight (including DTO_ENTITY_TYPE_COUPLING, comment-only TODO/FIXME, raw-cast, structure, suppression, and secret checks); source completeness and frozen-SHA gates; source-fetch/planner retries; source-context 12-file/65536-character bounds; patch parser/truncation/invalid-JSON protections; Candidate Verification; Write Guard; verificationEvidence forwarding; workflow identity; Git mutation guards. Patch generation remains `claude-sonnet-5`, `max_tokens=16384`. Planner and reviewer retain their existing budgets/models.

Recorded `Prepare WF2 Failure Status` has attemptCount 3 for this request; recorded `Persist WF2 Failure Status` returned FIX_FAILED. Live business state was not read or changed during this local-only task.

## Files changed by this task

- `pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json`
- `scripts/harden-wf2-multifile-candidate-review.mjs` (new local-only, idempotent transformation)
- `scripts/lib/wf2-candidate-set-guard.js` (new, embedded guard)
- `scripts/fixtures/wf2-attempt-1999-atomic-review.json` (new frozen evidence fixture)
- `scripts/wf2-multifile-candidate-review.spec.mjs` (new)
- `scripts/wf2-promotion-identity.spec.mjs`
- `scripts/wf2-verification-evidence.spec.mjs`
- `WF2-MULTIFILE-ATOMIC-REVIEW-AUDIT.md` (this report)

Pre-existing unrelated working-tree changes were left intact. Backend, frontend, WF1/WF3, application sources, and live workflow state were untouched. **NO LIVE. NO COMMIT. NO RETRY. NO PUSH.**
