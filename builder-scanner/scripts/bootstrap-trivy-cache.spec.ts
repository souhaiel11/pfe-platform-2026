/** V1.7 bootstrap-timeout-split phase — deterministic proof that the vuln
 * DB and Java DB bootstrap steps use their own separate, correctly-ordered
 * timeouts (10m / 30m — see the script's own header comment for the
 * throughput math behind those numbers), and that a failure of either step
 * still fails the whole bootstrap closed: no partial "good enough"
 * readiness, no retry.
 *
 * Source-text checks pin each timeout value to the RIGHT invocation (vuln-
 * db-only gets the 10m variable, java-db-only gets the 30m variable — never
 * swapped, never collapsed back to one shared literal). The behavioral
 * checks run the REAL script under `sh` against a fake `trivy` shim on
 * PATH, so they exercise real `set -eu` propagation without paying for a
 * real network download — the same fast/offline/deterministic split this
 * codebase already uses (trivy-readiness.spec.ts's synthetic `trivy
 * --version` text; containers-conf.spec.ts's source-text Dockerfile
 * checks).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const scriptPath = path.join(__dirname, 'bootstrap-trivy-cache.sh');
const script = fs.readFileSync(scriptPath, 'utf8');

// 1. Vuln DB invocation uses its own variable, pinned to 10m.
assert.match(script, /--download-db-only --timeout "\$TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT"/,
  'vuln DB bootstrap must use TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT');
assert.match(script, /TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT=10m/,
  'TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT must be 10m -- proven adequate with ~4.3x margin at the worst observed throughput');

// 2. Java DB invocation uses its OWN, longer variable, pinned to 30m --
// never the vuln DB's variable, never a shared literal.
assert.match(script, /--download-java-db-only --timeout "\$TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT"/,
  'Java DB bootstrap must use TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT, not the vuln DB variable');
assert.match(script, /TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT=30m/,
  'TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT must be 30m -- proven this phase against real mirror.gcr.io throughput (877135-1642571 B/s), worst case ~1108s, comfortably inside 1800s');

// 3. The two timeouts are genuinely independent -- never collapse back to
// one shared magic literal.
assert.notEqual(
  script.match(/TRIVY_VULN_DB_BOOTSTRAP_TIMEOUT=(\S+)/)?.[1],
  script.match(/TRIVY_JAVA_DB_BOOTSTRAP_TIMEOUT=(\S+)/)?.[1],
  'vuln DB and Java DB bootstrap timeouts must remain independently configurable, not the same value',
);

// 4. No retry loop was introduced -- `set -eu` (fail closed, no shell-level
// retry wrapper around either trivy invocation) must still be the only
// error-handling mechanism.
assert.match(script, /set -eu/, 'must keep set -eu (fail closed, no silent continuation)');
// Comment-stripped so this checks actual shell control flow, not prose that
// legitimately discusses the absence of a retry (e.g. this script's own
// header comment).
const codeOnly = script.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
assert.doesNotMatch(codeOnly, /\bwhile\b|\buntil\b|\bfor\s+\w+\s+in\b/,
  'must not introduce any retry loop around the trivy invocations');

// --- Behavioral: real `sh` execution against a fake `trivy` on PATH ---

function runWithFakeTrivy(fakeTrivyBody: string): { status: number; stdout: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-spec-'));
  const fakeTrivyPath = path.join(tmp, 'trivy');
  fs.writeFileSync(fakeTrivyPath, `#!/bin/sh\n${fakeTrivyBody}\n`, { mode: 0o755 });
  const cacheDir = path.join(tmp, 'cache');
  fs.mkdirSync(cacheDir);
  try {
    const stdout = execFileSync('sh', [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${tmp}:${process.env.PATH}`, SECURITY_TRIVY_CACHE_DIR: cacheDir },
    });
    return { status: 0, stdout };
  } catch (error: any) {
    return { status: error.status ?? 1, stdout: error.stdout ?? '' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 5. Both steps succeed -> script exits 0, both messages printed, final
// readiness verification runs last.
{
  const r = runWithFakeTrivy(`
if [ "$1" = "--version" ]; then echo "Version: 0.72.0"; exit 0; fi
exit 0
`);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Bootstrapping Trivy vulnerability DB/);
  assert.match(r.stdout, /Bootstrapping Trivy Java DB/);
  assert.match(r.stdout, /Verifying readiness/);
}

// 6. Vuln DB step fails -> script fails closed IMMEDIATELY: the Java DB
// step (and the final readiness verification) must never run. Proves
// `set -eu` propagation, no partial "good enough" bootstrap, no retry.
{
  const r = runWithFakeTrivy(`
case "$*" in
  *--download-db-only*) exit 1 ;;
  *) exit 0 ;;
esac
`);
  assert.notEqual(r.status, 0, 'a failed vuln DB bootstrap must fail the whole script');
  assert.match(r.stdout, /Bootstrapping Trivy vulnerability DB/);
  assert.doesNotMatch(r.stdout, /Bootstrapping Trivy Java DB/,
    'the Java DB step must never start once the vuln DB step has failed');
}

// 7. Vuln DB succeeds, Java DB step fails (the exact real-world shape this
// phase is about: a large, slow, non-resumable download timing out) ->
// script still fails closed; no silent "vuln DB is enough" readiness.
{
  const r = runWithFakeTrivy(`
case "$*" in
  *--download-java-db-only*) exit 1 ;;
  *) exit 0 ;;
esac
`);
  assert.notEqual(r.status, 0, 'a failed Java DB bootstrap must fail the whole script, even though the vuln DB step already succeeded');
  assert.match(r.stdout, /Bootstrapping Trivy vulnerability DB/);
  assert.match(r.stdout, /Bootstrapping Trivy Java DB/);
  assert.doesNotMatch(r.stdout, /Verifying readiness/,
    'the final readiness verification must never run after a failed Java DB bootstrap');
}

console.log('bootstrap-trivy-cache: PASS (independent 10m/30m timeouts on the correct invocations, no retry loop, real set -eu propagation on vuln-DB failure and on Java-DB failure)');
