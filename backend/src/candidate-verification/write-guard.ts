// R22-C — CRITICAL INVARIANT 3 groundwork: the future Git Writer (not
// implemented this phase) MUST call this before writing anything to
// GitHub, and MUST consume the exact same CandidateManifest object that was
// verified. This function is the only place that decision is made, so a
// later phase cannot accidentally skip it by inlining an ad hoc check.
import { CandidateManifest, CandidateVerification, VerificationEvidence, VerificationResult } from './candidate-verification.types';
import { buildVerificationEvidence } from './verification-evidence';
import { isFullGitSha } from '../incidents/incidents.service';
import { evaluateGeneratedCommentGuardForFile } from './generated-comment-guard';

export type WriteGuardRejectionReason =
  | 'HEAD_ONLY_NOT_WRITABLE'
  | 'VERIFICATION_NOT_PASS'
  | 'CANDIDATE_DIGEST_MISMATCH'
  | 'CANDIDATE_BASE_SHA_MISMATCH'
  | 'WORKSPACE_SHA_NOT_VERIFIED'
  | 'FULL_TEST_REQUIRED'
  // R81 — an automated-remediation OUTPUT-QUALITY violation (the candidate
  // itself introduced a TODO/FIXME marker in comment text it generated or
  // modified), never a claim about the application's own pre-existing
  // defect taxonomy. See generated-comment-guard.ts.
  | 'GENERATED_COMMENT_MARKER_FORBIDDEN'
  // R81.2 — FAIL CLOSED: a MODIFY on an extension the guard claims to
  // support arrived without trustworthy pre-edit content (missing/null/not
  // a string). Silently skipping the marker check here (as R81 did) is
  // fail-OPEN — any upstream breakage that drops sourceContent would
  // silently disable the guard instead of blocking the write. This reason
  // means "the guard's own precondition was not met", never "a marker was
  // found" and never an application defect.
  | 'GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE'
  // R81.3 — sourceContent was present and well-formed (so R81.2's own gate
  // passed) but does NOT hash to the trusted `originalBlobSha` GitHub itself
  // reported for that path/ref before the writer LLM ran. This is the
  // forgery case R81.2 could not detect on its own: a candidate/caller
  // supplying its OWN fabricated "pre-edit" text (so the comment-marker
  // diff finds nothing "new") is now cryptographically distinguishable from
  // the real pre-edit blob. Never a claim that a marker was found, and never
  // conflated with GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE (that reason is
  // reserved for "the trust anchor is ABSENT", this one for "it is PRESENT
  // but does not match").
  | 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH';

export type WriteGuardResult =
  | { ok: true }
  | { ok: false; reason: WriteGuardRejectionReason; verificationEvidence?: VerificationEvidence; generatedCommentViolations?: string[] };

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
  // R81/R81.2/R81.3 — output-quality gate, checked last (only once every
  // identity/verification precondition above already holds). Generic on file
  // extension only — no rule/project/file literal anywhere in this
  // decision. FAIL CLOSED (R81.2): a supported-extension MODIFY missing
  // trustworthy pre-edit content is rejected outright. FAIL CLOSED, CRYPTO-
  // BOUND (R81.3): trustworthy now also means CRYPTOGRAPHICALLY AUTHENTIC —
  // sourceContent must hash to the candidate's own claimed originalBlobSha
  // (itself GitHub's report for that path/ref, captured before the writer
  // LLM ran; see generated-comment-guard.ts). Both failure modes are checked
  // first and short-circuit the whole candidate, since an incomplete or
  // forged input file makes the marker check for THIS candidate unreliable
  // regardless of what any other file in it looks like.
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
