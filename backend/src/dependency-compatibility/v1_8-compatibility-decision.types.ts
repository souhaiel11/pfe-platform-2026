// Définit les décisions V1.8 et l'enveloppe liant une preuve à un dépôt, commit, composant, CVE et plan exacts.
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

/** Vérifie l’état suivant : automatique correction disponible V1 8. */
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
