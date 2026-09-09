// R22-C — isolated, exact-SHA workspace manager. Audited strategy from
// R22-B: shared local repository object database + `git worktree add
// --detach <sha>`. Proven safe pattern this session (R22-A's own
// pfe-app-test fix used exactly this, without ever touching the shared
// clone's checked-out branch).
//
// This never runs `git reset`/`git clean`/`git checkout` against the shared
// repository (repoPath) -- only `git worktree add`/`git worktree remove`,
// which do not touch the shared clone's own working tree or index.
import { Injectable, Optional } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_WORKSPACE_ROOT = '/var/pfe-remediation-workspaces';
const IDENTITY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class WorkspaceError extends Error {
  constructor(message: string, public readonly failureClass: 'WORKSPACE_CREATION_FAILED' | 'WORKSPACE_SHA_MISMATCH' | 'WORKSPACE_INFRA_FAILURE') {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface WorkspaceHandle {
  workspaceId: string;
  path: string;
  exactShaVerified: boolean;
  checkoutSha: string;
}

interface RegistryEntry {
  status: 'active' | 'cleaned';
  path: string;
}

@Injectable()
export class WorkspaceManager {
  // Process-local collision guard. A single NestJS process is this
  // service's whole deployment unit for R22-C; a multi-instance deployment
  // would need a durable (DB-backed) lock instead -- explicitly out of
  // scope for this phase, noted rather than silently assumed away.
  private readonly registry = new Map<string, RegistryEntry>();

  // @Optional(): a bare `string` constructor param has no DI token Nest can
  // resolve on its own (it would otherwise throw "cannot resolve
  // dependency... String at index [0]" at application bootstrap). @Optional
  // makes Nest pass `undefined` instead of throwing, which is exactly what
  // triggers the JS default parameter value below. Tests construct this
  // class directly (`new WorkspaceManager(scratchDir)`), bypassing Nest's
  // injector entirely, so this only matters for the real DI-wired instance.
  constructor(@Optional() private readonly workspaceRoot: string = DEFAULT_WORKSPACE_ROOT) {}

  workspaceId(requestId: string, batchId: string, candidateAttempt: number): string {
    for (const [label, value] of [['requestId', requestId], ['batchId', batchId]] as const) {
      if (!IDENTITY_SEGMENT_PATTERN.test(value)) {
        throw new WorkspaceError(`Invalid ${label} for workspace identity: ${JSON.stringify(value)}`, 'WORKSPACE_CREATION_FAILED');
      }
    }
    if (!Number.isInteger(candidateAttempt) || candidateAttempt < 0) {
      throw new WorkspaceError(`Invalid candidateAttempt: ${JSON.stringify(candidateAttempt)}`, 'WORKSPACE_CREATION_FAILED');
    }
    return `${requestId}/${batchId}/attempt-${candidateAttempt}`;
  }

  private resolveWorkspacePath(workspaceId: string): string {
    const resolved = path.resolve(this.workspaceRoot, workspaceId);
    const rootWithSep = path.resolve(this.workspaceRoot) + path.sep;
    if (!resolved.startsWith(rootWithSep)) {
      // Cannot happen given workspaceId()'s own allowlist regex, but this is
      // the actual escape-prevention check, not a decorative comment.
      throw new WorkspaceError('Computed workspace path escapes the workspace root.', 'WORKSPACE_CREATION_FAILED');
    }
    return resolved;
  }

  createWorkspace(params: { repoPath: string; candidateBaseSha: string; requestId: string; batchId: string; candidateAttempt: number }): WorkspaceHandle {
    const workspaceId = this.workspaceId(params.requestId, params.batchId, params.candidateAttempt);
    const existing = this.registry.get(workspaceId);
    if (existing?.status === 'active') {
      throw new WorkspaceError(`Workspace ${workspaceId} already has an active attempt — refusing to create a second one for the same identity.`, 'WORKSPACE_CREATION_FAILED');
    }

    const workspacePath = this.resolveWorkspacePath(workspaceId);
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });

    try {
      execFileSync('git', ['-C', params.repoPath, 'worktree', 'add', '--detach', workspacePath, params.candidateBaseSha], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      throw new WorkspaceError(`git worktree add failed: ${String(err?.stderr || err?.message || 'unknown error').slice(0, 500)}`, 'WORKSPACE_CREATION_FAILED');
    }

    this.registry.set(workspaceId, { status: 'active', path: workspacePath });

    let workspaceHeadSha: string;
    try {
      workspaceHeadSha = execFileSync('git', ['-C', workspacePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch (err: any) {
      this.forceCleanup(workspaceId, params.repoPath);
      throw new WorkspaceError(`Could not read workspace HEAD after worktree creation: ${err?.message || 'unknown error'}`, 'WORKSPACE_INFRA_FAILURE');
    }

    if (workspaceHeadSha.toLowerCase() !== params.candidateBaseSha.toLowerCase()) {
      // FAIL CLOSED, per the explicit invariant: never apply candidate
      // files onto a workspace that isn't proven to be at the exact SHA.
      this.forceCleanup(workspaceId, params.repoPath);
      throw new WorkspaceError(
        `Workspace HEAD (${workspaceHeadSha}) does not match candidateBaseSha (${params.candidateBaseSha}).`,
        'WORKSPACE_SHA_MISMATCH',
      );
    }

    return { workspaceId, path: workspacePath, exactShaVerified: true, checkoutSha: workspaceHeadSha };
  }

  cleanupWorkspace(workspaceId: string, repoPath: string): void {
    const entry = this.registry.get(workspaceId);
    if (!entry) return; // never created, or already cleaned — idempotent no-op
    this.forceCleanup(workspaceId, repoPath);
  }

  private forceCleanup(workspaceId: string, repoPath: string): void {
    const entry = this.registry.get(workspaceId);
    const workspacePath = entry?.path ?? this.resolveWorkspacePath(workspaceId);
    try {
      execFileSync('git', ['-C', repoPath, 'worktree', 'remove', '--force', workspacePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      // Worktree metadata may already be gone (e.g. creation failed before
      // registration completed) — fall back to a plain directory removal,
      // scoped strictly to the owned workspace path, never repoPath itself.
      try { fs.rmSync(workspacePath, { recursive: true, force: true }); } catch { /* best-effort, never throw from cleanup */ }
    }
    this.registry.set(workspaceId, { status: 'cleaned', path: workspacePath });
  }

  /** True only for a workspace this manager created and has not yet cleaned. Test/inspection helper. */
  isActive(workspaceId: string): boolean {
    return this.registry.get(workspaceId)?.status === 'active';
  }
}
