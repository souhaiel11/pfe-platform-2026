import * as assert from 'node:assert/strict';
import { CandidateVerificationController } from './candidate-verification.controller';
import { CandidateManifest } from './candidate-verification.types';

const fakeVerification: any = { overall: 'PASS', identity: { candidateDigest: 'd1', candidateBaseSha: 'a'.repeat(40) }, workspace: { exactShaVerified: true } };

function manifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  return { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0, repository: 'x/y', candidateBaseSha: 'a'.repeat(40), files: [], candidateDigest: 'd1', ...overrides };
}

// --- verify(): delegates to RepoCacheService then CandidateVerificationService with the resolved repoPath ---
{
  let capturedRepo: string | null = null;
  let capturedOptions: any = null;
  const fakeService: any = { verify: (m: CandidateManifest, options: any) => { capturedOptions = options; return fakeVerification; } };
  const fakeRepoCache: any = { ensureRepo: (repo: string) => { capturedRepo = repo; return '/fake/repo/path'; } };
  const controller = new CandidateVerificationController(fakeService, fakeRepoCache);

  const result = controller.verify({ manifest: manifest(), allowedPaths: ['A.java'] });
  assert.equal(capturedRepo, 'x/y', 'verify() resolves the repo path via RepoCacheService using manifest.repository');
  assert.equal(capturedOptions.repoPath, '/fake/repo/path', 'the resolved repo path is passed through to the verification service');
  assert.deepEqual(capturedOptions.allowedPaths, ['A.java']);
  assert.equal(result, fakeVerification, 'verify() returns exactly what the service returns');
}

// --- verify(): rejects a request with no manifest.files array before touching anything ---
{
  const fakeService: any = { verify: () => { throw new Error('must not be called'); } };
  const fakeRepoCache: any = { ensureRepo: () => { throw new Error('must not be called'); } };
  const controller = new CandidateVerificationController(fakeService, fakeRepoCache);
  assert.throws(() => controller.verify({ manifest: {} as any }), /files/, 'a manifest without files[] is rejected before calling the repo cache or verification service');
}

// --- write-guard(): delegates to assertCandidateStillValidForWrite ---
{
  const controller = new CandidateVerificationController({} as any, {} as any);
  const result = controller.writeGuard({ verification: fakeVerification, candidateManifest: manifest() });
  assert.equal(result.ok, true, 'write-guard endpoint reuses the exact assertCandidateStillValidForWrite logic (matching digest/baseSha/exactShaVerified)');

  const mismatched = controller.writeGuard({ verification: fakeVerification, candidateManifest: manifest({ candidateDigest: 'different' }) });
  assert.deepEqual(mismatched, { ok: false, reason: 'CANDIDATE_DIGEST_MISMATCH' });
}

// --- remote-head-drift(): delegates to assertRemoteHeadMatchesCandidateBase ---
{
  const controller = new CandidateVerificationController({} as any, {} as any);
  const noDrift = controller.remoteHeadDrift({ remoteHeadSha: 'a'.repeat(40), candidateBaseSha: 'a'.repeat(40) });
  assert.equal(noDrift.ok, true);
  const drifted = controller.remoteHeadDrift({ remoteHeadSha: 'b'.repeat(40), candidateBaseSha: 'a'.repeat(40) });
  assert.deepEqual(drifted, { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' });
}

console.log('CandidateVerificationController: PASS');
