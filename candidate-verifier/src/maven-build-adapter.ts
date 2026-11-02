// Compile et teste les projets Maven dans un espace isolé.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BuildAdapter, CompileResult } from './build-adapter';
import { RegressionTestResult } from '../../backend/src/candidate-verification/candidate-verification.types';
import { aggregateSurefireReports } from './surefire-aggregation';
import { isProcessTimeout } from './process-timeout';
import { redactSensitiveStderr } from './repo-cache.service';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const EVIDENCE_TAIL_CHARS = 20_000;

/** Conserve les dernières lignes du journal. */
function tail(text: string, maxChars = EVIDENCE_TAIL_CHARS): string {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

const TIMEOUT_EVIDENCE_MAX_LINES = 40;

/** Extrait les dernières lignes utiles au diagnostic. */
function tailLines(text: string, maxLines: number): string {
  const lines = text.split('\n').filter(l => l.length > 0);
  return (lines.length <= maxLines ? lines : lines.slice(-maxLines)).join('\n');
}

export interface MavenTimeoutEvidence {
  /** The last "Downloading from <repoId>: <url>" / "Downloaded from …"
   *  line found (stdout checked first, then stderr) -- Maven's own,
   *  well-known transport-log wording. null if no such line was ever
   *  captured (e.g. the process was killed before any real transport
   *  activity, or output was empty for another reason -- never guessed). */
  lastArtifact: string | null;
  /** A LOWER BOUND, not an exact count: repeated "Downloading from" starts
   *  for the same URL without an interleaved "Downloaded from", plus any
   *  line matching a known retry/reset keyword. Different Maven/resolver
   *  versions or verbosity levels can phrase this differently -- this is a
   *  heuristic over Maven's own real wording, not a guarantee. */
  retryCount: number;
  stdoutTail: string;
  stderrTail: string;
}

const ARTIFACT_TRANSFER_LINE = /^Download(?:ing|ed) from ([^:]+): (\S+)/;
const RETRY_KEYWORDS = /\b(retry|retrying|connection reset|could not transfer)\b/i;

/** Retrouve l’artefact Maven mentionné dans la sortie du build. */
function lastArtifactFrom(text: string): string | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = ARTIFACT_TRANSFER_LINE.exec(lines[i].trim());
    if (m) return `${m[1]}: ${m[2]}`;
  }
  return null;
}

/** Relance nombre depuis. */
function retryCountFrom(text: string): number {
  const startedCounts = new Map<string, number>();
  let retries = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const starting = /^Downloading from [^:]+: (\S+)/.exec(line);
    if (starting) {
      const n = (startedCounts.get(starting[1]) ?? 0) + 1;
      startedCounts.set(starting[1], n);
      if (n > 1) retries++;
      continue;
    }
    if (RETRY_KEYWORDS.test(line)) retries++;
  }
  return retries;
}

/** Construit les preuves du dépassement de délai Maven. */
function mavenTimeoutEvidence(rawStdout: string, rawStderr: string): MavenTimeoutEvidence {
  const stdout = redactSensitiveStderr(rawStdout);
  const stderr = redactSensitiveStderr(rawStderr);
  return {
    lastArtifact: lastArtifactFrom(stdout) ?? lastArtifactFrom(stderr),
    retryCount: retryCountFrom(stdout) + retryCountFrom(stderr),
    stdoutTail: tailLines(stdout, TIMEOUT_EVIDENCE_MAX_LINES),
    stderrTail: tailLines(stderr, TIMEOUT_EVIDENCE_MAX_LINES),
  };
}

/** Formate délai dépassé preuve fin du journal. */
function formatTimeoutEvidenceTail(goal: string, durationMs: number, budgetMs: number, evidence: MavenTimeoutEvidence): string {
  return tail([
    `WORKSPACE_TIMEOUT during mvn ${goal} (after ${durationMs}ms, budget ${budgetMs}ms)`,
    `LAST_ARTIFACT: ${evidence.lastArtifact ?? 'unknown (no transport-log line captured)'}`,
    `RETRY_COUNT (lower bound): ${evidence.retryCount}`,
    '--- stdout tail ---', evidence.stdoutTail || '(empty)',
    '--- stderr tail ---', evidence.stderrTail || '(empty)',
  ].join('\n'));
}

