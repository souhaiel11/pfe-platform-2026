/** CORRECTIF 2 primitives — none of these are wired into any live caller
 * yet (dependencyTree()'s options.offline, dependencyGoOffline(),
 * resolveArtifact()). This proves each primitive's own command
 * construction and result classification in isolation, fast and
 * deterministic, via a fake mvn-on-PATH that echoes its own argv (so the
 * test can assert exactly what was invoked) and can be told to fail with
 * Maven's own REAL offline-miss wording.
 *
 * That wording (OFFLINE_MISSING_ARTIFACT's regex target) was captured from
 * an actual `mvn -o dependency:tree` run against this exact Maven 3.8.7
 * install, against a pom referencing a nonexistent version -- reproduced
 * here verbatim as a fixture, not invented:
 *
 *   [ERROR] Failed to execute goal on project offline-probe: Could not
 *   resolve dependencies for project com.example:offline-probe:jar:1.0.0:
 *   Cannot access central (https://repo.maven.apache.org/maven2) in
 *   offline mode and the artifact
 *   ch.qos.logback:logback-classic:jar:1.9.9-does-not-exist-probe has not
 *   been downloaded from it before. -> [Help 1]
 *
 * `mvn dependency:get` working standalone with no pom.xml at all (used by
 * resolveArtifact()) was also verified for real, separately, against the
 * real ch.qos.logback:logback-classic:1.2.13 target version -- not
 * exercised here (real network, ~50s, not repeatable-fast) but confirmed:
 * exit 0, BUILD SUCCESS, artifact landed in .m2/repository/ch/qos/logback.
 */
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MavenBuildAdapter } from './maven-build-adapter';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-maven-offline-'));
const fakeMavenDir = path.join(root, 'bin');
fs.mkdirSync(fakeMavenDir);
const fakeMavenPath = path.join(fakeMavenDir, 'mvn');
const argsCapturePath = path.join(root, 'captured-args.txt');

// Real Maven's own offline-miss wording (see file header) -- the ONE
// nonzero-exit fixture body every "fails as offline miss" test below uses.
const REAL_OFFLINE_MISS_STDERR =
  '[ERROR] Failed to execute goal on project offline-probe: Could not resolve dependencies for project com.example:offline-probe:jar:1.0.0: ' +
  'Cannot access central (https://repo.maven.apache.org/maven2) in offline mode and the artifact ' +
  'ch.qos.logback:logback-classic:jar:1.9.9-does-not-exist-probe has not been downloaded from it before. -> [Help 1]';

/** Writes a fake `mvn` that records its own argv (one line per invocation,
 *  appended) to argsCapturePath, then exits with the given code/stderr. */
function installFakeMaven(exitCode: number, stderr = ''): void {
  const script =
    '#!/bin/sh\n' +
    `echo "$@" >> "${argsCapturePath}"\n` +
    (stderr ? `echo '${stderr.replace(/'/g, "'\\''")}' 1>&2\n` : '') +
    `exit ${exitCode}\n`;
  fs.writeFileSync(fakeMavenPath, script, { mode: 0o755 });
}
function lastCapturedArgs(): string {
  const lines = fs.readFileSync(argsCapturePath, 'utf8').trim().split('\n');
  return lines[lines.length - 1];
}
// Exact-token check, never substring: the tmpdir fixture path itself
// legitimately contains "-o" as a substring (this file's own "-offline-"
// prefix), which a naive .includes('-o') would false-positive on.
function hasToken(args: string, token: string): boolean {
  return args.split(/\s+/).includes(token);
}

