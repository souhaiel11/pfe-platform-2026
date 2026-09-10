import * as assert from 'node:assert/strict';
import { CandidateVerificationExecutor } from './candidate-verification-executor';
import { isProcessTimeout } from './process-timeout';

const sha = 'a'.repeat(40);
const request: any = {
  verifyHeadOnly: true, repository: 'owner/repo', targetSha: sha,
  validationRequestId: 'validation', requestId: 'request', batchId: 'batch', candidateAttempt: 1,
};

const manager: any = {
  workspaceId: () => 'request/batch/attempt-1',
  createWorkspace: () => ({ path: '/tmp', exactShaVerified: true, checkoutSha: sha }),
  cleanupWorkspace: () => undefined,
};
const repoCache: any = { ensureRepo: () => '/tmp/repo' };

function run(compile: any, tests: any = { status: 'SUCCESS', total: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null }) {
  const adapter: any = { supports: () => true, compile: () => compile, runRegressionTests: () => tests };
  return new CandidateVerificationExecutor(manager, {} as any, repoCache, [adapter]).executeHead(request);
}

assert.equal(isProcessTimeout({ signal: 'SIGTERM' }, 143, 10, 100), true, 'SIGTERM/143 is a timeout');
assert.equal(isProcessTimeout({}, 1, 100, 100), false, 'ordinary exit 1 is not a timeout');

const timeout = run({ status: 'FAILED', exitCode: 143, durationMs: 100, evidenceTail: 'WORKSPACE_TIMEOUT during mvn compile' });
assert.equal(timeout.overall, 'INCONCLUSIVE');
assert.equal(timeout.failureClass, 'WORKSPACE_TIMEOUT');

const compileFailed = run({ status: 'FAILED', exitCode: 1, durationMs: 1, evidenceTail: 'javac compilation error' });
assert.equal(compileFailed.overall, 'FAIL');
assert.equal(compileFailed.failureClass, 'CANDIDATE_COMPILE_FAILURE');

const testsFailed = run({ status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceTail: '' }, { status: 'FAILED', total: 1, failures: 1, errors: 0, skipped: 0, durationMs: 1, evidenceRef: 'assertion failure' });
assert.equal(testsFailed.overall, 'FAIL');
assert.equal(testsFailed.failureClass, 'CANDIDATE_TEST_REGRESSION');

console.log('candidate-verification-timeout: PASS');
