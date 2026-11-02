// Décide si une validation WF3 existante constitue une preuve applicable à UN artefact précis.
import { SecurityValidationEvidence } from './deployment-identity.types';

export type SecurityValidationApplicability = 'APPLICABLE' | 'NOT_APPLICABLE' | 'MISSING' | 'FAILED' | 'AMBIGUOUS';

/** Verdict d'applicabilité d'une validation WF3 à un artefact donné, avec sa justification. */
export interface SecurityValidationApplicabilityResult {
  applicability: SecurityValidationApplicability;
  reason: string;
}

/** Décide si une validation WF3 existante constitue une preuve POUR cet artefact précis. */
export function evaluateSecurityValidationApplicability(
  artifactCommitSha: string,
  validation: SecurityValidationEvidence,
): SecurityValidationApplicabilityResult {
  if (!validation.present) {
    return { applicability: 'MISSING', reason: 'Aucune validation WF3 enregistrée pour cet incident.' };
  }
  if (!validation.checkoutSha) {
    return { applicability: 'AMBIGUOUS', reason: 'Validation WF3 présente mais sans checkoutSha exploitable — impossible de déterminer son applicabilité.' };
  }
  const applies = validation.checkoutSha.toLowerCase() === artifactCommitSha.toLowerCase();
  if (!applies) {
    return {
      applicability: 'NOT_APPLICABLE',
      reason: `validation.checkoutSha (${validation.checkoutSha}) concerne une candidate distincte (fix-PR) de l'artefact authentifié (${artifactCommitSha}) — validation non applicable à CET artefact, jamais une incohérence d'identité.`,
    };
  }
  if (validation.validationStatus === 'VALIDATED' && validation.passed === true) {
    return { applicability: 'APPLICABLE', reason: 'validation.checkoutSha correspond exactement au commit de cet artefact et la validation a réussi.' };
  }
  return {
    applicability: 'FAILED',
    reason: `validation.checkoutSha correspond à cet artefact mais validationStatus="${validation.validationStatus}"/passed=${validation.passed} — validation applicable mais en échec.`,
  };
}
