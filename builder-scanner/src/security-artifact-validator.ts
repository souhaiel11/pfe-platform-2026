// Encadre la construction et le scan des images de vérification.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { SecurityArtifactScan, ArtifactRuntimeError, trackedSourceDigest, cveTargets, provesSecurityClosure } from '../../backend/src/security-remediation/security-artifact-scan';
import { MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

export { SecurityArtifactScan, ArtifactRuntimeError, trackedSourceDigest, cveTargets, provesSecurityClosure };

export interface SecurityArtifactValidator {
  /** Inspecte les données ou l’artefact pour en tirer des preuves. */
  inspect(workspace: string, budgetMs?: number): SecurityArtifactScan;
}

export const SECURITY_ARTIFACT_RUNTIME = Object.freeze({
  trivyVersion: '0.72.0',
  preflightTimeoutMs: 30_000,
  imageBuildTimeoutMs: 20 * 60_000,
  imageSaveTimeoutMs: 20 * 60_000,
  scanTimeoutMs: 20 * 60_000,
  cleanupTimeoutMs: 30_000,
});

export type ArtifactCommand = (command: string, args: string[], options: any) => string;

/** Liste Live Pids. */
function listLivePids(): Set<number> {
  const pids = new Set<number>();
  let entries: string[];
  try { entries = fs.readdirSync('/proc'); } catch { return pids; }
  for (const entry of entries) if (/^\d+$/.test(entry)) pids.add(Number(entry));
  return pids;
}

/** Prépare le résultat lié à base image type. */
export function baseImageKind(ref: string): 'BUILTIN_EMPTY_BASE' | 'REGISTRY_IMAGE' {
  // Docker's exact reserved empty base has no registry manifest. Tags,
  // namespaces and lookalike names remain ordinary registry references.
  return ref.trim() === 'scratch' ? 'BUILTIN_EMPTY_BASE' : 'REGISTRY_IMAGE';
}

/** Extrait les images de base déclarées dans le Dockerfile. */
export function parseBaseImages(dockerfileContent: string): string[] {
  const stageAliases = new Set<string>();
  const images: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of dockerfileContent.split('\n')) {
    const match = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(rawLine);
    if (!match) continue;
    const [, ref, alias] = match;
    if (baseImageKind(ref) !== 'BUILTIN_EMPTY_BASE' && !stageAliases.has(ref) && !seen.has(ref)) { images.push(ref); seen.add(ref); }
    if (alias) stageAliases.add(alias);
  }
  return images;
}

const STDERR_LOG_MAX_CHARS = 2000;

export interface CommandFailureLog {
  stage: string;
  command: string;
  target: string | null;
  exitCode: number | null;
  nodeErrorCode: string | null;
  signal: string | null;
  classification: 'TIMEOUT' | 'NON_TIMEOUT';
  stderrTail: string;
}

