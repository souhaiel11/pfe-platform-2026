/** Bounded-git-operations fix, Part 3 item 3 — proves
 * CandidateVerificationExecutor.run() now propagates an actual remaining
 * budget (derived from options.timeoutMs via the shared WorkerDeadline
 * abstraction) into RepoCacheService.ensureRepo(), instead of the previous
 * unconditional call with no timeoutMs at all (which always fell back to
 * RepoCacheService's own flat GIT_OPERATION_CAP_MS default regardless of
 * what the caller actually requested).
 *
 * Also proves the ONE thing this fix must NOT change: compile/regression
 * test timeout semantics. Each still receives the full, undiminished
 * options.timeoutMs, exactly as before -- the new WorkerDeadline governs
 * ONLY the repo-materialization step.
 *
 * Real WorkspaceManager + a real local git worktree checkout (same fixture
 * repo as candidate-verification-executor.spec.ts), so createWorkspace()
 * succeeds for real -- only RepoCacheService is wrapped (not replaced) so
 * its real ensureRepo() still runs, with the supplied timeoutMs captured
 * for assertion. The build adapter is a fake so this stays fast and
 * deterministic.
 */
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CandidateVerificationExecutor } from './candidate-verification-executor';
import { WorkspaceManager } from './workspace-manager.service';
import { CandidateMaterializer } from './candidate-materializer.service';
import { RepoCacheService, GIT_OPERATION_CAP_MS } from './repo-cache.service';
import { BuildAdapter } from './build-adapter';
import { computeCandidateDigest, computeContentSha256 } from '../../backend/src/candidate-verification/candidate-digest';
import { CandidateManifest } from '../../backend/src/candidate-verification/candidate-verification.types';

const REPO_PATH = process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test';
const HEAD_SHA = execFileSync('git', ['-C', REPO_PATH, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function buildManifest(requestId: string): CandidateManifest {
  const content = 'irrelevant to this fixture -- the fake build adapter never reads it';
  const manifest: CandidateManifest = {
    candidateId: `cand-${requestId}`, requestId, batchId: 'repo-budget-spec', candidateAttempt: 0,
    repository: 'souhaiel11/pfe-app-test', candidateBaseSha: HEAD_SHA,
    files: [{ path: 'README.md', operation: 'MODIFY', content, contentSha256: computeContentSha256(content) }],
  };
  manifest.candidateDigest = computeCandidateDigest(manifest);
  return manifest;
}

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-executor-repo-budget-'));
const workspaceManager = new WorkspaceManager(scratchRoot);
const repoCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-executor-repo-budget-cache-'));
fs.symlinkSync(REPO_PATH, path.join(repoCacheRoot, 'souhaiel11__pfe-app-test'));
const realRepoCache = new RepoCacheService(repoCacheRoot);

function makeExecutor(capturedTimeouts: Array<number | undefined>, compileTimeouts: number[], testTimeouts: number[]) {
  // Delegates to the REAL RepoCacheService (a real local fetch still
  // happens) while recording exactly what timeoutMs it was called with --
  // a spy, not a behavioral replacement.
  const spyRepoCache: any = {
    ensureRepo: (repository: string, timeoutMs?: number) => {
      capturedTimeouts.push(timeoutMs);
      return realRepoCache.ensureRepo(repository, timeoutMs);
    },
  };
  const fakeAdapter: BuildAdapter = {
    buildType: 'fake',
    supports: () => true,
    compile: (_w, timeoutMs) => { compileTimeouts.push(timeoutMs); return { status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceTail: '' }; },
    runRegressionTests: (_w, timeoutMs) => { testTimeouts.push(timeoutMs); return { status: 'SUCCESS', total: 0, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null }; },
  };
  return new CandidateVerificationExecutor(workspaceManager, new CandidateMaterializer(), spyRepoCache, [fakeAdapter]);
}

try {
  // 1. A caller-supplied options.timeoutMs (5000ms, deliberately far below
  // GIT_OPERATION_CAP_MS=60000ms) must reach ensureRepo() as an actual
  // bounded remaining budget close to 5000ms -- NEVER the old unconditional
  // call (which always meant "no timeoutMs at all", silently defaulting to
  // the full 60000ms cap regardless of what the caller asked for).
  {
    const captured: Array<number | undefined> = [];
    const compileTimeouts: number[] = [], testTimeouts: number[] = [];
    const executor = makeExecutor(captured, compileTimeouts, testTimeouts);
    const result = executor.execute(buildManifest('repo-budget-1'), { timeoutMs: 5_000 });
    assert.equal(captured.length, 1, '1: ensureRepo was called exactly once');
    assert.ok(captured[0] !== undefined, '1: a timeoutMs was actually supplied to ensureRepo (the regression this fix closes)');
    assert.ok(captured[0]! > 0 && captured[0]! <= 5_000, `1: supplied budget (${captured[0]}) must be a real remaining-budget value derived from options.timeoutMs=5000, not the flat ${GIT_OPERATION_CAP_MS}ms default`);
    assert.ok(captured[0]! > 4_500, `1: negligible setup work precedes ensureRepo() -- captured budget (${captured[0]}) should be very close to the full 5000ms requested`);
    // Compile/test timeout semantics UNCHANGED: each independently receives
    // the full, undiminished options.timeoutMs -- not the shrunk deadline
    // value used only for ensureRepo.
    assert.deepEqual(compileTimeouts, [5_000], '1: compile must still receive the full, undiminished options.timeoutMs');
    assert.deepEqual(testTimeouts, [5_000], '1: regression tests must still receive the full, undiminished options.timeoutMs, not reduced by ensureRepo\'s own elapsed time');
    assert.equal(result.overall, 'PASS');
  }

  // 2. Omitting options.timeoutMs entirely must preserve the EXISTING
  // default behavior byte-for-byte: ensureRepo still receives a bounded
  // (never undefined, never unbounded) budget of GIT_OPERATION_CAP_MS,
  // exactly what the unconditional pre-fix call always produced via
  // RepoCacheService's own internal default -- a real backward-compatibility
  // proof, not an assumption.
  {
    const captured: Array<number | undefined> = [];
    const compileTimeouts: number[] = [], testTimeouts: number[] = [];
    const executor = makeExecutor(captured, compileTimeouts, testTimeouts);
    const result = executor.execute(buildManifest('repo-budget-2'), {});
    assert.equal(captured.length, 1);
    assert.ok(captured[0] !== undefined && captured[0]! <= GIT_OPERATION_CAP_MS && captured[0]! > GIT_OPERATION_CAP_MS - 1_000,
      `2: with no options.timeoutMs, ensureRepo must still get a bounded default at (or just under) GIT_OPERATION_CAP_MS -- got ${captured[0]}`);
    // Compile/test's OWN separate default (5 minutes, unrelated to the
    // repo-materialization deadline) is also unchanged.
    assert.deepEqual(compileTimeouts, [5 * 60 * 1000], '2: compile\'s own default timeout is untouched by this fix');
    assert.equal(result.overall, 'PASS');
  }

  console.log('candidate-verification-executor.repo-budget.spec.ts: PASS (2/2 -- ensureRepo receives a real remaining-budget derived from options.timeoutMs when supplied, a bounded default when omitted, and compile/regression-test timeout semantics are provably unchanged)');
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  fs.rmSync(repoCacheRoot, { recursive: true, force: true });
}
