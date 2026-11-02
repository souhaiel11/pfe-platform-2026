// Prépare les dépôts et leurs révisions dans un cache local.
import { Injectable, Optional, BadRequestException } from '@nestjs/common';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

const DEFAULT_CACHE_ROOT = '/var/pfe-remediation-repos';

const GIT_SESSION_WRAPPER = 'setsid';

export const GIT_OPERATION_CAP_MS = 60_000;
const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Vérifie l’état suivant : valide dépôt Identifier. */
function isValidRepositoryIdentifier(repository: string): boolean {
  const segments = repository.split('/');
  if (segments.length !== 2) return false;
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && SEGMENT_PATTERN.test(segment));
}

const STDERR_LOG_MAX_CHARS = 2000;

const SENSITIVE_STDERR_PATTERNS: Array<[RegExp, string]> = [
  [/(\bhttps?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1***@'],
  [/\b(authorization\s*:\s*)\S+/gi, '$1***'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***'],
];
/** Masque les secrets dans les messages d’erreur externes. */
export function redactSensitiveStderr(text: string): string {
  return SENSITIVE_STDERR_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

export interface GitCommandFailureLog {
  operation: 'clone' | 'fetch';
  repository: string;
  exitCode: number | null;
  nodeErrorCode: string | null;
  signal: string | null;
  stderrTail: string;
}

/** Décrit Git commande échec. */
export function describeGitCommandFailure(operation: 'clone' | 'fetch', repository: string, error: any): GitCommandFailureLog {
  const exitCode = typeof error?.status === 'number' ? error.status : null;
  const nodeErrorCode = typeof error?.code === 'string' ? error.code : null;
  const signal = typeof error?.signal === 'string' ? error.signal : null;
  const rawStderr = typeof error?.stderr === 'string' ? error.stderr : (error?.stderr ? String(error.stderr) : '');
  const redacted = redactSensitiveStderr(rawStderr);
  const stderrTail = redacted.length > STDERR_LOG_MAX_CHARS ? '…' + redacted.slice(-STDERR_LOG_MAX_CHARS) : redacted;
  return { operation, repository, exitCode, nodeErrorCode, signal, stderrTail };
}

/** Journalise Git commande échec. */
function logGitCommandFailure(operation: 'clone' | 'fetch', repository: string, error: any): void {
  console.error(JSON.stringify({ event: 'REPO_CACHE_COMMAND_FAILURE', ...describeGitCommandFailure(operation, repository, error) }));
}

/** Journalise Git échéance Refusal. */
function logGitDeadlineRefusal(operation: 'clone' | 'fetch', repository: string, timeoutMs: number): void {
  console.error(JSON.stringify({ event: 'REPO_CACHE_DEADLINE_EXHAUSTED', operation, repository, timeoutMs }));
}

/** Prépare le résultat lié à terminate Git processus groupe. */
function terminateGitProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    // Negative pid == "signal the whole process group", not just one pid --
    // this is the one syscall-level primitive that makes group membership
    // (established at spawn time via `detached`), not PID-diff timing,
    // the source of truth for what belongs to this git invocation.
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ESRCH (group already empty -- the common, successful-completion case)
    // or EPERM -- best-effort only, never throw from cleanup.
  }
}

export type GitCommand = (args: string[], options: { timeout: number; killSignal: 'SIGKILL' }) => { pid?: number } | void;

/** Exécute Git avec les paramètres d’exécution prévus. */
const defaultGitCommand: GitCommand = (args, options) => {
  // Wrapped via `setsid` (see GIT_SESSION_WRAPPER's own comment) so git
  // becomes the leader of its own new process group instead of sharing
  // this Node process's group -- the one change from the prior plain
  // `execFileSync('git', ...)` call. stdio shape, timeout and killSignal
  // are otherwise unchanged.
  const result = spawnSync(GIT_SESSION_WRAPPER, ['git', ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const pid = result.pid;
  if (result.error) {
    (result.error as any).pid = pid;
    throw result.error;
  }
  if (result.status !== 0 || result.signal) {
    const err: any = new Error(`Command failed: git ${args.join(' ')}`);
    err.status = result.status;
    err.signal = result.signal;
    err.stderr = result.stderr ? result.stderr.toString() : '';
    err.pid = pid;
    throw err;
  }
  return { pid };
};

@Injectable()
export class RepoCacheService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @Optional() private readonly cacheRoot: string = DEFAULT_CACHE_ROOT,
    private readonly gitCommand: GitCommand = defaultGitCommand,
  ) {}

  /** Exécute Git avec un délai borné et classe les échecs. */
  private runGitBounded(args: string[], timeoutMs: number | undefined, operation: 'clone' | 'fetch', repository: string): void {
    const effectiveTimeout = Math.max(1, Math.floor(timeoutMs ?? GIT_OPERATION_CAP_MS));
    let pid: number | undefined;
    try {
      const outcome = this.gitCommand(args, { timeout: effectiveTimeout, killSignal: 'SIGKILL' });
      pid = outcome ? outcome.pid : undefined;
    } catch (error: any) {
      pid = typeof error?.pid === 'number' ? error.pid : undefined;
      logGitCommandFailure(operation, repository, error);
      throw error;
    } finally {
      // Unconditional, regardless of success/failure/timeout -- matches
      // this codebase's existing cleanup discipline (WorkspaceManager,
      // builder-scanner's own sweep). Scoped to exactly this invocation's
      // own process group; see terminateGitProcessGroup's own comment for
      // why this replaced the previous broad PID-diff sweep.
      terminateGitProcessGroup(pid);
    }
  }

  /** Prépare le dépôt et la révision nécessaires. */
  ensureRepo(repository: string, timeoutMs?: number): string {
    if (!isValidRepositoryIdentifier(repository)) {
      throw new BadRequestException(`Invalid repository identifier: ${JSON.stringify(repository)}`);
    }
    if (timeoutMs !== undefined && timeoutMs < MIN_STAGE_BUDGET_MS) {
      const operation: 'clone' | 'fetch' = fs.existsSync(path.join(path.resolve(this.cacheRoot, repository.replace('/', '__')), '.git')) ? 'fetch' : 'clone';
      logGitDeadlineRefusal(operation, repository, timeoutMs);
      throw new Error(`ensureRepo: refused to start ${operation} for ${repository} -- remaining budget (${timeoutMs}ms) is below the minimum stage floor.`);
    }
    const cachePath = path.resolve(this.cacheRoot, repository.replace('/', '__'));
    const cacheRootResolved = path.resolve(this.cacheRoot) + path.sep;
    if (!cachePath.startsWith(cacheRootResolved)) {
      throw new BadRequestException('Computed repo cache path escapes the cache root.');
    }

    const capped = timeoutMs === undefined ? undefined : Math.min(timeoutMs, GIT_OPERATION_CAP_MS);
    if (fs.existsSync(path.join(cachePath, '.git'))) {
      this.runGitBounded(['-C', cachePath, 'fetch', '--all', '--prune'], capped, 'fetch', repository);
    } else {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      this.runGitBounded(['clone', `https://github.com/${repository}.git`, cachePath], capped, 'clone', repository);
    }
    return cachePath;
  }
}
