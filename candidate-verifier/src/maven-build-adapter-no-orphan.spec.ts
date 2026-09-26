/** V1.7 runtime stabilization phase, Phase I — orphan-process validation
 * for candidate-verifier's OWN direct `mvn` invocations (as distinct from
 * builder-scanner's nested nested-under-podman-build ones, already
 * covered by security-artifact-validator-orphan-sweep.spec.ts).
 *
 * Structural claim being tested: the REAL `mvn` launcher script ends with
 * `exec "$JAVACMD" ...` (verified by inspecting the actual installed
 * script on this host) -- `exec` REPLACES the shell's own process image
 * with java, keeping the SAME pid throughout, rather than forking a
 * separate child. That means killing the one pid execFileSync tracks
 * (the `mvn` shell script) kills the ACTUAL running Maven/JVM process
 * directly -- there is no separate descendant left behind, unlike the
 * nested-podman-build case where a real fork boundary exists.
 *
 * Proven here empirically, not just by code inspection: a fake `mvn` on
 * PATH mirrors the real script's own `exec` pattern (`exec sleep N`)
 * rather than a real multi-minute Maven build, keeping this test fast
 * while exercising the identical mechanism. */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MavenBuildAdapter } from './maven-build-adapter';

const MARKER_SECONDS = '63.219';
function markerStillRunning(): boolean {
  try { execFileSync('pgrep', ['-f', `sleep ${MARKER_SECONDS}`], { encoding: 'utf8' }); return true; }
  catch { return false; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-maven-no-orphan-'));
const fakeMavenDir = path.join(root, 'bin');
fs.mkdirSync(fakeMavenDir);
const fakeMavenPath = path.join(fakeMavenDir, 'mvn');
// Mirrors the REAL mvn script's own final line (`exec "$JAVACMD" ...`) --
// same mechanism, a fast stand-in instead of a real multi-minute build.
fs.writeFileSync(fakeMavenPath, `#!/bin/sh\nexec sleep ${MARKER_SECONDS}\n`, { mode: 0o755 });

const originalPath = process.env.PATH;
try {
  assert.equal(markerStillRunning(), false, 'precondition: no stray marker process from a previous run');
  process.env.PATH = `${fakeMavenDir}:${originalPath}`;

  const adapter = new MavenBuildAdapter();
  const BUDGET_MS = 3_000;
  const started = Date.now();
  const result = adapter.dependencyTree(root, BUDGET_MS);
  const wallClockMs = Date.now() - started;

  assert.equal(result.status, 'FAILED', 'the fake mvn (a real long-running process) must be reported as failed, not silently succeed');
  assert.equal(result.timedOut, true, 'the failure must be attributed to a real timeout');
  assert.ok(wallClockMs < 30_000, `must return near the ${BUDGET_MS}ms budget, not run out the ${MARKER_SECONDS}s sleep (took ${wallClockMs}ms)`);

  const deadline = Date.now() + 5_000;
  while (markerStillRunning() && Date.now() < deadline) { /* brief poll */ }
  assert.equal(markerStillRunning(), false, 'no orphan: the real process (exec-chained from the fake mvn script, exactly like the real one execs into java) must not survive');

  console.log(`maven-build-adapter no-orphan (candidate-verifier's own direct mvn calls): PASS (real subprocess killed at ~${wallClockMs}ms against a ${BUDGET_MS}ms budget; no orphan -- confirms the exec-chain structurally has no fork boundary to leak across)`);
} finally {
  process.env.PATH = originalPath;
  fs.rmSync(root, { recursive: true, force: true });
}
