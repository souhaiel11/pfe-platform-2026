/** V1.7 runtime stabilization phase, Phase I — orphan-process validation
 * across additional real failure shapes beyond the one already covered by
 * security-artifact-validator-orphan-sweep.spec.ts (kill during the
 * IMAGE_BUILD/Podman-build RUN step, idle-sleeping descendant).
 *
 * Covers:
 *   3. kill while the nested child is CPU-ACTIVE (a real busy loop, not an
 *      idle sleep -- proves a genuinely computing process is really
 *      terminated, not merely one blocked on I/O).
 *   4. kill during/around Trivy (the SAME orphan shape, at the TRIVY_SCAN
 *      stage instead of IMAGE_BUILD).
 *   5. repeated timeout runs (the fix holds across multiple consecutive
 *      real kills in the same process -- no accumulation, no residual
 *      state leaking between independent inspect() calls).
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactRuntimeError, TrivyImageArtifactValidator } from './security-artifact-validator';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-orphan-extended-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });

function markerStillRunning(marker: string): boolean {
  try { execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }); return true; }
  catch { return false; }
}
function waitUntilGone(marker: string, ms = 5_000): void {
  const deadline = Date.now() + ms;
  while (markerStillRunning(marker) && Date.now() < deadline) { /* brief poll, no sleep-in-JS needed at this timescale */ }
}

try {
  // 3. CPU-ACTIVE descendant: a real, genuinely-computing shell busy loop,
  // backgrounded, with the outer shell blocking in `wait` -- the outer
  // process is what gets SIGKILLed, the busy loop is its real child.
  {
    const marker = 'BUSY_MARKER_98214';
    assert.equal(markerStillRunning(marker), false, 'precondition: no stray busy-loop marker');
    const BUDGET_MS = 3_000;
    const adapter = new TrivyImageArtifactValidator((command, args, options) => {
      if (command === 'podman' && args[0] === 'info') return 'true';
      if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
      if (command === 'podman' && args[0] === 'pull') return '';
      if (command === 'podman' && args[0] === 'build') {
        // The marker is embedded as literal TEXT in the INNER shell
        // script string, which is itself one argv entry of the inner
        // process -- `pgrep -f` matches the whole command line, so this
        // reliably identifies the real busy-loop process, not merely the
        // outer wrapper. A real busy loop (`while true; do :; done`), not
        // an idle `sleep`, so this genuinely proves an ACTIVELY COMPUTING
        // process is really killed.
        return execFileSync('sh', ['-c', `sh -c "true ${marker}; while true; do :; done" & wait`], {
          timeout: options.timeout, killSignal: options.killSignal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
      }
      if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') throw Object.assign(new Error('no such image'), { status: 1 });
      throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'UNEXPECTED_STAGE_REACHED');
    });
    let threw: ArtifactRuntimeError | undefined;
    try { adapter.inspect(repo, BUDGET_MS); } catch (err) { threw = err as ArtifactRuntimeError; }
    assert.ok(threw instanceof ArtifactRuntimeError);
    assert.equal(threw!.code, 'RUNTIME_OPERATION_TIMEOUT');
    waitUntilGone(marker);
    assert.equal(markerStillRunning(marker), false, 'a CPU-actively-computing orphan (not merely idle) must not survive');
  }
  console.log('orphan validation, scenario 3 (CPU-active descendant): PASS');

  // 4. Kill during/around Trivy: the SAME real orphan shape, this time
  // reached via a successful (faked) build/save, with the ORPHAN spawned
  // by the TRIVY_SCAN stage's own command instead of IMAGE_BUILD.
  {
    const marker = 'TRIVY_MARKER_55031';
    assert.equal(markerStillRunning(marker), false, 'precondition: no stray Trivy-stage marker');
    const BUDGET_MS = 3_000;
    let imagePresent = false;
    const adapter = new TrivyImageArtifactValidator((command, args, options) => {
      if (command === 'podman' && args[0] === 'info') return 'true';
      if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
      if (command === 'podman' && args[0] === 'pull') return '';
      if (command === 'podman' && args[0] === 'build') { imagePresent = true; return ''; }
      if (command === 'podman' && args[0] === 'save') { fs.writeFileSync(args[args.indexOf('--output') + 1], 'synthetic-image'); return ''; }
      if (command === 'trivy' && args[0] === 'image') {
        return execFileSync('sh', ['-c', `sh -c "true ${marker}; sleep 64.5" & wait`], {
          timeout: options.timeout, killSignal: options.killSignal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
      }
      if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') { if (!imagePresent) throw Object.assign(new Error('no such image'), { status: 1 }); return ''; }
      if (command === 'podman' && args[0] === 'image' && args[1] === 'rm') { imagePresent = false; return ''; }
      throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'UNEXPECTED_STAGE_REACHED');
    });
    let threw: ArtifactRuntimeError | undefined;
    try { adapter.inspect(repo, BUDGET_MS); } catch (err) { threw = err as ArtifactRuntimeError; }
    assert.ok(threw instanceof ArtifactRuntimeError);
    assert.equal(threw!.code, 'RUNTIME_OPERATION_TIMEOUT');
    assert.equal(threw!.stage, 'TRIVY_SCAN');
    waitUntilGone(marker);
    assert.equal(markerStillRunning(marker), false, 'an orphan spawned during the TRIVY_SCAN stage must not survive either -- the sweep is not IMAGE_BUILD-specific');
  }
  console.log('orphan validation, scenario 4 (kill during Trivy): PASS');

  // 5. Repeated timeout runs: the fix must hold across MULTIPLE
  // consecutive real kills in the SAME process -- no accumulation, no
  // state leaking between independent inspect() calls (each call gets its
  // own fresh pidsBeforeBuild snapshot).
  {
    const REPEAT_MARKER_PREFIX = 'REPEAT_MARKER_';
    const REPEATS = 3;
    for (let i = 0; i < REPEATS; i++) {
      const marker = `${REPEAT_MARKER_PREFIX}${i}`;
      assert.equal(markerStillRunning(marker), false, `precondition (iteration ${i}): no stray marker`);
      const adapter = new TrivyImageArtifactValidator((command, args, options) => {
        if (command === 'podman' && args[0] === 'info') return 'true';
        if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
        if (command === 'podman' && args[0] === 'pull') return '';
        if (command === 'podman' && args[0] === 'build') {
          return execFileSync('sh', ['-c', `sh -c "true ${marker}; sleep 65.1" & wait`], {
            timeout: options.timeout, killSignal: options.killSignal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          });
        }
        if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') throw Object.assign(new Error('no such image'), { status: 1 });
        throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'UNEXPECTED_STAGE_REACHED');
      });
      let threw: ArtifactRuntimeError | undefined;
      try { adapter.inspect(repo, 3_000); } catch (err) { threw = err as ArtifactRuntimeError; }
      assert.ok(threw instanceof ArtifactRuntimeError, `iteration ${i} must fail`);
      waitUntilGone(marker);
      assert.equal(markerStillRunning(marker), false, `iteration ${i}: its own orphan must not survive`);
    }
    // All markers across all iterations gone -- no cross-iteration leak.
    for (let i = 0; i < REPEATS; i++) assert.equal(markerStillRunning(`${REPEAT_MARKER_PREFIX}${i}`), false);
  }
  console.log(`orphan validation, scenario 5 (repeated timeout runs, 3x consecutive): PASS`);

  console.log('orphan validation extended: PASS (CPU-active descendant killed, Trivy-stage orphan killed, 3 repeated real kills with no accumulation)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
