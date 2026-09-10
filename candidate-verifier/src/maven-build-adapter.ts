// R22-C — Maven build adapter. Only build type proven safe this phase (R22-B
// Phase 6 audit); the interface (build-adapter.ts) is generic so Gradle/npm
// can follow later without touching the orchestrating service.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BuildAdapter, CompileResult } from './build-adapter';
import { RegressionTestResult } from '../../backend/src/candidate-verification/candidate-verification.types';
import { aggregateSurefireReports } from './surefire-aggregation';
import { isProcessTimeout } from './process-timeout';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const EVIDENCE_TAIL_CHARS = 20_000;

function tail(text: string, maxChars = EVIDENCE_TAIL_CHARS): string {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

/**
 * Deliberately NOT `...process.env`: this backend process's own env holds
 * DB_PASS/JWT_SECRET/etc. A Maven subprocess compiling/testing candidate
 * code has no legitimate need to see them, and "no secret values in stored
 * evidence" is easiest to guarantee by never handing them to the child
 * process in the first place.
 */
function safeMavenEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'JAVA_HOME', 'M2_HOME', 'MAVEN_HOME', 'MAVEN_OPTS', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] != null) env[key] = process.env[key];
  return env;
}

function runMaven(args: string[], cwd: string, timeoutMs: number): { status: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number } {
  const start = Date.now();
  try {
    const stdout = execFileSync('mvn', args, {
      cwd, timeout: timeoutMs, encoding: 'utf8', env: safeMavenEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '', timedOut: false, durationMs: Date.now() - start };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const status = typeof err?.status === 'number' ? err.status : null;
    const timedOut = isProcessTimeout(err, status, durationMs, timeoutMs);
    return {
      status,
      stdout: String(err?.stdout ?? ''), stderr: String(err?.stderr ?? ''),
      timedOut, durationMs,
    };
  }
}

export class MavenBuildAdapter implements BuildAdapter {
  readonly buildType = 'maven';

  supports(workspacePath: string): boolean {
    return fs.existsSync(path.join(workspacePath, 'pom.xml'));
  }

  compile(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): CompileResult {
    const result = runMaven(['-q', 'compile'], workspacePath, timeoutMs);
    if (result.timedOut) {
      return { status: 'FAILED', exitCode: result.status, durationMs: result.durationMs, evidenceTail: 'WORKSPACE_TIMEOUT during mvn compile' };
    }
    return {
      status: result.status === 0 ? 'SUCCESS' : 'FAILED',
      exitCode: result.status,
      durationMs: result.durationMs,
      evidenceTail: tail(result.stdout + '\n' + result.stderr),
    };
  }

  runRegressionTests(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): RegressionTestResult {
    const result = runMaven(['test', '-B'], workspacePath, timeoutMs);
    if (result.timedOut) {
      return { status: 'UNKNOWN', total: null, failures: null, errors: null, skipped: null, durationMs: result.durationMs, evidenceRef: 'WORKSPACE_TIMEOUT during mvn test' };
    }
    const aggregate = aggregateSurefireReports(workspacePath);
    if (aggregate.matchCount === 0) {
      // Tests were supposed to run but no usable Surefire output was found
      // (e.g. compile-then-test failed before Surefire ever wrote a
      // report) -- honest UNKNOWN, never a fabricated 0/PASS, same rule as
      // BuildRunner.groovy.
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
