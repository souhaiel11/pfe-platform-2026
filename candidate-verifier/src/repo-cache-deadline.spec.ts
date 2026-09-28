/** Execution-2057 root-cause fix (Part 2) — deterministic coverage for
 * RepoCacheService's new bounded-timeout / orphan-sweep behavior. No
 * external network dependence anywhere in this file: successful-path
 * coverage uses a real LOCAL git fixture (a bare repo on disk); every
 * failure/timeout/budget scenario uses the injected `GitCommand` seam
 * (mirrors TrivyImageArtifactValidator's own injectable `command`), never
 * a real subprocess to github.com. */
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { RepoCacheService, GIT_OPERATION_CAP_MS, GitCommand } from './repo-cache.service';
import { MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

function dnsFailure() {
  return Object.assign(new Error('Command failed'), {
    status: 128, stderr: "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com\n",
  });
}

// === Test 1: successful fetch against a REAL local git fixture (no network, no mock) ===
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-cache-deadline-'));
  const bareRepo = path.join(root, 'upstream.git');
  const seedClone = path.join(root, 'seed');
  execFileSync('git', ['init', '--bare', '-q', bareRepo]);
  execFileSync('git', ['clone', '-q', bareRepo, seedClone]);
  execFileSync('git', ['-C', seedClone, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', seedClone, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(seedClone, 'file.txt'), 'hello');
  execFileSync('git', ['-C', seedClone, 'add', '.']);
  execFileSync('git', ['-C', seedClone, 'commit', '-q', '-m', 'seed']);
  execFileSync('git', ['-C', seedClone, 'push', '-q', 'origin', 'HEAD:refs/heads/main']);
  execFileSync('git', ['-C', bareRepo, 'symbolic-ref', 'HEAD', 'refs/heads/main']); // avoid an ambiguous-default-branch checkout on the next clone

  const cacheRoot = path.join(root, 'cache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const cachePath = path.join(cacheRoot, 'fake__repo');
  execFileSync('git', ['clone', '-q', bareRepo, cachePath]); // pre-populate the cache path so ensureRepo() takes its FETCH branch (never the hardcoded github.com clone URL)

  const service = new RepoCacheService(cacheRoot); // real default GitCommand, no injection
  const result = service.ensureRepo('fake/repo', 30_000);
  assert.equal(result, cachePath);
  const head = execFileSync('git', ['-C', cachePath, 'rev-parse', 'refs/remotes/origin/main'], { encoding: 'utf8' }).trim();
  assert.equal(head.length, 40, 'the real local fetch brought down a real, valid commit on origin/main');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('Test 1: PASS (successful fetch against a real local git fixture, no network, no mock)');
}

// A writable-but-empty root for every mock-based test below (never used by
// the real-fixture Test 1 above) -- exists so `ensureRepo()`'s own
// `fs.mkdirSync(path.dirname(cachePath), {recursive:true})` (on the clone
// branch) succeeds; the injected GitCommand never actually touches it.
const mockCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-cache-deadline-mock-'));

// === Test 2: DNS/connect failure is logged, and the SAME raw error is re-thrown unchanged ===
{
  const originalConsoleError = console.error;
  const captured: string[] = [];
  console.error = (line: string) => { captured.push(line); };
  const injected = dnsFailure();
  const gitCommand: GitCommand = () => { throw injected; };
  const service = new RepoCacheService(mockCacheRoot, gitCommand);
  let thrown: any;
  try { service.ensureRepo('x/y', 30_000); } catch (e) { thrown = e; }
  console.error = originalConsoleError;

  assert.strictEqual(thrown, injected, 'the exact same raw error is re-thrown -- external error contract unchanged');
  const logLine = captured.find(l => l.includes('REPO_CACHE_COMMAND_FAILURE'));
  assert.ok(logLine, 'a diagnostic log line was emitted');
  const parsed = JSON.parse(logLine!);
  assert.equal(parsed.operation, 'clone', 'nonexistent cache root has no .git -- this is the clone branch');
  assert.equal(parsed.exitCode, 128);
  assert.ok(parsed.stderrTail.includes('Could not resolve host: github.com'));
  console.log('Test 2: PASS (DNS/connect failure logged with real diagnostic detail; raw error re-thrown unchanged)');
}

// === Test 3: timeout is derived from the remaining budget, capped at GIT_OPERATION_CAP_MS ===
{
  const seenTimeouts: number[] = [];
  const gitCommand: GitCommand = (_args, options) => { seenTimeouts.push(options.timeout); };
  const service = new RepoCacheService(mockCacheRoot, gitCommand);

  service.ensureRepo('x/y', 5_000);
  assert.equal(seenTimeouts[0], 5_000, 'a budget comfortably under the cap is forwarded unchanged');

  service.ensureRepo('x/y', GIT_OPERATION_CAP_MS + 50_000);
  assert.equal(seenTimeouts[1], GIT_OPERATION_CAP_MS, 'a budget larger than the per-operation cap is capped, never handed through unbounded');

  const service2 = new RepoCacheService(mockCacheRoot, gitCommand);
  service2.ensureRepo('x/y'); // no timeoutMs at all
  assert.equal(seenTimeouts[2], GIT_OPERATION_CAP_MS, 'omitting timeoutMs still yields a bounded default -- never unbounded, matching the historical gap this fix closes');
  console.log('Test 3: PASS (timeout derived from remaining budget, capped, and defaulted -- never unbounded)');
}

// === Test 4: no command is attempted once the budget is already exhausted ===
{
  let calls = 0;
  const gitCommand: GitCommand = () => { calls++; };
  const service = new RepoCacheService(mockCacheRoot, gitCommand);
  assert.throws(() => service.ensureRepo('x/y', MIN_STAGE_BUDGET_MS - 1), /refused to start/);
  assert.equal(calls, 0, 'an already-exhausted budget must prevent even the first attempt');
  console.log('Test 4: PASS (deadline exhaustion refuses to start -- zero command attempts)');
}

// === Test 5: the budget is never silently reset between sequential calls ===
{
  const calls: Array<{ timeout: number }> = [];
  const gitCommand: GitCommand = (_args, options) => { calls.push({ timeout: options.timeout }); };
  const service = new RepoCacheService(mockCacheRoot, gitCommand);

  service.ensureRepo('x/y', 20_000); // a first call with a healthy remaining budget succeeds
  assert.equal(calls.length, 1);
  assert.throws(() => service.ensureRepo('x/y', 200), /refused to start/, 'a SECOND call reporting a much-shrunk remaining budget is refused on its own terms, never silently topped back up to a fresh window');
  assert.equal(calls.length, 1, 'the refused second call never reached the command at all');
  console.log('Test 5: PASS (shared/shrinking budget across sequential calls -- never silently reset)');
}

// === Test 6: a timed-out git invocation's own DESCENDANT (same process
// group) is terminated, while a genuinely INDEPENDENT process that started
// during the same interval (a stand-in for a health check / `docker exec`)
// survives untouched. This supersedes the previous PID-diff-based version
// of this test: that mechanism killed every PID merely new in /proc, which
// could not distinguish "spawned by this git invocation" from "started by
// something else at the same time" -- exactly the ownership gap the
// process-group rewrite (terminateGitProcessGroup) closes. Group membership
// (real /proc pgrp, not PID-diff timing) is what this test verifies.
async function testSix() {
  // Stand-in for the real `git` process: a detached session leader (same
  // property production code gets via `setsid`) that itself backgrounds a
  // real child -- a stand-in for git-remote-https, a real descendant in the
  // SAME process group, never itself tracked by execFileSync's timeout.
  const leader = spawn('sh', ['-c', 'sleep 30 & wait'], { detached: true, stdio: 'ignore' });
  const leaderPid = leader.pid!;
  leader.unref();

  // A genuinely independent process -- its OWN separate process group,
  // standing in for a health check or an operator's `docker exec` that
  // happens to start during the same real-world interval. Must never be
  // touched by cleanup scoped to leaderPid's group.
  const independent = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  const independentPid = independent.pid!;
  independent.unref();

  // /proc/<pid>/stat fields after "(comm) " are: state ppid pgrp session ...
  // -- pgrp is index 2 in that post-comm split. Split from AFTER the last
  // ')' rather than naively on spaces, robust to a comm containing spaces
  // or parens.
  const pgrpOf = (pid: number): number | null => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
      return Number(afterComm.split(' ')[2]);
    } catch { return null; }
  };
  const anyProcessInGroup = (pgid: number): boolean => {
    let entries: string[];
    try { entries = fs.readdirSync('/proc'); } catch { return false; }
    return entries.some(e => /^\d+$/.test(e) && pgrpOf(Number(e)) === pgid);
  };
  const isAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

  // Let the leader's shell actually background `sleep 30` into the real
  // process group before proceeding.
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(anyProcessInGroup(leaderPid), 'fixture sanity: the backgrounded descendant is really in leaderPid\'s process group');
  assert.ok(isAlive(independentPid), 'fixture sanity: the independent process is really running');

  // Simulate execFileSync's/spawnSync's real timeout behavior: ONLY the
  // tracked direct child (the leader) is SIGKILLed by Node's own timeout
  // machinery -- its own backgrounded descendant is NOT (this is the exact
  // gap production code closes via terminateGitProcessGroup, not
  // re-implemented here). Injected error carries `pid: leaderPid`, exactly
  // as defaultGitCommand's own thrown errors now do.
  try { process.kill(leaderPid, 'SIGKILL'); } catch { /* already gone */ }
  const gitCommand: GitCommand = () => {
    throw Object.assign(new Error('Command failed'), { status: null, signal: 'SIGKILL', pid: leaderPid });
  };
  const service = new RepoCacheService(mockCacheRoot, gitCommand);
  assert.throws(() => service.ensureRepo('x/y', 30_000));

  // Bounded poll (kernel-level SIGKILL delivery/reaping is asynchronous) --
  // see this file's own prior version of this comment for why a real
  // `await new Promise(setTimeout)` yield is required here, not a
  // synchronous busy-wait.
  let groupStillOccupied = anyProcessInGroup(leaderPid);
  for (let waited = 0; groupStillOccupied && waited <= 500; waited += 20) {
    await new Promise((r) => setTimeout(r, 20));
    groupStillOccupied = anyProcessInGroup(leaderPid);
  }
  assert.equal(groupStillOccupied, false, 'every process in the git invocation\'s own process group (leader + real descendants) must be terminated by the time ensureRepo() has settled');
  assert.ok(isAlive(independentPid), 'a genuinely independent process that started during the same interval must survive untouched -- ownership, never PID-diff timing, gates cleanup');

  try { process.kill(independentPid, 'SIGKILL'); } catch { /* test hygiene only */ }
  console.log('Test 6: PASS (git invocation\'s own process-group descendant terminated; a genuinely independent concurrent process survives untouched)');
}

testSix().then(() => {
  fs.rmSync(mockCacheRoot, { recursive: true, force: true });
  console.log('repo-cache-deadline.spec.ts: PASS (6/6 — real local fixture success, DNS-failure logging + unchanged error contract, budget-derived/capped/defaulted timeout, deadline-exhaustion refusal, non-reset shared budget, process-group-scoped descendant termination with independent-process survival)');
}).catch((e) => { console.error(e); process.exit(1); });