/** Prépare le résultat lié à sûr Maven environnement. */
function safeMavenEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'JAVA_HOME', 'M2_HOME', 'MAVEN_HOME', 'MAVEN_OPTS', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] != null) env[key] = process.env[key];
  return env;
}

/** Exécute Maven avec les paramètres et délais prévus. */
function runMaven(args: string[], cwd: string, timeoutMs: number): { status: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number } {
  const start = Date.now();
  try {
    const stdout = execFileSync('mvn', args, {
      // killSignal SIGKILL (not the default SIGTERM): a stuck/ignoring JVM
      // must not be able to outlive its own timeout window -- same
      // termination discipline as TrivyImageArtifactValidator's run().
      cwd, timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8', env: safeMavenEnv(), stdio: ['ignore', 'pipe', 'pipe'],
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

const OFFLINE_MISSING_ARTIFACT = /Cannot access \S+ \([^)]*\) in offline mode and the artifact (\S+) has not been downloaded from it before/g;

export interface OfflineResolutionFailure {
  code: 'DEPENDENCY_NOT_IN_CACHE';
  /** Every distinct GAV Maven itself named, in first-seen order. */
  missingArtifacts: string[];
  /** The LAST one named -- empirically (real reproduction, this file's own
   *  spec) this is the artifact tied to Maven's final "[ERROR] Failed to
   *  execute goal..." summary line, not merely the first thing warned
   *  about while resolving unrelated lifecycle plugins. A heuristic over
   *  Maven's own real wording and internal resolution order, not a
   *  language-level guarantee. */
  primaryMissingArtifact: string;
}

/** Détecte un échec de résolution des dépendances hors ligne. */
function offlineResolutionFailureFrom(text: string): OfflineResolutionFailure | null {
  const seen: string[] = [];
  OFFLINE_MISSING_ARTIFACT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OFFLINE_MISSING_ARTIFACT.exec(text))) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen.length === 0 ? null : { code: 'DEPENDENCY_NOT_IN_CACHE', missingArtifacts: seen, primaryMissingArtifact: seen[seen.length - 1] };
}

// Warm-up transport failures are infrastructure evidence. Unknown failures
// stay ambiguous; absence of one of these signatures never proves health.
const NETWORK_FAILURE_SIGNATURES: RegExp[] = [
  /connection reset/i,
  /connect(?:ion)? timed[- ]?out/i,
  /read timed out/i,
  /unknownhostexception/i,
  /no route to host/i,
  /unexpected end of file/i,
  /premature eof/i,
  /network is unreachable/i,
  /temporary failure in name resolution/i,
];

export interface WarmupNetworkFailure {
  code: 'WARMUP_NETWORK_FAILURE';
  matchedSignature: string;
  detail: string;
}

/** Détecte une panne réseau pendant la préparation Maven. */
function warmupNetworkFailureFrom(text: string): WarmupNetworkFailure | null {
  for (const pattern of NETWORK_FAILURE_SIGNATURES) {
    const m = pattern.exec(text);
    if (m) return { code: 'WARMUP_NETWORK_FAILURE', matchedSignature: pattern.source, detail: tail(m[0], 200) };
  }
  return null;
}

export interface WarmupResult {
  status: 'SUCCESS' | 'FAILED';
  exitCode: number | null;
  durationMs: number;
  evidenceTail: string;
  /** Infrastructure evidence; a successful offline probe may still proceed. */
  timedOut: boolean;
  networkFailure?: WarmupNetworkFailure;
  /** Positive not-found evidence from online resolution, NOT inferred from
   * absence of a network signature. Cached negatives remain ambiguous. */
  resolutionFailure?: { code: 'ARTIFACT_NOT_FOUND'; artifact: string };
  timeoutEvidence?: MavenTimeoutEvidence;
}

/** Classe le résultat de préparation des dépendances Maven. */
function warmupResultFrom(r: ReturnType<typeof runMaven>, budgetMs: number): WarmupResult {
  const combined = redactSensitiveStderr(r.stdout + '\n' + r.stderr);
  const networkFailure = r.status !== 0 && !r.timedOut ? warmupNetworkFailureFrom(combined) ?? undefined : undefined;
  // A fresh resolver not-found result is a positive non-network diagnosis.
  // Never promote cached negatives, transfer/auth/TLS errors, or an arbitrary
  // failure with no recognized network signature to a healthy warm-up.
  const notFound = /Could not find artifact ([^\s]+) in [^\s]+ \([^)]+\)/.exec(combined);
  const ambiguousTransport = /could not transfer|failed to transfer|cached in the local repository|failure was cached|\b(?:401|403|407|429|5\d\d)\b|SSL|PKIX|handshake|unauthorized|forbidden/i.test(combined);
  const errorLines = combined.split('\n').filter(line => line.startsWith('[ERROR]'));
  const terminalNotFound = errorLines.some(line => line.includes('Failed to execute goal') && /Could not find artifact/.test(line));
  const unknownError = errorLines.some(line => !/Could not find artifact|^\[ERROR\]\s*$|To see the full stack trace|Re-run Maven|For more information|^\[ERROR\] \[Help \d+\]/.test(line));
  const timeoutEvidence = r.timedOut ? mavenTimeoutEvidence(r.stdout, r.stderr) : undefined;
  return {
    status: r.status === 0 ? 'SUCCESS' : 'FAILED',
    exitCode: r.status, durationMs: r.durationMs, timedOut: r.timedOut,
    evidenceTail: r.timedOut
      ? formatTimeoutEvidenceTail('dependency warm-up', r.durationMs, budgetMs, timeoutEvidence!)
      : tail(combined),
    networkFailure, timeoutEvidence,
    resolutionFailure: r.status === 1 && !r.timedOut && !networkFailure && !ambiguousTransport && terminalNotFound && !unknownError && notFound
      ? { code: 'ARTIFACT_NOT_FOUND', artifact: notFound[1] } : undefined,
  };
}

