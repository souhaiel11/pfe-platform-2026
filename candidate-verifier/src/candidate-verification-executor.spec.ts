// R22-E2C2 — real, unmocked end-to-end proof of the execution-plane logic,
// moved here from backend/src/candidate-verification/candidate-verification.service.spec.ts
// (R22-C) along with the code it tests. Same real repository, real commits,
// real git worktree, real Maven compile/test as before -- only the class
// name changed (CandidateVerificationService -> CandidateVerificationExecutor)
// and repoPath is no longer passed in (RepoCacheService, also moved here,
// now resolves it internally from manifest.repository).
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CandidateVerificationExecutor } from './candidate-verification-executor';
import { WorkspaceManager } from './workspace-manager.service';
import { CandidateMaterializer } from './candidate-materializer.service';
import { RepoCacheService } from './repo-cache.service';
import { computeCandidateDigest, computeContentSha256 } from '../../backend/src/candidate-verification/candidate-digest';
import { CandidateManifest } from '../../backend/src/candidate-verification/candidate-verification.types';

const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
const FIXED_SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';

const SP = '/tmp/claude-1000/-home-souhaiel-pfe-2026-platform/bdcb2d19-e972-4e6c-b19f-1e99e7f70174/scratchpad/r22c-fixtures';
const fixedTaskDTOTest = fs.readFileSync(path.join(SP, 'TaskDTOTest.fixed.java'), 'utf8');
const brokenTaskDTO = fs.readFileSync(path.join(SP, 'TaskDTO.broken.java'), 'utf8');
const testRegressionContent = fixedTaskDTOTest.replace(
  'assertEquals(Task.TaskStatus.TODO, dto.toEntity().getStatus());',
  'assertEquals(Task.TaskStatus.DONE, dto.toEntity().getStatus());',
);

function file(p: string, content: string, operation: 'MODIFY' = 'MODIFY') {
  return { path: p, operation, content, contentSha256: computeContentSha256(content) };
}

function buildManifest(requestId: string, files: CandidateManifest['files']): CandidateManifest {
  const manifest: CandidateManifest = {
    candidateId: `cand-${requestId}`, requestId, batchId: 'r22e2c2-batch', candidateAttempt: 0,
    repository: 'souhaiel11/pfe-app-test', candidateBaseSha: FIXED_SHA, files,
  };
  manifest.candidateDigest = computeCandidateDigest(manifest);
  return manifest;
}

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-candidate-verifier-executor-spec-'));
const workspaceManager = new WorkspaceManager(scratchRoot);
// RepoCacheService is real too, but pointed at a scratch cache root that
// already contains a usable clone via a symlink to the real dev clone --
// simplest correct way to prove "the executor resolves repoPath itself"
// without a real network clone in every test run (RepoCacheService's own
// clone-from-network behavior is separately proven in repo-cache.service.spec.ts).
const repoCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-candidate-verifier-repocache-'));
fs.symlinkSync(REPO_PATH, path.join(repoCacheRoot, 'souhaiel11__pfe-app-test'));
const repoCache = new RepoCacheService(repoCacheRoot);
const executor = new CandidateVerificationExecutor(workspaceManager, new CandidateMaterializer(), repoCache);

const allVerificationLevels = new Set<string>();

async function main() {
  // --- PASS scenario, executor resolves repoPath itself from manifest.repository ---
  {
    const harmlessContent = fixedTaskDTOTest + '\n// R22-E2C2 harmless candidate marker, changes nothing behaviorally\n';
    const manifest = buildManifest('reqPass', [file('src/test/java/com/pfe/devsecops/dto/TaskDTOTest.java', harmlessContent)]);
    const result = executor.execute(manifest);
    allVerificationLevels.add(result.verificationLevel);
    assert.equal(result.overall, 'PASS', `expected PASS: ${JSON.stringify(result.compile)} / ${JSON.stringify(result.tests.regression)}`);
    assert.equal(result.compile.status, 'SUCCESS');
    assert.equal(result.tests.regression.status, 'SUCCESS');
    assert.equal(result.tests.regression.total, 22, 'Test 13 (spec) - Surefire totals preserved: the real 22-test suite aggregates correctly');
    assert.equal(result.tests.regression.failures, 0);
    assert.equal(result.identity.candidateDigest, manifest.candidateDigest, 'Test 4 (spec) - shared digest computation (imported from backend, not reimplemented) produces the identical value used to build the manifest');
    assert.equal(result.workspace.exactShaVerified, true, 'Test 9 (spec) - exact-SHA verification preserved');
    assert.equal(result.workspace.cleaned, true, 'Test 14 (spec) - cleanup preserved');
    assert.equal(fs.existsSync(path.join(scratchRoot, result.workspace.workspaceId)), false, 'workspace directory actually removed from disk');
  }

  // --- compile failure classified correctly (real, broken commit content) ---
  {
    const manifest = buildManifest('reqCompileFail', [file('src/main/java/com/pfe/devsecops/dto/TaskDTO.java', brokenTaskDTO)]);
    const result = executor.execute(manifest);
    allVerificationLevels.add(result.verificationLevel);
    assert.equal(result.overall, 'FAIL');
    assert.equal(result.failureClass, 'CANDIDATE_COMPILE_FAILURE', 'Test 11 (spec) - Maven compile behavior preserved: a real compile failure is still classified correctly');
    assert.equal(result.compile.status, 'FAILED');
    assert.equal(result.tests.regression.status, 'NOT_RUN');
    assert.equal(result.workspace.cleaned, true);
  }

  // --- test regression classified correctly (real induced JUnit failure) ---
  {
    const manifest = buildManifest('reqTestFail', [file('src/test/java/com/pfe/devsecops/dto/TaskDTOTest.java', testRegressionContent)]);
    const result = executor.execute(manifest);
    allVerificationLevels.add(result.verificationLevel);
    assert.equal(result.overall, 'FAIL');
    assert.equal(result.failureClass, 'CANDIDATE_TEST_REGRESSION', 'Test 12 (spec) - Maven regression test behavior preserved');
    assert.equal(result.compile.status, 'SUCCESS');
    assert.equal(result.tests.regression.status, 'FAILED');
    assert.ok((result.tests.regression.failures ?? 0) >= 1);
  }

  // --- Test 22 (spec) / static analysis stays NOT_RUN, verificationLevel never anything but COMPILE_TEST_VERIFIED ---
  {
    const manifest = buildManifest('reqShapeCheck', [file('src/test/java/com/pfe/devsecops/dto/TaskDTOTest.java', fixedTaskDTOTest)]);
    const result = executor.execute(manifest);
    assert.deepEqual(result.staticAnalysis, { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null }, 'Test 22 (spec) - static analysis remains NOT_RUN');
  }
  assert.deepEqual(allVerificationLevels, new Set(['COMPILE_TEST_VERIFIED']), 'FULL_PREFLIGHT_VERIFIED is never emitted, in any scenario');

  fs.rmSync(scratchRoot, { recursive: true, force: true });
  fs.rmSync(repoCacheRoot, { recursive: true, force: true });
  console.log('CandidateVerificationExecutor (real repo, real Maven): PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
