/** V1.7 Blocker B — REAL subprocess termination proof.
 *
 * Every other test in this phase injects a plain JS function in place of
 * the `podman`/`trivy` commands (the ArtifactCommand fault-test seam) --
 * necessary because Blocker A (see n8n-workflows/WF6-V1_7-RUNTIME-
 * INTEGRATION-AUDIT.md) means rootless Podman cannot initialize in this
 * environment, so the real command can never be exercised end-to-end here.
 *
 * That still leaves "subprocess timeout" / "process termination on
 * timeout" / "no orphan process" unproven against an actual OS process
 * UNLESS something real is used. `sleep` needs no Podman/Trivy/container
 * runtime and is available in any POSIX environment (including this one),
 * so this file substitutes a REAL, LONG-RUNNING `sleep` for one stage's
 * command via the SAME injection seam, with the SAME timeout/killSignal
 * options the adapter itself computed -- proving actual OS-level kill and
 * absence of a surviving process, not a simulated one.
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactRuntimeError, TrivyImageArtifactValidator } from './security-artifact-validator';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-real-termination-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });

// An unusual, unlikely-to-collide sleep duration used purely as a `pgrep -f`
// marker to find/confirm-absent the real child process by its argv.
const MARKER_SECONDS = '61.417';
function markerStillRunning(): boolean {
  try { execFileSync('pgrep', ['-f', `sleep ${MARKER_SECONDS}`], { encoding: 'utf8' }); return true; }
  catch { return false; } // pgrep exits non-zero when nothing matches
}

try {
  assert.equal(markerStillRunning(), false, 'precondition: no stray marker process from a previous run');

  // Must clear MIN_STAGE_BUDGET_MS so the (instant, faked) preflight stages
  // are actually attempted and the real sleep is reached, while staying
  // tiny next to the 61.417s sleep it will terminate.
  const BUDGET_MS = 3_000;
  const adapter = new TrivyImageArtifactValidator((command, args, options) => {
    if (command === 'podman' && args[0] === 'info') return 'true';
    if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
    if (command === 'podman' && args[0] === 'pull') return '';
    if (command === 'podman' && args[0] === 'build') {
      // Substitute a REAL 61.417s sleep for the real `podman build` --
      // forwarding the SAME options (timeout/killSignal/stdio) the adapter
      // computed for this stage, so Node's own execFileSync watchdog is
      // what terminates it, exactly as it would terminate a real stuck
      // build. If the deadline did not actually bound this call, this
      // would hang the test for 61s instead of failing fast.
      return execFileSync('sleep', [MARKER_SECONDS], {
        timeout: options.timeout, killSignal: options.killSignal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    // The real `podman build` was killed above without ever producing a
    // real image -- mirror that for the adapter's own post-failure cleanup
    // pass (`exists()`/`image rm`, still exercised even after a failed
    // build) so it correctly finds nothing to remove instead of this fake
    // masking the ORIGINAL timeout behind an unrelated cleanup error.
    if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') throw Object.assign(new Error('no such image'), { status: 1 });
    throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'UNEXPECTED_STAGE_REACHED');
  });

  const started = Date.now();
  let threw: ArtifactRuntimeError | undefined;
  try { adapter.inspect(repo, BUDGET_MS); }
  catch (err) { threw = err as ArtifactRuntimeError; }
  const wallClockMs = Date.now() - started;

  assert.ok(threw instanceof ArtifactRuntimeError, 'a real 61s sleep standing in for `podman build` must fail the call, not let it succeed');
  assert.equal(threw!.code, 'RUNTIME_OPERATION_TIMEOUT', 'Node classifies its own execFileSync timeout as ETIMEDOUT -> RUNTIME_OPERATION_TIMEOUT');
  // The call must return in roughly the BUDGET, never anywhere near the
  // full 61.417s the sleep was asked to run for -- proves the timeout
  // this deadline computed was the one that actually fired.
  assert.ok(wallClockMs < 30_000, `inspect() must return near the ${BUDGET_MS}ms budget, not run out the 61.417s sleep (took ${wallClockMs}ms)`);

  // No orphan process: give the kernel a brief moment to reap the killed
  // child, then confirm no process matching the marker survives. This is
  // the actual "no orphan process" proof -- not an assumption.
  const deadline = Date.now() + 3_000;
  while (markerStillRunning() && Date.now() < deadline) { /* brief poll, no sleep-in-JS needed at this timescale */ }
  assert.equal(markerStillRunning(), false, 'the real sleep process must not survive past inspect() returning -- no orphan process');

  console.log(`worker-deadline real termination: PASS (real subprocess killed at ~${wallClockMs}ms against a ${BUDGET_MS}ms budget vs a 61417ms command; no orphan process)`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
