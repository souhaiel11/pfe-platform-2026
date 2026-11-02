// Vocabulaire d'états cible pour WF2 (pas encore branché sur le flux de contrôle
// actuel), plus une table de traduction depuis les statuts `fixRequest.status`
// réellement persistés aujourd'hui.
export type Wf2TargetState =
  | 'RECEIVED'
  | 'CONTEXT_BUILDING'
  | 'CONTEXT_REQUIRED'
  | 'RESEARCHING'
  | 'PLANNED'
  | 'GENERATING'
  | 'CANDIDATE_READY'
  | 'VERIFYING'
  | 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION'
  | 'CANDIDATE_REJECTED'
  | 'HUMAN_DECISION_REQUIRED'
  | 'INCONCLUSIVE';

export const CURRENT_FIX_REQUEST_STATUSES = [
  'FIX_STARTING', 'DISPATCHED', 'FIX_FAILED', 'PR_CREATED', 'VALIDATED', 'REJECTED',
] as const;
export type CurrentFixRequestStatus = (typeof CURRENT_FIX_REQUEST_STATUSES)[number];

// Traduit un statut `fixRequest.status` actuellement persisté vers le vocabulaire
// d'état cible WF2 ; renvoie 'UNKNOWN' si le statut n'est pas reconnu.
export function translateCurrentFixRequestStatus(status: string | undefined | null): Wf2TargetState | 'UNKNOWN' {
  switch (status) {
    case 'FIX_STARTING': return 'RECEIVED';
    case 'DISPATCHED': return 'GENERATING';
    case 'FIX_FAILED': return 'CANDIDATE_REJECTED';
    case 'PR_CREATED': return 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION';
    case 'VALIDATED': return 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION';
    case 'REJECTED': return 'CANDIDATE_REJECTED';
    default: return 'UNKNOWN';
  }
}
