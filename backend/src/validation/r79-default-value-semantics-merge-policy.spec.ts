// R79 — real production gap found on incident 73733ec0-4077-4c81-aed3-df3a3bca5245
// / PR #34, attempt 13 (validated SHA 5ef66be30482042d9dd6802402692e3d03636c97):
// mergeAuthorization reached MERGE_READY while the batch's OWN dedicated
// default-value-semantics re-check sat at {verdict: 'VERIFICATION_REQUIRED',
// checkedPairs: 0, evidence: []} for the exact same SHA — unresolved, not
// proven, yet silently treated as a no-op even though this remediation's
// entire stated purpose was fixing exactly that invariant. TWO real,
// separate gaps were found and closed here:
//
// GAP 1 — wrong base sha (traced, not guessed): incidents.service.ts's two
// buildDefaultValueSemanticsEvidence() call sites (saveValidation,
// recomputePrValidationPolicy) passed `fixRequest.baselineSha` — the
// ORIGINAL source-scan commit, used for the unrelated Sonar
// scanner-regression diff (validation.regression.baselineSha) — as the
// "candidateBaseSha" fetch anchor. That only equals a candidate's real git
// parent on a batch's FIRST attempt; for a corrective (2nd+) attempt like
// #13, the branch has already moved past it. Verified live: GitHub's
// contents API 404s for TaskDTO.java at the real incident's baselineSha
// (6ed56ff791acbf3e111431285bef7b30c8076084) — the fetch throws, and
// buildDefaultValueSemanticsEvidence() correctly (by its own contract)
// degrades to VERIFICATION_REQUIRED/checkedPairs:0/evidence:[], exactly
// matching the persisted record. Fixed by resolveDefaultValueSemanticsBaseSha()
// (prefers fixRequest.correctiveDispatch.blockedSha — the actual sha this
// attempt's writes are based on — falling back to baselineSha only for a
// batch's first attempt, when they coincide).
//
// GAP 2 — a "NO_DEFECT via zero relevant pairs checked" was indistinguishable
// from "NO_DEFECT via the required pair being proven safe". Even AFTER fixing
// GAP 1, a REAL live replay (fetching TaskDTO.java/TaskService.java at both
// dc1aa978... and 5ef66be3... from GitHub and running the real
// evaluateDefaultValueSemantics()) still returns {verdict: 'NO_DEFECT',
// checkedPairs: 0, checkedFieldPairs: []} — NOT because the fix was proven
// safe, but because discoverMigrations() finds zero @RequestBody type
// changes in the compared text: the Entity->DTO migration itself already
// happened in an EARLIER attempt, and attempt 13's diff (TaskDTO.java +
// TaskService.java only, no controller change) never touches the
// @RequestBody declaration site discoverMigrations looks for. Fixed by
// making computeMergeAuthorization() require, when
// defaultValueSemanticsRequired is true, that the verdict is 'NO_DEFECT'
// via >=1 checked pair AND that at least one checked pair's own
// (sourceType, sourceField, candidateType, candidateField) identity matches
// the blocking cause's own — see checkedFieldPairs on
// DefaultValueSemanticsAudit and defaultValueSemanticsRelevantPairWasChecked().
//
// Both gaps preserve BYTE-IDENTICAL behavior for every ordinary/unrelated
// validation (defaultValueSemanticsRequired absent/false) — see test 9.
//
// A THIRD finding, NOT fixed here (out of scope, reported honestly rather
// than silently worked around): a live proof-of-concept directly invoking
// analyzeDefaultValueSemantics() with the EXACT (Task/status/TaskDTO/status)
// tuple the blocking cause names — using the real candidate TaskDTO.java/
// TaskService.java content at 5ef66be3... and the real Task.java baseline —
// came back PROVEN_DEFECT, not NO_DEFECT. That is a FALSE POSITIVE relative
// to the actual fix: scanPropagation()'s guard-detection only recognizes the
// `get<Field>() != null` idiom, not the presence-tracking boolean
// (`isStatusPresent()`) attempt 13's own fix actually uses, so it never sees
// the real guard and reports the propagation as unconditional. This means a
// naive "targeted single-pair re-check bypassing discoverMigrations" is NOT
// safe to wire in as-is — it would incorrectly BLOCK a working fix. See the
// R79 report for the recommended closure path (a real executed behavioral
// test on the ABSENT case, not a static-analyzer extension, not LLM opinion).