export interface DependencyTreeResult {
  status: 'SUCCESS' | 'FAILED';
  text: string | null;
  evidenceTail: string;
  timedOut: boolean;
  /** Present only when timedOut -- structured, machine-checkable form of
   *  the same evidence folded into evidenceTail's free text. */
  timeoutEvidence?: MavenTimeoutEvidence;
  /** Present only when called with options.offline and Maven's own
   *  "has not been downloaded from it before" signature was matched. */
  offlineFailure?: OfflineResolutionFailure;
}

export interface SecurityPackageResult {
  status: 'SUCCESS' | 'FAILED';
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  evidenceTail: string;
  /** True only when at least one Surefire "Tests run:" summary was actually
   *  found -- never inferred from a successful exit code alone (a project
   *  with zero test classes still exits 0, but must never be reported as
   *  testsExecuted=true). */
  testsExecuted: boolean;
  /** null exactly when testsExecuted is false -- there is nothing to have
   *  passed or failed. Never true/false as a stand-in for "unknown". */
  testsPassed: boolean | null;
  testsTotal: number | null;
  testsFailures: number | null;
  testsErrors: number | null;
  testsSkipped: number | null;
}

export class MavenBuildAdapter implements BuildAdapter {
  readonly buildType = 'maven';

  /** Construit le paquet du candidat avec ses paramètres de test. */
  packageCandidate(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): CompileResult {
    const r = runMaven(['clean', 'package', '-DskipTests', '-B'], workspacePath, timeoutMs);
    return { status: r.status === 0 ? 'SUCCESS' : 'FAILED', exitCode: r.status, durationMs: r.durationMs,
      evidenceTail: tail(r.stdout + '\n' + r.stderr) };
  }

  /** Prépare le résultat lié à package candidat avec tests. */
  packageCandidateWithTests(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): SecurityPackageResult {
    const r = runMaven(['clean', 'package', '-B'], workspacePath, timeoutMs);
    if (r.timedOut) {
      const timeoutEvidence = mavenTimeoutEvidence(r.stdout, r.stderr);
      return {
        status: 'FAILED', exitCode: r.status, durationMs: r.durationMs, timedOut: true,
        evidenceTail: formatTimeoutEvidenceTail('clean package (with tests)', r.durationMs, timeoutMs, timeoutEvidence),
        testsExecuted: false, testsPassed: null, testsTotal: null, testsFailures: null, testsErrors: null, testsSkipped: null,
      };
    }
    const combined = redactSensitiveStderr(r.stdout + '\n' + r.stderr);
    const aggregate = aggregateSurefireReports(workspacePath);
    const testsExecuted = aggregate.matchCount > 0;
    const testsFailedCount = aggregate.failures + aggregate.errors;
    return {
      status: r.status === 0 ? 'SUCCESS' : 'FAILED', exitCode: r.status, durationMs: r.durationMs, timedOut: false,
      evidenceTail: tail(combined),
      testsExecuted,
      testsPassed: testsExecuted ? testsFailedCount === 0 : null,
      testsTotal: testsExecuted ? aggregate.total : null,
      testsFailures: testsExecuted ? aggregate.failures : null,
      testsErrors: testsExecuted ? aggregate.errors : null,
      testsSkipped: testsExecuted ? aggregate.skipped : null,
    };
  }

