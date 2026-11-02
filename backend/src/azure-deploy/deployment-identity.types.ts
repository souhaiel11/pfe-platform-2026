// Types purs (sans import NestJS/TypeORM) pour la Strong Deployment Identity.
import { ArtifactPublicationSource } from './publication-provenance';

export type CommitFailureCode =
  | 'DEPLOY_COMMIT_MISSING'
  | 'DEPLOY_COMMIT_MISMATCH'
  | 'DEPLOY_BUILD_MISMATCH'
  | 'DEPLOY_COMMIT_AMBIGUOUS';

export type ArtifactFailureCode =
  | 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE'
  | 'DEPLOY_ARTIFACT_DIGEST_MISSING'
  | 'DEPLOY_ARTIFACT_DIGEST_MISMATCH'
  | 'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH'
  | 'DEPLOY_ARTIFACT_REGISTRY_MISMATCH';

export type ArtifactProvenanceFailureCode =
  | ArtifactFailureCode
  | 'DEPLOY_ARTIFACT_COMMIT_MISMATCH'
  | 'DEPLOY_ARTIFACT_REVISION_MISSING'
  | 'DEPLOY_ARTIFACT_REVISION_MISMATCH'
  | 'DEPLOY_ARTIFACT_PUBLICATION_UNVERIFIED'
  | CommitFailureCode
  | EnvironmentFailureCode;

export type EnvironmentFailureCode = 'DEPLOY_ENVIRONMENT_UNRESOLVED';

export type DeploymentIdentityFailureCode = CommitFailureCode | ArtifactFailureCode | EnvironmentFailureCode;

export interface CommitResolutionInput {
  reportBuildNumber: number | null;
  reportCommitSha?: string | null;
  validation?: {
    buildNumber?: number | null;
    validationStatus?: string | null;
    passed?: boolean | null;
    checkoutSha?: string | null;
    expectedPrHeadSha?: string | null;
    mergeAuthorization?: { forSha?: string | null } | null;
  } | null;
}

export interface CommitResolutionResult {
  ok: boolean;
  buildNumber: number | null;
  commitSha: string | null;
  evidence: Record<string, unknown>;
  failureCode: CommitFailureCode | null;
}

export interface AcrDigestLookup {
  found: boolean;
  registry?: string | null;
  repository?: string | null;
  tag?: string | null;
  digest?: string | null;
}

export interface ArtifactResolutionInput {
  targetRegistry: string | null;
  targetRepository: string | null;
  requestedTag: string | null;
  lookup: AcrDigestLookup | null;
  expectedDigest?: string | null;
}

export interface ArtifactResolutionResult {
  ok: boolean;
  imageReference: string | null;
  artifactDigest: string | null;
  evidence: Record<string, unknown>;
  failureCode: ArtifactFailureCode | null;
}

export interface EnvironmentIdentity {
  provider: string;
  resourceGroup: string;
  registry: string;
  targetName: string;
  region: string | null;
  environmentIdentityHash: string;
}

export interface EnvironmentResolutionResult {
  ok: boolean;
  environmentIdentity: EnvironmentIdentity | null;
  failureCode: EnvironmentFailureCode | null;
}

export interface DeploymentArtifactRecord {
  projectId: string;
  buildNumber: number;
  commitSha: string;
  registry: string;
  repository: string;
  tag: string;
  digest: string;
  source: 'JENKINS_PIPELINE' | 'MANUAL_REGISTERED' | 'UNKNOWN';
  provenanceVerified: boolean;
  publicationSource?: ArtifactPublicationSource | null;
}

export interface ArtifactProvenanceResolutionInput {
  commit: CommitResolutionResult;
  environment: EnvironmentResolutionResult;
  targetRegistry: string | null;
  targetRepository: string | null;
  candidateArtifact: DeploymentArtifactRecord | null;
  freshLookup?: AcrDigestLookup | null;
  freshRevisionCheck?: { available: boolean; revision?: string | null } | null;
}

export interface ArtifactProvenanceResolutionResult {
  ok: boolean;
  commitSha: string | null;
  buildNumber: number | null;
  registry: string | null;
  repository: string | null;
  tag: string | null;
  digest: string | null;
  provenanceEvidence: Record<string, unknown>;
  failureCode: ArtifactProvenanceFailureCode | null;
}

export interface DeploymentIdentity {
  projectId: string;
  buildNumber: number;
  commitSha: string;
  artifactRegistry: string;
  artifactRepository: string;
  artifactTag: string;
  artifactDigest: string;
  environmentIdentity: EnvironmentIdentity;
  deploymentIdentityHash: string;
}

export type BuildIdentityFailureCode = 'DEPLOY_COMMIT_MISSING' | 'DEPLOY_COMMIT_AMBIGUOUS' | 'DEPLOY_COMMIT_MISMATCH';

export interface BuildIdentity {
  projectId: string;
  incidentId: string;
  mainBuildNumber: number;
  commitSha: string;
  repository: string | null;
  branchOrRef: string | null;
}

export interface BuildIdentityResolutionInput {
  projectId: string;
  incidentId: string | null;
  mainBuildNumber: number | null;
  sourceCommitSha: string | null;
  secondarySourceCommitSha?: string | null;
  repository: string | null;
  branchOrRef?: string | null;
}

export interface BuildIdentityResolutionResult {
  ok: boolean;
  buildIdentity: BuildIdentity | null;
  securityValidationMissing: boolean;
  evidence: Record<string, unknown>;
  failureCode: BuildIdentityFailureCode | null;
}

export interface SecurityValidationEvidence {
  present: boolean;
  validationStatus: string | null;
  passed: boolean | null;
  checkoutSha: string | null;
  validationBuildNumber: number | null;
  expectedPrHeadSha: string | null;
}

export type GovernanceClass = 'READY' | 'CONDITIONAL' | 'CRITICAL_RISK' | 'TECHNICALLY_IMPOSSIBLE';

export type { SecurityValidationApplicability } from './security-validation-applicability';

export interface GovernanceRiskSignals {
  securityValidationApplicability: import('./security-validation-applicability').SecurityValidationApplicability;
  testsStatus: string | null;
  sonarQualityGate: string | null;
  trivyCritical: number;
  owaspCritical: number;
  judgeDecision: string | null;
  unresolvedBlockingCount: number;
  requiredStages: Array<{ stage: string; status: string; blocking?: boolean; required?: boolean }>;
}

export interface GovernanceDecisionResult {
  class: GovernanceClass;
  technicallyImpossibleReasons: string[];
  criticalRiskReasons: string[];
  conditionalReasons: string[];
  buildIdentity: BuildIdentityResolutionResult;
  artifactProvenance: ArtifactProvenanceResolutionResult | null;
  environment: EnvironmentResolutionResult;
}
