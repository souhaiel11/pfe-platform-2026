// Regroupe les traitements de WF6 correction badge.

export interface Wf6RemediationLike {
  status?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  reason?: string | null;
}

const POSITIVE_STATUSES = new Set(['CANDIDATE_READY']);

/** Prépare le résultat lié à WF6 Proposed PR. */
export function wf6ProposedPr(remediation: Wf6RemediationLike | null | undefined): { prNumber: number | null; prUrl: string } | null {
  if (!remediation || !remediation.prUrl) return null;
  if (!POSITIVE_STATUSES.has(String(remediation.status))) return null;
  return { prNumber: remediation.prNumber ?? null, prUrl: remediation.prUrl };
}

/** Indique si une tentative WF6 du lot reste en cours. */
export function wf6StillOpenInBatch(remediation: Wf6RemediationLike | null | undefined): boolean {
  return !!remediation && remediation.status === 'STILL_OPEN';
}
