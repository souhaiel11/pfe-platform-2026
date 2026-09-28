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
import { redactSensitiveStderr } from './repo-cache.service';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const EVIDENCE_TAIL_CHARS = 20_000;

function tail(text: string, maxChars = EVIDENCE_TAIL_CHARS): string {
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

// Execution-2058 traceability fix — a timed-out `mvn dependency:tree` used
// to leave ZERO forensic trail beyond total elapsed duration (see
// dependencyTree()'s own comment below). Bounded to the last N lines
// (never unbounded), and redacted with the SAME discipline
// repo-cache.service.ts already applies to git's own remote-controlled
// text -- Maven's resolver output is equally not content this process
// controls the shape of.
const TIMEOUT_EVIDENCE_MAX_LINES = 40;

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

function lastArtifactFrom(text: string): string | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = ARTIFACT_TRANSFER_LINE.exec(lines[i].trim());
    if (m) return `${m[1]}: ${m[2]}`;
  }
  return null;
}

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

function formatTimeoutEvidenceTail(goal: string, durationMs: number, budgetMs: number, evidence: MavenTimeoutEvidence): string {
  return tail([
    `WORKSPACE_TIMEOUT during mvn ${goal} (after ${durationMs}ms, budget ${budgetMs}ms)`,
    `LAST_ARTIFACT: ${evidence.lastArtifact ?? 'unknown (no transport-log line captured)'}`,
    `RETRY_COUNT (lower bound): ${evidence.retryCount}`,
    '--- stdout tail ---', evidence.stdoutTail || '(empty)',
    '--- stderr tail ---', evidence.stderrTail || '(empty)',
  ].join('\n'));
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

// CORRECTIF 2 (offline-mode fail-closed diagnosis) -- Maven's own real,
// stable wording when `-o` hits an artifact it has never cached (verified
// against a real `mvn -o dependency:tree` run against this exact Maven
// 3.8.7 install, not invented -- see this file's own spec for the full
// captured transcript this was derived from):
//   "Cannot access central (https://repo.maven.apache.org/maven2) in
//    offline mode and the artifact <GAV> has not been downloaded from it
//    before."
// Distinguishing this from a generic FAILED lets a caller give a fail-
// closed but EXPLICIT, exploitable diagnosis (which artifact, not just
// "dependency:tree exited non-zero") instead of the opaque failure an
// offline miss would otherwise be -- never a silent/muted timeout either,
// since an offline miss fails fast (no network wait at all).
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

export class MavenBuildAdapter implements BuildAdapter {
  readonly buildType = 'maven';

  packageCandidate(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): CompileResult {
    const r = runMaven(['clean', 'package', '-DskipTests', '-B'], workspacePath, timeoutMs);
    return { status: r.status === 0 ? 'SUCCESS' : 'FAILED', exitCode: r.status, durationMs: r.durationMs,
      evidenceTail: tail(r.stdout + '\n' + r.stderr) };
  }

  effectivePom(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): DependencyTreeResult {
    const output = path.join(workspacePath, '.pfe-effective-pom.xml');
    const r = runMaven(['help:effective-pom', '-Dverbose', '-B', '-Doutput=' + output], workspacePath, timeoutMs);
    try {
      if (r.status !== 0) return { status: 'FAILED', text: null, evidenceTail: tail(r.stdout + r.stderr), timedOut: r.timedOut };
      return { status: 'SUCCESS', text: fs.readFileSync(output, 'utf8'), evidenceTail: '', timedOut: false };
    } finally { try { fs.unlinkSync(output); } catch {} }
  }

  supports(workspacePath: string): boolean {
    return fs.existsSync(path.join(workspacePath, 'pom.xml'));
  }

  supportsMode(): boolean { return true; }

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

  compileTests(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): CompileResult {
    const result = runMaven(['-q', 'test-compile'], workspacePath, timeoutMs);
    if (result.timedOut) return { status: 'FAILED', exitCode: result.status, durationMs: result.durationMs, evidenceTail: 'WORKSPACE_TIMEOUT during mvn test-compile' };
    return { status: result.status === 0 ? 'SUCCESS' : 'FAILED', exitCode: result.status,
      durationMs: result.durationMs, evidenceTail: tail(result.stdout + '\n' + result.stderr) };
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

  // R-SEC-V1.1 §4 — the ONE extra Maven goal this phase needs, read-only,
  // no candidate files involved (used by GroundedMavenProvenanceService
  // against an exact-SHA worktree, never against a candidate patch).
  // -DoutputFile writes clean, unprefixed tree text (no "[INFO] " noise to
  // strip) -- the same approach used to capture this module's own real
  // fixtures (backend/src/security-remediation/fixtures/pfe-app-test.
  // dependency-tree.txt). Deliberately NOT `help:effective-pom`: the pure
  // resolver (resolveMavenProvenance) already fails closed (UNRESOLVED) on
  // a property inherited from a parent POM rather than needing the merged
  // model to chase it down -- so that goal is not run here, honoring
  // "do not run arbitrary Maven goals" by only running what is actually used.
  //
  // Offline analysis resolves through Maven's local cache only. Warm-up
  // health is interpreted by resolveDependencyTreeOffline(), not here.
  dependencyTree(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS, options: { offline?: boolean } = {}): DependencyTreeResult {
    const outputFile = path.join(workspacePath, '.pfe-dependency-tree-output.txt');
    const args = ['dependency:tree', '-B', `-DoutputFile=${outputFile}`, '-DoutputType=text'];
    if (options.offline) args.unshift('-o');
    const result = runMaven(args, workspacePath, timeoutMs);
    if (result.timedOut) {
      // Execution-2058 observability gap: this previously discarded
      // whatever stdout/stderr execFileSync HAD already captured before the
      // SIGKILL (runMaven() itself always captures it into result.stdout/
      // result.stderr -- see its own catch branch) and replaced it with a
      // fixed string, so the ONLY forensic evidence for a real grounding
      // timeout was the total elapsed duration -- exactly the gap that made
      // this exact incident's root cause (a large, legitimately in-progress,
      // cold-cache dependency download, not a stall/DNS/lock issue)
      // reconstructable only via the .m2 repository's own file timestamps,
      // never from application evidence. Now: bounded, redacted last lines,
      // the last artifact/repo transfer line seen, and a retry-count lower
      // bound (mavenTimeoutEvidence(), above) -- both folded into
      // evidenceTail as free text (WORKSPACE_TIMEOUT kept first for any
      // caller that still greps for it defensively -- DependencyTreeResult's
      // own callers already branch on the typed `timedOut` field, never on
      // this string) AND exposed structurally via `timeoutEvidence`.
      const timeoutEvidence = mavenTimeoutEvidence(result.stdout, result.stderr);
      return {
        status: 'FAILED', text: null, timedOut: true, timeoutEvidence,
        evidenceTail: formatTimeoutEvidenceTail('dependency:tree', result.durationMs, timeoutMs, timeoutEvidence),
      };
    }
    if (result.status !== 0) {
      const combined = redactSensitiveStderr(result.stdout + '\n' + result.stderr);
      // CORRECTIF 2 -- an offline miss fails FAST (no network wait at all,
      // never a timeout), so it is checked here, never on the timedOut
      // branch above. Only attempted when options.offline was actually
      // requested: the same real error text could theoretically appear in
      // ONLINE stderr too (e.g. a misconfigured local mirror), where it
      // would not mean the same thing -- never inferred from text content
      // alone, only from the caller's own declared intent.
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

  // Online preparation runs only against the caller's verified baseline.
  // go-offline is best-effort: only the later offline tree proves sufficiency.
  dependencyGoOffline(workspacePath: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): WarmupResult {
    return warmupResultFrom(runMaven(['dependency:go-offline', '-B'], workspacePath, timeoutMs), timeoutMs);
  }

  /** Resolve an approved target GAV against the same trusted baseline.
   * Can also run in an empty directory; when run in a project Maven still
   * reads its model/configuration. No candidate worktree is passed here.
   * Non-transitive by design: this does not prove a patched graph is cached;
   * the mandatory offline tree performs that check. */
  resolveArtifact(cwd: string, gav: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): WarmupResult {
    return warmupResultFrom(runMaven(['dependency:get', '-B', `-Dartifact=${gav}`, '-Dtransitive=false'], cwd, timeoutMs), timeoutMs);
  }
}
