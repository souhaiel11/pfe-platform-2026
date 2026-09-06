import * as assert from 'node:assert/strict';
import { CandidateVerificationController } from './candidate-verification.controller';
import { CandidateManifest } from './candidate-verification.types';

const fakeVerification: any = { overall: 'PASS', identity: { candidateDigest: 'd1', candidateBaseSha: 'a'.repeat(40) }, workspace: { exactShaVerified: true } };

function manifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  return { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0, repository: 'x/y', candidateBaseSha: 'a'.repeat(40), files: [], candidateDigest: 'd1', ...overrides };
}

async function main() {
  // --- verify(): forwards the manifest/allowedPaths/timeoutMs to the (now-HTTP-client)
  // service unchanged -- no repoPath resolution happens in the backend at
  // all anymore (R22-E2C2 -- that moved to the candidate-verifier worker's
  // own RepoCacheService). ---
  {
    let capturedManifest: any = null;
    let capturedOptions: any = null;
    const fakeService: any = { verify: async (m: CandidateManifest, options: any) => { capturedManifest = m; capturedOptions = options; return fakeVerification; } };
    const controller = new CandidateVerificationController(fakeService);

    const result = await controller.verify({ manifest: manifest(), allowedPaths: ['A.java'], options: { timeoutMs: 1234 } });
    assert.equal(capturedManifest.repository, 'x/y', 'verify() forwards the manifest as-is to the service');
    assert.deepEqual(capturedOptions, { allowedPaths: ['A.java'], timeoutMs: 1234 }, 'verify() forwards allowedPaths/timeoutMs, with no repoPath field at all');
    assert.equal(result, fakeVerification, 'verify() returns exactly what the service returns, unchanged');
  }

  // --- verify(): rejects a request with no manifest.files array before calling the service ---
  {
    const fakeService: any = { verify: () => { throw new Error('must not be called'); } };
    const controller = new CandidateVerificationController(fakeService);
    assert.throws(() => controller.verify({ manifest: {} as any }), /files/, 'a manifest without files[] is rejected before calling the verification service');
  }

  // --- write-guard(): delegates to assertCandidateStillValidForWrite (control-plane, no service dependency at all) ---
  {
    const controller = new CandidateVerificationController({} as any);
    const result = controller.writeGuard({ verification: fakeVerification, candidateManifest: manifest() });
    assert.equal(result.ok, true, 'write-guard endpoint reuses the exact assertCandidateStillValidForWrite logic (matching digest/baseSha/exactShaVerified)');

    const mismatched = controller.writeGuard({ verification: fakeVerification, candidateManifest: manifest({ candidateDigest: 'different' }) });
    assert.deepEqual(mismatched, { ok: false, reason: 'CANDIDATE_DIGEST_MISMATCH' });
  }

  // --- remote-head-drift(): delegates to assertRemoteHeadMatchesCandidateBase (control-plane, no service dependency) ---
  {
    const controller = new CandidateVerificationController({} as any);
    const noDrift = controller.remoteHeadDrift({ remoteHeadSha: 'a'.repeat(40), candidateBaseSha: 'a'.repeat(40) });
    assert.equal(noDrift.ok, true);
    const drifted = controller.remoteHeadDrift({ remoteHeadSha: 'b'.repeat(40), candidateBaseSha: 'a'.repeat(40) });
    assert.deepEqual(drifted, { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' });
  }

  console.log('CandidateVerificationController: PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
