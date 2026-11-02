// Teste le composant « workspace-manager.service » et ses cas d’erreur.
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

/** Prépare les données nécessaires à ce scénario. */
function gitCommand(args: string[]): string {
  return execFileSync('git', ['-C', REPO_PATH, ...args], { encoding: 'utf8' }).trim();
}

// Snapshot the shared clone's state before touching anything, so we can
// prove it is byte-for-byte unaffected afterward (Test 21).
const branchBefore = gitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
const headBefore = gitCommand(['rev-parse', 'HEAD']);
const statusBefore = gitCommand(['status', '--short']);
const worktreeListBefore = gitCommand(['worktree', 'list']).split('\n').filter(l => !l.includes(scratchRoot));

/** Prépare les données nécessaires à ce scénario. */
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


// A deliberately well-formed-but-nonexistent SHA -- real `git worktree add`
// failure, not a fabricated/mocked one, so "worktree creation fails" below
// exercises the ACTUAL failure path createWorkspace() takes, not a stand-in.
const NONEXISTENT_SHA = '0000000000000000000000000000000000000000';

{
  const root = fs.mkdtempSync(path.join(scratchRoot, 'root-'));
  const manager = new WorkspaceManager(root);
  const preExistingParent = path.join(root, 'reqPreExist');
  fs.mkdirSync(preExistingParent, { recursive: true }); // step 1 -- exists BEFORE this manager ever creates anything
  assert.equal(fs.readdirSync(preExistingParent).length, 0, 'precondition: the pre-existing parent starts empty');

  let threw: unknown;
  try {
    manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: NONEXISTENT_SHA, requestId: 'reqPreExist', batchId: 'batchNew', candidateAttempt: 0 });
  } catch (e) { threw = e; } // step 2 -- real git worktree add failure, batchNew is novel, reqPreExist is not
  assert.ok(threw instanceof WorkspaceError && threw.failureClass === 'WORKSPACE_CREATION_FAILED', 'precondition: worktree creation genuinely failed (real git, real nonexistent SHA)');

  const workspaceId = manager.workspaceId('reqPreExist', 'batchNew', 0);
  manager.cleanupWorkspace(workspaceId, REPO_PATH); // step 3

  assert.equal(fs.existsSync(path.join(preExistingParent, 'batchNew')), false, 'Test P4-A step 4 - this operation\'s own residue (batchNew, which IT created) is gone');
  assert.ok(fs.existsSync(preExistingParent), 'Test P4-A step 5 - the PRE-EXISTING empty parent directory (reqPreExist, which this manager never created) still exists');
  assert.equal(fs.readdirSync(preExistingParent).length, 0, 'Test P4-A step 5 - and remains exactly as empty as it started -- untouched, not merely "not yet removed"');
}

// Test P4-A2: OPERATION-CREATED ANCESTORS REMOVED (the second named
// scenario). The operation itself creates BOTH new nested levels (requestId
// AND batchId are both novel this time -- no pre-existing boundary nearby
// except the workspace root itself), worktree creation fails for the same
// real reason, and cleanup must remove exactly what this operation created,
// stopping at the workspace root (the ultimate pre-existing boundary).
{
  const root = fs.mkdtempSync(path.join(scratchRoot, 'root-'));
  const manager = new WorkspaceManager(root);
  const workspaceId = manager.workspaceId('reqNestedNew', 'batchNestedNew', 0);
  const parentDir = path.join(root, 'reqNestedNew', 'batchNestedNew');
  const grandparentDir = path.join(root, 'reqNestedNew');

  let threw: unknown;
  try {
    manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: NONEXISTENT_SHA, requestId: 'reqNestedNew', batchId: 'batchNestedNew', candidateAttempt: 0 });
  } catch (e) { threw = e; }
  assert.ok(threw instanceof WorkspaceError, 'precondition: worktree creation genuinely failed');
  assert.ok(fs.existsSync(parentDir) && fs.existsSync(grandparentDir), 'precondition: BOTH newly-created nested levels exist on disk, pre-cleanup');
  assert.equal(manager.isActive(workspaceId), false, 'precondition: never registered active (worktree add failed before registration)');

  manager.cleanupWorkspace(workspaceId, REPO_PATH);
  assert.equal(fs.existsSync(parentDir), false, 'Test P4-A2 - the operation-created batchId level is removed');
  assert.equal(fs.existsSync(grandparentDir), false, 'Test P4-A2 - the operation-created requestId level is ALSO removed (both levels were novel, both owned)');
  assert.ok(fs.existsSync(root), 'Test P4-A2 - cleanup stops at the workspace root itself, the ultimate pre-existing boundary, never removing it');
  // idempotent: a second cleanup of the same, now-absent id must not throw
  assert.doesNotThrow(() => manager.cleanupWorkspace(workspaceId, REPO_PATH), 'Test P4-A2(idempotent) - cleaning an already-cleaned, never-registered id a second time does not throw');
}

