import * as assert from 'node:assert/strict';
import { assertCandidateStillValidForWrite } from './write-guard';
import { CandidateVerification, CandidateManifest } from './candidate-verification.types';

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

// --- happy path: matching digest + base SHA + PASS + exactShaVerified ---
{
  const result = assertCandidateStillValidForWrite(passingVerification(), manifest());
  assert.equal(result.ok, true, 'a fully matching, PASS verification is accepted for write');
}

// --- overall != PASS blocks the write, regardless of digest match ---
{
  const verification = passingVerification();
  verification.overall = 'INCONCLUSIVE';
  const result = assertCandidateStillValidForWrite(verification, manifest());
  assert.deepEqual(result, { ok: false, reason: 'VERIFICATION_NOT_PASS' });
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
