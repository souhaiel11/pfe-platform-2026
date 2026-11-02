// Contrat d'autorisation de merge : donne à « un humain peut-il merger cette PR ?

import { FindingVerdict, PipelineHealth } from './finding-pipeline-separation';

export type MergeAuthorization =
  | 'MERGE_READY'
  | 'BLOCKED'
  | 'INCONCLUSIVE'
  | 'VALIDATING';

export type RemediationResult = 'VALIDATED' | 'INVALID' | 'INCONCLUSIVE';

export type RegressionResult = 'CLEAN' | 'CHANGES_REQUIRED' | 'INCONCLUSIVE';
export type HeadVerificationResult = 'PASS' | 'CODE_FAILURE' | 'INCONCLUSIVE';

export type MergeBlockingReason =
  | 'FINDING_INVALID'
  | 'REMEDIATION_INCONCLUSIVE'
  | 'REGRESSION_CHANGES_REQUIRED'
  | 'REGRESSION_UNVERIFIED'
  | 'HEAD_VERIFICATION_UNVERIFIED'
  | 'HEAD_VERIFICATION_CODE_FAILURE'
  | 'STAGE_INCOMPLETE'
  | 'SHA_MISMATCH'
  | 'VALIDATION_IN_PROGRESS'
  | 'DEFAULT_VALUE_SEMANTICS_REGRESSION'
  | 'DEFAULT_VALUE_SEMANTICS_UNVERIFIED';

export interface MergeAdvisory {
  code: string;
  message: string;
}

export interface MergeAuthorizationInput {
  remediationResult: RemediationResult;
  exactCorrelationVerified: boolean;
  requiredStagesComplete: boolean;
  regressionResult: RegressionResult;
  headVerificationResult?: HeadVerificationResult;
  pipelineHealth?: Partial<PipelineHealth> | null;
  validationInProgress?: boolean;
  defaultValueSemanticsResult?: 'PROVEN_DEFECT' | 'VERIFICATION_REQUIRED' | 'NO_DEFECT' | null;
  defaultValueSemanticsRequired?: boolean;
  defaultValueSemanticsEvaluatedShaMatches?: boolean;
  defaultValueSemanticsCheckedPairs?: number;
  defaultValueSemanticsRelevantPairChecked?: boolean;
}

export interface MergeAuthorizationResult {
  authorization: MergeAuthorization;
  remediationResult: RemediationResult;
  regressionResult: RegressionResult;
  headVerificationResult: HeadVerificationResult;
  blockingReasons: MergeBlockingReason[];
  technicalReasons: MergeBlockingReason[];
  advisories: MergeAdvisory[];
}

// Agrège les verdicts par finding en un seul verdict de lot : VALIDATED si tous
// valides, INVALID si au moins un invalide, sinon INCONCLUSIVE (y compris si vide).
export function deriveRemediationResult(findingVerdicts: readonly FindingVerdict[]): RemediationResult {
  if (findingVerdicts.some(v => v === 'INVALID')) return 'INVALID';
  if (findingVerdicts.length > 0 && findingVerdicts.every(v => v === 'VALID')) return 'VALIDATED';
  return 'INCONCLUSIVE';
}

// Vérifie que la corrélation est exacte : WF3 a confirmé la corrélation ET le SHA
// validé correspond exactement au HEAD de PR attendu.
export function deriveExactCorrelationVerified(input: {
  correlationVerified: unknown;
  checkoutSha: unknown;
  expectedPrHeadSha: unknown;
}): boolean {
  const a = String(input.checkoutSha ?? '').toLowerCase();
  const b = String(input.expectedPrHeadSha ?? '').toLowerCase();
  const shaOk = /^[a-f0-9]{40}$/.test(a) && a === b;
  return input.correlationVerified === true && shaOk;
}

const CODE_FAILURE_CLASSES = new Set(['CANDIDATE_COMPILE_FAILURE', 'CANDIDATE_TEST_REGRESSION']);

// Classe le résultat du vérificateur HEAD_ONLY : PASS si overall==='PASS',
// CODE_FAILURE seulement si overall==='FAIL' avec une classe d'échec reconnue comme
// défaut de code, sinon INCONCLUSIVE.
export function deriveHeadVerificationResult(input: {
  overall?: unknown;
  failureClass?: unknown;
} | null | undefined): HeadVerificationResult {
  if (!input || input.overall === 'INCONCLUSIVE') return 'INCONCLUSIVE';
  if (input.overall === 'PASS') return 'PASS';
  if (input.overall === 'FAIL' && CODE_FAILURE_CLASSES.has(String(input.failureClass || ''))) return 'CODE_FAILURE';
  return 'INCONCLUSIVE';
}