import * as assert from 'node:assert/strict';
import { computeMergeAuthorization, MergeAuthorizationInput } from './merge-authorization';
import {
  resolveDefaultValueSemanticsBaseSha,
  correctiveBlockingCausesDeclareDefaultValueSemanticsDefect,
  defaultValueSemanticsRelevantPairWasChecked,
} from '../incidents/incidents.service';

const readyBase: MergeAuthorizationInput = {
  remediationResult: 'VALIDATED',
  exactCorrelationVerified: true,
  requiredStagesComplete: true,
  regressionResult: 'CLEAN',
  headVerificationResult: 'PASS',
};

// The real corrective dispatch record from incident 73733ec0, attempt 13,
// captured live from the running platform on 2026-09-20.
const realFixRequest = {
  baselineSha: '6ed56ff791acbf3e111431285bef7b30c8076084',
  correctiveDispatch: {
    status: 'DISPATCHED', attempt: 13,
    blockedSha: 'dc1aa978719ca40e6339e075cfe52a79875b2342',
    correctiveContext: {
      reasonCodes: ['DEFAULT_VALUE_SEMANTICS_REGRESSION'],
      blockingCauses: [
        {
          type: 'DEFAULT_VALUE_SEMANTICS_DEFECT',
          sourceType: 'Task', sourceField: 'status', candidateType: 'TaskDTO', candidateField: 'status',
          candidateSha: 'dc1aa978719ca40e6339e075cfe52a79875b2342',
        },
      ],
    },
  },
};

// 1. required=false + no migration -> unchanged (VERIFICATION_REQUIRED remains a no-op).
{
  const r = computeMergeAuthorization({ ...readyBase, defaultValueSemanticsResult: 'VERIFICATION_REQUIRED' });
  assert.equal(r.authorization, 'MERGE_READY');
  assert.equal(r.technicalReasons.length, 0);
  const explicitlyFalse = computeMergeAuthorization({
    ...readyBase, defaultValueSemanticsResult: 'VERIFICATION_REQUIRED', defaultValueSemanticsRequired: false,
  });
  assert.equal(explicitlyFalse.authorization, 'MERGE_READY');
  console.log('R79_1_REQUIRED_FALSE_UNCHANGED: PASS');
}

// 2. required=true + PROVEN_DEFECT -> BLOCKED, unconditionally.
{
  const r = computeMergeAuthorization({
    ...readyBase, defaultValueSemanticsResult: 'PROVEN_DEFECT',
    defaultValueSemanticsRequired: true, defaultValueSemanticsEvaluatedShaMatches: true,
    defaultValueSemanticsCheckedPairs: 1, defaultValueSemanticsRelevantPairChecked: true,
  });
  assert.equal(r.authorization, 'BLOCKED');
  assert.ok(r.blockingReasons.includes('DEFAULT_VALUE_SEMANTICS_REGRESSION'));
  console.log('R79_2_PROVEN_DEFECT_BLOCKED: PASS');
}

// 3. required=true + VERIFICATION_REQUIRED -> INCONCLUSIVE.
{
  const r = computeMergeAuthorization({
    ...readyBase, defaultValueSemanticsResult: 'VERIFICATION_REQUIRED',
    defaultValueSemanticsRequired: true, defaultValueSemanticsEvaluatedShaMatches: true,
  });
  assert.equal(r.authorization, 'INCONCLUSIVE');
  assert.ok(r.technicalReasons.includes('DEFAULT_VALUE_SEMANTICS_UNVERIFIED'));
  assert.equal(r.blockingReasons.length, 0);
  console.log('R79_3_VERIFICATION_REQUIRED_INCONCLUSIVE: PASS');
}

