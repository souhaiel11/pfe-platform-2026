// V1.8 Phase 4 ticket — "Controlled Decision Integration". Pure types only.
//
// This is the ADDITIVE `compatibilityDecision` shape the ticket asks for.
// It is deliberately a NEW, separate type -- never a modification of
// SecurityEligibilityResult/SecurityRemediationType (security-eligibility-classifier.ts)
// or SecurityFindingDecision (security-finding-decision.types.ts), both of
// which remain byte-for-byte unchanged and continue to be the ONLY inputs
// WF6 dispatch and the existing frontend checkbox logic ever read (see
// Phase 12's own requirement: WF6_DECISION_SOURCE stays CURRENT_PRODUCTION).
export type V1_8CompatibilityState =
  | 'VALIDATED_RECOMMENDED'
  | 'VALIDATED_ALTERNATIVES'
  | 'SECURITY_TARGET_UNKNOWN'
  | 'PROJECT_CONTEXT_INSUFFICIENT'
  | 'MAJOR_UPGRADE_REQUIRES_REVIEW'
  | 'NO_COMPATIBLE_CANDIDATE'
  | 'VALIDATION_FAILED'
  // Kept in the vocabulary for honesty (a finding not yet covered by any
  // generated evidence, e.g. one newly created after the evidence store was
  // last generated) -- Phase 3's real run reached zero of these across all
  // 251 real findings, but the lookup service must never silently treat an
  // UNKNOWN finding as any of the states above.
  | 'NOT_YET_SANDBOXED';

/**
 * V1.8 Phase 5 ticket — Phase 2 "evidence binding". The exact context this
 * evidence entry was validated against -- never used for the compatibility
 * DECISION itself (that stays exactly the fields below), only for the Phase
 * 3 stale-evidence guard's field-by-field comparison against a live task's
 * CURRENT context. `evidenceId` is a deterministic content hash (repository
 * + cve + component + editType + fromVersion + toVersion) -- reproducible,
 * never random, so regenerating the store from the same real inputs always
 * yields the same id (see v1_8_phase4_generate_evidence_store.ts's own
 * computeEvidenceId()).
 */
export interface V1_8EvidenceBinding {
  evidenceId: string;
  schemaVersion: 2;
  repository: string;
  validatedCommitSha: string;
  findingSource: 'OWASP' | 'TRIVY';
  cve: string;
  component: string;
  installedVersion: string;
  validationRunId: string;
  validatedAt: string;
}

export interface V1_8CompatibilityDecision extends V1_8EvidenceBinding {
  state: V1_8CompatibilityState;
  recommendedVersion: string | null;
  actualEditTarget: string | null;
  editType: 'DEPENDENCY_VERSION' | 'PROPERTY_VERSION' | 'DEPENDENCY_MANAGEMENT_VERSION' | 'BOM_VERSION' | 'PARENT_VERSION' | null;
  fromVersion: string | null;
  toVersion: string | null;
  /** The version the vulnerable dependency is EXPECTED to resolve to after the edit -- for a DIRECT/PROPERTY edit this equals toVersion; for an owner (PARENT/BOM) edit, toVersion is the OWNER's version while this is the actual dependency's resulting version (see remediation-plan.ts's own expectedResolvedDependencyVersion, the same distinction, reused verbatim). */
  expectedResolvedDependency: string | null;
  ownerType: 'PARENT' | 'IMPORTED_BOM' | 'DEPENDENCY_MANAGEMENT' | null;
  ownerCoordinate: string | null;
  evidenceSummary: string;
  recommendationReason: string;
  sandboxValidated: boolean;
  targetCveClosed: boolean | null;
  newHighCriticalCount: number | null;
  requiresDeveloperReview: boolean;
}

/**
 * Phase 5 — "Define, but do not yet activate, the future rule." Pure
 * function; not called from any live controller/service/WF6 path in this
 * phase (grep this repository for its name to confirm — its only callers
 * are its own spec file and, later, whatever phase eventually activates
 * it). Every clause below is checked explicitly, in the order the ticket
 * itself lists them, so a future activation is a one-line call-site change,
 * never a re-derivation of this rule.
 */
export function isAutoFixAvailableV1_8(decision: V1_8CompatibilityDecision): boolean {
  if (decision.state !== 'VALIDATED_RECOMMENDED') return false;
  if (decision.sandboxValidated !== true) return false;
  if (decision.targetCveClosed !== true) return false;
  if (decision.newHighCriticalCount !== 0) return false;
  if (decision.requiresDeveloperReview === true) return false;
  if (decision.recommendedVersion == null) return false;
  if (decision.actualEditTarget == null) return false;
  return true;
}
