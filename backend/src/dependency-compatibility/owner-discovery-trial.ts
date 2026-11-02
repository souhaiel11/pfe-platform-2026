// Modélise l'essai réel d'une modification du parent/BOM propriétaire et la lecture de l'arbre produit.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RemediationPlan } from './remediation-plan';
import { applyOwnerVersionEdit } from './owner-pom-edit';

export interface OwnerDiscoveryTrialResult {
  ownerFromVersion: string;
  ownerToVersion: string;
  resolvedVulnerableVersion: string | null;
  status: 'RESOLVED' | 'EXPECTED_DEPENDENCY_NOT_RESOLVED' | 'DEPENDENCY_RESOLUTION_FAILED' | 'POM_EDIT_FAILED' | 'TIMEOUT';
  evidence: string[];
  /**
   * V1.8 Phase 3 ticket — the full real `mvn dependency:tree` text this
   * trial produced (null when the trial never reached a successful tree
   * run). Exposed so a caller checking MULTIPLE vulnerable dependencies
   * against the SAME owner edit (owner+fromVersion+candidateVersion) can
   * cache this ONE real tree and call extractResolvedVersion() again for
   * each dependency, instead of re-running `mvn dependency:tree` once per
   * dependency for an edit that is byte-identical every time (Phase 11's
   * own deduplication instinct) -- never re-executes a real Maven
   * operation whose result cannot have changed.
   */
  treeText: string | null;
}

/** Exécute dépendance arbre. */
function runDependencyTree(cwd: string, timeoutMs: number): { ok: boolean; text: string | null; evidenceTail: string; timedOut: boolean } {
  const outputFile = path.join(cwd, '.pfe-owner-trial-dependency-tree.txt');
  try {
    execFileSync('mvn', ['dependency:tree', '-B', `-DoutputFile=${outputFile}`, '-DoutputType=text'],
      { cwd, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      return { ok: true, text: fs.readFileSync(outputFile, 'utf8'), evidenceTail: '', timedOut: false };
    } catch {
      return { ok: false, text: null, evidenceTail: 'mvn dependency:tree exited 0 but the output file was not written.', timedOut: false };
    } finally {
      try { fs.unlinkSync(outputFile); } catch { /* best-effort */ }
    }
  } catch (err: any) {
    const timedOut = err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT';
    const output = String(err?.stdout ?? '') + String(err?.stderr ?? '');
    return { ok: false, text: null, evidenceTail: output.slice(-800), timedOut };
  }
}

/** Extrait Resolved version. */
export function extractResolvedVersion(treeText: string, groupArtifact: string): string | null {
  if (!treeText || !groupArtifact) return null;
  const escaped = groupArtifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}:jar:([^:\\s]+):`, 'm');
  const match = treeText.match(pattern);
  return match ? match[1] : null;
}

/** Exécute propriétaire Discovery Trial. */
export function runOwnerDiscoveryTrial(input: {
  workspacePath: string;
  pomRelativePath: string;
  plan: Pick<RemediationPlan, 'editType' | 'editCoordinate' | 'vulnerableDependency' | 'fromVersion'>;
  ownerCandidateVersion: string;
  timeoutMs?: number;
}): OwnerDiscoveryTrialResult {
  const timeoutMs = input.timeoutMs ?? 120000;
  const pomPath = path.join(input.workspacePath, input.pomRelativePath);
  const originalContent = fs.readFileSync(pomPath, 'utf8');
  const ownerFromVersion = input.plan.fromVersion;

  const edit = applyOwnerVersionEdit(originalContent, input.plan, input.ownerCandidateVersion);
  if (!edit.ok) {
    return {
      ownerFromVersion, ownerToVersion: input.ownerCandidateVersion, resolvedVulnerableVersion: null,
      status: 'POM_EDIT_FAILED', evidence: [`applyOwnerVersionEdit failed: ${edit.reason}`], treeText: null,
    };
  }

  try {
    fs.writeFileSync(pomPath, edit.content!, 'utf8');
    const tree = runDependencyTree(input.workspacePath, timeoutMs);
    if (tree.timedOut) {
      return { ownerFromVersion, ownerToVersion: input.ownerCandidateVersion, resolvedVulnerableVersion: null, status: 'TIMEOUT', evidence: [`mvn dependency:tree timed out after ${timeoutMs}ms.`], treeText: null };
    }
    if (!tree.ok || !tree.text) {
      return { ownerFromVersion, ownerToVersion: input.ownerCandidateVersion, resolvedVulnerableVersion: null, status: 'DEPENDENCY_RESOLUTION_FAILED', evidence: [tree.evidenceTail || 'mvn dependency:tree failed.'], treeText: null };
    }
    const resolved = extractResolvedVersion(tree.text, input.plan.vulnerableDependency);
    if (!resolved) {
      return {
        ownerFromVersion, ownerToVersion: input.ownerCandidateVersion, resolvedVulnerableVersion: null,
        status: 'EXPECTED_DEPENDENCY_NOT_RESOLVED', treeText: tree.text,
        evidence: [`${input.plan.vulnerableDependency} did not appear at all in the real dependency:tree after bumping ${input.plan.editCoordinate} to ${input.ownerCandidateVersion} -- never guessed.`],
      };
    }
    return {
      ownerFromVersion, ownerToVersion: input.ownerCandidateVersion, resolvedVulnerableVersion: resolved,
      status: 'RESOLVED', treeText: tree.text,
      evidence: [`Real mvn dependency:tree after bumping ${input.plan.editCoordinate} to ${input.ownerCandidateVersion}: ${input.plan.vulnerableDependency} resolves to ${resolved}. This proves resolution only -- NOT security closure (Phase 7); that requires a real rescan.`],
    };
  } finally {
    try { fs.writeFileSync(pomPath, originalContent, 'utf8'); } catch { /* best-effort restore; the whole worktree is caller-owned and caller-cleaned regardless */ }
  }
}