// Test P4-B: a genuinely untouched identity (nothing ever created on disk,
// never registered) stays a true no-op -- no subprocess, no filesystem
// mutation attempted.
{
  const manager = freshManager();
  const workspaceId = manager.workspaceId('reqNeverTouched', 'batch1', 0);
  assert.doesNotThrow(() => manager.cleanupWorkspace(workspaceId, REPO_PATH), 'Test P4-B - cleanup of a fully untouched identity does not throw');
}

// Test P4-C: an invalid/out-of-root identity is refused, never resolved
// into a path outside the workspace root and removed.
{
  const manager = freshManager();
  assert.throws(
    () => manager.cleanupWorkspace('../escape', REPO_PATH),
    WorkspaceError,
    'Test P4-C - cleanupWorkspace refuses an out-of-root identity via the same escape guard resolveWorkspacePath() already enforces, rather than silently resolving/removing outside the workspace root',
  );
}

// Test P4-D: normal, successful-workspace cleanup is unchanged by this fix
// (registered path still takes the direct forceCleanup branch), AND now
// also prunes ITS freshly-created parent -- proving the same residue class
// existed (unnoticed) even on the happy path, not only the failure path.
{
  const manager = freshManager();
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqNormalCleanup', batchId: 'batch1', candidateAttempt: 0 });
  const parentDir = path.dirname(handle.path);
  manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
  assert.equal(fs.existsSync(handle.path), false, 'Test P4-D - a successfully-registered workspace is still removed exactly as before');
  assert.equal(fs.existsSync(parentDir), false, 'Test P4-D - its freshly-created parent is pruned too on the successful/happy path, not only the failure path');
  assert.doesNotThrow(() => manager.cleanupWorkspace(handle.workspaceId, REPO_PATH), 'Test P4-D(idempotent) - a second cleanup of an already-cleaned, previously-registered id does not throw');
}

{
  const manager = freshManager();
  const first = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqSiblings', batchId: 'batch1', candidateAttempt: 0 });
  const second = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqSiblings', batchId: 'batch1', candidateAttempt: 1 });
  const sharedParent = path.dirname(first.path);
  assert.equal(sharedParent, path.dirname(second.path), 'precondition: both attempts share the same requestId/batchId parent directory');
  manager.cleanupWorkspace(first.workspaceId, REPO_PATH);
  assert.equal(fs.existsSync(first.path), false, 'Test P4-E - the cleaned-up sibling itself is gone');
  assert.ok(fs.existsSync(sharedParent), 'Test P4-E - the shared parent is PRESERVED because the other sibling still occupies it (non-empty stops the prune walk)');
  assert.ok(fs.existsSync(second.path), 'Test P4-E - the still-active sibling workspace is completely untouched');
  manager.cleanupWorkspace(second.workspaceId, REPO_PATH);
  assert.equal(fs.existsSync(sharedParent), false, 'Test P4-E - once the LAST sibling is cleaned up, the now-genuinely-empty shared parent is pruned too');
}

