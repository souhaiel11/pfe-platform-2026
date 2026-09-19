import * as assert from 'node:assert/strict';
import { CandidateVerificationExecutor } from './candidate-verification-executor';
import { CandidateManifest, VerificationMode } from '../../backend/src/candidate-verification/candidate-verification.types';

const sha = 'a'.repeat(40);
const manifest: CandidateManifest = {
  candidateId: 'closure-candidate', requestId: 'closure-request', batchId: 'closure-batch', candidateAttempt: 10,
  repository: 'owner/repository', candidateBaseSha: sha, candidateDigest: 'd'.repeat(64),
  files: [{ path: 'src/main/java/Closure.java', operation: 'MODIFY', content: 'class Closure {}', contentSha256: 'c'.repeat(64) }],
};
const workspaceManager = {
  workspaceId: (_requestId: string, _batchId: string, _attempt: number, sequence?: number) => `closure-${sequence ?? 0}`,
  createWorkspace: ({ candidateBaseSha }: any) => ({ path: '/tmp/closure-workspace', exactShaVerified: true, checkoutSha: candidateBaseSha }),
  cleanupWorkspace: () => {},
};
const materializer = { materialize: () => {} };
const repoCache = { ensureRepo: () => '/tmp/closure-repository' };
const pass = { status: 'SUCCESS' as const, exitCode: 0, durationMs: 1, evidenceTail: '' };
const adapter = {
  buildType: 'closure', supports: () => true, supportsMode: () => true,
  compile: () => pass, compileTests: () => pass,
  runRegressionTests: () => ({ status: 'SUCCESS' as const, total: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: '' }),
};
const executor = new CandidateVerificationExecutor(workspaceManager as any, materializer as any, repoCache as any, [adapter]);
for (const [index, mode] of (['COMPILE_MAIN', 'COMPILE_TESTS', 'FULL_TEST'] as VerificationMode[]).entries()) {
  const result = executor.execute(manifest, { mode, verificationStep: { sequence: index + 1, phase: ['INITIAL_COMPILE', 'TEST_COMPILE', 'FULL_TEST'][index] as any, stateDigest: manifest.candidateDigest! } });
  assert.equal(result.overall, 'PASS', mode);
  assert.equal(result.workspace.requestedSha, sha, `${mode}: requestedSha`);
  assert.equal(result.workspace.checkoutSha, sha, `${mode}: checkoutSha`);
  assert.equal(result.identity.candidateBaseSha, sha, `${mode}: candidateBaseSha`);
  assert.equal(result.workspace.exactShaVerified, true, `${mode}: exactShaVerified`);
  assert.equal(result.workspace.checkoutSha, result.workspace.requestedSha, `${mode}: exact anchoring`);
}
console.log('candidate-sha-evidence: 3/3 modes PASS');
