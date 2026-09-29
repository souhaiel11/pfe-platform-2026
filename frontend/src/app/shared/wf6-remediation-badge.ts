// ─────────────────────────────────────────────────────────────────────
// Contrat d'honnêteté (déjà établi, non négociable) : WF6 ne sait pas si
// une PR a été fusionnée (aucun polling GitHub post-création) -- ce module
// ne renvoie donc jamais "corrigé/résolu", uniquement "proposé".
//
// Écart de vocabulaire corrigé ici (preuve : TEST 1 / TEST 2, PR #38/#39) :
// ManualRemediationTask.securityFindingRemediation.status n'a PAS la même
// signification selon le chemin qui l'a écrit --
//   - chemin mono-CVE historique (/result, ex. PR #37) : status est le
//     statut GLOBAL du pipeline WF6 ("CANDIDATE_READY", "NOT_ELIGIBLE", ...).
//   - chemin batch (/batch-result, N>=1, ex. PR #38/#39) : status est le
//     statut PAR CVE dérivé de deriveCveClosureStatus() ("CLOSED" /
//     "STILL_OPEN" / "NOT_OBSERVED", + les statuts d'échec amont du pipeline
//     comme "PATCH_CONFLICT"/"NOT_ELIGIBLE"/"GROUNDING_FAILED"/"PENDING").
//     Aucun statut GLOBAL n'est jamais persisté par tâche sur ce chemin
//     (recordWf6BatchResult n'écrit que finding.status, jamais dto.status)
//     -- le statut PAR CVE est donc la seule vérité disponible, ce qui
//     tombe bien : c'est exactement ce qu'un badge PAR CVE doit refléter.
//
// Les deux vocabulaires partagent le même champ `status` et les mêmes
// champs prUrl/prNumber/branchName/candidateIdentity -- seul l'ENSEMBLE de
// valeurs que `status` peut prendre diffère selon le chemin d'origine.
// ─────────────────────────────────────────────────────────────────────

export interface Wf6RemediationLike {
  status?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  reason?: string | null;
}

const POSITIVE_STATUSES = new Set(['CANDIDATE_READY', 'CLOSED']);

/**
 * Une PR existe ET cette CVE précise est traitée par le candidat qui l'a
 * produite -- dans les DEUX vocabulaires connus (mono-CVE historique
 * "CANDIDATE_READY", batch "CLOSED"). Ne renvoie jamais un badge positif
 * pour un statut qui ne confirme pas la fermeture de CETTE CVE (ex.
 * STILL_OPEN avec un prUrl hérité d'une tentative batch antérieure
 * différente -- la non-érasure de prUrl côté backend rend ce cas réel).
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
