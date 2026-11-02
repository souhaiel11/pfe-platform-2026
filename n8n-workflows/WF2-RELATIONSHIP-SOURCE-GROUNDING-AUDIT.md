# WF2 relationship dependency source grounding

Local-only follow-up to the [atomic-review change](WF2-MULTIFILE-ATOMIC-REVIEW-AUDIT.md). The combined local artifact has **155 nodes**. No deployment, business request, commit, push, application-source edit, or Git/GitHub mutation occurred.

## 1. Original expansion audit

```text
CURRENT_EXPANSION_SEED = fetched finding source, TaskController.java
CURRENT_EXPANSION_DEPTH = 1 import hop; imported files were not scanned
CURRENT_IMPORT_TYPES_INCLUDED = explicit non-static imports resolving to existing src/main/java sources; nested-type import fallback to containing source
WHY_USER_REPOSITORY_WAS_MISSED = controller imports Task and TaskService only; no second hop; TaskService does not import UserRepository either
```

The original `Expand Referenced API Sources` examined the source contents delivered by `Fetch Finding Source Context`, not the subsequently fetched Task/TaskService contents. It skipped wildcard/static imports and resolved explicit imports against the repository tree. `Fetch Referenced API Sources` fetched that three-file selection. `Validate Source Context Completeness` compared only those requested paths against returned paths: it correctly checked 3/3, but could not detect an API dependency absent from the requested set.

The pre-change audit was reported before editing. Import expansion alone, even with the preferred extra hop, cannot discover the real UserRepository: there is no TaskService→UserRepository import edge at this SHA.

## 2. Frozen evidence

Repository: `souhaiel11/pfe-app-test`. Frozen SHA: `4c9537d51ab6c560c0e1c53a7e07e922a844f3e6`.

Sources and tree were read using read-only `git show`, `git ls-tree`, and `git rev-parse` against the existing local repository. The [focused fixture](scripts/fixtures/wf2-relationship-source-grounding.json) preserves the source contents and Git blob IDs.

```text
TASKSERVICE_IMPORTS_USERREPOSITORY = NO
TASKSERVICE_HAS_USERREPOSITORY_FIELD = NO
USER_REPOSITORY_DECLARATION = public interface UserRepository extends JpaRepository<User, Long>
USER_REPOSITORY_FIND_BY_ID_AVAILABLE = YES
USER_ENTITY_SOURCE_AVAILABLE = YES
USER_REPOSITORY_API_PROVEN = YES
```

- TaskController imports `com.pfe.devsecops.model.Task` and `com.pfe.devsecops.service.TaskService`.
- Task has `@ManyToOne @JoinColumn(name="user_id") private User user`; User is in the same package, so no import is needed.
- TaskService imports Task, User, and TaskRepository. It injects TaskRepository, not UserRepository.
- UserRepository is in `com.pfe.devsecops.repository`, imports `com.pfe.devsecops.model.User` and `org.springframework.data.jpa.repository.JpaRepository`, and declares the generic inheritance above.
- User is an `@Entity`; its `@Id` field is `Long`.

Inherited `findById` was not inferred from a repository name. The frozen POM uses Boot 2.7.0 and its JPA starter. The locally cached Boot 2.7.0 dependency BOM selects Spring Data BOM 2021.2.0; that BOM selects JPA/Commons 2.7.0. Read-only `javap` on those local artifacts verified:

```text
JpaRepository<T, ID> extends PagingAndSortingRepository<T, ID>
PagingAndSortingRepository<T, ID> extends CrudRepository<T, ID>
CrudRepository<T, ID> declares java.util.Optional<T> findById(ID)
```

The fixture records artifact coordinates and SHA-256 hashes. No framework source or binary was fetched by the workflow or added to the repository. The workflow includes a narrow audited inheritance-signature adapter for this API; it does not invent an arbitrary service method or infer APIs merely from Spring naming conventions.

## 3. Selected bounded strategy

```text
SELECTED_EXPANSION_STRATEGY = one additional local Java import/same-package type hop, plus same-module repository candidate discovery for detected relationships
MAX_EXPANSION_DEPTH = 2 total from finding source; 1 additional hop over the initial selected set
BOUNDS_PRESERVED = YES
MAX_FILES = 12
MAX_CONTEXT_CHARS = 65536 decoded source characters
```

The extra hop scans only the initially completed source set. It includes explicit application-local imports and referenced same-package types. Where that set contains a supported entity relationship, it also selects repository Java sources from the same application module's `repository`/`repositories` directory. This bounded candidate discovery is necessary because the desired resolver is not imported by the original service. Filenames select candidates, not API authority: only the subsequent source declaration check can establish the resolver.

