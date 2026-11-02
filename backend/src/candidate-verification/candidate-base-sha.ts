// Calcule le SHA de base à partir duquel un candidat de remédiation doit être comparé : le HEAD de la branche de remédiation si elle existe déjà, sinon le SHA baseline fourni.
import { isFullGitSha } from './candidate-digest';

export interface CandidateBaseShaInput {
  remediationBranchExists: boolean;
  remediationBranchHeadSha?: string | null;
  baselineSha?: string | null;
}

// Erreur levée quand le SHA de base ne peut pas être résolu de façon sûre.
export class CandidateBaseShaResolutionError extends Error {
  /** Initialise l’erreur avec son contexte. */
  constructor(message: string) {
    super(message);
    this.name = 'CandidateBaseShaResolutionError';
  }
}

// Détermine le SHA de base d'un candidat : HEAD de la branche de remédiation si elle
// existe, sinon le SHA baseline ; lève une erreur plutôt que de retourner une valeur fausse.
export function resolveCandidateBaseSha(input: CandidateBaseShaInput): string {
  if (input.remediationBranchExists) {
    if (!isFullGitSha(input.remediationBranchHeadSha)) {
      throw new CandidateBaseShaResolutionError(
        'Remediation branch exists but its HEAD SHA is missing/invalid — refusing to fall back to baseline SHA.',
      );
    }
    return input.remediationBranchHeadSha!.toLowerCase();
  }
  if (!isFullGitSha(input.baselineSha)) {
    throw new CandidateBaseShaResolutionError(
      'Remediation branch does not exist and no valid baseline SHA was supplied.',
    );
  }
  return input.baselineSha!.toLowerCase();
}
