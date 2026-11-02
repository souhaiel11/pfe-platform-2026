// Dernier verrou avant toute écriture GitHub.
import { CandidateManifest, CandidateVerification, VerificationEvidence, VerificationResult } from './candidate-verification.types';
import { buildVerificationEvidence } from './verification-evidence';
import { isFullGitSha } from './candidate-digest';
import { evaluateGeneratedCommentGuardForFile } from './generated-comment-guard';

export type WriteGuardRejectionReason =
  | 'HEAD_ONLY_NOT_WRITABLE'
  | 'VERIFICATION_NOT_PASS'
  | 'CANDIDATE_DIGEST_MISMATCH'
  | 'CANDIDATE_BASE_SHA_MISMATCH'
  | 'WORKSPACE_SHA_NOT_VERIFIED'
  | 'FULL_TEST_REQUIRED'
  | 'GENERATED_COMMENT_MARKER_FORBIDDEN'
  | 'GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE'
  | 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH';

export type WriteGuardResult =
  | { ok: true }
  | { ok: false; reason: WriteGuardRejectionReason; verificationEvidence?: VerificationEvidence; generatedCommentViolations?: string[] };

/** Dernier verrou avant une écriture GitHub. */
export function assertCandidateStillValidForWrite(
  verification: VerificationResult,
  candidateManifest: CandidateManifest,
): WriteGuardResult {
  if ('mode' in verification && verification.mode === 'HEAD_ONLY') return { ok: false, reason: 'HEAD_ONLY_NOT_WRITABLE' };
  const candidate = verification as CandidateVerification;
  if (candidate.mode && candidate.mode !== 'FULL_TEST') return { ok: false, reason: 'FULL_TEST_REQUIRED' };
  if (verification.overall !== 'PASS') {
    return { ok: false, reason: 'VERIFICATION_NOT_PASS', verificationEvidence: buildVerificationEvidence(candidate) };
  }
  const manifestDigest = candidateManifest.candidateDigest;
  if (!manifestDigest || candidate.identity.candidateDigest !== manifestDigest) {
    return { ok: false, reason: 'CANDIDATE_DIGEST_MISMATCH' };
  }
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
  for (const file of candidateManifest.files) {
    const verdict = evaluateGeneratedCommentGuardForFile(file);
    if (verdict.ok === false && verdict.reason === 'INPUT_INCOMPLETE') {
      return { ok: false, reason: 'GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE' };
    }
    if (verdict.ok === false && verdict.reason === 'INTEGRITY_MISMATCH') {
      return { ok: false, reason: 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH' };
    }
  }
  const generatedCommentViolations = candidateManifest.files.flatMap(file => {
    const verdict = evaluateGeneratedCommentGuardForFile(file);
    return verdict.ok === false && verdict.reason === 'MARKER_FORBIDDEN' ? verdict.violations : [];
  });
  if (generatedCommentViolations.length > 0) {
    return { ok: false, reason: 'GENERATED_COMMENT_MARKER_FORBIDDEN', generatedCommentViolations };
  }
  return { ok: true };
}
