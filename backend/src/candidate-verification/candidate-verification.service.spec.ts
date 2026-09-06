import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CandidateVerificationService } from './candidate-verification.service';
import { WorkspaceManager } from './workspace-manager.service';
import { CandidateMaterializer } from './candidate-materializer.service';
import { computeCandidateDigest, computeContentSha256 } from './candidate-digest';
import { CandidateManifest } from './candidate-verification.types';

// Full real end-to-end integration: real git worktree, real Maven compile,
// real Surefire run, against the real pfe-app-test repo at the exact
// commits this whole session diagnosed. No mocking of git/mvn anywhere.
const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
const FIXED_SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';

const SP = '/tmp/claude-1000/-home-souhaiel-pfe-2026-platform/bdcb2d19-e972-4e6c-b19f-1e99e7f70174/scratchpad/r22c-fixtures';
const fixedTaskDTOTest = fs.readFileSync(path.join(SP, 'TaskDTOTest.fixed.java'), 'utf8');
const brokenTaskDTO = fs.readFileSync(path.join(SP, 'TaskDTO.broken.java'), 'utf8');
// Same file as fixedTaskDTOTest but with one assertion's expected value
// flipped (TODO -> DONE), producing a real, deterministic JUnit failure.
const testRegressionContent = fixedTaskDTOTest.replace(
  'assertEquals(Task.TaskStatus.TODO, dto.toEntity().getStatus());',
  'assertEquals(Task.TaskStatus.DONE, dto.toEntity().getStatus());',
);
assert.notEqual(testRegressionContent, fixedTaskDTOTest, 'sanity: the regression fixture actually differs from the real fixed test file');

function file(p: string, content: string, operation: 'MODIFY' = 'MODIFY') {
  return { path: p, operation, content, contentSha256: computeContentSha256(content) };
}

function buildManifest(requestId: string, files: CandidateManifest['files']): CandidateManifest {
  const manifest: CandidateManifest = {
    candidateId: `cand-${requestId}`, requestId, batchId: 'r22c-batch', candidateAttempt: 0,
    repository: 'souhaiel11/pfe-app-test', candidateBaseSha: FIXED_SHA, files,
  };
  manifest.candidateDigest = computeCandidateDigest(manifest);
  return manifest;
}

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-candidate-verification-spec-'));
const workspaceManager = new WorkspaceManager(scratchRoot);
const service = new CandidateVerificationService(workspaceManager, new CandidateMaterializer());

const allVerificationLevels = new Set<string>();

async function main() {
  // --- PASS scenario: a harmless, real, compiling+passing MODIFY ---
  {
    const harmlessContent = fixedTaskDTOTest + '\n// R22-C harmless candidate marker, changes nothing behaviorally\n';
    const manifest = buildManifest('reqPass', [file('src/test/java/com/pfe/devsecops/dto/TaskDTOTest.java', harmlessContent)]);
    const result = service.verify(manifest, { repoPath: REPO_PATH });
    allVerificationLevels.add(result.verificationLevel);
    assert.equal(result.overall, 'PASS', `expected PASS: ${JSON.stringify(result.compile)} / ${JSON.stringify(result.tests.regression)}`);
    assert.equal(result.compile.status, 'SUCCESS');
    assert.equal(result.tests.regression.status, 'SUCCESS');
    assert.equal(result.tests.regression.total, 22, 'the real 22-test suite aggregates correctly through the full orchestrating service');
    assert.equal(result.tests.regression.failures, 0);
    assert.equal(result.identity.candidateDigest, manifest.candidateDigest, 'returned verification references the exact digest that was supplied (Critical Invariant 3)');
    assert.equal(result.workspace.exactShaVerified, true);
    assert.equal(result.workspace.cleaned, true, 'workspace marked cleaned in the returned result');
    assert.equal(fs.existsSync(path.join(scratchRoot, result.workspace.workspaceId)), false, 'workspace directory actually removed from disk after a PASS run');
  }

  // --- Test 12 (service level): compile failure classified correctly, via real materialization of the real broken TaskDTO onto a workspace checked out at the FIXED sha ---
  {
    const manifest = buildManifest('reqCompileFail', [file('src/main/java/com/pfe/devsecops/dto/TaskDTO.java', brokenTaskDTO)]);
    const result = service.verify(manifest, { repoPath: REPO_PATH });
    allVerificationLevels.add(result.verificationLevel);
    assert.equal(result.overall, 'FAIL');
    assert.equal(result.failureClass, 'CANDIDATE_COMPILE_FAILURE', 'Test 12 - a real compile failure is classified as CANDIDATE_COMPILE_FAILURE, not a generic UNKNOWN');
    assert.equal(result.compile.status, 'FAILED');
    assert.equal(result.tests.regression.status, 'NOT_RUN', 'tests never run after a compile failure');
    assert.equal(result.workspace.cleaned, true, 'Test 19 - cleanup occurs after a FAIL result too');
  }

  // --- Test 14: test failure classified correctly, via a real failing assertion ---
  {
    const manifest = buildManifest('reqTestFail', [file('src/test/java/com/pfe/devsecops/dto/TaskDTOTest.java', testRegressionContent)]);
    const result = service.verify(manifest, { repoPath: REPO_PATH });
    allVerificationLevels.add(result.verificationLevel);
    assert.equal(result.overall, 'FAIL');
    assert.equal(result.failureClass, 'CANDIDATE_TEST_REGRESSION', 'Test 14 - a real JUnit assertion failure is classified as CANDIDATE_TEST_REGRESSION');
    assert.equal(result.compile.status, 'SUCCESS', 'the candidate still compiles -- only the test assertion is wrong');
    assert.equal(result.tests.regression.status, 'FAILED');
    assert.ok((result.tests.regression.failures ?? 0) >= 1, 'at least one real aggregated failure recorded');
    assert.equal(result.workspace.cleaned, true, 'Test 19b - cleanup occurs after a test-regression FAIL result too');
  }

  // --- Test 15/16/17 across every scenario above ---
  assert.deepEqual(allVerificationLevels, new Set(['COMPILE_TEST_VERIFIED']), 'Test 17 - FULL_PREFLIGHT_VERIFIED is never emitted by this phase\'s code, in any scenario');

  // --- Test 15/16 (manifest-invalid path, cheapest way to also prove targeted/static shape without a full build) ---
  {
    const manifest = buildManifest('reqShapeCheck', [file('src/test/java/com/pfe/devsecops/dto/TaskDTOTest.java', fixedTaskDTOTest)]);
    const result = service.verify(manifest, { repoPath: REPO_PATH });
    assert.deepEqual(result.tests.targeted, { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, 'Test 15 - targeted tests explicitly NOT_RUN with the documented reason');
    assert.deepEqual(result.staticAnalysis, { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null }, 'Test 16 - static analysis explicitly NOT_RUN with the documented reason');
  }

  // --- manifest-invalid short-circuit: no workspace ever created ---
  {
    const manifest = buildManifest('reqInvalidManifest', []); // zero files
    const result = service.verify(manifest, { repoPath: REPO_PATH });
    assert.equal(result.overall, 'FAIL');
    assert.equal(result.failureClass, 'CANDIDATE_MANIFEST_INVALID');
    assert.equal(result.workspace.created, false, 'an invalid manifest never even attempts workspace creation');
  }

  fs.rmSync(scratchRoot, { recursive: true, force: true });
  console.log('CandidateVerificationService: PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
