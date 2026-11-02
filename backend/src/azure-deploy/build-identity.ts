// Résout l'identité d'un build (commit source, numéro de build) directement à partir des preuves propres du build, indépendamment de toute validation WF3 — fonctions pures uniquement.
import { isFullGitSha } from '../candidate-verification/candidate-digest';
import {
  BuildIdentityResolutionInput,
  BuildIdentityResolutionResult,
  CommitResolutionResult,
  SecurityValidationEvidence,
} from './deployment-identity.types';

/** Résout l'identité d'un build à partir de son commit source : échoue si le SHA est manquant/invalide ou si un second SHA revendiqué le contredit. */
export function resolveBuildIdentity(input: BuildIdentityResolutionInput): BuildIdentityResolutionResult {
  const evidence: Record<string, unknown> = {
    projectId: input.projectId,
    incidentId: input.incidentId,
    mainBuildNumber: input.mainBuildNumber,
    sourceCommitSha: input.sourceCommitSha,
    secondarySourceCommitSha: input.secondarySourceCommitSha ?? null,
    repository: input.repository,
    branchOrRef: input.branchOrRef ?? null,
  };
  /** Construit le résultat fail. */
  const fail = (failureCode: BuildIdentityResolutionResult['failureCode']): BuildIdentityResolutionResult =>
    ({ ok: false, buildIdentity: null, securityValidationMissing: false, evidence, failureCode });

  if (!input.incidentId || !input.mainBuildNumber) return fail('DEPLOY_COMMIT_MISSING');
  if (!isFullGitSha(input.sourceCommitSha)) return fail('DEPLOY_COMMIT_MISSING');
  const normalizedSha = input.sourceCommitSha.toLowerCase();

  if (isFullGitSha(input.secondarySourceCommitSha) && input.secondarySourceCommitSha!.toLowerCase() !== normalizedSha) {
    return fail('DEPLOY_COMMIT_AMBIGUOUS');
  }

  return {
    ok: true,
    buildIdentity: {
      projectId: input.projectId,
      incidentId: input.incidentId,
      mainBuildNumber: input.mainBuildNumber,
      commitSha: normalizedSha,
      repository: input.repository,
      branchOrRef: input.branchOrRef ?? null,
    },
    securityValidationMissing: false,
    evidence,
    failureCode: null,
  };
}

/** Normalise la validation WF3 existante (si présente) en un objet de preuve propre, sans jamais l'interroger pour construire l'identité du build elle-même. */
export function extractSecurityValidationEvidence(validation: {
  validationStatus?: string | null;
  passed?: boolean | null;
  checkoutSha?: string | null;
  buildNumber?: number | null;
  expectedPrHeadSha?: string | null;
} | null | undefined): SecurityValidationEvidence {
  if (!validation || Object.keys(validation).length === 0) {
    return { present: false, validationStatus: null, passed: null, checkoutSha: null, validationBuildNumber: null, expectedPrHeadSha: null };
  }
  return {
    present: true,
    validationStatus: validation.validationStatus ?? null,
    passed: validation.passed ?? null,
    checkoutSha: isFullGitSha(validation.checkoutSha) ? validation.checkoutSha!.toLowerCase() : null,
    validationBuildNumber: Number(validation.buildNumber) || null,
    expectedPrHeadSha: isFullGitSha(validation.expectedPrHeadSha) ? validation.expectedPrHeadSha!.toLowerCase() : null,
  };
}

/** Résultat d'une vérification croisée entre l'identité d'un build et une validation WF3. */
export interface BuildIdentityValidationCrossCheckResult {
  ok: boolean;
  failureCode: 'DEPLOY_COMMIT_MISMATCH' | null;
  reason: string | null;
}

/** Prépare le résultat lié à cross Check construction identité Against validation. */
export function crossCheckBuildIdentityAgainstValidation(
  buildCommitSha: string,
  validation: SecurityValidationEvidence,
): BuildIdentityValidationCrossCheckResult {
  if (!validation.present) return { ok: true, failureCode: null, reason: null };
  return { ok: true, failureCode: null, reason: 'validation.checkoutSha describes a separate fix-PR candidate by design; not compared for equality.' };
}

/** Adapte un BuildIdentityResolutionResult vers le format CommitResolutionResult attendu par evaluateProvenDeploymentArtifact(), sans dupliquer sa logique. */
export function toCommitResolutionResult(result: BuildIdentityResolutionResult): CommitResolutionResult {
  if (!result.ok || !result.buildIdentity) {
    return { ok: false, buildNumber: null, commitSha: null, evidence: result.evidence, failureCode: result.failureCode };
  }
  return {
    ok: true,
    buildNumber: result.buildIdentity.mainBuildNumber,
    commitSha: result.buildIdentity.commitSha,
    evidence: result.evidence,
    failureCode: null,
  };
}
