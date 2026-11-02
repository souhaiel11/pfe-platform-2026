// Teste le composant « artifact-failure-logging » et ses cas d’erreur.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ArtifactRuntimeError, TrivyImageArtifactValidator, describeCommandFailure } from './security-artifact-validator';

// =====================================================================
// Part A — describeCommandFailure(): pure function, no subprocess/console.
// =====================================================================
{
  const nonzero = Object.assign(new Error('injected'), { status: 1, stderr: 'Error: initializing source docker://maven:3.8.6-openjdk-11: reading manifest: connection reset by peer' });
  const log = describeCommandFailure('PODMAN_BASE_IMAGE_PULL', 'podman', ['pull', 'maven:3.8.6-openjdk-11'], nonzero);
  assert.equal(log.exitCode, 1, 'nonzero exit code is captured');
  assert.equal(log.classification, 'NON_TIMEOUT', 'a plain nonzero exit is classified NON_TIMEOUT');
  assert.equal(log.target, 'maven:3.8.6-openjdk-11', 'the pulled image reference is extracted as the target');
  assert.ok(log.stderrTail.includes('connection reset by peer'), 'stderr content is captured');
  console.log('artifact-failure-logging Test A1: PASS (nonzero exit + stderr + target captured)');
}
{
  const timeout = Object.assign(new Error('injected'), { status: null, code: 'ETIMEDOUT', stderr: '' });
  const log = describeCommandFailure('IMAGE_BUILD', 'podman', ['build', '--isolation=chroot', '--tag', 'localhost/security-closure:abc'], timeout);
  assert.equal(log.classification, 'TIMEOUT', 'ETIMEDOUT is classified TIMEOUT, unchanged from the existing ArtifactRuntimeError mapping');
  assert.equal(log.exitCode, null, 'no numeric exit code on a pure timeout');
  assert.equal(log.target, 'localhost/security-closure:abc', 'the --tag value is extracted as the target for a build stage');
  console.log('artifact-failure-logging Test A2: PASS (timeout classification + build --tag target extraction)');
}
{
  const long = 'x'.repeat(5000) + 'THE-REAL-ERROR-IS-HERE-AT-THE-END';
  const error = Object.assign(new Error('injected'), { status: 1, stderr: long });
  const log = describeCommandFailure('TRIVY_SCAN', 'trivy', ['image', '--input', 'archive.tar'], error);
  assert.ok(log.stderrTail.length <= 2001, 'stderr is bounded/truncated, never unbounded');
  assert.ok(log.stderrTail.endsWith('THE-REAL-ERROR-IS-HERE-AT-THE-END'), 'truncation keeps the TAIL (most likely to contain the actual error), not an arbitrary head cut');
  assert.equal(log.target, null, 'a non-podman command (trivy) never fabricates an image target');
  console.log('artifact-failure-logging Test A3: PASS (bounded stderr truncation keeps the tail)');
}
{
  // No .stderr at all (e.g. ENOENT never populates it) must not throw
  // building the log, AND -- code-review addition -- nodeErrorCode now
  // makes this a wrapper-level failure (the binary itself never ran)
  // explicitly distinguishable from a real nonzero exit.
  const enoent = Object.assign(new Error('injected'), { code: 'ENOENT' });
  const log = describeCommandFailure('PODMAN_PREFLIGHT', 'podman', ['info'], enoent);
  assert.equal(log.stderrTail, '', 'a missing stderr degrades to an empty string, never throws');
  assert.equal(log.exitCode, null, 'a wrapper-level failure (binary never ran) has no real process exit code');
  assert.equal(log.nodeErrorCode, 'ENOENT', 'the raw Node error code is surfaced, identifying this as "executable not found", not a Podman/Trivy exit');
  assert.equal(log.signal, null, 'no termination signal on a spawn-never-happened failure');
  console.log('artifact-failure-logging Test A4: PASS (missing stderr handled safely; wrapper failure explicitly distinguishable via nodeErrorCode)');
}
{
  // Code-review addition — the OTHER half of the wrapper-vs-exit
  // distinction: a real process that ran and was killed by a signal
  // (e.g. this codebase's own killSignal:'SIGKILL' on timeout/deadline
  // enforcement) must surface that signal explicitly too, separate from
  // both a clean exit code and a Node-level wrapper error code.
  const killed = Object.assign(new Error('injected'), { status: null, signal: 'SIGKILL' });
  const log = describeCommandFailure('IMAGE_BUILD', 'podman', ['build', '--tag', 'localhost/x:y'], killed);
  assert.equal(log.exitCode, null, 'a signal-terminated process has no normal exit code');
  assert.equal(log.nodeErrorCode, null, 'a signal kill is not a Node wrapper error code');
  assert.equal(log.signal, 'SIGKILL', 'the termination signal is surfaced explicitly');
  console.log('artifact-failure-logging Test A4b: PASS (signal-terminated process distinguishable from both a clean exit and a wrapper failure)');
}
{
  // Structural secret-safety guarantee: the function's own signature never
  // accepts env/headers/credentials, so nothing resembling one can appear
  // in its output regardless of what the error object happens to carry.
  const adversarial = Object.assign(new Error('injected'), {
    status: 1, stderr: 'plain podman stderr, no secrets here',
    env: { DB_PASS: 'should-never-be-read' }, headers: { Authorization: 'Bearer should-never-be-read' },
  });
  const log = describeCommandFailure('PODMAN_BASE_IMAGE_PULL', 'podman', ['pull', 'eclipse-temurin:11-jre-alpine'], adversarial);
  const serialized = JSON.stringify(log);
  assert.ok(!serialized.includes('should-never-be-read'), 'even an error object carrying extraneous env/headers fields never leaks them -- the log shape has no field that could');
  assert.deepEqual(Object.keys(log).sort(), ['classification', 'command', 'exitCode', 'nodeErrorCode', 'signal', 'stage', 'stderrTail', 'target'], 'the log shape is exactly these 8 fields, nothing else -- no env, no headers, no credential file path');
  console.log('artifact-failure-logging Test A5: PASS (log shape structurally excludes secrets/env/headers)');
}
{
  // Code-review addition — stderr REDACTION (not merely truncation): even
  // though no current failure mode in this codebase's public-image-only,
  // token-free pull path is known to produce one, a registry or git error
  // could in principle echo back something sensitive. Each pattern tested
  // independently.
  const cases: Array<[string, string, RegExp]> = [
    ['URL userinfo', 'Error: fetching https://deploy:s3cr3t-pass@registry.example.com/v2/: unauthorized', /deploy:s3cr3t-pass@/],
    ['Authorization header', 'remote error: Authorization: Basic dXNlcjpwYXNz rejected', /Basic dXNlcjpwYXNz/],
    ['Bearer token', 'server responded: invalid Bearer eyJhbGciOiJIUzI1NiJ9.abc.def token', /eyJhbGciOiJIUzI1NiJ9\.abc\.def/],
    ['signed URL query param', 'GET https://cdn.example.com/blob?X-Amz-Signature=deadbeef1234&other=1 failed', /X-Amz-Signature=deadbeef1234/],
  ];
  for (const [label, stderr, mustNotAppear] of cases) {
    const log = describeCommandFailure('PODMAN_BASE_IMAGE_PULL', 'podman', ['pull', 'maven:3.8.6-openjdk-11'], Object.assign(new Error('injected'), { status: 1, stderr }));
    assert.ok(!mustNotAppear.test(log.stderrTail), `Test A6 (${label}) - the sensitive substring must not survive into the log`);
    assert.ok(log.stderrTail.includes('***'), `Test A6 (${label}) - redaction leaves a visible marker, not silent content loss`);
  }
  console.log('artifact-failure-logging Test A6: PASS (URL userinfo, Authorization, Bearer, signed-URL query params all redacted)');
}
{
  // multiline stderr (real podman/git output is frequently multi-line) is
  // preserved structurally, not mangled/collapsed, and still bounded.
  const multiline = ['line one', 'line two: the real error', 'line three'].join('\n');
  const log = describeCommandFailure('IMAGE_BUILD', 'podman', ['build'], Object.assign(new Error('injected'), { status: 1, stderr: multiline }));
  assert.equal(log.stderrTail, multiline, 'short multiline stderr survives intact, newlines included');
  console.log('artifact-failure-logging Test A7: PASS (multiline stderr preserved)');
}
{
  // Buffer stderr (execFileSync without an `encoding` option would hand
  // back a Buffer, not a string) must not throw and must not silently
  // vanish -- security-artifact-validator's own run()/runCleanup() always
  // pass encoding:'utf8', so this is defensive for any future caller that
  // omits it.
  const bufError = Object.assign(new Error('injected'), { status: 1, stderr: Buffer.from('buffer stderr content') });
  const log = describeCommandFailure('TRIVY_SCAN', 'trivy', ['image'], bufError);
  assert.ok(log.stderrTail.includes('buffer stderr content'), 'a Buffer stderr value is coerced to text, not dropped');
  console.log('artifact-failure-logging Test A8: PASS (Buffer stderr handled)');
}
{
  // Wildly unusual error shapes (null, a bare string throw, an empty
  // object) must never throw while BUILDING the log -- this function runs
  // inside an already-failing path; it must never itself become a second,
  // masking failure.
  for (const weird of [null, undefined, 'a bare string throw', 42, {}]) {
    assert.doesNotThrow(() => describeCommandFailure('PODMAN_PREFLIGHT', 'podman', ['info'], weird), `Test A9 - describeCommandFailure must not throw for error value: ${JSON.stringify(weird)}`);
  }
  console.log('artifact-failure-logging Test A9: PASS (unusual/missing error values handled safely)');
}

