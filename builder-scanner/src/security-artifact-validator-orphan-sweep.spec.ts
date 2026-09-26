/** V1.7 final predeploy phase, Phase F/G — REAL orphan-GRANDCHILD sweep
 * proof.
 *
 * security-artifact-validator-real-termination.spec.ts already proves the
 * DIRECT child Node's execFileSync kills is really terminated. It does NOT
 * exercise the actual bug discovered this phase: `--isolation=chroot`
 * shares this container's own pid namespace with the build's RUN-step
 * process, so when the SIGKILLed `podman build` never gets the chance to
 * run its own `--force-rm` teardown, a process THAT BUILD ITSELF SPAWNED
 * survives -- a grandchild from Node's point of view, never directly
 * targeted by execFileSync's own timeout/killSignal.
 *
 * This substitutes a real `sh` that backgrounds a real, long-running
 * marker `sleep` and then blocks in `wait` -- reproducing exactly that
 * shape: the outer process (the one execFileSync's timeout kills) has a
 * real child of its own that does NOT die when the outer one is SIGKILLed.
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactRuntimeError, TrivyImageArtifactValidator } from './security-artifact-validator';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-orphan-sweep-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });

const MARKER_SECONDS = '62.831';
function markerStillRunning(): boolean {
  try { execFileSync('pgrep', ['-f', `sleep ${MARKER_SECONDS}`], { encoding: 'utf8' }); return true; }
  catch { return false; }
}

try {
  assert.equal(markerStillRunning(), false, 'precondition: no stray marker process from a previous run');

  const BUDGET_MS = 3_000;
  const adapter = new TrivyImageArtifactValidator((command, args, options) => {
    if (command === 'podman' && args[0] === 'info') return 'true';
    if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
    if (command === 'podman' && args[0] === 'pull') return '';
    if (command === 'podman' && args[0] === 'build') {
      // The real bug shape: an outer process that backgrounds a real child
      // and then blocks -- the child survives when the OUTER process is
      // SIGKILLed, exactly like a RUN-step process survives a SIGKILLed
      // `podman build` under --isolation=chroot (both share this
      // container's own pid namespace, so this is a faithful real
      // reproduction, not a simulation of a different failure shape).
      return execFileSync('sh', ['-c', `sleep ${MARKER_SECONDS} & wait`], {
        timeout: options.timeout, killSignal: options.killSignal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') throw Object.assign(new Error('no such image'), { status: 1 });
    throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'UNEXPECTED_STAGE_REACHED');
  });

  // Give the marker sleep a moment to actually start before we assert
  // anything about it; inspect() itself blocks until its own timeout, so
  // this assertion setup happens entirely before/after that one call.
  let threw: ArtifactRuntimeError | undefined;
  try { adapter.inspect(repo, BUDGET_MS); }
  catch (err) { threw = err as ArtifactRuntimeError; }

  assert.ok(threw instanceof ArtifactRuntimeError, 'the outer process being killed must still fail the call');
  assert.equal(threw!.code, 'RUNTIME_OPERATION_TIMEOUT');

  // THE actual regression proof: the grandchild marker process must not
  // survive inspect() returning. Poll briefly (SIGKILL delivery + kernel
  // bookkeeping is not instantaneous) rather than assert instantly.
  const deadline = Date.now() + 5_000;
  while (markerStillRunning() && Date.now() < deadline) { /* brief poll */ }
  assert.equal(markerStillRunning(), false, 'a grandchild process spawned by the killed build must not survive as a live orphan -- this is the real bug this test exists to catch');

  console.log('security-artifact-validator orphan sweep: PASS (a real grandchild process spawned by a SIGKILLed build is proactively killed, not left running as a live orphan)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
