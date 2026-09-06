import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MavenBuildAdapter } from './maven-build-adapter';
import { WorkspaceManager } from './workspace-manager.service';

// Real repository, real commits, real `mvn`. Not mocked -- this is the same
// pattern already proven in R22-A/R21-AV (isolated git worktree, no touch
// on the shared clone) and it happens to exercise the exact two real
// historical states this whole session diagnosed: a broken compile
// (ea6230b7) and the fixed one with its real 4-class, 22-test suite
// (8a315b0d).
const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
const FIXED_SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';
const BROKEN_SHA = 'ea6230b79b99f0c5fcb3c7da3f838bb3efbe81be';

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-maven-adapter-spec-'));
const manager = new WorkspaceManager(scratchRoot);
const adapter = new MavenBuildAdapter();

async function main() {
  // --- Test 11: compile PASS (real, fixed commit) ---
  {
    const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: FIXED_SHA, requestId: 'reqCompilePass', batchId: 'b', candidateAttempt: 0 });
    try {
      assert.equal(adapter.supports(handle.path), true, 'MavenBuildAdapter.supports() detects the real pom.xml');
      const compile = adapter.compile(handle.path, 5 * 60 * 1000);
      assert.equal(compile.status, 'SUCCESS', `Test 11 - compile PASS on the fixed commit: ${compile.evidenceTail.slice(-500)}`);
      assert.equal(compile.exitCode, 0);

      // --- Test 13: 22-test Maven fixture aggregates all classes correctly ---
      const regression = adapter.runRegressionTests(handle.path, 5 * 60 * 1000);
      assert.equal(regression.status, 'SUCCESS', `Test 13 - regression tests pass: ${regression.evidenceRef?.slice(-500)}`);
      assert.equal(regression.total, 22, 'Test 13 - the real 4-class suite (TaskServiceTest=10, TaskDTOTest=5, TaskControllerTest=4, AuthControllerTest=3) aggregates to 22, not a single class\'s count');
      assert.equal(regression.failures, 0);
    } finally {
      manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
    }
  }

  // --- Test 12: compile failure classified correctly (real, broken commit) ---
  {
    const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: BROKEN_SHA, requestId: 'reqCompileFail', batchId: 'b', candidateAttempt: 0 });
    try {
      const compile = adapter.compile(handle.path, 5 * 60 * 1000);
      assert.equal(compile.status, 'FAILED', 'Test 12 - compile FAILED on the real broken TaskDTO/Task mismatch commit');
      assert.notEqual(compile.exitCode, 0);
      assert.match(compile.evidenceTail, /COMPILATION ERROR|cannot find symbol|incompatible types/, 'Test 12 - real javac error text captured in evidence');
    } finally {
      manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
    }
  }

  fs.rmSync(scratchRoot, { recursive: true, force: true });
  console.log('MavenBuildAdapter: PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
