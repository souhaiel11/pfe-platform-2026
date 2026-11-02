// Teste le composant « orphan-validation-extended » et ses cas d’erreur.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactRuntimeError, TrivyImageArtifactValidator } from './security-artifact-validator';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-orphan-extended-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });

/** Simule la mise à jour de l’état du formulaire. */
function markerStillRunning(marker: string): boolean {
  try { execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }); return true; }
  catch { return false; }
}
/** Attend la disparition du processus ou de la ressource. */
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
