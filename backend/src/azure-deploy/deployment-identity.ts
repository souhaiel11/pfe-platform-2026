// Fonctions pures de résolution de la Strong Deployment Identity.
import { createHash } from 'crypto';
import { isFullGitSha } from '../candidate-verification/candidate-digest';
import { publicationAllowsDeployment } from './publication-provenance';
import {
  AcrDigestLookup,
  ArtifactProvenanceResolutionInput,
  ArtifactProvenanceResolutionResult,
  ArtifactResolutionInput,
  ArtifactResolutionResult,
  CommitResolutionInput,
  CommitResolutionResult,
  DeploymentIdentity,
  EnvironmentIdentity,
  EnvironmentResolutionResult,
} from './deployment-identity.types';

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;

/** Établit le commit git validé pour CE build précisément. */
export function resolveValidatedDeploymentCommit(input: CommitResolutionInput): CommitResolutionResult {
  const validation = input.validation || null;
  const evidence: Record<string, unknown> = {
    reportBuildNumber: input.reportBuildNumber,
    reportCommitSha: input.reportCommitSha ?? null,
    validationBuildNumber: validation?.buildNumber ?? null,
    validationStatus: validation?.validationStatus ?? null,
    validationPassed: validation?.passed ?? null,
    checkoutSha: validation?.checkoutSha ?? null,
    expectedPrHeadSha: validation?.expectedPrHeadSha ?? null,
    mergeAuthorizationForSha: validation?.mergeAuthorization?.forSha ?? null,
  };
  /** Construit le résultat fail. */
  const fail = (failureCode: CommitResolutionResult['failureCode']): CommitResolutionResult =>
    ({ ok: false, buildNumber: null, commitSha: null, evidence, failureCode });

  const reportBuildNumber = input.reportBuildNumber;
  const validationBuildNumber = validation?.buildNumber ?? null;
  if (!reportBuildNumber || !validationBuildNumber || reportBuildNumber !== validationBuildNumber) {
    return fail('DEPLOY_BUILD_MISMATCH');
  }

  if (validation?.validationStatus !== 'VALIDATED' || validation?.passed !== true) {
    return fail('DEPLOY_COMMIT_MISSING');
  }

  const checkoutSha = validation?.checkoutSha;
  if (!isFullGitSha(checkoutSha)) return fail('DEPLOY_COMMIT_MISSING');
  const normalizedCheckout = checkoutSha.toLowerCase();

  const otherClaims: Array<{ name: string; value: unknown }> = [
    { name: 'expectedPrHeadSha', value: validation?.expectedPrHeadSha },
    { name: 'mergeAuthorizationForSha', value: validation?.mergeAuthorization?.forSha },
    { name: 'reportCommitSha', value: input.reportCommitSha },
  ];
  const conflicting = otherClaims.filter(c => isFullGitSha(c.value) && String(c.value).toLowerCase() !== normalizedCheckout);
  if (conflicting.length > 0) {
    const onlyExpectedPrHead = conflicting.length === 1 && conflicting[0].name === 'expectedPrHeadSha';
    return fail(onlyExpectedPrHead ? 'DEPLOY_COMMIT_MISMATCH' : 'DEPLOY_COMMIT_AMBIGUOUS');
  }

  return { ok: true, buildNumber: reportBuildNumber, commitSha: normalizedCheckout, evidence, failureCode: null };
}

