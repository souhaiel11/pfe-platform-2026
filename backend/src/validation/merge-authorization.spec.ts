import * as assert from 'node:assert/strict';
import {
  computeMergeAuthorization,
  deriveRemediationResult,
  deriveExactCorrelationVerified,
  MergeAuthorizationInput,
} from './merge-authorization';

// Pure unit tests — no DB, no IO. Exercise the decoupling contract:
// remediation correctness vs global pipeline/QG health vs regression, and the
// fact that regression detection does not exist yet (always INCONCLUSIVE).

const base: MergeAuthorizationInput = {
  remediationResult: 'VALIDATED',
  exactCorrelationVerified: true,
  requiredStagesComplete: true,
  regressionResult: 'INCONCLUSIVE',
  pipelineHealth: null,
};

// --- CASE A: the real PR #25 shape ---------------------------------------
// 2/2 findings VALID, exact SHA + correlation verified, required stages
// complete, global Sonar QG = ERROR (14 out-of-batch findings), regression
// not yet verifiable. Expected: NOT MERGE_READY, NOT BLOCKED — INCONCLUSIVE
// with REGRESSION_UNVERIFIED; QG is only an advisory, never a blocker here.
{
  const r = computeMergeAuthorization({
    ...base,
    remediationResult: 'VALIDATED',
    regressionResult: 'INCONCLUSIVE',
    pipelineHealth: { sonarQualityGate: 'ERROR', build: 'SUCCESS', tests: 'SUCCESS', requiredStagesStatus: 'PASSED' },
  });
  assert.equal(r.authorization, 'INCONCLUSIVE', 'CASE A: fully remediated but regression unverified => INCONCLUSIVE');
  assert.ok(r.blockingReasons.includes('REGRESSION_UNVERIFIED'), 'CASE A: reason is the missing regression proof');
  assert.ok(!r.blockingReasons.includes('FINDING_INVALID'), 'CASE A: no finding is invalid');
  assert.ok(
    !r.blockingReasons.some(x => String(x).startsWith('SONAR')),
    'CASE A: the global Sonar QG is NOT a blocking reason for merge',
  );
  assert.ok(
    r.advisories.some(a => a.code === 'SONAR_QUALITY_GATE_ERROR'),
    'CASE A: the global Sonar QG surfaces as an advisory only',
  );
  assert.notEqual(r.authorization, 'BLOCKED', 'CASE A: a red global QG alone never blocks the merge');
  assert.notEqual(r.authorization, 'MERGE_READY', 'CASE A: not auto-certifiable while regression is unverified');
}

// --- one finding INVALID => BLOCKED -------------------------------------
{
  const r = computeMergeAuthorization({ ...base, remediationResult: 'INVALID' });
  assert.equal(r.authorization, 'BLOCKED', 'an INVALID approved finding hard-blocks the merge');
  assert.ok(r.blockingReasons.includes('FINDING_INVALID'));
}
{
  // INVALID dominates even if everything else (incl. regression CLEAN) is green
  const r = computeMergeAuthorization({ ...base, remediationResult: 'INVALID', regressionResult: 'CLEAN' });
  assert.equal(r.authorization, 'BLOCKED', 'INVALID finding blocks even with regression CLEAN');
}

// --- regression CHANGES_REQUIRED => BLOCKED ----------------------------
{
  const r = computeMergeAuthorization({ ...base, remediationResult: 'VALIDATED', regressionResult: 'CHANGES_REQUIRED' });
  assert.equal(r.authorization, 'BLOCKED', 'regression demanding changes hard-blocks the merge');
  assert.ok(r.blockingReasons.includes('REGRESSION_CHANGES_REQUIRED'));
}

