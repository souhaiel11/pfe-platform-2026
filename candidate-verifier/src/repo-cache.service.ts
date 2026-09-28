// R22-E — repository materialization for the CandidateVerification HTTP
// endpoint. CandidateVerificationService (R22-C) assumes an already-local
// clone exists (proven this session against manually-managed dev clones);
// a live caller (WF2, via HTTP) has no such clone, so this fills that one
// real gap: clone-once, fetch-thereafter, into a deterministic cache path.
//
// Deliberately minimal: public HTTPS clone only, no token handling. This
// platform's demo projects (pfe-app-test) are public; a private-repo
// extension would need an explicit, separate credential-binding decision
// (same caution as R22-D's Sonar-position audit) -- not silently assumed
// here.
import { Injectable, Optional, BadRequestException } from '@nestjs/common';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

const DEFAULT_CACHE_ROOT = '/var/pfe-remediation-repos';

// `setsid` (util-linux, already present in this image's Debian/Bookworm
// base -- no new package) puts the program it runs into a brand-new
// session/process group, with pgid equal to that program's own pid --
// empirically confirmed (spawnSync's reported pid, the child's own `$$`,
// and its own `ps -o pgid=` all matched exactly): setsid does NOT insert an
// extra wrapper process with a different pid here, it just calls setsid()
// then execs `git` in place, so Node's own timeout/killSignal handling
// (which only ever SIGKILLs the ONE pid it tracked) is completely
// unaffected -- git itself is still that same tracked pid. The only change
// is that pid now also identifies a process GROUP terminateGitProcessGroup
// can target, since fork() preserves pgid for any real child git spawns
// (git-remote-https included).
const GIT_SESSION_WRAPPER = 'setsid';

// Execution-2057 root-cause fix (Part 2) — git clone/fetch previously had
// NO application-level timeout at all (confirmed by direct code read before
// this change), relying entirely on git/OS/TCP-stack defaults: a live
// reproduction against this exact code path hung for 132131ms before the
// underlying TCP stack itself gave up. GIT_OPERATION_CAP_MS is the ceiling
// for a SINGLE clone/fetch call, carved out of GROUNDING_STAGE_CAP_MS
// (security-remediation-orchestrator.service.ts, 300_000ms) which also has
// to leave room for the one `mvn dependency:tree` call that follows in the
// same grounding stage. 60s is chosen because every real clone/fetch of
// this platform's demo repos observed anywhere in this codebase's history
// (this file's own repo-cache.service.spec.ts, and every live probe run
// during the execution-2057 investigation) completed in well under 5
// seconds when the network path was healthy -- 60s is generous headroom
// over that norm while remaining far below both the observed ~132s hang
// and the full grounding-stage budget, so the subsequent Maven call still
// has most of its budget left even in the worst case.
export const GIT_OPERATION_CAP_MS = 60_000;
const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

function isValidRepositoryIdentifier(repository: string): boolean {
  const segments = repository.split('/');
  if (segments.length !== 2) return false;
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && SEGMENT_PATTERN.test(segment));
}

// Execution-2057 root-cause audit — the ONLY thing ensureRepo() ever did
// with a failed clone/fetch's real stderr/exit code was discard it: the
// catch site one layer up (grounded-maven-provenance.service.ts) only
// reads `err?.message`, and `execFileSync`'s own `.message` for a nonzero
// exit is just "Command failed: git ...", never the actual git stderr
// (which execFileSync captures separately, on `.stderr`, and which nothing
// here ever read). That left GROUNDING_FAILED:WORKSPACE_INFRA_FAILURE with
// zero diagnostic trail -- exactly the gap that made execution 2057's real
// cause (an intermittent DNS resolution failure for github.com, reproduced
// live against this same code path) unrecoverable from any existing log.
// This adds ONLY a diagnostic side channel: the thrown error's type and
// message, and therefore every existing external behavior/business-status
// contract, are completely unchanged -- same discipline as builder-scanner's
// own describeCommandFailure/logCommandFailure (security-artifact-validator.ts).
const STDERR_LOG_MAX_CHARS = 2000;

