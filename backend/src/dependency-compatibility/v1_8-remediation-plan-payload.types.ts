// V1.8 Phase 5 ticket — Phase 6: the VALIDATED-PLAN payload contract for
// WF6. Deliberately does NOT extend/replace Wf6BatchDispatchPayload
// (manual-remediation.service.ts) -- that payload stays exactly
// {projectId, batchId, findingTaskIds} for every dispatch made while
// V1_8_SECURITY_ENFORCEMENT !== 'ENFORCED' (see v1_8-enforcement-mode.ts),
// byte-for-byte unchanged. This type is the ADDITIONAL, opt-in shape sent
// only in ENFORCED mode, alongside the existing fields -- never instead of
// them (a caller/n8n version that has not been updated yet simply ignores
// the extra fields it does not recognize).
//
// "For DIRECT_EXPLICIT... do not send only fixedVersion for owner-managed
// remediation" -- this is why remediationPlan below always carries the
// FULL edit description (editType/actualEditTarget/fromVersion/toVersion/
// expectedResolvedDependency), never a bare version string, regardless of
// which edit type it describes.
import { V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

export interface Wf6RemediationPlanFragment {
  editType: 'DEPENDENCY_VERSION' | 'PROPERTY_VERSION' | 'DEPENDENCY_MANAGEMENT_VERSION' | 'BOM_VERSION' | 'PARENT_VERSION';
  actualEditTarget: string;
  fromVersion: string;
  toVersion: string;
  expectedResolvedDependency: string;
}

export interface Wf6ValidatedFindingPayload {
  findingTaskId: string;
  source: string;
  cve: string;
  installedVersion: string;
  compatibilityEvidenceId: string;
  remediationPlan: Wf6RemediationPlanFragment;
}

/** Built ONLY from an evidence entry that already passed canDispatchSecurityRemediationV1_8() (ALLOW) -- this function has no gating logic of its own and must never be called on a BLOCKed decision (the caller's own gate call is what proves that, not this function). */
export function buildWf6ValidatedFindingPayload(findingTaskId: string, evidence: V1_8CompatibilityDecision): Wf6ValidatedFindingPayload {
  if (evidence.state !== 'VALIDATED_RECOMMENDED' || !evidence.editType || !evidence.actualEditTarget || !evidence.toVersion || !evidence.fromVersion) {
    throw new Error('buildWf6ValidatedFindingPayload: evidence is not a validated, complete plan -- caller must gate with canDispatchSecurityRemediationV1_8() first.');
  }
  return {
    findingTaskId, source: evidence.findingSource, cve: evidence.cve, installedVersion: evidence.installedVersion,
    compatibilityEvidenceId: evidence.evidenceId,
    remediationPlan: {
      editType: evidence.editType, actualEditTarget: evidence.actualEditTarget,
      fromVersion: evidence.fromVersion, toVersion: evidence.toVersion,
      expectedResolvedDependency: evidence.expectedResolvedDependency ?? evidence.toVersion,
    },
  };
}
