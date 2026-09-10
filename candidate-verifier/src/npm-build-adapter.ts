import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildAdapter, CompileResult } from './build-adapter';
import { RegressionTestResult } from '../../backend/src/candidate-verification/candidate-verification.types';
import { aggregateJestReport } from './jest-json-aggregation';
import { isProcessTimeout } from './process-timeout';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function tail(text: string, maxChars = 20_000): string {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

// Deliberately duplicated: npm has its own strict allowlist, never process.env.
function safeNpmEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'npm_config_cache']) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return env;
}

function runNpm(args: string[], cwd: string, timeoutMs: number): {
  status: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number;
} {
  const start = Date.now();
  try {
    const stdout = execFileSync('npm', args, {
      cwd, timeout: timeoutMs, encoding: 'utf8', env: safeNpmEnv(),
      shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '', timedOut: false, durationMs: Date.now() - start };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const status = typeof err?.status === 'number' ? err.status : null;
    return {
      status,
      stdout: String(err?.stdout ?? ''), stderr: String(err?.stderr ?? err?.message ?? ''),
      timedOut: isProcessTimeout(err, status, durationMs, timeoutMs),
      durationMs,
    };
  }
}

export class NpmBuildAdapter implements BuildAdapter {
  readonly buildType = 'npm';

  supports(workspacePath: string): boolean {
    return fs.existsSync(path.join(workspacePath, 'package.json'));
  }

  compile(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): CompileResult {
    const start = Date.now();
    const finish = (status: CompileResult['status'], exitCode: number | null, evidenceTail: string): CompileResult =>
      ({ status, exitCode, durationMs: Date.now() - start, evidenceTail: tail(evidenceTail) });
    // v1 requires a lock; never fall back to a non-reproducible npm install.
    if (!fs.existsSync(path.join(workspacePath, 'package-lock.json'))
      && !fs.existsSync(path.join(workspacePath, 'npm-shrinkwrap.json'))) {
      return finish('FAILED', null, 'no npm lockfile — refusing non-reproducible install');
    }
    let manifest: any;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf8'));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('expected an object');
    } catch (err: any) {
      return finish('FAILED', null, `invalid/unreadable package.json: ${err.message}`);
    }
    let remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) return finish('FAILED', null, 'WORKSPACE_TIMEOUT before npm ci');
    const install = runNpm(['ci', '--include=dev', '--ignore-scripts'], workspacePath, remaining);
    const installEvidence = `npm ci:\n${install.stdout}\n${install.stderr}`;
    if (install.timedOut) return finish('FAILED', install.status, 'WORKSPACE_TIMEOUT during npm ci');
    if (install.status !== 0) return finish('FAILED', install.status, installEvidence);
    const build = manifest.scripts?.build;
    if (build === undefined) {
      return finish('SUCCESS', 0, `${installEvidence}\ndependencies installed; no build script declared (JS validity NOT proven — tests required)`);
    }
    if (typeof build !== 'string' || build.trim() === '') {
      return finish('FAILED', null, 'invalid package.json scripts.build: expected a non-empty string');
    }
    remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) return finish('FAILED', null, 'WORKSPACE_TIMEOUT before npm run build');
    const result = runNpm(['run', 'build'], workspacePath, remaining);
    if (result.timedOut) return finish('FAILED', result.status, 'WORKSPACE_TIMEOUT during npm run build');
    return finish(result.status === 0 ? 'SUCCESS' : 'FAILED', result.status,
      `${installEvidence}\nnpm run build:\n${result.stdout}\n${result.stderr}`);
  }

  runRegressionTests(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): RegressionTestResult {
    const start = Date.now();
    const unknown = (evidenceRef: string): RegressionTestResult => ({
      status: 'UNKNOWN', total: null, failures: null, errors: null, skipped: null,
      durationMs: Date.now() - start, evidenceRef: tail(evidenceRef, 4000),
    });
    const unsupported = 'unsupported/undetected test runner (v1: Jest only)';
    let scratch: string | undefined;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf8'));
      const test = manifest?.scripts?.test;
      if (typeof test !== 'string' || test.trim() === ''
        || !(test.includes('jest') || manifest?.devDependencies?.jest || manifest?.dependencies?.jest)) {
        return unknown(unsupported);
      }
      const localJest = path.resolve(workspacePath, 'node_modules', '.bin', 'jest');
      if (!fs.existsSync(localJest)) {
        return unknown('Jest declared but not installed locally (node_modules/.bin/jest absent) — refusing global/registry fallback');
      }
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-jest-'));
      const outputFile = path.join(scratch, 'report.json');
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) return unknown('WORKSPACE_TIMEOUT before Jest');
      // Invoke only the project's installed binary: no npm exec/global/registry fallback.
      // Resolve the absolute path so relative workspace paths also work with cwd.
      // This intentionally bypasses scripts.test and its pre/post hooks.
      let result: { status: number | null; stdout: string; stderr: string; timedOut: boolean };
      try {
        const stdout = execFileSync(localJest, ['--ci', '--json', `--outputFile=${outputFile}`], {
          cwd: workspacePath, timeout: remaining, encoding: 'utf8', env: safeNpmEnv(),
          shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        });
        result = { status: 0, stdout, stderr: '', timedOut: false };
      } catch (err: any) {
        result = {
          status: typeof err?.status === 'number' ? err.status : null,
          stdout: String(err?.stdout ?? ''), stderr: String(err?.stderr ?? err?.message ?? ''),
          timedOut: err?.signal === 'SIGTERM' || err?.killed === true,
        };
      }
      if (result.timedOut) return unknown('WORKSPACE_TIMEOUT during Jest');
      const evidence = tail(`Jest direct invocation (scripts.test bypassed):\n${result.stdout}\n${result.stderr}`, 3000);
      const aggregate = aggregateJestReport(outputFile);
      if (aggregate.matchCount === 0) return unknown(`no usable Jest report\n${evidence}`);
      const failures = aggregate.failures + aggregate.errors;
      const completed = (status: 'FAILED' | 'SUCCESS', evidenceRef = evidence): RegressionTestResult => ({
        status, total: aggregate.total, failures, errors: aggregate.errors,
        skipped: aggregate.skipped, durationMs: Date.now() - start, evidenceRef,
      });
      if (aggregate.errors > 0) {
        return completed('FAILED', `test suite(s) failed to load / errored (numFailedTestSuites>0)\n${evidence}`);
      }
      if (aggregate.total === 0) return unknown(`no tests executed (no suite errors)\n${evidence}`);
      if (aggregate.failures > 0) return completed('FAILED');
      if (aggregate.total === aggregate.skipped) {
        return unknown(`only skipped tests\n${evidence}`);
      }
      if (result.status !== 0) return unknown(`jest exit ${result.status} without reported failures\n${evidence}`);
      return completed('SUCCESS');
    } catch (err: any) {
      return unknown(`Jest verification unavailable: ${err.message}`);
    } finally {
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}
