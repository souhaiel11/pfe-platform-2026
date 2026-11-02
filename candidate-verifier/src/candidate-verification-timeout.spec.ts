// Teste le composant « candidate-verification-timeout » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { CandidateVerificationExecutor } from './candidate-verification-executor';
import { isProcessTimeout } from './process-timeout';

const sha = 'a'.repeat(40);
const request: any = {
  verifyHeadOnly: true, repository: 'owner/repo', targetSha: sha,
  validationRequestId: 'validation', requestId: 'request', batchId: 'batch', candidateAttempt: 1,
};

const manager: any = {
  /** Construit l’identifiant de l’espace de travail. */
  workspaceId: () => 'request/batch/attempt-1',
  /** Crée un espace isolé pour la vérification. */
  createWorkspace: () => ({ path: '/tmp', exactShaVerified: true, checkoutSha: sha }),
  /** Nettoie l’espace de travail après l’opération. */
  cleanupWorkspace: () => undefined,
};
const repoCache: any = {
/** Prépare le dépôt et la révision nécessaires. */
ensureRepo: () => '/tmp/repo' };

/** Exécute le traitement et collecte son résultat. */
function run(compile: any, tests: any = { status: 'SUCCESS', total: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null }) {
  const adapter: any = {
  /** Indique si cet adaptateur prend en charge les données. */
  supports: () => true,
  /** Compile le projet dans le délai disponible. */
  compile: () => compile,
  /** Exécute les tests pour détecter les régressions. */
  runRegressionTests: () => tests };
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
