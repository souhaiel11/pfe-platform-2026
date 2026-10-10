// Legacy helper retained for compatibility. Only current CANDIDATE_READY can
// produce a proposed-PR badge. Row categories and neutral PR links are driven
// by security-remediation-presentation.ts, including historical CLOSED evidence.

export interface Wf6RemediationLike {
  status?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  reason?: string | null;
}

const POSITIVE_STATUSES = new Set(['CANDIDATE_READY']);

/** Compatibility helper for callers that need a current proposed PR.
 * Historical CLOSED is never a proposal; neutral PR links use the shared presentation.
 */
export function wf6ProposedPr(remediation: Wf6RemediationLike | null | undefined): { prNumber: number | null; prUrl: string } | null {
  if (!remediation || !remediation.prUrl) return null;
  if (!POSITIVE_STATUSES.has(String(remediation.status))) return null;
  return { prNumber: remediation.prNumber ?? null, prUrl: remediation.prUrl };
}

/**
 * Cette CVE appartenait à un lot dont le verdict tout-ou-rien a échoué
 * PARCE QUE cette CVE précise est restée ouverte dans le candidat --
 * jamais un badge positif dans ce cas, mais une indication distincte
 * (le lot a été tenté, pas ignoré).
 */
export function wf6StillOpenInBatch(remediation: Wf6RemediationLike | null | undefined): boolean {
  return !!remediation && remediation.status === 'STILL_OPEN';
}
