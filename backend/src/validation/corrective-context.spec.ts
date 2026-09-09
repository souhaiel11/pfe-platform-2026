import * as assert from 'node:assert/strict';
import { extractBlockingCauses, buildCorrectiveContext } from './corrective-context';

// BRIQUE 5 — pure extraction contract: never invents evidence, never mixes
// TARGET_FINDING_INVALID with NEW_BLOCKING_FINDING for the same record,
// carries line as supporting evidence only (never identity).

function main() {
  // A validation record shaped exactly like saveValidation() persists.
  const sha = 'a'.repeat(40);
  const cleanValidation = {
    checkoutSha: sha, analysisId: 'analysis-1',
    findingResults: [
      { findingId: 'a', result: 'VALID', evidence: 'a absent' },
      { findingId: 'b', result: 'VALID', evidence: 'b absent' },
    ],
    mergeAuthorization: { blockingReasons: [] },
    regression: { candidateSha: sha, blockingIntroducedFindings: [] },
  };
  assert.deepEqual(extractBlockingCauses(cleanValidation), [], 'no invalid finding, no blocking regression -> no causes');

  // CASE B-shaped: one INVALID target finding.
  const invalidValidation = {
    ...cleanValidation,
    findingResults: [
      { findingId: 'a', result: 'INVALID', evidence: 'sonar exact-sha a: issue still open' },
      { findingId: 'b', result: 'VALID', evidence: 'b absent' },
    ],
    mergeAuthorization: { blockingReasons: ['FINDING_INVALID'] },
  };
  const invalidCauses = extractBlockingCauses(invalidValidation);
  assert.equal(invalidCauses.length, 1);
  assert.equal(invalidCauses[0].type, 'TARGET_FINDING_INVALID');
  assert.equal(invalidCauses[0].findingId, 'a');
  assert.equal(invalidCauses[0].evidenceRef, 'sonar exact-sha a: issue still open');
  assert.equal(invalidCauses[0].candidateSha, sha);
  assert.equal(invalidCauses[0].scannerAnalysisId, 'analysis-1');

  // CASE A/C-shaped: a genuinely new blocking regression finding.
  const regressionValidation = {
    ...cleanValidation,
    mergeAuthorization: { blockingReasons: ['REGRESSION_CHANGES_REQUIRED'] },
    regression: {
      candidateSha: sha,
      blockingIntroducedFindings: [
        { source: 'SONARQUBE', rule: 'java:S9999', path: 'src/NewBug.java', line: 5, message: 'new issue', fingerprint: 'SONARQUBE::java:S9999::src/newbug.java' },
      ],
    },
  };
  const regressionCauses = extractBlockingCauses(regressionValidation);
  assert.equal(regressionCauses.length, 1);
  assert.equal(regressionCauses[0].type, 'NEW_BLOCKING_FINDING');
  assert.equal(regressionCauses[0].findingSource, 'SONARQUBE');
  assert.equal(regressionCauses[0].rule, 'java:S9999');
  assert.equal(regressionCauses[0].path, 'src/NewBug.java');
  assert.equal(regressionCauses[0].line, 5, 'line is carried as supporting evidence');
  assert.equal(regressionCauses[0].candidateSha, sha);
  // The fingerprint itself is never exposed as a business field here -- it
  // is purely an engine-internal identity concern, not causal-context evidence.
  assert.ok(!('fingerprint' in regressionCauses[0]));

  // Both kinds simultaneously: never conflated into a single generic cause.
  const bothValidation = {
    ...cleanValidation,
    findingResults: [{ findingId: 'a', result: 'INVALID', evidence: 'still open' }],
    mergeAuthorization: { blockingReasons: ['FINDING_INVALID', 'REGRESSION_CHANGES_REQUIRED'] },
    regression: regressionValidation.regression,
  };
  const bothCauses = extractBlockingCauses(bothValidation);
  assert.equal(bothCauses.length, 2);
  assert.deepEqual(bothCauses.map(c => c.type).sort(), ['NEW_BLOCKING_FINDING', 'TARGET_FINDING_INVALID']);

  // buildCorrectiveContext: preserves lineage-relevant fields, never invents.
  const ctx = buildCorrectiveContext({ previousAttempt: 1, validation: bothValidation });
  assert.equal(ctx.previousAttempt, 1);
  assert.equal(ctx.previousValidatedSha, sha);
  assert.equal(ctx.currentPrHeadSha, sha);
  assert.deepEqual(ctx.reasonCodes, ['FINDING_INVALID', 'REGRESSION_CHANGES_REQUIRED']);
  assert.equal(ctx.blockingCauses.length, 2);
  assert.deepEqual(ctx.originalFindingResults, [{ findingId: 'a', result: 'INVALID', evidence: 'still open' }]);

  // Malformed/absent validation never throws, never fabricates a cause.
  assert.deepEqual(extractBlockingCauses(null), []);
  assert.deepEqual(extractBlockingCauses({}), []);
  const emptyCtx = buildCorrectiveContext({ previousAttempt: 1, validation: {} });
  assert.deepEqual(emptyCtx.blockingCauses, []);
  assert.deepEqual(emptyCtx.reasonCodes, []);
  assert.deepEqual(emptyCtx.originalFindingResults, []);

  console.log('Corrective context extraction (Brique 5): PASS');
}

main();