/** Calcule l’autorisation de fusion. */
export function computeMergeAuthorization(input: MergeAuthorizationInput): MergeAuthorizationResult {
  const advisories = buildAdvisories(input.pipelineHealth);
  const headVerificationResult = input.headVerificationResult ?? 'INCONCLUSIVE';

  if (input.validationInProgress === true) {
    return {
      authorization: 'VALIDATING', remediationResult: input.remediationResult, regressionResult: input.regressionResult,
      headVerificationResult,
      blockingReasons: [], technicalReasons: ['VALIDATION_IN_PROGRESS'], advisories,
    };
  }

  const blockingReasons: MergeBlockingReason[] = [];
  const technicalReasons: MergeBlockingReason[] = [];

  if (input.remediationResult === 'INVALID') blockingReasons.push('FINDING_INVALID');
  else if (input.remediationResult === 'INCONCLUSIVE') technicalReasons.push('REMEDIATION_INCONCLUSIVE');

  if (!input.exactCorrelationVerified) technicalReasons.push('SHA_MISMATCH');
  if (!input.requiredStagesComplete) technicalReasons.push('STAGE_INCOMPLETE');

  if (input.regressionResult === 'CHANGES_REQUIRED') blockingReasons.push('REGRESSION_CHANGES_REQUIRED');
  else if (input.regressionResult === 'INCONCLUSIVE') technicalReasons.push('REGRESSION_UNVERIFIED');

  if (headVerificationResult === 'CODE_FAILURE') blockingReasons.push('HEAD_VERIFICATION_CODE_FAILURE');
  else if (headVerificationResult !== 'PASS') technicalReasons.push('HEAD_VERIFICATION_UNVERIFIED');

  if (input.defaultValueSemanticsResult === 'PROVEN_DEFECT') {
    blockingReasons.push('DEFAULT_VALUE_SEMANTICS_REGRESSION');
  } else if (input.defaultValueSemanticsRequired === true) {
    const stale = input.defaultValueSemanticsEvaluatedShaMatches !== true;
    const relevantProofPresent = input.defaultValueSemanticsResult === 'NO_DEFECT'
      && (input.defaultValueSemanticsCheckedPairs ?? 0) > 0
      && input.defaultValueSemanticsRelevantPairChecked === true;
    if (stale || !relevantProofPresent) {
      technicalReasons.push('DEFAULT_VALUE_SEMANTICS_UNVERIFIED');
    }
  }

  const hardBlocked = blockingReasons.length > 0;

  let authorization: MergeAuthorization;
  if (hardBlocked) {
    authorization = 'BLOCKED';
  } else if (technicalReasons.length === 0
    && headVerificationResult === 'PASS'
    && input.remediationResult === 'VALIDATED'
    && input.exactCorrelationVerified
    && input.requiredStagesComplete
    && input.regressionResult === 'CLEAN') {
    authorization = 'MERGE_READY';
  } else {
    authorization = 'INCONCLUSIVE';
  }

  return { authorization, remediationResult: input.remediationResult, regressionResult: input.regressionResult,
    headVerificationResult, blockingReasons, technicalReasons, advisories };
}

// Construit les avis non bloquants (Quality Gate Sonar rouge, défaillance technique
// du pipeline) à partir de l'état de santé du pipeline.
function buildAdvisories(health?: Partial<PipelineHealth> | null): MergeAdvisory[] {
  const advisories: MergeAdvisory[] = [];
  if (!health) return advisories;

  const qg = String(health.sonarQualityGate ?? '').toUpperCase();
  if (qg && qg !== 'OK' && qg !== 'PASSED' && qg !== 'UNKNOWN') {
    advisories.push({
      code: `SONAR_QUALITY_GATE_${qg}`,
      message:
        'Le Quality Gate SonarQube global du projet n’est pas au vert. Informatif pour le merge ' +
        '(la correction du batch reste prouvée) ; reste bloquant pour le déploiement via DeployReadiness.',
    });
  }
  if (health.technicalFailure) {
    advisories.push({
      code: 'PIPELINE_TECHNICAL_FAILURE',
      message: 'Le pipeline de validation a signalé une défaillance technique — vérifier le build/infra.',
    });
  }
  return advisories;
}
