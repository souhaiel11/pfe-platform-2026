import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuildAdapter, CompileResult } from './build-adapter';
import { RegressionTestResult } from '../../backend/src/candidate-verification/candidate-verification.types';
import { aggregatePytestReport } from './pytest-report';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
function tail(text: string, limit = 20_000): string { return text.slice(-limit); }

function safePythonEnv(): NodeJS.ProcessEnv {
  // Never inherit PYTHONPATH, PYTHONHOME, PIP_* or PYTEST_ADDOPTS.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL']) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return env;
}

function runPython(args: string[], cwd: string, timeoutMs: number, binary = 'python3') {
  if (timeoutMs <= 0) return { status: null as number | null, output: '', timedOut: true };
  try {
    const stdout = execFileSync(binary, args, {
      cwd, timeout: timeoutMs, encoding: 'utf8', env: safePythonEnv(),
      shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout, timedOut: false };
  } catch (err: any) {
    return {
      status: typeof err?.status === 'number' ? err.status : null,
      output: String(err?.stdout ?? '') + '\n' + String(err?.stderr ?? err?.message ?? ''),
      timedOut: err?.signal === 'SIGTERM' || err?.killed === true,
    };
  }
}

// v1 convention: conventional application .py files only. Custom pytest
// discovery patterns are not inferred. Never traverse symlinks or dependency dirs.
function applicationSources(root: string): string[] {
  const files: string[] = [];
  const excluded = new Set(['test', 'tests', '__tests__', 'venv', 'env', 'node_modules', '__pycache__', 'site-packages']);
  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) visit(file);
      } else if (entry.isFile() && entry.name.endsWith('.py')
        && !entry.name.startsWith('test_') && !entry.name.endsWith('_test.py')
        && entry.name !== 'conftest.py' && entry.name !== 'setup.py') files.push(file);
    }
  }
  visit(root);
  return files;
}

export class PythonBuildAdapter implements BuildAdapter {
  readonly buildType = 'python';
  // Same instance must run compile then tests. No global or repo-local venv
  // fallback. Successful preparations remain owned here until tests/recompile.
  private readonly venvs = new Map<string, string>();

  supports(workspacePath: string): boolean {
    return fs.existsSync(path.join(workspacePath, 'requirements.txt'));
  }

  compile(workspacePath: string, timeoutMs = DEFAULT_TIMEOUT_MS): CompileResult {
    const start = Date.now();
    const ws = path.resolve(workspacePath);
    let venv: string | undefined;
    let keep = false;
    const finish = (status: 'SUCCESS' | 'FAILED', exitCode: number | null, evidenceTail: string): CompileResult =>
      ({ status, exitCode, durationMs: Date.now() - start, evidenceTail: tail(evidenceTail) });
    try {
      const previous = this.venvs.get(ws);
      if (previous) { fs.rmSync(previous, { recursive: true, force: true }); this.venvs.delete(ws); }
      const requirements = fs.readFileSync(path.join(ws, 'requirements.txt'), 'utf8');
      venv = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-python-'));
      const python = path.join(venv, 'bin', 'python');
      const evidence: string[] = [];
      const steps = [
        { name: 'venv creation', binary: 'python3', args: ['-m', 'venv', venv] },
        { name: 'dependency installation', binary: python, args: ['-m', 'pip', 'install', '-r', 'requirements.txt'] },
      ];
      for (const step of steps) {
        const result = runPython(step.args, ws, timeoutMs - (Date.now() - start), step.binary);
        if (result.timedOut) return finish('FAILED', result.status, `WORKSPACE_TIMEOUT during ${step.name}`);
        evidence.push(`${step.name}:\n${result.output}`);
        if (result.status !== 0) return finish('FAILED', result.status, evidence.join('\n'));
      }
      if (requirements.trim() === '') evidence.push('requirements.txt empty; no dependencies declared');
      const sources = applicationSources(ws);
      // One file per invocation avoids command-line length limits;
      // bytecode is redirected outside the candidate repo.
      for (const source of sources) {
        const result = runPython(['-X', `pycache_prefix=${path.join(venv, 'bytecode')}`,
          '-m', 'compileall', '-q', source], ws, timeoutMs - (Date.now() - start), python);
        if (result.timedOut) return finish('FAILED', result.status, 'WORKSPACE_TIMEOUT during app syntax check');
        if (result.status !== 0) return finish('FAILED', result.status, `app syntax check:\n${result.output}`);
      }
      evidence.push(`app syntax checked: ${sources.length} file(s); conventional test paths excluded`);
      evidence.push('venv created; deps installed; app syntax checked (test bodies/behaviour NOT proven — tests required)');
      this.venvs.set(ws, venv);
      keep = true;
      return finish('SUCCESS', 0, evidence.join('\n'));
    } catch (err: any) {
      return finish('FAILED', null, `Python preparation unavailable: ${err.message}`);
    } finally {
      if (venv && !keep) fs.rmSync(venv, { recursive: true, force: true });
    }
  }

  runRegressionTests(workspacePath: string, timeoutMs = DEFAULT_TIMEOUT_MS): RegressionTestResult {
    const start = Date.now();
    const ws = path.resolve(workspacePath);
    const venv = this.venvs.get(ws);
    const unknown = (evidenceRef: string): RegressionTestResult => ({
      status: 'UNKNOWN', total: null, failures: null, errors: null, skipped: null,
      durationMs: Date.now() - start, evidenceRef: tail(evidenceRef, 4000),
    });
    let reportDir: string | undefined;
    try {
      if (!venv || !fs.existsSync(path.join(venv, 'bin', 'pytest'))) {
        return unknown('pytest not available in venv (v1: pytest only)');
      }
      reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-pytest-'));
      const report = path.join(reportDir, 'report.xml');
      const result = runPython(['-m', 'pytest', `--junitxml=${report}`], ws,
        timeoutMs - (Date.now() - start), path.join(venv, 'bin', 'python'));
      if (result.timedOut) return unknown('WORKSPACE_TIMEOUT during pytest');
      const evidence = tail(result.output, 3000);
      const aggregate = aggregatePytestReport(report);
      if (aggregate.matchCount === 0) return unknown(`no usable pytest report\n${evidence}`);
      const failures = aggregate.failures + aggregate.errors;
      const completed = (status: 'SUCCESS' | 'FAILED', evidenceRef = evidence): RegressionTestResult => ({
        status, total: aggregate.total, failures, errors: aggregate.errors, skipped: aggregate.skipped,
        durationMs: Date.now() - start, evidenceRef,
      });
      if (aggregate.errors > 0) return completed('FAILED', `pytest collection/setup/teardown error(s)\n${evidence}`);
      if (aggregate.total === 0) return unknown(`no tests collected\n${evidence}`);
      if (aggregate.failures > 0) return completed('FAILED');
      if (aggregate.total === aggregate.skipped) return unknown(`only skipped\n${evidence}`);
      if (result.status !== 0) return unknown(`pytest exit ${result.status} without reported failures\n${evidence}`);
      if (aggregate.total <= aggregate.skipped) return unknown(`inconsistent pytest counters\n${evidence}`);
      return completed('SUCCESS');
    } catch (err: any) {
      return unknown(`pytest verification unavailable: ${err.message}`);
    } finally {
      try { if (reportDir) fs.rmSync(reportDir, { recursive: true, force: true }); }
      finally {
        if (venv) { fs.rmSync(venv, { recursive: true, force: true }); this.venvs.delete(ws); }
      }
    }
  }
}