// --- everything good + regression CLEAN => MERGE_READY ----------------
{
  const r = computeMergeAuthorization({
    ...base,
    remediationResult: 'VALIDATED',
    exactCorrelationVerified: true,
    requiredStagesComplete: true,
    regressionResult: 'CLEAN',
  });
  assert.equal(r.authorization, 'MERGE_READY', 'all preconditions positively satisfied => MERGE_READY');
  assert.deepEqual(r.blockingReasons, [], 'MERGE_READY carries no blocking reasons');
}
{
  // MERGE_READY still holds with a red global Sonar QG (advisory only)
  const r = computeMergeAuthorization({
    ...base,
    remediationResult: 'VALIDATED',
    regressionResult: 'CLEAN',
    pipelineHealth: { sonarQualityGate: 'ERROR' },
  });
  assert.equal(r.authorization, 'MERGE_READY', 'red global QG alone does not remove MERGE_READY');
  assert.ok(r.advisories.some(a => a.code === 'SONAR_QUALITY_GATE_ERROR'), 'QG still surfaced as advisory');
}

// --- SHA mismatch => never MERGE_READY --------------------------------
{
  const r = computeMergeAuthorization({
    ...base,
    remediationResult: 'VALIDATED',
    exactCorrelationVerified: false,
    requiredStagesComplete: true,
    regressionResult: 'CLEAN',
  });
  assert.notEqual(r.authorization, 'MERGE_READY', 'SHA/correlation not verified => never MERGE_READY');
  assert.equal(r.authorization, 'INCONCLUSIVE');
  assert.ok(r.blockingReasons.includes('SHA_MISMATCH'));
}

// --- required stage incomplete => never MERGE_READY -------------------
{
  const r = computeMergeAuthorization({ ...base, remediationResult: 'VALIDATED', requiredStagesComplete: false, regressionResult: 'CLEAN' });
  assert.notEqual(r.authorization, 'MERGE_READY');
  assert.ok(r.blockingReasons.includes('STAGE_INCOMPLETE'));
}

// --- validation in progress => VALIDATING -----------------------------
{
  const r = computeMergeAuthorization({ ...base, validationInProgress: true, regressionResult: 'CLEAN' });
  assert.equal(r.authorization, 'VALIDATING', 'validation still running => VALIDATING regardless of other signals');
  assert.deepEqual(r.blockingReasons, ['VALIDATION_IN_PROGRESS']);
}

// --- remediation INCONCLUSIVE (not all VALID, none INVALID) => INCONCLUSIVE
{
  const r = computeMergeAuthorization({ ...base, remediationResult: 'INCONCLUSIVE', regressionResult: 'CLEAN' });
  assert.equal(r.authorization, 'INCONCLUSIVE');
  assert.ok(r.blockingReasons.includes('REMEDIATION_INCONCLUSIVE'));
}

// --- deriveRemediationResult: reuses FindingVerdict, no duplication ---
{
  assert.equal(deriveRemediationResult(['VALID', 'VALID']), 'VALIDATED');
  assert.equal(deriveRemediationResult(['VALID', 'INVALID']), 'INVALID');
  assert.equal(deriveRemediationResult(['VALID', 'INCONCLUSIVE']), 'INCONCLUSIVE');
  assert.equal(deriveRemediationResult(['INVALID', 'INCONCLUSIVE']), 'INVALID');
  assert.equal(deriveRemediationResult([]), 'INCONCLUSIVE', 'empty batch is never VALIDATED');
}

// --- deriveExactCorrelationVerified: WF3 flag AND full-hex SHA equality
{
  const sha = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';
  assert.equal(
    deriveExactCorrelationVerified({ correlationVerified: true, checkoutSha: sha, expectedPrHeadSha: sha.toUpperCase() }),
    true,
    'case-insensitive full-hex match + WF3 flag => verified',
  );
  assert.equal(
    deriveExactCorrelationVerified({ correlationVerified: true, checkoutSha: sha, expectedPrHeadSha: 'b'.repeat(40) }),
    false,
    'different SHA => not verified',
  );
  assert.equal(
    deriveExactCorrelationVerified({ correlationVerified: false, checkoutSha: sha, expectedPrHeadSha: sha }),
    false,
    'WF3 correlation flag false => not verified even if SHAs match',
  );
  assert.equal(
    deriveExactCorrelationVerified({ correlationVerified: true, checkoutSha: '8a315b0d', expectedPrHeadSha: '8a315b0d' }),
    false,
    'short/non-40-hex SHA => not verified',
  );
}

console.log('merge-authorization contract: PASS');