  /** Produit le POM effectif pour établir les versions Maven. */
  effectivePom(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): DependencyTreeResult {
    const output = path.join(workspacePath, '.pfe-effective-pom.xml');
    const r = runMaven(['help:effective-pom', '-Dverbose', '-B', '-Doutput=' + output], workspacePath, timeoutMs);
    try {
      if (r.status !== 0) return { status: 'FAILED', text: null, evidenceTail: tail(r.stdout + r.stderr), timedOut: r.timedOut };
      return { status: 'SUCCESS', text: fs.readFileSync(output, 'utf8'), evidenceTail: '', timedOut: false };
    } finally { try { fs.unlinkSync(output); } catch {} }
  }

  /** Indique si cet adaptateur prend en charge les données. */
  supports(workspacePath: string): boolean {
    return fs.existsSync(path.join(workspacePath, 'pom.xml'));
  }

  /** Indique si ce mode est pris en charge. */
  supportsMode(): boolean { return true; }

  /** Compile le projet dans le délai disponible. */
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

  /** Compile les tests du projet. */
  compileTests(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): CompileResult {
    const result = runMaven(['-q', 'test-compile'], workspacePath, timeoutMs);
    if (result.timedOut) return { status: 'FAILED', exitCode: result.status, durationMs: result.durationMs, evidenceTail: 'WORKSPACE_TIMEOUT during mvn test-compile' };
    return { status: result.status === 0 ? 'SUCCESS' : 'FAILED', exitCode: result.status,
      durationMs: result.durationMs, evidenceTail: tail(result.stdout + '\n' + result.stderr) };
  }

  /** Exécute les tests pour détecter les régressions. */
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

  /** Prépare le résultat lié à dépendance arbre. */
  dependencyTree(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS, options: { offline?: boolean } = {}): DependencyTreeResult {
    const outputFile = path.join(workspacePath, '.pfe-dependency-tree-output.txt');
    const args = ['dependency:tree', '-B', `-DoutputFile=${outputFile}`, '-DoutputType=text'];
    if (options.offline) args.unshift('-o');
    const result = runMaven(args, workspacePath, timeoutMs);
    if (result.timedOut) {
      const timeoutEvidence = mavenTimeoutEvidence(result.stdout, result.stderr);
      return {
        status: 'FAILED', text: null, timedOut: true, timeoutEvidence,
        evidenceTail: formatTimeoutEvidenceTail('dependency:tree', result.durationMs, timeoutMs, timeoutEvidence),
      };
    }
    if (result.status !== 0) {
      const combined = redactSensitiveStderr(result.stdout + '\n' + result.stderr);
      const offlineFailure = options.offline ? offlineResolutionFailureFrom(combined) ?? undefined : undefined;
      return { status: 'FAILED', text: null, evidenceTail: tail(combined), timedOut: false, offlineFailure };
    }
    try {
      const text = fs.readFileSync(outputFile, 'utf8');
      return { status: 'SUCCESS', text, evidenceTail: tail(redactSensitiveStderr(result.stdout + '\n' + result.stderr)), timedOut: false };
    } catch {
      return { status: 'FAILED', text: null, evidenceTail: tail(redactSensitiveStderr(result.stdout + '\n' + result.stderr) + '\nmvn dependency:tree exited 0 but the output file was not written'), timedOut: false };
    } finally {
      try { fs.unlinkSync(outputFile); } catch { /* best-effort; the whole worktree is removed by WorkspaceManager regardless */ }
    }
  }

  /** Prépare le résultat lié à dépendance Go Offline. */
  dependencyGoOffline(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): WarmupResult {
    return warmupResultFrom(runMaven(['dependency:go-offline', '-B'], workspacePath, timeoutMs), timeoutMs);
  }

  /** Résout artefact. */
  resolveArtifact(cwd: string, gav: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): WarmupResult {
    return warmupResultFrom(runMaven(['dependency:get', '-B', `-Dartifact=${gav}`, '-Dtransitive=false'], cwd, timeoutMs), timeoutMs);
  }
}