const originalPath = process.env.PATH;
try {
  fs.writeFileSync(argsCapturePath, '');
  process.env.PATH = `${fakeMavenDir}:${originalPath}`;
  const adapter = new MavenBuildAdapter();

  // 1. dependencyTree({offline:false} / default) never adds -o.
  {
    installFakeMaven(0);
    adapter.dependencyTree(root, 30_000);
    const args = lastCapturedArgs();
    assert.ok(!hasToken(args, '-o'), `default (non-offline) call must not add -o -- got: ${args}`);
  }

  // 2. dependencyTree({offline:true}) prepends -o -- the exact, minimal
  // wiring point CORRECTIF 2's future caller will flip.
  {
    installFakeMaven(0);
    adapter.dependencyTree(root, 30_000, { offline: true });
    const args = lastCapturedArgs();
    assert.ok(args.startsWith('-o '), `offline:true must prepend -o -- got: ${args}`);
    assert.ok(args.includes('dependency:tree'), 'the goal itself is unchanged');
  }

  // 3. offline:true + Maven's real "has not been downloaded" signature ->
  // structured offlineFailure, fail-closed but EXPLICIT (never a muted
  // generic FAILED, never confused with a timeout).
  {
    installFakeMaven(1, REAL_OFFLINE_MISS_STDERR);
    const result = adapter.dependencyTree(root, 30_000, { offline: true });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.timedOut, false, 'an offline miss fails fast -- never classified as a timeout');
    assert.ok(result.offlineFailure, 'offlineFailure must be populated');
    assert.equal(result.offlineFailure!.code, 'DEPENDENCY_NOT_IN_CACHE');
    assert.deepEqual(result.offlineFailure!.missingArtifacts, ['ch.qos.logback:logback-classic:jar:1.9.9-does-not-exist-probe']);
    assert.equal(result.offlineFailure!.primaryMissingArtifact, 'ch.qos.logback:logback-classic:jar:1.9.9-does-not-exist-probe');
  }

  // 4. The SAME real failure text, but WITHOUT options.offline -- must
  // never be classified as offlineFailure. Detection is gated on the
  // caller's own declared intent, never inferred from text content alone
  // (the exact scenario this file's own maven-build-adapter.ts comment
  // calls out: a misconfigured mirror could theoretically print similar
  // text in a genuinely online run, where it would not mean the same
  // thing).
  {
    installFakeMaven(1, REAL_OFFLINE_MISS_STDERR);
    const result = adapter.dependencyTree(root, 30_000); // offline omitted
    assert.equal(result.status, 'FAILED');
    assert.equal(result.offlineFailure, undefined, 'offlineFailure must never be inferred without the caller declaring offline:true');
  }

  // 5. dependencyGoOffline() invokes the real, correct goal.
  {
    installFakeMaven(0);
    const result = adapter.dependencyGoOffline(root, 30_000);
    assert.equal(result.status, 'SUCCESS');
    const args = lastCapturedArgs();
    assert.ok(args.includes('dependency:go-offline'), `must invoke dependency:go-offline -- got: ${args}`);
  }

  // 6. resolveArtifact() invokes dependency:get with the exact GAV and
  // -Dtransitive=false (pre-warms exactly the one requested artifact, not
  // its own unbounded transitive graph).
  {
    installFakeMaven(0);
    const result = adapter.resolveArtifact(root, 'ch.qos.logback:logback-classic:1.2.13', 30_000);
    assert.equal(result.status, 'SUCCESS');
    const args = lastCapturedArgs();
    assert.ok(args.includes('dependency:get'), `must invoke dependency:get -- got: ${args}`);
    assert.ok(args.includes('-Dartifact=ch.qos.logback:logback-classic:1.2.13'), `must pass the exact GAV -- got: ${args}`);
    assert.ok(args.includes('-Dtransitive=false'), `must resolve non-transitively -- got: ${args}`);
  }

  // 7. Warm-up failing with a real network-transport signature (a
  // "Connection reset" wagon-transfer failure, well-known Maven/Java
  // wording) -> networkFailure populated, distinct from a generic FAILED.
  // Warm-up NEVER touches candidate content, so this is always an
  // infrastructure signal, never evidence about any artifact.
  {
    installFakeMaven(1, '[ERROR] Failed to transfer file: https://repo.maven.apache.org/maven2/x/x-1.0.jar. Return code is: 200, ReasonPhrase: Connection reset by peer');
    const result = adapter.dependencyGoOffline(root, 30_000);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.timedOut, false);
    assert.ok(result.networkFailure, 'a network-transport signature must be classified as networkFailure');
    assert.equal(result.networkFailure!.code, 'WARMUP_NETWORK_FAILURE');
  }

  // 8. Warm-up genuinely timing out (a real subprocess kill, not a fake
  // exit code) -> timedOut:true. Also always infrastructure-class, per the
  // SAME reasoning as #7 -- a future caller must gate on `status ===
  // 'FAILED'` as a whole (timedOut OR networkFailure OR neither), never
  // only on networkFailure's presence.
  {
    const HANG_SECONDS = '61.417';
    fs.writeFileSync(fakeMavenPath, `#!/bin/sh\nexec sleep ${HANG_SECONDS}\n`, { mode: 0o755 });
    const result = adapter.resolveArtifact(root, 'ch.qos.logback:logback-classic:1.2.13', 2_000);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.timedOut, true, 'a real subprocess timeout during warm-up must be reported as timedOut');
    assert.equal(result.networkFailure, undefined, 'timedOut and networkFailure are reported separately, never both -- text-based classification is skipped once the cause is already known to be a timeout');
    const deadline = Date.now() + 5_000;
    const stillRunning = () => { try { execFileSync('pgrep', ['-f', `sleep ${HANG_SECONDS}`], { encoding: 'utf8' }); return true; } catch { return false; } };
    while (stillRunning() && Date.now() < deadline) { /* brief poll */ }
    assert.equal(stillRunning(), false, 'no orphan left behind by a warm-up timeout');
  }

  // 9. A genuine, non-network Maven failure during warm-up (no known
  // network signature in the text) -> FAILED, but networkFailure stays
  // undefined. Confirms no false positives: absence of evidence is not
  // treated as evidence of a network cause either way.
  {
    installFakeMaven(1, '[ERROR] Non-resolvable parent POM: Could not find artifact com.example:parent:pom:9.9.9 in central');
    const result = adapter.dependencyGoOffline(root, 30_000);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.timedOut, false);
    assert.equal(result.networkFailure, undefined, 'a real (non-network) Maven resolution failure must not be misclassified as a network problem');
  }

  console.log('maven-build-adapter-offline.spec.ts: PASS (9/9 -- offline flag wiring, real Maven offline-miss signature parsed into a structured DEPENDENCY_NOT_IN_CACHE failure gated on declared intent, dependency:go-offline and dependency:get(-Dtransitive=false) command construction all correct, warm-up network-failure/timeout classification distinct from a genuine resolution failure -- no false positives; none wired into a live caller)');
} finally {
  process.env.PATH = originalPath;
  fs.rmSync(root, { recursive: true, force: true });
}