// This service only ever runs a public, tokenless HTTPS clone/fetch (see
// this file's own header comment) -- no credential is ever part of argv or
// env here. Redacted anyway, defensively, for the same reason
// builder-scanner redacts registry stderr: the TEXT git/the remote returns
// is not content this process controls the shape of. Exported so
// maven-build-adapter.ts's own timeout-evidence capture (execution-2058
// follow-up) reuses the exact same discipline instead of a second,
// independently-maintained pattern set -- the risk class (a remote's own
// text, not content this process controls) is identical for both.
const SENSITIVE_STDERR_PATTERNS: Array<[RegExp, string]> = [
  [/(\bhttps?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1***@'],
  [/\b(authorization\s*:\s*)\S+/gi, '$1***'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***'],
];
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

// Pure, directly testable -- mirrors builder-scanner's describeCommandFailure
// shape/discipline exactly (wrapper-vs-exit distinction, bounded/redacted
// stderr, never throws on a wildly unusual error value).
export function describeGitCommandFailure(operation: 'clone' | 'fetch', repository: string, error: any): GitCommandFailureLog {
  const exitCode = typeof error?.status === 'number' ? error.status : null;
  const nodeErrorCode = typeof error?.code === 'string' ? error.code : null;
  const signal = typeof error?.signal === 'string' ? error.signal : null;
  const rawStderr = typeof error?.stderr === 'string' ? error.stderr : (error?.stderr ? String(error.stderr) : '');
  const redacted = redactSensitiveStderr(rawStderr);
  const stderrTail = redacted.length > STDERR_LOG_MAX_CHARS ? '…' + redacted.slice(-STDERR_LOG_MAX_CHARS) : redacted;
  return { operation, repository, exitCode, nodeErrorCode, signal, stderrTail };
}

function logGitCommandFailure(operation: 'clone' | 'fetch', repository: string, error: any): void {
  console.error(JSON.stringify({ event: 'REPO_CACHE_COMMAND_FAILURE', ...describeGitCommandFailure(operation, repository, error) }));
}

function logGitDeadlineRefusal(operation: 'clone' | 'fetch', repository: string, timeoutMs: number): void {
  console.error(JSON.stringify({ event: 'REPO_CACHE_DEADLINE_EXHAUSTED', operation, repository, timeoutMs }));
}

// git's own HTTPS transport runs as a CHILD of the `git` process itself
// (git-remote-https), not of this Node process directly -- execFileSync's
// `timeout`/`killSignal` only ever reaches the one direct child it tracked
// (`git`), never that child's own children. A SIGKILLed `git` can therefore
// leave its transport helper running, orphaned, still holding the network
// connection open -- the same class of gap already found and fixed for
// podman builds (builder-scanner/src/security-artifact-validator.ts's own
// pidsBeforeBuild sweep).
//
// Process-cleanup-ownership correction (superseding the original
// PID-diff-based sweep): killing every PID that is merely NEW in
// `/proc` since the call started is not attribution -- it is a coincidence
// window. Blocking Node's single event-loop thread only stops THIS process
// from scheduling new work; it proves nothing about processes started by
// something else entirely (a health check, a `docker exec`, cron) during
// the same real-world interval, and a broad sweep would SIGKILL those too.
// The fix: spawn git DETACHED, making it the leader of its own new POSIX
// process group (pgid == git's own pid). Because fork() preserves pgid
// unless a child explicitly calls setpgid (git never does), EVERY real
// descendant git spawns -- including git-remote-https -- inherits that
// exact pgid automatically. `process.kill(-pid, 'SIGKILL')` then targets
// ONLY that process group, atomically, via the kernel's own group-signal
// primitive -- never a second, race-prone /proc re-scan performed by this
// code. A process outside that group (an unrelated health check, an
// operator's `docker exec`) is never touched, no matter when it happened
// to start. If the pid is unknown (a fault-injection test seam that never
// established a real ownership pid), NOTHING is killed -- absence of proof
// of ownership means absence of action, never a broad fallback sweep.
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

// Command injection is a fault-test seam (real subprocess timeout/failure
// injection without real network dependence), never part of an HTTP
// request -- same discipline and shape as TrivyImageArtifactValidator's own
// injectable `command` (builder-scanner/src/security-artifact-validator.ts).
// Returns (or throws with) the spawned process's own pid when a real one
// was established, so the caller can scope cleanup to exactly that
// process's own group -- a seam that never spawns a real process (most
// fault-injection tests) simply omits it, and no group-kill is attempted.
export type GitCommand = (args: string[], options: { timeout: number; killSignal: 'SIGKILL' }) => { pid?: number } | void;

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
  constructor(
    @Optional() private readonly cacheRoot: string = DEFAULT_CACHE_ROOT,
    private readonly gitCommand: GitCommand = defaultGitCommand,
  ) {}

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

  /**
   * Returns a local path with an up-to-date fetch of `repository` ("owner/name").
   * Clones on first use, fetches otherwise.
   *
   * `timeoutMs`, when given, is the caller's remaining worker-deadline
   * budget at the point this is called (never a fresh, unrelated window --
   * see GroundedMavenProvenanceService.resolve(), which derives it from
   * request.timeoutMs, itself already the orchestrator's own
   * deadline.budgetFor(GROUNDING_STAGE_CAP_MS)). Bounded to at most
   * GIT_OPERATION_CAP_MS either way, and refused outright -- no command
   * attempted at all -- once below MIN_STAGE_BUDGET_MS, the same floor
   * every other deadline-aware stage in this codebase already shares.
   */
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