/** Résout l'identité d'un artefact à partir d'une recherche RÉELLE de digest ACR — un simple tag texte (même « latest ») ne prouve jamais rien seul. */
export function evaluateArtifactIdentity(input: ArtifactResolutionInput): ArtifactResolutionResult {
  const evidence: Record<string, unknown> = {
    targetRegistry: input.targetRegistry,
    targetRepository: input.targetRepository,
    requestedTag: input.requestedTag,
    lookup: input.lookup,
    expectedDigest: input.expectedDigest ?? null,
  };
  /** Construit le résultat fail. */
  const fail = (failureCode: ArtifactResolutionResult['failureCode']): ArtifactResolutionResult =>
    ({ ok: false, imageReference: null, artifactDigest: null, evidence, failureCode });

  if (!input.targetRegistry || !input.targetRepository) return fail('DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');
  if (!input.lookup || input.lookup.found !== true) return fail('DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');

  const digest = input.lookup.digest;
  if (!digest || !DIGEST_RE.test(digest)) return fail('DEPLOY_ARTIFACT_DIGEST_MISSING');
  const normalizedDigest = digest.toLowerCase();

  if (input.lookup.registry && input.lookup.registry !== input.targetRegistry) return fail('DEPLOY_ARTIFACT_REGISTRY_MISMATCH');
  if (input.lookup.repository && input.lookup.repository !== input.targetRepository) return fail('DEPLOY_ARTIFACT_REPOSITORY_MISMATCH');

  if (input.expectedDigest && input.expectedDigest.toLowerCase() !== normalizedDigest) return fail('DEPLOY_ARTIFACT_DIGEST_MISMATCH');

  const imageReference = `${input.targetRegistry}.azurecr.io/${input.targetRepository}@${normalizedDigest}`;
  return { ok: true, imageReference, artifactDigest: normalizedDigest, evidence, failureCode: null };
}

interface CanonicalEnvironmentConfig {
  provider: string | null | undefined;
  resourceGroup: string | null | undefined;
  registry: string | null | undefined;
  targetName: string | null | undefined;
}

/** Calcule un hash déterministe de l'environnement cible (provider+resourceGroup+registry+targetName+region) à partir du seul azureConfig du projet, jamais d'une valeur envoyée par le frontend. */
export function deriveDeploymentEnvironmentIdentity(
  azureConfig: (CanonicalEnvironmentConfig & { region?: string | null }) | null | undefined,
): EnvironmentResolutionResult {
  if (!azureConfig || !azureConfig.provider || !azureConfig.resourceGroup || !azureConfig.registry || !azureConfig.targetName) {
    return { ok: false, environmentIdentity: null, failureCode: 'DEPLOY_ENVIRONMENT_UNRESOLVED' };
  }
  const canonical = {
    provider: String(azureConfig.provider),
    resourceGroup: String(azureConfig.resourceGroup),
    registry: String(azureConfig.registry),
    targetName: String(azureConfig.targetName),
    region: azureConfig.region ? String(azureConfig.region) : null,
  };
  const environmentIdentityHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return { ok: true, environmentIdentity: { ...canonical, environmentIdentityHash }, failureCode: null };
}

