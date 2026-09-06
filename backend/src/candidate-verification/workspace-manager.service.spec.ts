import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceManager, WorkspaceError } from './workspace-manager.service';

// Real repository, real commit (already present locally from this
// session's PR #25 work) -- not mocked, per the same convention as R22-A's
// RepositoryResearchService tests.
const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
const SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-workspace-manager-spec-'));

function gitCommand(args: string[]): string {
  return execFileSync('git', ['-C', REPO_PATH, ...args], { encoding: 'utf8' }).trim();
}

// Snapshot the shared clone's state before touching anything, so we can
// prove it is byte-for-byte unaffected afterward (Test 21).
const branchBefore = gitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
const headBefore = gitCommand(['rev-parse', 'HEAD']);
const statusBefore = gitCommand(['status', '--short']);
const worktreeListBefore = gitCommand(['worktree', 'list']).split('\n').filter(l => !l.includes(scratchRoot));

function freshManager(): WorkspaceManager {
  return new WorkspaceManager(fs.mkdtempSync(path.join(scratchRoot, 'root-')));
}

// --- Test 3: workspace HEAD must equal candidateBaseSha (happy path) ---
{
  const manager = freshManager();
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'req1', batchId: 'batch1', candidateAttempt: 0 });
  assert.equal(handle.exactShaVerified, true, 'Test 3 - exact SHA verified true on a correct checkout');
  const actualHead = execFileSync('git', ['-C', handle.path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(actualHead, SHA, 'Test 3 - workspace HEAD really is the candidateBaseSha, verified independently of the manager\'s own claim');
  manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
}

// --- Test 3 (fail-closed variant): a caller-supplied ref that resolves to
// something other than itself (a branch name instead of a resolved SHA)
// must be rejected as WORKSPACE_SHA_MISMATCH, real git behavior, not a mock. ---
{
  const manager = freshManager();
  assert.throws(
    () => manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: 'main', requestId: 'req2', batchId: 'batch1', candidateAttempt: 0 }),
    (err: unknown) => err instanceof WorkspaceError && err.failureClass === 'WORKSPACE_SHA_MISMATCH',
    'Test 3b - a symbolic ref that is not itself a full SHA fails closed as WORKSPACE_SHA_MISMATCH',
  );
  // The manager must not leave an active registration behind after failing closed.
  assert.equal(manager.isActive(manager.workspaceId('req2', 'batch1', 0)), false, 'a SHA-mismatched workspace is not left registered as active');
}

// --- Test 22: concurrent/duplicate identity cannot collide ---
{
  const manager = freshManager();
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'req3', batchId: 'batch1', candidateAttempt: 0 });
  assert.throws(
    () => manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'req3', batchId: 'batch1', candidateAttempt: 0 }),
    (err: unknown) => err instanceof WorkspaceError && err.failureClass === 'WORKSPACE_CREATION_FAILED',
    'Test 22 - a second create for the SAME identity while the first is active is rejected, never silently shares/overwrites it',
  );
  manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
  // After cleanup, the same identity may be reused for a genuine retry.
  const retried = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'req3', batchId: 'batch1', candidateAttempt: 0 });
  assert.ok(fs.existsSync(retried.path), 'the same identity can be legitimately reused once the prior attempt is cleaned up');
  manager.cleanupWorkspace(retried.workspaceId, REPO_PATH);
}

// --- distinct identities never collide, distinct paths ---
{
  const manager = freshManager();
  const a = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqA', batchId: 'batch1', candidateAttempt: 0 });
  const b = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqB', batchId: 'batch1', candidateAttempt: 0 });
  assert.notEqual(a.path, b.path, 'distinct requestIds produce distinct workspace paths');
  manager.cleanupWorkspace(a.workspaceId, REPO_PATH);
  manager.cleanupWorkspace(b.workspaceId, REPO_PATH);
}

// --- path traversal / bounded identity ---
{
  const manager = freshManager();
  assert.throws(() => manager.workspaceId('../escape', 'batch1', 0), WorkspaceError, 'requestId containing path traversal is rejected');
  assert.throws(() => manager.workspaceId('req', 'b/../../etc', 0), WorkspaceError, 'batchId containing path traversal is rejected');
}

// --- Tests 18/19/20: cleanup occurs after PASS-shaped use, FAIL-shaped use, and an exception during materialization-equivalent work ---
{
  const manager = freshManager();
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqPass', batchId: 'batch1', candidateAttempt: 0 });
  manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
  assert.equal(fs.existsSync(handle.path), false, 'Test 18 - workspace directory removed after a PASS-shaped flow');
  assert.equal(manager.isActive(handle.workspaceId), false, 'workspace no longer registered active after cleanup');
}
{
  const manager = freshManager();
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqFail', batchId: 'batch1', candidateAttempt: 0 });
  // simulate a FAIL-shaped flow: caller decides to clean up regardless of outcome
  manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
  assert.equal(fs.existsSync(handle.path), false, 'Test 19 - workspace directory removed after a FAIL-shaped flow');
}
{
  const manager = freshManager();
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqExc', batchId: 'batch1', candidateAttempt: 0 });
  try {
    throw new Error('simulated exception during candidate work');
  } catch {
    // A real caller's try/finally would call this from `finally` -- proven
    // properly wired end-to-end in candidate-verification.service.spec.ts;
    // this proves the manager's own cleanup call is unconditionally safe
    // to invoke after an exception.
    manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
  }
  assert.equal(fs.existsSync(handle.path), false, 'Test 20 - workspace directory removed after an exception path');
}

// --- Test 21: the shared clone itself is byte-for-byte untouched ---
{
  const branchAfter = gitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
  const headAfter = gitCommand(['rev-parse', 'HEAD']);
  const statusAfter = gitCommand(['status', '--short']);
  const worktreeListAfter = gitCommand(['worktree', 'list']).split('\n').filter(l => !l.includes(scratchRoot));
  assert.equal(branchAfter, branchBefore, 'Test 21 - shared clone still on the same branch it started on');
  assert.equal(headAfter, headBefore, 'Test 21 - shared clone HEAD SHA unchanged');
  assert.equal(statusAfter, statusBefore, 'Test 21 - shared clone working tree status unchanged (no reset/clean/checkout leaked into it)');
  assert.deepEqual(worktreeListAfter, worktreeListBefore, 'Test 21 - no orphaned worktree entries left registered against the shared clone');
}

fs.rmSync(scratchRoot, { recursive: true, force: true });
console.log('WorkspaceManager: PASS');
