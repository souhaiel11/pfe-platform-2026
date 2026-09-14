import * as assert from 'node:assert/strict';
import { assertCandidateStillValidForWrite } from './write-guard';
import { CandidateVerification, CandidateManifest, HeadVerification } from './candidate-verification.types';

function headOnlyVerification(): HeadVerification {
  return {
    mode: 'HEAD_ONLY',
    identity: { repository: 'x/y', targetSha: 'a'.repeat(40), validationRequestId: 'v1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0 },
    workspace: { workspaceId: 'r1/b1/attempt-0', exactShaVerified: true, created: true, cleaned: true, checkoutSha: 'a'.repeat(40) },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 100, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, regression: { status: 'SUCCESS', total: 1, failures: 0, errors: 0, skipped: 0, durationMs: 100, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS',
    verificationLevel: 'COMPILE_TEST_VERIFIED',
    failureClass: 'SHA_UNAVAILABLE',
  };
}

function passingVerification(overrides: Partial<CandidateVerification['identity']> = {}): CandidateVerification {
  return {
    identity: { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0, candidateBaseSha: 'a'.repeat(40), candidateDigest: 'digest-1', ...overrides },
    workspace: { workspaceId: 'r1/b1/attempt-0', exactShaVerified: true, created: true, cleaned: true },
    manifestValidation: { status: 'PASS', errors: [] },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 100, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, regression: { status: 'SUCCESS', total: 22, failures: 0, errors: 0, skipped: 0, durationMs: 100, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS',
    verificationLevel: 'COMPILE_TEST_VERIFIED',
    failureClass: null,
  };
}

function manifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  return { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0, repository: 'x/y', candidateBaseSha: 'a'.repeat(40), files: [], candidateDigest: 'digest-1', ...overrides };
}

// --- HEAD_ONLY is never write-authorizing, regardless of overall/exactShaVerified ---
{
  const result = assertCandidateStillValidForWrite(headOnlyVerification(), manifest());
  assert.deepEqual(result, { ok: false, reason: 'HEAD_ONLY_NOT_WRITABLE' }, 'a HEAD_ONLY-mode verification result must never be treated as write-authorizing');
}

// --- happy path: matching digest + base SHA + PASS + exactShaVerified ---
{
  const result = assertCandidateStillValidForWrite(passingVerification(), manifest());
  assert.equal(result.ok, true, 'a fully matching, PASS verification is accepted for write');
}

// --- overall != PASS blocks the write, regardless of digest match ---
// R76 -- now also carries a bounded verificationEvidence summary alongside
// the unchanged rejection reason (Case C: INCONCLUSIVE still blocked).
{
  const verification = passingVerification();
  verification.overall = 'INCONCLUSIVE';
  const result: any = assertCandidateStillValidForWrite(verification, manifest());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VERIFICATION_NOT_PASS');
  assert.deepEqual(result.verificationEvidence, {
    overall: 'INCONCLUSIVE', failureClass: null,
    compile: { status: 'SUCCESS', exitCode: 0, evidenceTail: null },
    tests: { regressionStatus: 'SUCCESS', evidenceTail: null },
    staticAnalysis: { status: 'NOT_RUN' },
  });
}

// R76 -- Case B: FAIL remains blocked, exactly the same as INCONCLUSIVE.
{
  const verification = passingVerification();
  verification.overall = 'FAIL';
  verification.failureClass = 'CANDIDATE_COMPILE_FAILURE';
  verification.compile = { status: 'FAILED', exitCode: 1, durationMs: 50, evidenceRef: 'error: incompatible types' };
  const result: any = assertCandidateStillValidForWrite(verification, manifest());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VERIFICATION_NOT_PASS', 'FAIL must be rejected with the exact same reason as INCONCLUSIVE -- write-guard never distinguishes them for authorization');
  assert.equal(result.verificationEvidence.overall, 'FAIL');
  assert.equal(result.verificationEvidence.failureClass, 'CANDIDATE_COMPILE_FAILURE');
  assert.equal(result.verificationEvidence.compile.status, 'FAILED');
  assert.equal(result.verificationEvidence.compile.exitCode, 1);
  assert.equal(result.verificationEvidence.compile.evidenceTail, 'error: incompatible types');
}

// R76 -- Case D/F/G/H: bounded, truncated, redacted, tolerant of missing fields.
{
  const verification = passingVerification();
  verification.overall = 'FAIL';
  verification.compile = { status: 'FAILED', exitCode: 1, durationMs: 50, evidenceRef: 'x'.repeat(2000) };
  const result: any = assertCandidateStillValidForWrite(verification, manifest());
  assert.equal(result.verificationEvidence.compile.evidenceTail.length, 500, 'evidence tail must be hard-capped at 500 chars');
}
{
  const verification = passingVerification();
  verification.overall = 'FAIL';
  verification.tests.regression = { status: 'FAILED', total: 5, failures: 1, errors: 0, skipped: 0, durationMs: 10,
    evidenceRef: 'test failed because password=hunter2 was leaked in config' };
  const result: any = assertCandidateStillValidForWrite(verification, manifest());
  assert.doesNotMatch(result.verificationEvidence.tests.evidenceTail, /hunter2/, 'secret-like values must be redacted');
  assert.match(result.verificationEvidence.tests.evidenceTail, /password=\[REDACTED\]/);
}
{
  // Missing/null compile+test detail must never throw -- evidence degrades to null fields.
  const verification = passingVerification();
  verification.overall = 'INCONCLUSIVE';
  verification.failureClass = 'BUILD_TYPE_UNSUPPORTED';
  (verification.compile as any) = { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null };
  (verification.tests.regression as any) = { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null };
  const result: any = assertCandidateStillValidForWrite(verification, manifest());
  assert.equal(result.verificationEvidence.compile.evidenceTail, null);
  assert.equal(result.verificationEvidence.tests.evidenceTail, null);
  assert.equal(result.verificationEvidence.compile.exitCode, null);
}

// --- Test 23: candidateDigest mismatch blocks the write guard ---
{
  const result = assertCandidateStillValidForWrite(passingVerification(), manifest({ candidateDigest: 'a-different-digest' }));
  assert.deepEqual(result, { ok: false, reason: 'CANDIDATE_DIGEST_MISMATCH' }, 'Test 23 - a manifest whose digest no longer matches what was verified is rejected for write, even if overall==PASS');
}

// --- Test 24: candidateBaseSha mismatch blocks the write guard ---
{
  const result = assertCandidateStillValidForWrite(passingVerification(), manifest({ candidateBaseSha: 'b'.repeat(40) }));
  assert.deepEqual(result, { ok: false, reason: 'CANDIDATE_BASE_SHA_MISMATCH' }, 'Test 24 - a manifest whose base SHA no longer matches the verified one is rejected for write');
}

// --- exactShaVerified must be true, not just truthy-adjacent ---
{
  const verification = passingVerification();
  verification.workspace.exactShaVerified = false;
  const result = assertCandidateStillValidForWrite(verification, manifest());
  assert.deepEqual(result, { ok: false, reason: 'WORKSPACE_SHA_NOT_VERIFIED' });
}

// --- case-insensitive SHA comparison, still matches ---
{
  const verification = passingVerification({ candidateBaseSha: 'A'.repeat(40) });
  const result = assertCandidateStillValidForWrite(verification, manifest({ candidateBaseSha: 'a'.repeat(40) }));
  assert.equal(result.ok, true, 'SHA comparison is case-insensitive');
}

console.log('write-guard: PASS');
