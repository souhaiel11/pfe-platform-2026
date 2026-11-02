// Définit et construit le plan de remédiation transmis après une autorisation V1.8. Ce constructeur ne remplace pas la vérification du gate.
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

/** Construit WF6 Validated finding données transmises. */
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