// =====================================================================
// Part B — real TrivyImageArtifactValidator.inspect() end-to-end: proves
// the actual run()/runCleanup() catch blocks invoke the logger, and that
// the EXTERNAL ArtifactRuntimeError contract is byte-for-byte unchanged.
// =====================================================================
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v171-observability-'));
  const repo = path.join(root, 'repo');
  execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });
  const secrets = ['DB_PASS', 'JWT_SECRET', 'N8N_INTERNAL_SECRET', 'GITHUB_TOKEN', 'BUILDER_INTERNAL_SECRET'];
  const saved = Object.fromEntries(secrets.map(k => [k, process.env[k]]));
  for (const key of secrets) process.env[key] = 'synthetic-secret-must-not-reach-log-' + key;

  const originalConsoleError = console.error;
  const captured: string[] = [];
  /** Traite l’erreur reçue et termine le suivi de la demande. */
  console.error = (...a: any[]) => { captured.push(a.map(String).join(' ')); };

  try {
    const adapter = new TrivyImageArtifactValidator((command, args) => {
      if (command === 'podman' && args[0] === 'info') return 'true';
      if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
      if (command === 'podman' && args[0] === 'pull') {
        throw Object.assign(new Error('injected'), { status: 125, stderr: 'Error: initializing source docker://maven:3.8.6-openjdk-11: pinging container registry registry-1.docker.io: connection reset by peer' });
      }
      // buildAttempted is set before the pull loop runs (existing,
      // unrelated behavior), so the post-inspect cleanup block still probes
      // for a temporary image even though `podman build` itself was never
      // reached -- mirror security-artifact-validator.spec.ts's own
      // `imagePresent`-tracking convention so that pre-existing cleanup
      // path doesn't mask the pull failure under test here.
      if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') throw Object.assign(new Error('injected'), { status: 1 });
      throw new Error('Unexpected command in observability test: ' + command + ' ' + args.join(' '));
    });

    let thrown: any;
    try { adapter.inspect(repo); } catch (e) { thrown = e; }

    assert.ok(thrown instanceof ArtifactRuntimeError, 'external contract: still throws ArtifactRuntimeError');
    assert.equal(thrown.code, 'RUNTIME_COMMAND_FAILED', 'external contract: same code as before this phase (proven by the pre-existing security-artifact-validator.spec.ts fault-injection scenario)');
    assert.equal(thrown.stage, 'PODMAN_BASE_IMAGE_PULL', 'external contract: same stage as before this phase');
    assert.equal(thrown.message, 'RUNTIME_COMMAND_FAILED:PODMAN_BASE_IMAGE_PULL', 'external contract: the caller-visible reason string is byte-for-byte unchanged');

    assert.ok(captured.length >= 1, 'a diagnostic log line was actually emitted from the real catch block');
    const logLine = captured.find(l => l.includes('ARTIFACT_COMMAND_FAILURE'));
    assert.ok(logLine, 'the emitted line is the structured ARTIFACT_COMMAND_FAILURE event');
    const parsed = JSON.parse(logLine!);
    assert.equal(parsed.stage, 'PODMAN_BASE_IMAGE_PULL');
    assert.equal(parsed.target, 'maven:3.8.6-openjdk-11', 'the log identifies WHICH image was being pulled -- exactly what execution 2053 could not answer');
    assert.equal(parsed.exitCode, 125, 'the real podman exit code is now observable');
    assert.equal(parsed.classification, 'NON_TIMEOUT');
    assert.ok(parsed.stderrTail.includes('connection reset by peer'), 'the real registry-failure stderr is now observable');

    for (const line of captured) for (const key of secrets) assert.ok(!line.includes('synthetic-secret-must-not-reach-log-' + key), `no log line ever contains the ${key} sentinel value`);

    console.log('artifact-failure-logging Test B1: PASS (real inspect() fault path logs full diagnostic context, external contract unchanged, no secret leakage)');
  } finally {
    console.error = originalConsoleError;
    for (const key of secrets) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('Artifact command failure observability: PASS (9 pure-function scenarios incl. wrapper-vs-exit distinction and stderr redaction + 1 real end-to-end fault-injection scenario)');
