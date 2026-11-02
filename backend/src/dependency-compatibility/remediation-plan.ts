// Construit le plan indiquant quoi modifier pour corriger une dépendance.
import { DependencyControlProfile } from './dependency-control-profile.types';
import { SecurityCandidate } from './security-candidate-collector';
import { classifyCandidateVersionPolicy, isAutomationEligiblePolicy, CandidateVersionPolicy } from './candidate-version-policy';

export type RemediationEditType =
  | 'DEPENDENCY_VERSION'
  | 'PROPERTY_VERSION'
  | 'DEPENDENCY_MANAGEMENT_VERSION'
  | 'BOM_VERSION'
  | 'PARENT_VERSION';

export interface RemediationPlan {
  vulnerableDependency: string; // groupId:artifactId
  securityCandidate: SecurityCandidate;

  editType: RemediationEditType;
  editCoordinate: string; // the groupId:artifactId (or groupId:artifactId of the BOM/parent) actually being edited
  editProperty: string | null;
  fromVersion: string;
  toVersion: string | null;

  expectedResolvedDependencyVersion: string | null;

  /** True only when toVersion/expectedResolvedDependencyVersion can be known WITHOUT a sandbox trial. */
  requiresSandboxDiscovery: boolean;

  versionPolicy: CandidateVersionPolicy;
  requiresMajorUpgrade: boolean;
  requiresDeveloperReview: boolean;
  automationEligible: boolean;

  evidence: string[];
}

export interface RemediationPlanResult {
  plans: RemediationPlan[];
  /** Non-null exactly when NO plan could be generated for this profile (TRANSITIVE_MANAGED/UNKNOWN with no safe edit target) -- the caller's cue for MANUAL_REVIEW, never a silently empty plans[] with no explanation. */
  manualReviewReason: string | null;
}

/** Ajoute au plan les règles de version applicables. */
function withPolicy(plan: Omit<RemediationPlan, 'versionPolicy' | 'requiresMajorUpgrade' | 'requiresDeveloperReview' | 'automationEligible' | 'evidence'>, evidenceBase: string[], extraEvidence: string): RemediationPlan {
  // Owner edits (BOM/PARENT) with no concrete discovered target version:
  // conservatively UNKNOWN, never assumed safe (Phase 6's own rule -- "does
  // not automatically authorize" a major owner bump just because the
  // dependency needs SOME fix).
  const policy: CandidateVersionPolicy = plan.toVersion
    ? classifyCandidateVersionPolicy(plan.fromVersion, plan.toVersion)
    : { state: 'UNKNOWN', currentVersion: plan.fromVersion, candidateVersion: '(undiscovered)', reason: 'Owner (BOM/parent) target version not yet discovered -- requires a real sandbox trial before any version-safety claim can be made; never assumed safe.' };
  const automationEligible = isAutomationEligiblePolicy(policy);
  return {
    ...plan,
    versionPolicy: policy,
    requiresMajorUpgrade: policy.state === 'CROSS_MAJOR',
    requiresDeveloperReview: !automationEligible,
    automationEligible,
    evidence: [...evidenceBase, extraEvidence, `Version policy: ${policy.state} (${policy.reason})`],
  };
}

/** Construit correction plans. */
export function buildRemediationPlans(profile: DependencyControlProfile, candidates: SecurityCandidate[]): RemediationPlanResult {
  const dep = `${profile.groupId}:${profile.artifactId}`;
  if (!candidates.length) {
    return { plans: [], manualReviewReason: 'NO_SECURITY_CANDIDATE' };
  }

  switch (profile.versionControl) {
    case 'DIRECT_EXPLICIT':
      return {
        manualReviewReason: null,
        plans: candidates.map(c => withPolicy(
          { vulnerableDependency: dep, securityCandidate: c, editType: 'DEPENDENCY_VERSION', editCoordinate: dep, editProperty: null, fromVersion: profile.installedVersion, toVersion: c.version, expectedResolvedDependencyVersion: c.version, requiresSandboxDiscovery: false },
          profile.evidence, `Direct <version> edit on ${dep}: ${profile.installedVersion} -> ${c.version} (source: ${c.source} ${c.cve}).`,
        )),
      };
    case 'PROPERTY':
      return {
        manualReviewReason: null,
        plans: candidates.map(c => withPolicy(
          { vulnerableDependency: dep, securityCandidate: c, editType: 'PROPERTY_VERSION', editCoordinate: dep, editProperty: profile.propertyName, fromVersion: profile.installedVersion, toVersion: c.version, expectedResolvedDependencyVersion: c.version, requiresSandboxDiscovery: false },
          profile.evidence, `Property <${profile.propertyName}> edit: ${profile.installedVersion} -> ${c.version} (source: ${c.source} ${c.cve}).`,
        )),
      };
    case 'DEPENDENCY_MANAGEMENT':
      return {
        manualReviewReason: null,
        plans: candidates.map(c => withPolicy(
          { vulnerableDependency: dep, securityCandidate: c, editType: 'DEPENDENCY_MANAGEMENT_VERSION', editCoordinate: dep, editProperty: null, fromVersion: profile.installedVersion, toVersion: c.version, expectedResolvedDependencyVersion: c.version, requiresSandboxDiscovery: false },
          profile.evidence, `Local <dependencyManagement><dependency> edit for ${dep}: ${profile.installedVersion} -> ${c.version} (source: ${c.source} ${c.cve}).`,
        )),
      };
    case 'IMPORTED_BOM': {
      const bom = `${profile.bomGroupId}:${profile.bomArtifactId}`;
      return {
        manualReviewReason: null,
        plans: candidates.map(c => withPolicy(
          { vulnerableDependency: dep, securityCandidate: c, editType: 'BOM_VERSION', editCoordinate: bom, editProperty: null, fromVersion: profile.bomVersion || '', toVersion: null, expectedResolvedDependencyVersion: null, requiresSandboxDiscovery: true },
          profile.evidence, `${dep}'s version is owned by imported BOM ${bom}:${profile.bomVersion} -- WRONG PLAN would edit ${dep} directly; PREFERRED PLAN bumps the BOM and verifies (via a real sandbox dependency:tree re-check) which ${dep} version it then resolves to before trusting it against ${c.cve}'s target ${c.version}.`,
        )),
      };
    }
    case 'PARENT': {
      const parent = `${profile.parentGroupId}:${profile.parentArtifactId}`;
      return {
        manualReviewReason: null,
        plans: candidates.map(c => withPolicy(
          { vulnerableDependency: dep, securityCandidate: c, editType: 'PARENT_VERSION', editCoordinate: parent, editProperty: null, fromVersion: profile.parentVersion || '', toVersion: null, expectedResolvedDependencyVersion: null, requiresSandboxDiscovery: true },
          profile.evidence, `${dep}'s version is owned by parent ${parent}:${profile.parentVersion} -- WRONG PLAN would edit ${dep} directly; PREFERRED PLAN bumps the parent and verifies (via a real sandbox dependency:tree re-check) which ${dep} version it then resolves to before trusting it against ${c.cve}'s target ${c.version}.`,
        )),
      };
    }
    case 'TRANSITIVE_MANAGED':
      return { plans: [], manualReviewReason: 'TRANSITIVE_NO_ARBITRARY_OVERRIDE: pure transitive dependency -- adding a direct override is not automatically safe; requires explicit project policy + validation this Phase 1 resolver does not assume.' };
    case 'UNKNOWN':
    default:
      return { plans: [], manualReviewReason: 'CONTROL_PROFILE_UNKNOWN: cannot determine what actually controls this dependency\'s version -- never guessed.' };
  }
}
