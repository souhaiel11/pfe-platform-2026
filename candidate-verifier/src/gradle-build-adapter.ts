// R22 (Gradle adapter) — calqued 1:1 on maven-build-adapter.ts. Same
// BuildAdapter interface, same behavioural contracts (timeout -> 'FAILED' with
// a 'WORKSPACE_TIMEOUT'-tagged evidence string for compile / 'UNKNOWN' for
// tests; matchCount 0 -> honest UNKNOWN, never a fabricated 0/PASS;
// failures = failures + errors, errors kept separately).
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BuildAdapter, CompileResult } from './build-adapter';
import { RegressionTestResult } from '../../backend/src/candidate-verification/candidate-verification.types';
import { aggregateJunitReports } from './junit-aggregation';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const EVIDENCE_TAIL_CHARS = 20_000;

function tail(text: string, maxChars = EVIDENCE_TAIL_CHARS): string {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

/**
 * Deliberately NOT `...process.env` -- same rule as safeMavenEnv(): a Gradle
 * subprocess compiling/testing candidate code has no legitimate need to see
 * this process's DB_PASS/JWT_SECRET/etc, and "no secret values in stored
 * evidence" is easiest to guarantee by never handing them to the child.
 * Duplicated on purpose (no shared base with Maven for now) -- the keep lists
 * genuinely differ (GRADLE_USER_HOME/GRADLE_OPTS vs M2_HOME/MAVEN_*).
 */
function safeGradleEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'JAVA_HOME', 'LANG', 'LC_ALL', 'GRADLE_USER_HOME', 'GRADLE_OPTS'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] != null) env[key] = process.env[key];
  return env;
}

/** './gradlew' when it exists AND is executable, otherwise the 'gradle' on PATH. */
function resolveGradleBinary(cwd: string): string {
  const wrapper = path.join(cwd, 'gradlew');
  try {
    fs.accessSync(wrapper, fs.constants.X_OK);
    return wrapper;
  } catch {
    return 'gradle';
  }
}

function runGradle(args: string[], cwd: string, timeoutMs: number): { status: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number } {
  const bin = resolveGradleBinary(cwd);
  // Always run with plain console output; idempotent if the caller already passed it.
  const fullArgs = args.includes('--console=plain') ? args : [...args, '--console=plain'];
  const start = Date.now();
  try {
    const stdout = execFileSync(bin, fullArgs, {
      cwd, timeout: timeoutMs, encoding: 'utf8', env: safeGradleEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '', timedOut: false, durationMs: Date.now() - start };
  } catch (err: any) {
    const timedOut = err?.signal === 'SIGTERM' || err?.killed === true;
    return {
      status: typeof err?.status === 'number' ? err.status : null,
      stdout: String(err?.stdout ?? ''), stderr: String(err?.stderr ?? ''),
      timedOut, durationMs: Date.now() - start,
    };
  }
}

export class GradleBuildAdapter implements BuildAdapter {
  readonly buildType = 'gradle';

  supports(workspacePath: string): boolean {
    return fs.existsSync(path.join(workspacePath, 'build.gradle'))
      || fs.existsSync(path.join(workspacePath, 'build.gradle.kts'));
  }

  compile(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): CompileResult {
    const result = runGradle(['compileJava', '--console=plain'], workspacePath, timeoutMs);
    if (result.timedOut) {
      return { status: 'FAILED', exitCode: result.status, durationMs: result.durationMs, evidenceTail: 'WORKSPACE_TIMEOUT during gradle compileJava' };
    }
    return {
      status: result.status === 0 ? 'SUCCESS' : 'FAILED',
      exitCode: result.status,
      durationMs: result.durationMs,
      evidenceTail: tail(result.stdout + '\n' + result.stderr),
    };
  }

  runRegressionTests(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): RegressionTestResult {
    const result = runGradle(['test', '--console=plain'], workspacePath, timeoutMs);
    if (result.timedOut) {
      return { status: 'UNKNOWN', total: null, failures: null, errors: null, skipped: null, durationMs: result.durationMs, evidenceRef: 'WORKSPACE_TIMEOUT during gradle test' };
    }
    const aggregate = aggregateJunitReports(workspacePath);
    if (aggregate.matchCount === 0) {
      // Tests were supposed to run but no usable JUnit XML was found (e.g.
      // compile-then-test failed before any report was written) -- honest
      // UNKNOWN, never a fabricated 0/PASS, same rule as MavenBuildAdapter
      // and BuildRunner.groovy.
      return { status: 'UNKNOWN', total: null, failures: null, errors: null, skipped: null, durationMs: result.durationMs, evidenceRef: tail(result.stdout + '\n' + result.stderr, 4000) };
    }
    const totalFailures = aggregate.failures + aggregate.errors;
    return {
      status: totalFailures > 0 ? 'FAILED' : 'SUCCESS',
      total: aggregate.total, failures: totalFailures, errors: aggregate.errors, skipped: aggregate.skipped,
      durationMs: result.durationMs,
      evidenceRef: tail(result.stdout + '\n' + result.stderr, 4000),
    };
  }
}