/** Hash canonique de déploiement à partir des 3 composants porteurs d'identité (projectId, commitSha, artifactDigest, environnement) — numéro de build/tag/registre sont évidentiels, pas identitaires. */
export function computeDeploymentIdentityHash(identity: {
  projectId: string;
  commitSha: string;
  artifactDigest: string;
  environmentIdentity: Pick<EnvironmentIdentity, 'environmentIdentityHash'>;
}): string {
  const canonical = {
    projectId: identity.projectId,
    commitSha: identity.commitSha.toLowerCase(),
    artifactDigest: identity.artifactDigest.toLowerCase(),
    environmentIdentityHash: identity.environmentIdentity.environmentIdentityHash,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Assemble la DeploymentIdentity finale à partir des trois résolutions (commit/artefact/environnement) ; renvoie null si l'une des trois a échoué. */
export function buildDeploymentIdentity(params: {
  projectId: string;
  commit: CommitResolutionResult;
  artifact: ArtifactResolutionResult & { registry: string; repository: string; tag: string };
  environment: EnvironmentResolutionResult;
}): DeploymentIdentity | null {
  if (!params.commit.ok || !params.artifact.ok || !params.environment.ok) return null;
  if (!params.commit.buildNumber || !params.commit.commitSha || !params.artifact.artifactDigest || !params.environment.environmentIdentity) return null;
  const base = {
    projectId: params.projectId,
    buildNumber: params.commit.buildNumber,
    commitSha: params.commit.commitSha,
    artifactRegistry: params.artifact.registry,
    artifactRepository: params.artifact.repository,
    artifactTag: params.artifact.tag,
    artifactDigest: params.artifact.artifactDigest,
    environmentIdentity: params.environment.environmentIdentity,
  };
  return { ...base, deploymentIdentityHash: computeDeploymentIdentityHash(base) };
}

/** Évalue Proven déploiement artefact. */
export function evaluateProvenDeploymentArtifact(input: ArtifactProvenanceResolutionInput): ArtifactProvenanceResolutionResult {
  const evidence: Record<string, unknown> = {
    commitOk: input.commit.ok,
    commitFailureCode: input.commit.failureCode,
    environmentOk: input.environment.ok,
    environmentFailureCode: input.environment.failureCode,
    targetRegistry: input.targetRegistry,
    targetRepository: input.targetRepository,
    candidateArtifact: input.candidateArtifact,
    freshLookup: input.freshLookup ?? null,
    publicationSource: input.candidateArtifact?.publicationSource ?? null,
    artifactIdentityProven: input.candidateArtifact?.provenanceVerified ?? null,
  };
  /** Construit le résultat fail. */
  const fail = (failureCode: ArtifactProvenanceResolutionResult['failureCode']): ArtifactProvenanceResolutionResult =>
    ({ ok: false, commitSha: null, buildNumber: null, registry: null, repository: null, tag: null, digest: null, provenanceEvidence: evidence, failureCode });

  if (!input.commit.ok || !input.commit.buildNumber || !input.commit.commitSha) return fail(input.commit.failureCode || 'DEPLOY_COMMIT_MISSING');
  if (!input.environment.ok) return fail(input.environment.failureCode || 'DEPLOY_ENVIRONMENT_UNRESOLVED');
  if (!input.targetRegistry || !input.targetRepository) return fail('DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');

  const artifact = input.candidateArtifact;
  if (!artifact) return fail('DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');

  if (artifact.buildNumber !== input.commit.buildNumber) return fail('DEPLOY_BUILD_MISMATCH');

  if (artifact.commitSha.toLowerCase() !== input.commit.commitSha.toLowerCase()) return fail('DEPLOY_ARTIFACT_COMMIT_MISMATCH');

  if (!DIGEST_RE.test(artifact.digest)) return fail('DEPLOY_ARTIFACT_DIGEST_MISSING');
  if (artifact.registry !== input.targetRegistry) return fail('DEPLOY_ARTIFACT_REGISTRY_MISMATCH');
  if (artifact.repository !== input.targetRepository) return fail('DEPLOY_ARTIFACT_REPOSITORY_MISMATCH');

  if (!artifact.provenanceVerified) return fail('DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');

  if (!publicationAllowsDeployment(artifact.publicationSource)) {
    return fail('DEPLOY_ARTIFACT_PUBLICATION_UNVERIFIED');
  }

  if (input.freshLookup) {
    if (!input.freshLookup.found || !input.freshLookup.digest) return fail('DEPLOY_ARTIFACT_DIGEST_MISSING');
    if (input.freshLookup.digest.toLowerCase() !== artifact.digest.toLowerCase()) return fail('DEPLOY_ARTIFACT_DIGEST_MISMATCH');
  }

  if (input.freshRevisionCheck) {
    if (!input.freshRevisionCheck.available || !input.freshRevisionCheck.revision) return fail('DEPLOY_ARTIFACT_REVISION_MISSING');
    if (input.freshRevisionCheck.revision.toLowerCase() !== input.commit.commitSha.toLowerCase()) return fail('DEPLOY_ARTIFACT_REVISION_MISMATCH');
  }

  return {
    ok: true,
    commitSha: artifact.commitSha.toLowerCase(),
    buildNumber: artifact.buildNumber,
    registry: artifact.registry,
    repository: artifact.repository,
    tag: artifact.tag,
    digest: artifact.digest.toLowerCase(),
    provenanceEvidence: evidence,
    failureCode: null,
  };
}

export type { AcrDigestLookup };