The real expanded set is:

```text
src/main/java/com/pfe/devsecops/controller/TaskController.java
src/main/java/com/pfe/devsecops/model/Task.java
src/main/java/com/pfe/devsecops/service/TaskService.java
src/main/java/com/pfe/devsecops/model/User.java
src/main/java/com/pfe/devsecops/repository/TaskRepository.java
src/main/java/com/pfe/devsecops/repository/UserRepository.java
```

User is justified by Task's same-package field and TaskService's explicit import. TaskRepository is justified by TaskService's explicit import. UserRepository is discovered as a repository candidate, then matched to User by its actual fetched generic declaration. There is no production hardcoding of a Task/User filename for discovery.

Java/javax/jakarta/Spring and other out-of-application imports are excluded. Paths must remain safe application Java paths; generated/build/resource/secret/configuration directories are excluded. No import in the newly fetched sources triggers another hop. All selected paths are required; an unrelated repository candidate may therefore conservatively cause a failure rather than allow partial context.

## 4. Topology and completeness

```text
Expand Referenced API Sources
→ Fetch Referenced API Sources
→ Validate Source Context Completeness [existing R23 gate]
→ Expand Required Dependency Sources [new]
→ Fetch Required Dependency Sources [new; native read-only GET, retry ×3]
→ Validate Required Dependency Sources [new]
→ Prepare Generic Remediation Plan
```

Both outputs of the new fetch converge at its completeness gate. Expansion/gate errors use the existing `Failure Envelope - Fetch Referenced API Sources`; no second callback mechanism or custom network helper was added. The original R23 gate body and failure route remain intact.

The request records `initialPaths`, `requiredPaths`, required relationship fields/types, `frozenSourceSha`, and depth. The native fetch re-fetches the complete bounded set under the existing exact-SHA reference expression, deliberately avoiding a new merge/cache mechanism. The final gate requires every requested path, nonempty decoded content, and a valid Git blob SHA; contradictory explicit source SHA metadata is rejected. Missing/error/empty/duplicate required sources fail closed. File and aggregate decoded-character limits are enforced before planning.

Missing dependencies or unproven/ambiguous relationship APIs raise `SOURCE_API_CONTEXT_INCOMPLETE`. Failure metadata remains bounded to requested/fetched counts and missing identifiers/paths, capped at 12 entries of 240 characters; the existing failure envelope caps persistence to 500 characters. Source contents and credentials are not included.

The final gate matches the fetched relationship entity, actual repository package/import/declaration, supported generic ID type, entity ID field, and audited inherited signature. Unsupported or ambiguous repository inheritance, ID mismatches, and unsupported relationship declaration syntax fail closed. This is deliberately a conservative source adapter, not a complete Java type resolver.

## 5. Generation invariant

**Before patch generation, required relationship APIs must match fetched source evidence and the audited inheritance context. Otherwise generation stops.**

The final gate produces `sourceGrounding.groundedRelationshipApis`, including the repository and entity source paths, exact types, ID type, method, return type, inheritance chain, and frozen SHA. Planning, patch generation, and batch semantic review all receive this evidence.

Planner structured output now includes `requiredRelationshipApis`. `Validate Generic Remediation Plan` checks these declarations against the grounded catalog; a guessed method such as `findUserById`, an unknown repository, or an omitted required mapping API cannot proceed. Patch preparation independently requires the proof and the actual repository source in its source context for relationship mapping.

Generation instructions retain association preservation, no invented repository/service API, no `new User(userId)` or fake entity shortcut without fetched convention, and distinct create/update semantics. Creation resolves a non-null ID through the proven repository; update preserves existing Task.user rather than silently introducing reassignment/clearing. Insufficient evidence requires fail-closed/manual routing.

```text
LLM_CAN_INVENT_RELATIONSHIP_API = NO under the enforced plan/generation contract
```

This does not claim control over every token an LLM might emit. Unknown declared APIs are deterministically blocked; arbitrary generated implementation defects remain subject to unchanged preflight, complete-batch semantic review, Candidate Verification, and Write Guard. No live model invocation was performed.

## 6. Tests and preserved hardening

All **13 suites** passed: the prior 11-suite sweep, the new focused suite, and the existing source-API suite:

