import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import childProcess = require('node:child_process');
import { PythonBuildAdapter } from './python-build-adapter';

const empty = { status: 'UNKNOWN', total: null, failures: null, errors: null, skipped: null };
const suite = (tests: number, failures = 0, errors = 0, skipped = 0) =>
  `<testsuites><testsuite tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}"/></testsuites>`;
const cases = [
  { name: 'passing test', xml: suite(1), exit: 0,
    expected: { status: 'SUCCESS', total: 1, failures: 0, errors: 0, skipped: 0 }, evidence: '' },
  { name: 'collection error before zero-total check', xml: suite(0, 0, 1), exit: 2,
    expected: { status: 'FAILED', total: 0, failures: 1, errors: 1, skipped: 0 }, evidence: 'collection/setup/teardown' },
  { name: 'zero tests', xml: suite(0), exit: 5, expected: empty, evidence: 'no tests collected' },
  { name: 'test failure even with exit zero', xml: suite(1, 1), exit: 0,
    expected: { status: 'FAILED', total: 1, failures: 1, errors: 0, skipped: 0 }, evidence: '' },
  { name: 'only skipped', xml: suite(1, 0, 0, 1), exit: 0, expected: empty, evidence: 'only skipped' },
  { name: 'nonzero exit without reported failures', xml: suite(1), exit: 3, expected: empty, evidence: 'pytest exit 3' },
  { name: 'unusable report', xml: '<broken', exit: 0, expected: empty, evidence: 'no usable pytest report' },
  { name: 'missing report', xml: null, exit: 0, expected: empty, evidence: 'no usable pytest report' },
  { name: 'timeout overrides report', xml: suite(1), exit: 0, timeout: true, expected: empty, evidence: 'WORKSPACE_TIMEOUT' },
  { name: 'pytest absent in venv', xml: null, exit: 0, absent: true, expected: empty, evidence: 'pytest not available in venv' },
  { name: 'failures include errors once', xml: suite(2, 1, 1), exit: 1,
    expected: { status: 'FAILED', total: 2, failures: 2, errors: 1, skipped: 0 }, evidence: '' },
];
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'python-adapter-spec-'));
const originalExec = childProcess.execFileSync;
try {
  fs.writeFileSync(path.join(ws, 'requirements.txt'), '');
  fs.writeFileSync(path.join(ws, 'app.py'), 'value = 1');
  fs.writeFileSync(path.join(ws, 'test_app.py'), 'broken syntax intentionally excluded');
  fs.writeFileSync(path.join(ws, 'conftest.py'), 'excluded');
  fs.mkdirSync(path.join(ws, 'tests'));
  fs.writeFileSync(path.join(ws, 'tests', 'helper.py'), 'excluded');
  for (const scenario of cases) {
    let venv = '', report = '', testCalls = 0, syntaxCalls = 0;
    childProcess.execFileSync = ((binary: string, args: string[], options: any) => {
      assert.equal(options.shell, false);
      assert.equal(options.cwd, ws);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      const env = {};
      for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL']) if (process.env[key] != null) env[key] = process.env[key];
      assert.deepEqual(options.env, env);
      if (args[1] === 'venv') {
        assert.equal(binary, 'python3');
        venv = args[2];
        assert.ok(path.relative(ws, venv).startsWith('..'));
        fs.mkdirSync(path.join(venv, 'bin'));
        if (!scenario.absent) fs.writeFileSync(path.join(venv, 'bin', 'pytest'), 'placeholder');
      } else {
        assert.equal(binary, path.join(venv, 'bin', 'python'));
        if (args[1] === 'pip') {
          assert.deepEqual(args, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
        } else if (args.includes('compileall')) {
          syntaxCalls++;
          assert.equal(args[args.length - 1], path.join(ws, 'app.py'));
        } else {
          testCalls++;
          report = args[2].slice('--junitxml='.length);
          assert.deepEqual(args, ['-m', 'pytest', `--junitxml=${report}`]);
          assert.equal(fs.existsSync(report), false);
          if (scenario.xml !== null) fs.writeFileSync(report, scenario.xml);
          if (scenario.timeout) throw { signal: 'SIGTERM', status: null };
          if (scenario.exit !== 0) throw { status: scenario.exit, stderr: 'synthetic diagnostics' };
        }
      }
      return '';
    }) as typeof childProcess.execFileSync;
    const adapter = new PythonBuildAdapter();
    assert.equal(adapter.supports(ws), true);
    const compile = adapter.compile(ws);
    assert.equal(compile.status, 'SUCCESS', compile.evidenceTail);
    assert.equal(compile.exitCode, 0);
    assert.match(compile.evidenceTail, /requirements.txt empty/);
    assert.equal(syntaxCalls, 1);
    assert.equal(fs.existsSync(venv), true, 'venv retained until tests');
    const { durationMs, evidenceRef, ...result } = adapter.runRegressionTests(ws);
    assert.deepEqual(result, scenario.expected, scenario.name);
    assert.ok(evidenceRef.includes(scenario.evidence));
    assert.ok(durationMs >= 0);
    assert.equal(testCalls, scenario.absent ? 0 : 1);
    assert.equal(fs.existsSync(venv), false, 'venv cleaned even on UNKNOWN');
    if (report) assert.equal(fs.existsSync(path.dirname(report)), false);
    console.log(`PASS: ${scenario.name}`);
  }
  // Preparation failure must clean its venv without any test invocation.
  let failedVenv = '';
  childProcess.execFileSync = ((binary: string, args: string[]) => {
    if (args[1] === 'venv') { failedVenv = args[2]; return ''; }
    throw { status: 7, stderr: 'synthetic pip failure' };
  }) as typeof childProcess.execFileSync;
  const failure = new PythonBuildAdapter().compile(ws);
  assert.equal(failure.status, 'FAILED');
  assert.equal(failure.exitCode, 7);
  assert.equal(fs.existsSync(failedVenv), false);
  console.log('PASS: install failure preserves exit code and cleans venv');
} finally {
  childProcess.execFileSync = originalExec;
  fs.rmSync(ws, { recursive: true, force: true });
}
console.log('python-build-adapter: PASS (12 synthetic cases; no Python/pytest execution)');