// 4. required=true + NO_DEFECT + checkedPairs=0 -> INCONCLUSIVE (the exact
// shape of the CURRENT, still-unrepaired-in-production real bug).
{
  const r = computeMergeAuthorization({
    ...readyBase, defaultValueSemanticsResult: 'NO_DEFECT',
    defaultValueSemanticsRequired: true, defaultValueSemanticsEvaluatedShaMatches: true,
    defaultValueSemanticsCheckedPairs: 0, defaultValueSemanticsRelevantPairChecked: false,
  });
  assert.equal(r.authorization, 'INCONCLUSIVE');
  assert.ok(r.technicalReasons.includes('DEFAULT_VALUE_SEMANTICS_UNVERIFIED'));
  console.log('R79_4_NO_DEFECT_ZERO_PAIRS_INCONCLUSIVE: PASS');
}

// 5. required=true + NO_DEFECT + checkedPairs>0 but NONE relevant to the
// blocking cause (e.g. only unrelated fields like `title`/`priority` were
// checked) -> INCONCLUSIVE.
{
  const r = computeMergeAuthorization({
    ...readyBase, defaultValueSemanticsResult: 'NO_DEFECT',
    defaultValueSemanticsRequired: true, defaultValueSemanticsEvaluatedShaMatches: true,
    defaultValueSemanticsCheckedPairs: 3, defaultValueSemanticsRelevantPairChecked: false,
  });
  assert.equal(r.authorization, 'INCONCLUSIVE');
  assert.ok(r.technicalReasons.includes('DEFAULT_VALUE_SEMANTICS_UNVERIFIED'));
  console.log('R79_5_NO_DEFECT_IRRELEVANT_PAIRS_INCONCLUSIVE: PASS');
}

// 6. required=true + relevant safe pair (checkedPairs>0, relevant, sha matches) -> may reach MERGE_READY.
{
  const r = computeMergeAuthorization({
    ...readyBase, defaultValueSemanticsResult: 'NO_DEFECT',
    defaultValueSemanticsRequired: true, defaultValueSemanticsEvaluatedShaMatches: true,
    defaultValueSemanticsCheckedPairs: 1, defaultValueSemanticsRelevantPairChecked: true,
  });
  assert.equal(r.authorization, 'MERGE_READY');
  console.log('R79_6_RELEVANT_SAFE_PAIR_MERGE_READY: PASS');
}

// 7. relevant pair proven safe, but evaluatedSha is stale (doesn't match the
// sha this authorization is actually for) -> INCONCLUSIVE, never trusted.
{
  const r = computeMergeAuthorization({
    ...readyBase, defaultValueSemanticsResult: 'NO_DEFECT',
    defaultValueSemanticsRequired: true, defaultValueSemanticsEvaluatedShaMatches: false,
    defaultValueSemanticsCheckedPairs: 1, defaultValueSemanticsRelevantPairChecked: true,
  });
  assert.equal(r.authorization, 'INCONCLUSIVE');
  assert.ok(r.technicalReasons.includes('DEFAULT_VALUE_SEMANTICS_UNVERIFIED'));
  console.log('R79_7_RELEVANT_BUT_STALE_SHA_INCONCLUSIVE: PASS');
}

