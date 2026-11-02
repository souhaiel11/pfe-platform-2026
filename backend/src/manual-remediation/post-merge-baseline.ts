// Base des corrections après un merge confirmé sans nouveau build (bouton « Merge effectué ») :
// tant qu'aucun build postérieur au merge n'a été analysé, une nouvelle correction sur le même
// fichier doit partir du commit de merge, sinon elle repartirait d'un pom.xml d'avant le correctif.
import { Repository } from 'typeorm';
import { isFullGitSha } from '../candidate-verification/candidate-digest';
import { ManualRemediationTask } from './manual-remediation.entity';

export interface ConfirmedMerge { mergeCommitSha: string; prMergedAt: string }

/** Choisit le commit de base : le merge confirmé s'il est postérieur au build de l'incident, sinon le commit du build. */
export function effectiveBaseSha(incidentSha: string, incidentCreatedAt: Date | string | null | undefined, merge: ConfirmedMerge | null): string {
  if (!merge || !isFullGitSha(String(merge.mergeCommitSha || ''))) return incidentSha;
  const mergedAt = Date.parse(String(merge.prMergedAt || ''));
  const builtAt = incidentCreatedAt ? new Date(incidentCreatedAt as any).getTime() : NaN;
  if (!Number.isFinite(mergedAt) || !Number.isFinite(builtAt) || mergedAt <= builtAt) return incidentSha;
  return String(merge.mergeCommitSha).toLowerCase();
}

/** Dernier merge confirmé (via « Merge effectué ») d'une correction de sécurité du projet, ou null. */
export async function latestConfirmedMerge(tasks: Repository<ManualRemediationTask>, projectId: string): Promise<ConfirmedMerge | null> {
  if (typeof (tasks as any)?.query !== 'function') return null;
  const rows: any[] = await tasks.query(
    `SELECT "securityFindingRemediation"->>'mergeCommitSha' AS sha, "securityFindingRemediation"->>'prMergedAt' AS at
       FROM manual_remediation_tasks
      WHERE "projectId" = $1 AND "securityFindingRemediation"->>'mergeCommitSha' IS NOT NULL
      ORDER BY "securityFindingRemediation"->>'prMergedAt' DESC LIMIT 1`, [projectId]);
  return rows[0]?.sha ? { mergeCommitSha: rows[0].sha, prMergedAt: rows[0].at } : null;
}