const SENSITIVE_STDERR_PATTERNS: Array<[RegExp, string]> = [
  [/(\bhttps?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1***@'], // URL userinfo: scheme://user:pass@host
  [/\b(authorization\s*:\s*)\S+/gi, '$1***'], // Authorization: <anything>
  [/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***'], // Bearer <token>
  [/([?&](?:token|sig|signature|X-Amz-Signature|access_token)=)[^\s&"']+/gi, '$1***'], // signed-URL query params
];
/** Masque les secrets dans les messages d’erreur externes. */
function redactSensitiveStderr(text: string): string {
  return SENSITIVE_STDERR_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

/** Décrit commande échec. */
export function describeCommandFailure(stage: string, command: string, args: string[], error: any): CommandFailureLog {
  const exitCode = typeof error?.status === 'number' ? error.status : null;
  const nodeErrorCode = typeof error?.code === 'string' ? error.code : null;
  const signal = typeof error?.signal === 'string' ? error.signal : null;
  const classification: CommandFailureLog['classification'] = nodeErrorCode === 'ETIMEDOUT' ? 'TIMEOUT' : 'NON_TIMEOUT';
  let target: string | null = null;
  if (command === 'podman') {
    if (args[0] === 'pull' && args[1]) target = args[1];
    else { const tagIndex = args.indexOf('--tag'); if (tagIndex !== -1 && args[tagIndex + 1]) target = args[tagIndex + 1]; }
  }
  const rawStderr = typeof error?.stderr === 'string' ? error.stderr : (error?.stderr ? String(error.stderr) : '');
  const redacted = redactSensitiveStderr(rawStderr);
  const stderrTail = redacted.length > STDERR_LOG_MAX_CHARS ? '…' + redacted.slice(-STDERR_LOG_MAX_CHARS) : redacted;
  return { stage, command, target, exitCode, nodeErrorCode, signal, classification, stderrTail };
}

/** Journalise commande échec. */
function logCommandFailure(stage: string, command: string, args: string[], error: any): void {
  console.error(JSON.stringify({ event: 'ARTIFACT_COMMAND_FAILURE', ...describeCommandFailure(stage, command, args, error) }));
}

/** Convertit erreur vers artefact code. */
function mapErrorToArtifactCode(error: any): string {
  return error?.code === 'ENOENT' ? 'RUNTIME_EXECUTABLE_UNAVAILABLE'
    : error?.code === 'ETIMEDOUT' ? 'RUNTIME_OPERATION_TIMEOUT' : 'RUNTIME_COMMAND_FAILED';
}

// V1.7.2 bounded base-image-pull reliability — execution 2054's root-cause
// read (this phase's own predecessor turn) showed a REAL, demonstrated
// transient-transfer failure: podman `pull` exiting 125 with stderr ending
// "writing blob: storing blob to file ...: happened during read: unexpected
// EOF" -- a registry connection cut mid-transfer, not a hang (Node never
// killed it; podman's own process exited on its own). Exit code 125 is
// podman's generic catch-all for nearly every failure category (auth,
// missing image, invalid reference, disk space, TLS, ...), so it is
// deliberately NEVER used alone as the retry signal -- only a NARROW
// allowlist of stderr patterns that specifically indicate an interrupted
// transfer, the one failure family that is plausibly transient and safe to
// retry unattended. Every pattern here names a real, well-known "the
// connection was cut mid-copy" signal from container-registry tooling;
// nothing broader (auth/reference/cert/disk/permission wording) is or
// should be added without equally direct evidence.
const TRANSIENT_PULL_STDERR_PATTERNS: RegExp[] = [
  /unexpected EOF/i, // observed directly: execution 2054, blob copy interrupted mid-stream
  /connection reset by peer/i, // classic interrupted TCP transfer
  /TLS handshake timeout/i, // transport-layer setup cut short, not a certificate/authority failure
  /timeout awaiting response headers/i, // registry connection stalled and was cut (podman's own wording, not a Node/exec-level timeout -- those are excluded below via nodeErrorCode)
  /i\/o timeout/i, // Go net package's own transient socket-level timeout wording
];

// Permanent failures win even when another diagnostic names a transient
// transfer error. This veto does not widen the transient allowlist.
const PERMANENT_PULL_STDERR_PATTERNS: RegExp[] = [
  /permission denied|operation not permitted/i,
  /no space left on device|disk quota exceeded|read-only file system/i,
  /x509:|certificate|unknown authority/i,
  /unauthorized|authentication required|access denied|requested access.*denied|forbidden/i,
  /invalid reference|manifest unknown|name unknown|not found|no such file or directory/i,
];

/** Vérifie l’état suivant : Transient récupération échec. */
export function isTransientPullFailure(error: any): boolean {
  if (typeof error?.status !== 'number') return false;
  if (typeof error?.code === 'string') return false;
  const stderr = typeof error?.stderr === 'string' ? error.stderr : (error?.stderr ? String(error.stderr) : '');
  if (PERMANENT_PULL_STDERR_PATTERNS.some((pattern) => pattern.test(stderr))) return false;
  return TRANSIENT_PULL_STDERR_PATTERNS.some((pattern) => pattern.test(stderr));
}

export const MAX_PULL_ATTEMPTS = 3;

/** Prépare le résultat lié à récupération Backoff millisecondes. */
export function pullBackoffMs(attemptJustFailed: number): number {
  return Math.min(500, 250 * attemptJustFailed);
}

export type PullRetryClassification = 'TRANSIENT_TRANSFER_INTERRUPTED' | 'NON_RETRYABLE' | 'DEADLINE_EXCEEDED' | 'SUCCESS';

export interface PullRetryEvent {
  image: string;
  /** Number of command invocations so far; a pre-attempt deadline rejection adds none. */
  attempt: number;
  classification: PullRetryClassification;
  durationMs: number;
  /** -1 when the caller runs with no overall budget at all (`remainingBudgetMs` returned undefined). */
  remainingBudgetMs: number;
  outcome: 'SUCCESS' | 'RETRYING' | 'GIVING_UP';
}

export interface PullRetryDeps {
  /** Runs ONE command attempt bounded by the given timeout; throws the RAW error (never ArtifactRuntimeError) on failure. */
  attempt: (timeoutMs: number) => string;
  now: () => number;
  sleep: (ms: number) => void;
  /** Remaining overall-deadline budget right now; undefined means "no deadline in play" (mirrors inspect()'s own budgetMs===undefined convention). */
  remainingBudgetMs: () => number | undefined;
  cap: number;
  maxAttempts: number;
  minStageBudgetMs: number;
  isRetryable: (error: any) => boolean;
  backoffMs: (attemptJustFailed: number) => number;
  image: string;
  onEvent: (event: PullRetryEvent) => void;
}

/** Prépare le résultat lié à récupération base image avec relance. */
export function pullBaseImageWithRetry(deps: PullRetryDeps): string {
  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    const remainingBefore = deps.remainingBudgetMs();
    if (remainingBefore !== undefined && remainingBefore < deps.minStageBudgetMs) {
      deps.onEvent({ image: deps.image, attempt: attempt - 1, classification: 'DEADLINE_EXCEEDED', durationMs: 0, remainingBudgetMs: remainingBefore, outcome: 'GIVING_UP' });
      throw new ArtifactRuntimeError('WORKER_DEADLINE_EXCEEDED', 'PODMAN_BASE_IMAGE_PULL');
    }
    const timeout = remainingBefore === undefined ? deps.cap : Math.min(deps.cap, Math.floor(remainingBefore));
    const began = deps.now();
    try {
      const out = deps.attempt(timeout);
      const remainingAfter = deps.remainingBudgetMs();
      deps.onEvent({ image: deps.image, attempt, classification: 'SUCCESS', durationMs: Math.round(deps.now() - began), remainingBudgetMs: remainingAfter ?? -1, outcome: 'SUCCESS' });
      return out;
    } catch (error: any) {
      const durationMs = Math.round(deps.now() - began);
      const retryable = deps.isRetryable(error);
      const isLastAttempt = attempt >= deps.maxAttempts;
      let outcome: 'RETRYING' | 'GIVING_UP' = retryable && !isLastAttempt ? 'RETRYING' : 'GIVING_UP';
      let backoff = 0;
      if (outcome === 'RETRYING') {
        backoff = deps.backoffMs(attempt);
        const remainingForBackoff = deps.remainingBudgetMs();
        // Retry delays share the SAME budget as the attempts themselves --
        // never a free extension of it. If what remains cannot cover both
        // the backoff AND a still-meaningful next attempt, stop now rather
        // than spend the last of the budget sleeping.
        if (remainingForBackoff !== undefined && remainingForBackoff < deps.minStageBudgetMs + backoff) outcome = 'GIVING_UP';
      }
      const remainingNow = deps.remainingBudgetMs();
      deps.onEvent({ image: deps.image, attempt, classification: retryable ? 'TRANSIENT_TRANSFER_INTERRUPTED' : 'NON_RETRYABLE', durationMs, remainingBudgetMs: remainingNow ?? -1, outcome });
      if (outcome === 'GIVING_UP') throw error;
      deps.sleep(backoff);
    }
  }
  /* istanbul ignore next -- unreachable: maxAttempts >= 1 and the loop above always either returns or throws before falling through. */
  throw new Error('pullBaseImageWithRetry: unreachable');
}

/** Prépare le résultat lié à par défaut Sleep. */
function defaultSleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class TrivyImageArtifactValidator implements SecurityArtifactValidator {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private readonly command: ArtifactCommand = (cmd, args, opts) => execFileSync(cmd, args, opts).toString(),
    // Injectable purely so tests can prove backoff without a real
    // multi-hundred-ms wait per attempt; production always uses the real
    // synchronous sleep above.
    private readonly sleep: (ms: number) => void = defaultSleep,
  ) {}

  /** Inspecte les données ou l’artefact pour en tirer des preuves. */
  inspect(workspace: string, budgetMs?: number): SecurityArtifactScan {
    const started = performance.now(), timings: Record<string, number> = {};
    const sourceDigest = trackedSourceDigest(workspace);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'security-closure-'));
    const tag = 'localhost/security-closure:' + path.basename(scratch).toLowerCase();
    const env: NodeJS.ProcessEnv = {};
    // Deliberately exclude proxy variables, TRIVY_* option overrides,
    // CONTAINER_HOST, DOCKER_HOST and all platform credentials.
    for (const k of ['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'LANG'])
      if (process.env[k]) env[k] = process.env[k];
    // Un délai nul supprimerait la limite : conserver au moins 1 ms et vérifier le budget avant l’appel.
    const inspectStarted = performance.now();
    /** Calcule le temps disponible pour l’étape suivante. */
    const remainingBudget = (): number | undefined =>
      budgetMs === undefined ? undefined : Math.max(0, budgetMs - (performance.now() - inspectStarted));
    /** Exécute le traitement et collecte son résultat. */
    const run = (stage: string, cmd: string, args: string[], cap: number) => {
      const remaining = remainingBudget();
      if (remaining !== undefined && remaining < MIN_STAGE_BUDGET_MS) {
        timings[stage] = timings[stage] ?? 0;
        throw new ArtifactRuntimeError('WORKER_DEADLINE_EXCEEDED', stage);
      }
      const timeout = remaining === undefined ? cap : Math.min(cap, Math.floor(remaining));
      const began = performance.now();
      try {
        return this.command(cmd, args, { cwd: scratch, env, encoding: 'utf8', timeout,
          killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error: any) {
        logCommandFailure(stage, cmd, args, error);
        throw new ArtifactRuntimeError(mapErrorToArtifactCode(error), stage, typeof error?.status === 'number' ? error.status : undefined);
      } finally { timings[stage] = (timings[stage] ?? 0) + Math.round(performance.now() - began); }
    };
    /** Exécute Cleanup. */
    const runCleanup = (stage: string, cmd: string, args: string[], cap: number) => {
      const began = performance.now();
      try {
        return this.command(cmd, args, { cwd: scratch, env, encoding: 'utf8', timeout: cap,
          killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error: any) {
        logCommandFailure(stage, cmd, args, error);
        throw new ArtifactRuntimeError(mapErrorToArtifactCode(error), stage, typeof error?.status === 'number' ? error.status : undefined);
      } finally { timings[stage] = Math.round(performance.now() - began); }
    };
    const cfg = SECURITY_ARTIFACT_RUNTIME;
    let buildAttempted = false;
    let result: SecurityArtifactScan | undefined, failure: unknown;
    const pidsBeforeBuild = listLivePids();
    try {
      if (run('PODMAN_PREFLIGHT', 'podman', ['info', '--format', '{{.Host.Security.Rootless}}'], cfg.preflightTimeoutMs).trim() !== 'true')
        throw new ArtifactRuntimeError('ROOTLESS_BUILDER_REQUIRED', 'PODMAN_PREFLIGHT');
      const scannerVersion = run('TRIVY_PREFLIGHT', 'trivy', ['--version'], cfg.preflightTimeoutMs).trim();
      if (!/^Version: 0\.72\.0(?:\r?\n|$)/m.test(scannerVersion))
        throw new ArtifactRuntimeError('TRIVY_VERSION_MISMATCH', 'TRIVY_PREFLIGHT');
      if (!fs.existsSync(path.join(workspace, 'Dockerfile')))
        throw new ArtifactRuntimeError('IMAGE_BUILD_CONTRACT_MISSING', 'IMAGE_BUILD');
      buildAttempted = true;
      /**
       * Vrai si l'image de base est DÉJÀ dans le store local de podman.
       *
       * Un `podman image exists` absent renvoie le code 1 : c'est une
       * réponse, pas une panne — on ne journalise donc rien dans ce cas
       * (contrairement à run/runCleanup, qui émettraient un
       * ARTIFACT_COMMAND_FAILURE trompeur pour une absence normale).
       * Toute autre erreur reste propagée : on ne déduit jamais « absente »
       * d'un échec qu'on n'a pas compris.
       */
      const baseImagePresent = (image: string): boolean => {
        const began = performance.now();
        try {
          this.command('podman', ['image', 'exists', image], { cwd: scratch, env, encoding: 'utf8',
            timeout: cfg.preflightTimeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
          return true;
        } catch (error: any) {
          if (error?.status === 1) return false;
          logCommandFailure('BASE_IMAGE_EXISTS', 'podman', ['image', 'exists', image], error);
          throw new ArtifactRuntimeError(mapErrorToArtifactCode(error), 'BASE_IMAGE_EXISTS',
            typeof error?.status === 'number' ? error.status : undefined);
        } finally {
          timings['BASE_IMAGE_EXISTS'] = (timings['BASE_IMAGE_EXISTS'] ?? 0) + Math.round(performance.now() - began);
        }
      };
      for (const image of parseBaseImages(fs.readFileSync(path.join(workspace, 'Dockerfile'), 'utf8'))) {
        // L'étape IMAGE_BUILD ci-dessous s'exécute avec `--pull=never` : une
        // image de base déjà présente localement SUFFIT au build. Exiger
        // quand même un accès au registre rendait toute la fermeture de
        // sécurité dépendante d'une sortie réseau dont elle n'a pas besoin —
        // constaté en réel (RUNTIME_COMMAND_FAILED:PODMAN_BASE_IMAGE_PULL,
        // « TLS handshake timeout » vers registry-1.docker.io, 3 tentatives,
        // alors que les deux images étaient déjà dans le store).
        //
        // On ne saute donc le pull que sur une preuve POSITIVE de présence
        // locale. Image absente -> le pull reste obligatoire et son échec
        // reste bloquant : aucun scan n'est jamais produit à partir d'une
        // image qu'on n'a pas.
        if (baseImagePresent(image)) {
          console.error(JSON.stringify({ event: 'ARTIFACT_BASE_IMAGE_CACHED', image, outcome: 'PULL_SKIPPED' }));
          continue;
        }
        try {
          pullBaseImageWithRetry({
            /** Exécute une tentative et en collecte le résultat. */
            attempt: (timeoutMs) => this.command('podman', ['pull', image],
              { cwd: scratch, env, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
            /** Renvoie l’heure courante utilisée par le traitement. */
            now: () => performance.now(),
            sleep: this.sleep,
            remainingBudgetMs: remainingBudget,
            cap: cfg.imageBuildTimeoutMs,
            maxAttempts: MAX_PULL_ATTEMPTS,
            minStageBudgetMs: MIN_STAGE_BUDGET_MS,
            isRetryable: isTransientPullFailure,
            backoffMs: pullBackoffMs,
            image,
            /** Traite événement. */
            onEvent: (event) => {
              timings['PODMAN_BASE_IMAGE_PULL'] = (timings['PODMAN_BASE_IMAGE_PULL'] ?? 0) + event.durationMs;
              // Deliberately lighter than logCommandFailure -- no raw
              // stderr here, so a 3-attempt run never emits it 3 times;
              // the full sanitized diagnostic (via the existing
              // logCommandFailure path) still fires exactly once below,
              // only on the attempt that actually gives up.
              console.error(JSON.stringify({ event: 'ARTIFACT_PULL_RETRY', ...event }));
            },
          });
        } catch (error: any) {
          if (error instanceof ArtifactRuntimeError) throw error; // WORKER_DEADLINE_EXCEEDED -- already final
          logCommandFailure('PODMAN_BASE_IMAGE_PULL', 'podman', ['pull', image], error);
          throw new ArtifactRuntimeError(mapErrorToArtifactCode(error), 'PODMAN_BASE_IMAGE_PULL', typeof error?.status === 'number' ? error.status : undefined);
        }
      }
      const mavenCache = process.env.MAVEN_CACHE_DIR;
      run('IMAGE_BUILD', 'podman', ['build', '--isolation=chroot', '--rm=true', '--force-rm=true', '--layers=false',
        '--pull=never',
        ...(mavenCache ? ['--volume', `${mavenCache}:/root/.m2`] : []),
        '--tag', tag, workspace], cfg.imageBuildTimeoutMs);
      const archive = path.join(scratch, 'image.tar'), reportPath = path.join(scratch, 'report.json');
      run('IMAGE_SAVE', 'podman', ['save', '--format', 'docker-archive', '--output', archive, tag], cfg.imageSaveTimeoutMs);
      fs.writeFileSync(path.join(scratch, 'ignore'), '');
      fs.writeFileSync(path.join(scratch, 'config.yaml'), '{}\n');
      const cache = process.env.SECURITY_TRIVY_CACHE_DIR;
      run('TRIVY_SCAN', 'trivy', ['image', '--input', archive, '--scanners', 'vuln,misconfig',
        '--config', path.join(scratch, 'config.yaml'), '--ignorefile', path.join(scratch, 'ignore'),
        ...(cache ? ['--cache-dir', cache] : []),
        '--skip-db-update', '--skip-java-db-update', '--skip-check-update', '--skip-version-check', '--offline-scan',
        '--list-all-pkgs', '--exit-code', '0', '--format', 'json', '--no-progress',
        '--timeout', '20m', '--output', reportPath], cfg.scanTimeoutMs);
      if (trackedSourceDigest(workspace) !== sourceDigest) throw new ArtifactRuntimeError('SCANNER_MUTATED_SOURCE', 'SOURCE_CHECK');
      const raw = fs.readFileSync(reportPath);
      let report: any;
      try { report = JSON.parse(raw.toString()); } catch { throw new ArtifactRuntimeError('MALFORMED_SCANNER_JSON', 'REPORT_PARSE'); }
      result = { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest,
        artifactDigest: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
        reportDigest: createHash('sha256').update(raw).digest('hex'), buildPassed: true, scannerVersion, report, timings };
      try { cveTargets(result, ''); } catch { throw new ArtifactRuntimeError('INCOMPLETE_SCANNER_REPORT', 'REPORT_PARSE'); }
    } catch (error) {
      failure = error instanceof ArtifactRuntimeError ? error : new ArtifactRuntimeError('RUNTIME_IO_FAILED', 'ARTIFACT_VALIDATION');
    }
    // Cleanup is part of acceptance. Even a successfully scanned candidate
    // cannot return success when its temporary image cannot be removed.
    try {
      if (buildAttempted) {
        /** Vérifie la condition liée à exists. */
        const exists = () => {
          try { runCleanup('IMAGE_EXISTS', 'podman', ['image', 'exists', tag], cfg.cleanupTimeoutMs); return true; }
          catch (error) {
            if (error instanceof ArtifactRuntimeError && error.exitCode === 1) return false;
            throw error;
          }
        };
        if (exists()) runCleanup('IMAGE_CLEANUP', 'podman', ['image', 'rm', '--force', tag], cfg.cleanupTimeoutMs);
        if (exists()) throw new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'IMAGE_CLEANUP');
      }
    } catch { failure = new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'IMAGE_CLEANUP'); }
    if (buildAttempted) {
      for (const pid of listLivePids()) {
        if (pidsBeforeBuild.has(pid)) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
    try { fs.rmSync(scratch, { recursive: true, force: true }); }
    catch { failure = new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'SCRATCH_CLEANUP'); }
    timings.TOTAL_ARTIFACT_DURATION_MS = Math.round(performance.now() - started);
    if (failure) throw failure;
    return result!;
  }
}
