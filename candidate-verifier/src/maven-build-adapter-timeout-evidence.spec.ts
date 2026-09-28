/** Execution-2058 observability fix — dependencyTree() previously discarded
 * whatever real stdout/stderr execFileSync had already captured before a
 * timeout SIGKILL, replacing it with a fixed "WORKSPACE_TIMEOUT..." string.
 * This is the exact gap that made execution 2058's real cause (a large,
 * legitimately in-progress, cold-cache dependency download -- not a stall,
 * DNS failure, or lock) reconstructable only via the .m2 repository's own
 * file timestamps, never from application evidence.
 *
 * Same fake-mvn-on-PATH, real-subprocess, real-timeout technique already
 * established by maven-build-adapter-no-orphan.spec.ts -- a fast stand-in
 * for a real multi-minute Maven run, not a mock of the timeout mechanism
 * itself.
 */
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MavenBuildAdapter } from './maven-build-adapter';

const MARKER_SECONDS = '61.417';
function markerStillRunning(): boolean {
  try { execFileSync('pgrep', ['-f', `sleep ${MARKER_SECONDS}`], { encoding: 'utf8' }); return true; }
  catch { return false; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-maven-timeout-evidence-'));
const fakeMavenDir = path.join(root, 'bin');
fs.mkdirSync(fakeMavenDir);
const fakeMavenPath = path.join(fakeMavenDir, 'mvn');
// Real Maven wagon/resolver transport-log wording (verified against a real
// `mvn -o dependency:tree` run against this exact Maven/resolver version --
// not invented): a first artifact resolved cleanly, a second one retried
// once (two "Downloading from" for the same URL, no "Downloaded from"
// between them -- exactly the shape lastArtifactFrom()/retryCountFrom()
// look for), a credential-shaped URL fragment that must be redacted, then
// the hang.
fs.writeFileSync(
  fakeMavenPath,
  '#!/bin/sh\n' +
  'echo "Downloading from central: https://repo.maven.apache.org/maven2/a/a-1.0.pom"\n' +
  'echo "Downloaded from central: https://repo.maven.apache.org/maven2/a/a-1.0.pom (1.2 kB at 3.4 kB/s)"\n' +
  'echo "Downloading from central: https://repo.maven.apache.org/maven2/avalon-framework/avalon-framework/4.1.3/avalon-framework-4.1.3.pom"\n' +
  'echo "Downloading from central: https://repo.maven.apache.org/maven2/avalon-framework/avalon-framework/4.1.3/avalon-framework-4.1.3.pom"\n' +
  'echo "[WARNING] Could not transfer artifact avalon-framework:avalon-framework:pom:4.1.3, will retry" 1>&2\n' +
  'echo "https://deploy:s3cr3t-pass@internal.example.com/should-be-redacted" 1>&2\n' +
  `exec sleep ${MARKER_SECONDS}\n`,
  { mode: 0o755 },
);

const originalPath = process.env.PATH;
try {
  assert.equal(markerStillRunning(), false, 'precondition: no stray marker process from a previous run');
  process.env.PATH = `${fakeMavenDir}:${originalPath}`;

  const adapter = new MavenBuildAdapter();
  const BUDGET_MS = 2_000;
  const result = adapter.dependencyTree(root, BUDGET_MS);

  assert.equal(result.status, 'FAILED');
  assert.equal(result.timedOut, true, 'the failure must be attributed to a real timeout');
  assert.ok(result.evidenceTail.includes('WORKSPACE_TIMEOUT'), 'the timeout marker is kept for any caller that still greps for it defensively');
  assert.ok(result.evidenceTail.includes('avalon-framework-4.1.3.pom'), `real captured stdout must survive into evidenceTail -- got: ${result.evidenceTail}`);

  // Typed-field callers (grounded-maven-provenance.service.ts) branch on
  // `timedOut`, never on the evidenceTail string -- confirms this fix did
  // not have to (and did not) change that contract.
  assert.equal(result.text, null);

  assert.ok(result.timeoutEvidence, 'structured timeoutEvidence must be present on a real timeout');
  const ev = result.timeoutEvidence!;
  assert.equal(ev.lastArtifact, 'central: https://repo.maven.apache.org/maven2/avalon-framework/avalon-framework/4.1.3/avalon-framework-4.1.3.pom',
    'the LAST transport-log line (the artifact actually in flight when killed) must be identified, not the first');
  assert.ok(ev.retryCount >= 2, `retryCount must count both the duplicate "Downloading from" (no interleaved "Downloaded from") and the explicit "will retry" warning -- got ${ev.retryCount}`);
  assert.ok(!ev.stderrTail.includes('s3cr3t-pass'), 'embedded credential-shaped URL fragments must be redacted, same discipline as repo-cache.service.ts');
  assert.ok(ev.stderrTail.includes('***'), 'redaction leaves a visible marker, not silent content loss');

  const deadline = Date.now() + 5_000;
  while (markerStillRunning() && Date.now() < deadline) { /* brief poll */ }
  assert.equal(markerStillRunning(), false, 'no orphan left behind by this fix');

  console.log('maven-build-adapter-timeout-evidence.spec.ts: PASS (real captured stdout/stderr now survives a dependency:tree timeout into evidenceTail; lastArtifact/retryCount extracted from real Maven transport-log wording; credential-shaped text redacted; timedOut/status contract unchanged; no orphan)');
} finally {
  process.env.PATH = originalPath;
  fs.rmSync(root, { recursive: true, force: true });
}
