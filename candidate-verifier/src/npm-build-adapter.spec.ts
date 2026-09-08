import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import childProcess = require('node:child_process');
import { NpmBuildAdapter } from './npm-build-adapter';

const green = { numTotalTests: 3, numFailedTests: 0, numPassedTests: 3,
  numPendingTests: 0, numFailedTestSuites: 0 };
const unknown = { status: 'UNKNOWN', total: null, failures: null, errors: null, skipped: null };
const cases = [
  { name: 'loading error with zero tests overrides empty-run UNKNOWN',
    report: { ...green, numTotalTests: 0, numPassedTests: 0, numFailedTestSuites: 1 }, exit: 1,
    expected: { status: 'FAILED', total: 0, failures: 1, errors: 1, skipped: 0 },
    evidence: 'test suite(s) failed to load / errored (numFailedTestSuites>0)' },
  { name: 'zero tests without suite errors is UNKNOWN',
    report: { ...green, numTotalTests: 0, numPassedTests: 0 }, exit: 0,
    expected: unknown, evidence: 'no tests executed (no suite errors)' },
  { name: 'individual test failure overrides even exit zero',
    report: { ...green, numFailedTests: 1, numPassedTests: 2, numFailedTestSuites: 1 }, exit: 0,
    expected: { status: 'FAILED', total: 3, failures: 1, errors: 0, skipped: 0 }, evidence: '' },
  { name: 'only skipped tests is UNKNOWN',
    report: { ...green, numPassedTests: 0, numPendingTests: 3 }, exit: 0,
    expected: unknown, evidence: 'only skipped tests' },
  { name: 'nonzero exit without reported failures is UNKNOWN', report: green, exit: 2,
    expected: unknown, evidence: 'jest exit 2 without reported failures' },
  { name: 'executed passing tests and exit zero is SUCCESS', report: green, exit: 0,
    expected: { status: 'SUCCESS', total: 3, failures: 0, errors: 0, skipped: 0 }, evidence: '' },
  { name: 'suite errors and individual failures are added once',
    report: { ...green, numFailedTests: 1, numPassedTests: 2, numFailedTestSuites: 2 }, exit: 0,
    expected: { status: 'FAILED', total: 3, failures: 2, errors: 1, skipped: 0 },
    evidence: 'test suite(s) failed to load / errored (numFailedTestSuites>0)' },
  { name: 'unusable report is UNKNOWN', report: {}, exit: 0,
    expected: unknown, evidence: 'no usable Jest report' },
];

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-adapter-decision-spec-'));
const originalExec = childProcess.execFileSync;
try {
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
  let absentCalls = 0;
  childProcess.execFileSync = (() => {
    absentCalls++;
    throw new Error('No subprocess may run without local Jest');
  }) as typeof childProcess.execFileSync;
  const absent = new NpmBuildAdapter().runRegressionTests(workspace);
  const { durationMs: absentDuration, evidenceRef: absentEvidence, ...absentResult } = absent;
  assert.deepEqual(absentResult, unknown);
  assert.equal(absentEvidence, 'Jest declared but not installed locally (node_modules/.bin/jest absent) — refusing global/registry fallback');
  assert.ok(absentDuration >= 0);
  assert.equal(absentCalls, 0, 'missing local Jest must never invoke a subprocess');
  console.log('PASS: local Jest absent -> UNKNOWN; zero subprocess calls');
  const localJest = path.join(workspace, 'node_modules', '.bin', 'jest');
  fs.mkdirSync(path.dirname(localJest), { recursive: true });
  fs.writeFileSync(localJest, 'synthetic placeholder; never executed');
  for (const scenario of cases) {
    let calls = 0;
    let outputFile = '';
    // Replace the subprocess boundary: no npm, npx or Jest process can run.
    childProcess.execFileSync = ((file: string, args: string[], options: any) => {
      calls++;
      assert.equal(file, localJest, 'invoke the project binary directly');
      assert.equal(options.shell, false);
      assert.equal(options.cwd, workspace);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      const expectedEnv = {};
      for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'npm_config_cache']) {
        if (process.env[key] != null) expectedEnv[key] = process.env[key];
      }
      assert.deepEqual(options.env, expectedEnv, 'strict environment allowlist');
      outputFile = args.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
      assert.deepEqual(args, ['--ci', '--json', `--outputFile=${outputFile}`]);
      assert.equal(fs.existsSync(outputFile), false, 'report must be fresh');
      assert.ok(path.relative(workspace, outputFile).startsWith('..'), 'report outside workspace');
      fs.writeFileSync(outputFile, JSON.stringify(scenario.report));
      if (scenario.exit !== 0) throw Object.assign(new Error('simulated exit'),
        { status: scenario.exit, stdout: '', stderr: 'synthetic diagnostics' });
      return '';
    }) as typeof childProcess.execFileSync;
    const result = new NpmBuildAdapter().runRegressionTests(workspace);
    const { durationMs, evidenceRef, ...actual } = result;
    assert.deepEqual(actual, scenario.expected, scenario.name);
    assert.ok(evidenceRef.includes(scenario.evidence), scenario.name);
    assert.ok(durationMs >= 0, scenario.name);
    assert.equal(calls, 1, scenario.name);
    assert.equal(fs.existsSync(path.dirname(outputFile)), false, 'temporary report directory cleaned');
    console.log(`PASS: ${scenario.name}`);
  }
} finally {
  childProcess.execFileSync = originalExec;
  fs.rmSync(workspace, { recursive: true, force: true });
}
console.log('npm-build-adapter decision: PASS (9 synthetic cases; no real subprocess)');
