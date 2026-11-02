// Teste le composant « maven-build-adapter-no-orphan » et ses cas d’erreur.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MavenBuildAdapter } from './maven-build-adapter';

const MARKER_SECONDS = '63.219';
/** Simule la mise à jour de l’état du formulaire. */
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
