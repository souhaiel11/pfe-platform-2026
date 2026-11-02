// Crée et nettoie les espaces isolés de vérification.
import { Injectable, Optional } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_WORKSPACE_ROOT = '/var/pfe-remediation-workspaces';
const IDENTITY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class WorkspaceError extends Error {
  /** Initialise l’erreur avec son contexte. */
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

  private readonly createdDirectories = new Set<string>();

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(@Optional() private readonly workspaceRoot: string = DEFAULT_WORKSPACE_ROOT) {}

  /** Construit l’identifiant de l’espace de travail. */
  workspaceId(requestId: string, batchId: string, candidateAttempt: number, verificationStep?: number): string {
    for (const [label, value] of [['requestId', requestId], ['batchId', batchId]] as const) {
      if (!IDENTITY_SEGMENT_PATTERN.test(value)) {
        throw new WorkspaceError(`Invalid ${label} for workspace identity: ${JSON.stringify(value)}`, 'WORKSPACE_CREATION_FAILED');
      }
    }
    if (!Number.isInteger(candidateAttempt) || candidateAttempt < 0) {
      throw new WorkspaceError(`Invalid candidateAttempt: ${JSON.stringify(candidateAttempt)}`, 'WORKSPACE_CREATION_FAILED');
    }
    if (verificationStep !== undefined && (!Number.isInteger(verificationStep) || verificationStep < 0))
      throw new WorkspaceError(`Invalid verificationStep: ${JSON.stringify(verificationStep)}`, 'WORKSPACE_CREATION_FAILED');
    return `${requestId}/${batchId}/attempt-${candidateAttempt}${verificationStep === undefined ? '' : `/step-${verificationStep}`}`;
  }

  /** Résout le chemin en le confinant à l’espace autorisé. */
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

  /** Crée un espace isolé pour la vérification. */
  createWorkspace(params: { repoPath: string; candidateBaseSha: string; requestId: string; batchId: string; candidateAttempt: number; verificationStep?: number }): WorkspaceHandle {
    const workspaceId = this.workspaceId(params.requestId, params.batchId, params.candidateAttempt, params.verificationStep);
    const existing = this.registry.get(workspaceId);
    if (existing?.status === 'active') {
      throw new WorkspaceError(`Workspace ${workspaceId} already has an active attempt — refusing to create a second one for the same identity.`, 'WORKSPACE_CREATION_FAILED');
    }

    const workspacePath = this.resolveWorkspacePath(workspaceId);
    this.createOwnedAncestors(workspacePath);

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

  /** Nettoie l’espace de travail après l’opération. */
  cleanupWorkspace(workspaceId: string, repoPath: string): void {
    const entry = this.registry.get(workspaceId);
    if (entry) { this.forceCleanup(workspaceId, repoPath); return; }
    const resolvedPath = this.resolveWorkspacePath(workspaceId);
    if (!fs.existsSync(resolvedPath) && !this.hasOwnedAncestor(resolvedPath)) return;
    this.forceCleanup(workspaceId, repoPath);
  }

  /** Vérifie la présence de Owned Ancestor. */
  private hasOwnedAncestor(resolvedPath: string): boolean {
    const root = path.resolve(this.workspaceRoot);
    for (let dir = path.dirname(resolvedPath); dir !== root; dir = path.dirname(dir)) {
      if (this.createdDirectories.has(dir)) return true;
    }
    return false;
  }

  /** Nettoie les ressources restantes après un échec. */
  private forceCleanup(workspaceId: string, repoPath: string): void {
    const entry = this.registry.get(workspaceId);
    const workspacePath = entry?.path ?? this.resolveWorkspacePath(workspaceId);
    // Code-review addition — symlink protection BEFORE any destructive
    // step, not only during ancestor pruning below: if the resolved leaf
    // path itself is a symlink (never expected in normal operation; this
    // manager never creates one), refuse the normal recursive-removal
    // paths entirely and only ever unlink the symlink itself, never
    // follow it into whatever it points at.
    let leafStat: fs.Stats | undefined;
    try { leafStat = fs.lstatSync(workspacePath); } catch { /* nothing there — nothing to protect against */ }
    if (leafStat && leafStat.isSymbolicLink()) {
      try { fs.unlinkSync(workspacePath); } catch { /* best-effort, never throw from cleanup */ }
      this.registry.set(workspaceId, { status: 'cleaned', path: workspacePath });
      return; // never prune ancestors relative to a symlinked "leaf" -- its real parent chain is not ours to interpret
    }
    try {
      execFileSync('git', ['-C', repoPath, 'worktree', 'remove', '--force', workspacePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      // Worktree metadata may already be gone (e.g. creation failed before
      // registration completed) — fall back to a plain directory removal,
      // scoped strictly to the owned workspace path, never repoPath itself.
      try { fs.rmSync(workspacePath, { recursive: true, force: true }); } catch { /* best-effort, never throw from cleanup */ }
    }
    // Removing only the leaf `workspacePath` left its operation-created
    // ANCESTOR directories behind: createWorkspace()'s ancestor-creation
    // step can create several new directory levels in one call (a never-
    // before-seen requestId AND batchId segment), and neither `git
    // worktree remove` nor the rmSync fallback above ever touches
    // anything above the leaf.
    this.pruneOwnedEmptyAncestors(workspacePath);
    this.registry.set(workspaceId, { status: 'cleaned', path: workspacePath });
  }

  /** Renvoie prune Owned vide Ancestors pour le traitement ou l’affichage. */
  private pruneOwnedEmptyAncestors(workspacePath: string): void {
    const root = path.resolve(this.workspaceRoot);
    let dir = path.dirname(path.resolve(workspacePath));
    while (dir !== root) {
      if (!this.createdDirectories.has(dir)) return;
      let stat;
      try { stat = fs.lstatSync(dir); } catch { this.createdDirectories.delete(dir); return; }
      if (!stat.isDirectory()) return; // a symlink (or anything else) standing where a directory should be: never touch it
      let children: string[];
      try { children = fs.readdirSync(dir); } catch { return; }
      if (children.length > 0) return; // still occupied (e.g. an active sibling workspace) — stop, try again on a later cleanup
      try { fs.rmdirSync(dir); } catch { return; }
      this.createdDirectories.delete(dir);
      dir = path.dirname(dir);
    }
  }

  /** Crée Owned Ancestors. */
  private createOwnedAncestors(workspacePath: string): void {
    const root = path.resolve(this.workspaceRoot);
    const parentDir = path.dirname(path.resolve(workspacePath));
    const chain: string[] = [];
    for (let dir = parentDir; dir !== root; dir = path.dirname(dir)) chain.push(dir);
    for (const dir of chain) if (!fs.existsSync(dir)) this.createdDirectories.add(dir);
    fs.mkdirSync(parentDir, { recursive: true });
  }

  /** Vérifie l’état suivant : actif. */
  isActive(workspaceId: string): boolean {
    return this.registry.get(workspaceId)?.status === 'active';
  }
}
