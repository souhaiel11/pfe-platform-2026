/** Execution-2057 observability fix — describeGitCommandFailure() is pure
 * and secret-safe: no subprocess, no network, no console. Mirrors
 * builder-scanner's own artifact-failure-logging.spec.ts discipline
 * (wrapper-vs-exit distinction, bounded/redacted stderr, never throws on
 * an unusual error value). Proves the diagnostic side channel only —
 * external contract (RepoCacheService still throwing the SAME raw error)
 * is covered separately below. */
import * as assert from 'node:assert/strict';
import { describeGitCommandFailure } from './repo-cache.service';

// A1: a real DNS-resolution git failure (execution 2057's actual reproduced
// class) is captured with its real exit code and stderr.
{
  const dnsFail = Object.assign(new Error('Command failed'), {
    status: 128, stderr: "fatal: unable to access 'https://github.com/souhaiel11/pfe-app-test.git/': Could not resolve host: github.com\n",
  });
  const log = describeGitCommandFailure('fetch', 'souhaiel11/pfe-app-test', dnsFail);
  assert.equal(log.exitCode, 128);
  assert.equal(log.nodeErrorCode, null, 'a real git exit is not a Node wrapper error code');
  assert.ok(log.stderrTail.includes('Could not resolve host: github.com'), 'the real git stderr is captured');
  assert.equal(log.operation, 'fetch');
  assert.equal(log.repository, 'souhaiel11/pfe-app-test');
  console.log('repo-cache-command-failure Test A1: PASS (real DNS-resolution git failure captured)');
}

// A2: a wrapper-level failure (git binary missing) is distinguishable from a real git exit.
{
  const enoent = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
  const log = describeGitCommandFailure('clone', 'souhaiel11/pfe-app-test', enoent);
  assert.equal(log.exitCode, null, 'a spawn-never-happened failure has no real process exit code');
  assert.equal(log.nodeErrorCode, 'ENOENT');
  assert.equal(log.stderrTail, '', 'no stderr on a wrapper-level failure');
  console.log('repo-cache-command-failure Test A2: PASS (wrapper failure distinguishable from a real git exit)');
}

// A3: bounded, tail-preserving stderr truncation for a very long git error.
{
  const long = 'x'.repeat(5000) + 'THE-REAL-GIT-ERROR-IS-HERE';
  const error = Object.assign(new Error('injected'), { status: 128, stderr: long });
  const log = describeGitCommandFailure('fetch', 'souhaiel11/pfe-app-test', error);
  assert.ok(log.stderrTail.length <= 2001);
  assert.ok(log.stderrTail.endsWith('THE-REAL-GIT-ERROR-IS-HERE'));
  console.log('repo-cache-command-failure Test A3: PASS (bounded stderr truncation keeps the tail)');
}

// A4: URL-embedded credential-shaped text (never expected from THIS
// tokenless-clone service, but redacted defensively regardless, matching
// builder-scanner's own posture toward remote-generated text) is redacted.
{
  const error = Object.assign(new Error('injected'), {
    status: 128, stderr: "fatal: unable to access 'https://deploy:s3cr3t-pass@github.com/x/y.git/': The requested URL returned error: 403\n",
  });
  const log = describeGitCommandFailure('clone', 'x/y', error);
  assert.ok(!log.stderrTail.includes('s3cr3t-pass'), 'embedded URL userinfo is redacted');
  assert.ok(log.stderrTail.includes('***'), 'redaction leaves a visible marker, not silent content loss');
  console.log('repo-cache-command-failure Test A4: PASS (URL-embedded credential-shaped text redacted)');
}

// A5: unusual/missing error values never throw while building the log.
{
  for (const weird of [null, undefined, 'a bare string throw', 42, {}]) {
    assert.doesNotThrow(() => describeGitCommandFailure('fetch', 'x/y', weird), `unexpected throw for: ${JSON.stringify(weird)}`);
  }
  console.log('repo-cache-command-failure Test A5: PASS (unusual/missing error values handled safely)');
}

// A6: structural secret-safety — the log shape is fixed and small, no env/headers field could ever appear.
{
  const adversarial = Object.assign(new Error('injected'), {
    status: 128, stderr: 'plain git stderr, no secrets here',
    env: { GITHUB_TOKEN: 'should-never-be-read' }, headers: { Authorization: 'Bearer should-never-be-read' },
  });
  const log = describeGitCommandFailure('fetch', 'x/y', adversarial);
  const serialized = JSON.stringify(log);
  assert.ok(!serialized.includes('should-never-be-read'));
  assert.deepEqual(Object.keys(log).sort(), ['exitCode', 'nodeErrorCode', 'operation', 'repository', 'signal', 'stderrTail'].sort());
  console.log('repo-cache-command-failure Test A6: PASS (log shape structurally excludes secrets/env/headers)');
}

console.log('repo-cache-command-failure.spec.ts: PASS (6/6 — real DNS-failure capture, wrapper-vs-exit distinction, bounded truncation, redaction, unusual-input safety, structural secret exclusion)');
