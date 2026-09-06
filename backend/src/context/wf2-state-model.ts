// R22-A Phase 6 — WF2 state model preparation.
//
// Target states, per the approved migration plan. NOT wired into any
// control flow this phase (Phase 10 explicitly defers replacing the
// existing PR Git write path) -- this is the vocabulary future phases will
// use, plus a translation layer FROM the real, currently-persisted
// `fixRequest.status` values, so that migration never requires a blind
// rename of already-persisted incident records (existing values:
// FIX_STARTING, DISPATCHED, FIX_FAILED, PR_CREATED, VALIDATED, REJECTED --
// see incidents.service.ts).
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

/**
 * Best-effort mapping from what is persisted today to the target
 * vocabulary. Deliberately approximate in one place (VALIDATED and
 * PR_CREATED both map to CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION): the
 * current pipeline has no distinct persisted state for "scanner validation
 * already passed" versus "candidate produced, awaiting validation" beyond
 * validation.passed itself, and the target enum given for this phase has no
 * dedicated post-validation-success state either. Documented here rather
 * than inventing a new target state not in the approved list.
 */
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
