// R22-C — CRITICAL INVARIANT 1: candidateBaseSha must never be silently
// equated to main/baseline SHA. This function makes the two real cases
// (remediation branch already exists vs. does not exist yet) explicit and
// fails closed on anything else -- it never fetches/infers anything itself
// (that stays the caller's job, same as WF2's own `Branch Exists?` node),
// it only refuses to guess when given inconsistent inputs.
import { isFullGitSha } from '../incidents/incidents.service';

export interface CandidateBaseShaInput {
  remediationBranchExists: boolean;
  /** Required and used only when remediationBranchExists is true. */
  remediationBranchHeadSha?: string | null;
  /** Required and used only when remediationBranchExists is false. */
  baselineSha?: string | null;
}

export class CandidateBaseShaResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateBaseShaResolutionError';
  }
}

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