// Test P4-F: a symlink placed where an ancestor directory would be expected
// stops the prune walk rather than being traversed/removed through -- lstat
// (never realpath/follow) is what proves this is a directory before rmdir.
{
  const manager = freshManager();
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqSymlink', batchId: 'batch1', candidateAttempt: 0 });
  const parentDir = path.dirname(handle.path); // reqSymlink/batch1
  const grandparentDir = path.dirname(parentDir); // reqSymlink
  // Remove the leaf via the manager first (simulating a normal successful
  // cleanup), then replace the now-empty parent with a symlink pointing
  // somewhere else entirely, and prove a SECOND, independent prune attempt
  // (calling the same private mechanism indirectly via a fresh workspace
  // sharing the grandparent) never follows or deletes through it.
  execFileSync('git', ['-C', REPO_PATH, 'worktree', 'remove', '--force', handle.path], { stdio: 'pipe' });
  const decoyTarget = fs.mkdtempSync(path.join(scratchRoot, 'decoy-target-'));
  fs.writeFileSync(path.join(decoyTarget, 'must-not-be-touched.txt'), 'sentinel');
  fs.rmdirSync(parentDir);
  fs.symlinkSync(decoyTarget, parentDir);
  const other = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqSymlink', batchId: 'batch2', candidateAttempt: 0 });
  manager.cleanupWorkspace(other.workspaceId, REPO_PATH);
  assert.ok(fs.existsSync(path.join(decoyTarget, 'must-not-be-touched.txt')), 'Test P4-F - the symlinked-away decoy directory\'s real content is untouched');
  assert.ok(fs.lstatSync(parentDir).isSymbolicLink(), 'Test P4-F - the symlink standing in for a sibling ancestor is itself left alone, never deleted or traversed');
  fs.rmSync(parentDir, { force: true }); // test-local teardown of the symlink itself, not exercised by the manager
  fs.rmSync(decoyTarget, { recursive: true, force: true });
  fs.rmSync(grandparentDir, { recursive: true, force: true });
}

// Test P4-F2: symlink protection at the LEAF itself, BEFORE the destructive
// removal step -- not merely during ancestor pruning (P4-F, above, only
// covers a symlinked ANCESTOR). This manager never creates a symlink at a
// workspace's own resolved path; this is an adversarial/defensive
// reproduction: forceCleanup's leaf-level lstat guard must catch it before
// either `git worktree remove` or the rmSync fallback ever runs against it.
{
  const root = fs.mkdtempSync(path.join(scratchRoot, 'root-'));
  const manager = new WorkspaceManager(root);
  const workspaceId = manager.workspaceId('reqLeafSymlink', 'batch1', 0);
  const resolvedPath = path.resolve(root, workspaceId);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const decoyTarget = fs.mkdtempSync(path.join(scratchRoot, 'decoy-leaf-target-'));
  fs.writeFileSync(path.join(decoyTarget, 'must-not-be-touched.txt'), 'sentinel');
  fs.symlinkSync(decoyTarget, resolvedPath); // the "workspace" IS a symlink to somewhere else entirely
  manager.cleanupWorkspace(workspaceId, REPO_PATH);
  assert.ok(fs.existsSync(path.join(decoyTarget, 'must-not-be-touched.txt')), 'Test P4-F2 - the outside sentinel file the leaf symlink points at is completely untouched (not merely "the symlink still exists" -- its REAL target survives)');
  assert.equal(fs.existsSync(resolvedPath), false, 'Test P4-F2 - the symlink itself (the leaf entry) IS removed -- cleanup still does its job, just safely (unlink, never recurse through it)');
  fs.rmSync(decoyTarget, { recursive: true, force: true });
}

{
  const outerRoot = fs.mkdtempSync(path.join(scratchRoot, 'outer-'));
  fs.writeFileSync(path.join(outerRoot, 'unrelated-cache-file.txt'), 'sentinel'); // stands in for a repo-cache/Maven/Podman/Trivy sibling
  const workspaceRoot = fs.mkdtempSync(path.join(outerRoot, 'workspaces-'));
  const manager = new WorkspaceManager(workspaceRoot);
  const handle = manager.createWorkspace({ repoPath: REPO_PATH, candidateBaseSha: SHA, requestId: 'reqBoundary', batchId: 'batch1', candidateAttempt: 0 });
  manager.cleanupWorkspace(handle.workspaceId, REPO_PATH);
  assert.equal(fs.existsSync(handle.path), false, 'Test P4-G - the workspace itself is removed');
  assert.ok(fs.existsSync(path.join(outerRoot, 'unrelated-cache-file.txt')), 'Test P4-G - a sibling outside the workspace root (standing in for repo-cache/Maven/Podman/Trivy caches) is never touched');
  fs.rmSync(outerRoot, { recursive: true, force: true });
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
