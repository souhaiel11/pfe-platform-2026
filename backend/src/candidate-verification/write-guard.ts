// R22-C — CRITICAL INVARIANT 3 groundwork: the future Git Writer (not
// implemented this phase) MUST call this before writing anything to
// GitHub, and MUST consume the exact same CandidateManifest object that was
// verified. This function is the only place that decision is made, so a
// later phase cannot accidentally skip it by inlining an ad hoc check.
import { CandidateManifest, CandidateVerification } from './candidate-verification.types';

export type WriteGuardRejectionReason =
  | 'VERIFICATION_NOT_PASS'
  | 'CANDIDATE_DIGEST_MISMATCH'
  | 'CANDIDATE_BASE_SHA_MISMATCH'
  | 'WORKSPACE_SHA_NOT_VERIFIED';

export type WriteGuardResult = { ok: true } | { ok: false; reason: WriteGuardRejectionReason };

export function assertCandidateStillValidForWrite(
  verification: CandidateVerification,
  candidateManifest: CandidateManifest,
): WriteGuardResult {
  if (verification.overall !== 'PASS') {
    return { ok: false, reason: 'VERIFICATION_NOT_PASS' };
  }
  const manifestDigest = candidateManifest.candidateDigest;
  if (!manifestDigest || verification.identity.candidateDigest !== manifestDigest) {
    return { ok: false, reason: 'CANDIDATE_DIGEST_MISMATCH' };
  }
  if (verification.identity.candidateBaseSha.toLowerCase() !== candidateManifest.candidateBaseSha.toLowerCase()) {
    return { ok: false, reason: 'CANDIDATE_BASE_SHA_MISMATCH' };
  }
  if (verification.workspace.exactShaVerified !== true) {
    return { ok: false, reason: 'WORKSPACE_SHA_NOT_VERIFIED' };
  }
  return { ok: true };
}
