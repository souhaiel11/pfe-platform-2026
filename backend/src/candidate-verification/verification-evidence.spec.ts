// R76 -- focused unit tests for the bounded verification-evidence helper
// itself (write-guard.spec.ts already proves it end-to-end through
// assertCandidateStillValidForWrite). Pure functions, no side effects.
import * as assert from 'node:assert/strict';
import { redactAndCapEvidence, buildVerificationEvidence } from './verification-evidence';
import { CandidateVerification } from './candidate-verification.types';

// --- redactAndCapEvidence: null/undefined -> null ---
assert.equal(redactAndCapEvidence(null), null);
assert.equal(redactAndCapEvidence(undefined), null);
assert.equal(redactAndCapEvidence(''), null);
assert.equal(redactAndCapEvidence('   '), null);

// --- hard cap at 500 chars by default ---
assert.equal(redactAndCapEvidence('x'.repeat(1000)).length, 500);
assert.equal(redactAndCapEvidence('x'.repeat(1000), 50).length, 50);

// --- newlines collapsed (single-line callback payload, matches WF2 convention) ---
assert.equal(redactAndCapEvidence('line1\nline2\r\nline3'), 'line1 line2 line3');

// --- secret-like values redacted, keyword preserved, value removed ---
assert.equal(redactAndCapEvidence('token=abc123 password: hunter2 api_key=XYZ'),
  'token=[REDACTED] password=[REDACTED] api_key=[REDACTED]');
assert.doesNotMatch(redactAndCapEvidence('secret=sk-real-secret-value')!, /sk-real-secret-value/);

function baseVerification(): CandidateVerification {
  return {
    identity: { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 1, candidateBaseSha: 'a'.repeat(40), candidateDigest: 'd1' },
    workspace: { workspaceId: 'r1/b1/attempt-1', exactShaVerified: true, created: true, cleaned: true },
    manifestValidation: { status: 'PASS', errors: [] },
    compile: { status: 'FAILED', exitCode: 1, durationMs: 1200, evidenceRef: 'error: incompatible types: TaskDTO cannot be converted to Task' },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
      regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'FAIL',
    verificationLevel: 'COMPILE_TEST_VERIFIED',
    failureClass: 'CANDIDATE_COMPILE_FAILURE',
  };
}

// --- buildVerificationEvidence: whitelists exactly the intended fields ---
{
  const evidence = buildVerificationEvidence(baseVerification());
  assert.deepEqual(Object.keys(evidence).sort(), ['compile', 'failureClass', 'overall', 'staticAnalysis', 'tests']);
  assert.deepEqual(Object.keys(evidence.compile).sort(), ['evidenceTail', 'exitCode', 'status']);
  assert.deepEqual(Object.keys(evidence.tests).sort(), ['evidenceTail', 'regressionStatus']);
  assert.equal(evidence.overall, 'FAIL');
  assert.equal(evidence.failureClass, 'CANDIDATE_COMPILE_FAILURE');
  assert.equal(evidence.compile.status, 'FAILED');
  assert.equal(evidence.compile.exitCode, 1);
  assert.match(evidence.compile.evidenceTail!, /incompatible types/);
  // No workspace/identity/manifest/full-log fields ever leak through.
  assert.ok(!('identity' in evidence));
  assert.ok(!('workspace' in evidence));
  assert.ok(!('manifestValidation' in evidence));
  assert.ok(!('verificationLevel' in evidence));
}

// --- never throws on a sparse/partial object ---
{
  const evidence = buildVerificationEvidence({} as CandidateVerification);
  assert.deepEqual(evidence, {
    overall: null, failureClass: null,
    compile: { status: null, exitCode: null, evidenceTail: null },
    tests: { regressionStatus: null, evidenceTail: null },
    staticAnalysis: { status: null },
  });
}

console.log('verification-evidence: PASS');
