// R22-C — CRITICAL INVARIANT 3 groundwork: the future Git Writer (not
// implemented this phase) MUST call this before writing anything to
// GitHub, and MUST consume the exact same CandidateManifest object that was
// verified. This function is the only place that decision is made, so a
// later phase cannot accidentally skip it by inlining an ad hoc check.
import { CandidateManifest, CandidateVerification, VerificationEvidence, VerificationResult } from './candidate-verification.types';
import { buildVerificationEvidence } from './verification-evidence';
import { isFullGitSha } from '../incidents/incidents.service';

export type WriteGuardRejectionReason =
  | 'HEAD_ONLY_NOT_WRITABLE'
  | 'VERIFICATION_NOT_PASS'
  | 'CANDIDATE_DIGEST_MISMATCH'
  | 'CANDIDATE_BASE_SHA_MISMATCH'
  | 'WORKSPACE_SHA_NOT_VERIFIED'
  | 'FULL_TEST_REQUIRED';

export type WriteGuardResult = { ok: true } | { ok: false; reason: WriteGuardRejectionReason; verificationEvidence?: VerificationEvidence };

export function assertCandidateStillValidForWrite(
  verification: VerificationResult,
  candidateManifest: CandidateManifest,
): WriteGuardResult {
  if ('mode' in verification && verification.mode === 'HEAD_ONLY') return { ok: false, reason: 'HEAD_ONLY_NOT_WRITABLE' };
  const candidate = verification as CandidateVerification;
  if (candidate.mode && candidate.mode !== 'FULL_TEST') return { ok: false, reason: 'FULL_TEST_REQUIRED' };
  // R76 -- observability only: a bounded diagnostic summary travels
  // alongside the same, unchanged rejection reason. It never influences
  // this decision (computed only after overall!=='PASS' is already
  // established) and both FAIL and INCONCLUSIVE keep being rejected
  // identically, exactly as before.
  if (verification.overall !== 'PASS') {
    return { ok: false, reason: 'VERIFICATION_NOT_PASS', verificationEvidence: buildVerificationEvidence(candidate) };
  }
  const manifestDigest = candidateManifest.candidateDigest;
  if (!manifestDigest || candidate.identity.candidateDigest !== manifestDigest) {
    return { ok: false, reason: 'CANDIDATE_DIGEST_MISMATCH' };
  }
  // Equality alone is not proof: two equally-malformed values (e.g. both
  // "abc") would pass a bare `===` check. Every SHA in this decision must
  // independently be a full 40-hex git SHA before any comparison between
  // them means anything.
  if (!isFullGitSha(candidateManifest.candidateBaseSha) || !isFullGitSha(candidate.identity.candidateBaseSha)
    || candidate.identity.candidateBaseSha.toLowerCase() !== candidateManifest.candidateBaseSha.toLowerCase()) {
    return { ok: false, reason: 'CANDIDATE_BASE_SHA_MISMATCH' };
  }
  if (verification.workspace.exactShaVerified !== true
    || !isFullGitSha(verification.workspace.requestedSha) || !isFullGitSha(verification.workspace.checkoutSha)
    || verification.workspace.requestedSha.toLowerCase() !== candidateManifest.candidateBaseSha.toLowerCase()
    || verification.workspace.checkoutSha.toLowerCase() !== verification.workspace.requestedSha.toLowerCase()) {
    return { ok: false, reason: 'WORKSPACE_SHA_NOT_VERIFIED' };
  }
  return { ok: true };
}