// 8. Current 5ef66be3 replay (real data, real helpers) cannot MERGE_READY
// without relevant proof. Base-sha resolution and required-flag derivation
// use the REAL incident 73733ec0 fixRequest.correctiveDispatch record; the
// {verdict, checkedPairs, checkedFieldPairs} triple is exactly what a real,
// live, end-to-end run of buildDefaultValueSemanticsEvidence() against real
// GitHub content at the CORRECTED base sha actually returned (see the R79
// report for the live command/output; reproduced verbatim here as a fixed
// expectation, not re-fetched over the network by this spec).
{
  assert.equal(resolveDefaultValueSemanticsBaseSha(realFixRequest), 'dc1aa978719ca40e6339e075cfe52a79875b2342');
  assert.equal(correctiveBlockingCausesDeclareDefaultValueSemanticsDefect(realFixRequest), true);

  const firstAttemptFixRequest = { baselineSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  assert.equal(resolveDefaultValueSemanticsBaseSha(firstAttemptFixRequest), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(correctiveBlockingCausesDeclareDefaultValueSemanticsDefect(firstAttemptFixRequest), false);

  // Real, live buildDefaultValueSemanticsEvidence() result (2026-09-20) once
  // GAP 1 is fixed: TaskDTO.java/TaskService.java at dc1aa978.../5ef66be3...
  // contain zero @RequestBody type-change bindings (that annotation lives
  // in TaskController.java, untouched by attempt 13) -> discoverMigrations
  // finds nothing -> checkedPairs stays 0.
  const realCheckoutSha = '5ef66be30482042d9dd6802402692e3d03636c97';
  const realAuditAfterGap1Fix = {
    verdict: 'NO_DEFECT' as const,
    evaluatedSha: realCheckoutSha,
    checkedPairs: 0,
    checkedFieldPairs: [] as Array<{ sourceType: string; sourceField: string; candidateType: string; candidateField: string; verdict: string }>,
  };
  const shaMatches = realAuditAfterGap1Fix.evaluatedSha.toLowerCase() === realCheckoutSha.toLowerCase();
  const relevantPairChecked = defaultValueSemanticsRelevantPairWasChecked(realFixRequest, realAuditAfterGap1Fix.checkedFieldPairs);
  assert.equal(relevantPairChecked, false, 'zero checked pairs means the required pair was, by construction, never checked');

  const replay = computeMergeAuthorization({
    ...readyBase,
    defaultValueSemanticsResult: realAuditAfterGap1Fix.verdict,
    defaultValueSemanticsRequired: correctiveBlockingCausesDeclareDefaultValueSemanticsDefect(realFixRequest),
    defaultValueSemanticsEvaluatedShaMatches: shaMatches,
    defaultValueSemanticsCheckedPairs: realAuditAfterGap1Fix.checkedPairs,
    defaultValueSemanticsRelevantPairChecked: relevantPairChecked,
  });
  assert.notEqual(replay.authorization, 'MERGE_READY', 'must NOT incorrectly produce MERGE_READY via "no migration found" alone');
  assert.equal(replay.authorization, 'INCONCLUSIVE');
  assert.ok(replay.technicalReasons.includes('DEFAULT_VALUE_SEMANTICS_UNVERIFIED'));
  console.log('R79_8_CURRENT_5EF66BE3_REPLAY_CANNOT_MERGE_READY: PASS (authorization =', replay.authorization + ', live platform currently still shows MERGE_READY)');
}

// 9. ordinary incidents WITHOUT semantic policy unaffected -- byte-identical
// to pre-R79 behavior even when the verdict is VERIFICATION_REQUIRED, the
// common case for any PR this check doesn't structurally apply to.
{
  const r = computeMergeAuthorization({ ...readyBase, defaultValueSemanticsResult: 'VERIFICATION_REQUIRED' });
  assert.equal(r.authorization, 'MERGE_READY');
  assert.equal(r.technicalReasons.length, 0);
  const r2 = computeMergeAuthorization({ ...readyBase, defaultValueSemanticsResult: 'NO_DEFECT' });
  assert.equal(r2.authorization, 'MERGE_READY');
  console.log('R79_9_ORDINARY_INCIDENTS_UNAFFECTED: PASS');
}

// 10. "prior R79 tests still pass" -- PROVEN_DEFECT unconditional block,
// mono-cause structural helpers, first-attempt fallback -- all re-asserted
// above (tests 1, 2, 8) within this same, single, up-to-date suite.
console.log('R79_10_PRIOR_TESTS_STILL_PASS: PASS (folded into 1/2/8 above — single up-to-date suite, no stale duplicate file)');

console.log('r79-default-value-semantics-merge-policy: PASS');