- `wf2-dto-entity-decoupling.spec.mjs`
- `wf2-source-context-completeness.spec.mjs`
- `wf2-preflight-rawcast.spec.mjs`
- `wf2-resilience.spec.mjs`
- `wf2-canonical-final.spec.mjs`
- `wf2-r22e-two-pass.spec.mjs`
- `wf2-promotion-identity.spec.mjs`
- `wf2-verification-evidence.spec.mjs`
- `qa-wf2-lifecycle.mjs`
- `wf2-multifile-candidate-review.spec.mjs`
- `wf2-patch-truncation.spec.mjs`
- `wf2-relationship-source-grounding.spec.mjs`
- `wf2-source-api.spec.mjs`

`git diff --check`: **PASS**. As in the preceding audit, canonical/R22E/lifecycle suites read their existing artifacts from disk; the new grounding suite and updated target suites exercise the combined promotion target.

Focused coverage includes the real 3→6 source chain, an explicit simulated TaskService→UserRepository dependency, exact frozen ref for both base/existing-branch cases, missing dependency/API evidence, wrong inheritance/ID declarations, third-party and unsafe path exclusion, no third hop, >12-file and >65536-character rejection, acceptance at exactly 65536 characters, structured planner requirements, patch grounding failure, and graph barriers to semantic review/verification/Git writes. The old three-source generation fixture now explicitly fails for missing UserRepository evidence. Batch review tests also check forwarding of the grounding catalog.

Node-count, retry allowlist, and topology assertions were updated narrowly for the three new nodes. Existing identity, credentials, failure routes, and Git safety comparisons remain enforced.

Compared with the accepted atomic-review artifact, these nodes remain byte-identical: Generic Candidate Preflight; strict patch parser and truncation guards; Independent Semantic Review and its enforcement; Candidate Verification; Write Guard; callback identity and failure/evidence forwarding. Existing source/planner/patch retries remain ×3. Patch model remains `claude-sonnet-5`, `max_tokens=16384`. DTO_ENTITY_TYPE_COUPLING, comment-only TODO/FIXME, raw-cast, structure, suppression, and secret checks are unchanged.

```text
ALL_CANDIDATES_BEFORE_REVIEW = YES
PARTIAL_BATCH_CAN_REACH_REVIEW = NO
FULL_SIBLING_CONTEXT_VISIBLE = YES
MULTIFILE_ATOMIC_REVIEW_INTACT = YES
RELATIONSHIP_DROP_PREVENTION_INTACT = YES (contract and fixture behavior)
REQUIRED_DEPENDENCY_FETCH_FAILURE_BLOCKS = YES
SOURCE_SHA_FROZEN = YES
EXPECTED_NODE_COUNT = 155
REAL_FIXREQUEST_UNTOUCHED = YES
ATTEMPT_COUNT = 3
READY_FOR_COMMIT_REVIEW = YES
```

Request `591853f3-9538-4df7-9b2d-7df1f8fca1f8` remains untouched. FIX_FAILED/attempt 3 is the recorded execution-1999 evidence, not a newly queried live state. No attempt 4 was started.

## 7. Files changed in this follow-up

- `pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json`
- `scripts/harden-wf2-relationship-source-grounding.mjs` — new local-only, idempotent transformation
- `scripts/lib/wf2-java-source-grounding.js` — new conservative source adapter
- `scripts/lib/wf2-expand-required-dependencies.js` — new bounded discovery
- `scripts/lib/wf2-validate-required-dependencies.js` — new completeness/API evidence guard
- `scripts/fixtures/wf2-relationship-source-grounding.json` — new frozen evidence fixture
- `scripts/wf2-relationship-source-grounding.spec.mjs` — new focused suite
- `scripts/wf2-source-api.spec.mjs`
- `scripts/wf2-source-context-completeness.spec.mjs`
- `scripts/wf2-dto-entity-decoupling.spec.mjs`
- `scripts/wf2-promotion-identity.spec.mjs`
- `scripts/wf2-verification-evidence.spec.mjs`
- `scripts/wf2-resilience.spec.mjs`
- `scripts/wf2-patch-truncation.spec.mjs`
- `scripts/wf2-multifile-candidate-review.spec.mjs`
- `WF2-MULTIFILE-ATOMIC-REVIEW-AUDIT.md` — links this superseding source-grounding audit
- `WF2-RELATIONSHIP-SOURCE-GROUNDING-AUDIT.md` — this report

Five existing workflow node bodies changed, three nodes were added, and source-gate wiring was extended. Workflow metadata is unchanged. Earlier unrelated working-tree changes were preserved. **NO LIVE. NO COMMIT. NO RETRY. NO PUSH.**
