// R-SEC-V1.2 §5 — deterministic, fail-closed pre-GitHub-write guard for a
// security dependency patch. Never called yet by anything that writes to
// GitHub (no such writer exists this phase) — this is the guard itself,
// proven standalone.
//
// KEY DESIGN: item 10-15 of §5 ("no other XML semantic element changed",
// "no dependency added/removed", "no exclusions/suppressions added", "no
// security scanner/plugin weakened", "no tests disabled", "no unrelated
// file changes") all collapse into ONE strong, provably-correct check: the
// guard INDEPENDENTLY RE-DERIVES what the patch should be by calling the
// SAME pure, deterministic writeSecurityPatch() again from the trusted
// request, and requires the proposed candidate to be BYTE-IDENTICAL to that
// re-derivation. writeSecurityPatch() only ever changes the authorized
// <version>/property values, re-deriving a coordinated scope from evidence
// -- so if the proposed candidate differs from a fresh re-run at all, by
// definition something outside those authorized substitutions was altered, and the
// guard rejects without needing a second, separately-maintained "did
// anything else change" implementation to drift out of sync with the writer.
import { computeGitBlobSha1, isFullGitSha } from '../candidate-verification/candidate-digest';
import { majorOf, parseVersion } from './version-selection-policy';
import { writeSecurityPatch } from './maven-security-patch-writer';
import { writeParentVersionPatch, ParentVersionPatchCandidate, ParentVersionPatchRequest } from './maven-parent-patch-writer';
import { SecurityPatchCandidate, SecurityPatchRequest } from './security-patch-request.types';
import { SecurityFindingDecision } from './security-finding-decision.types';

export type SecurityPatchGuardReason =
  | 'SECURITY_PATCH_SCOPE_MISMATCH'
  | 'SECURITY_PATCH_OLD_VERSION_MISMATCH'
  | 'SECURITY_PATCH_TARGET_VERSION_MISMATCH'
  | 'SECURITY_PATCH_UNAUTHORIZED_CHANGE'
  // Reused verbatim, not duplicated: this is the EXACT same invariant the
  // R81.3 write-guard already enforces for every candidate file, generic on
  // file type -- see backend/src/candidate-verification/write-guard.ts.
  | 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH'
  | 'SECURITY_PATCH_PROVENANCE_NOT_AUTOFIXABLE'
  | 'SECURITY_PATCH_CROSS_MAJOR_REJECTED'
  | 'SECURITY_PATCH_SHA_NOT_GROUNDED'
  | 'SECURITY_PATCH_ELIGIBILITY_NOT_CONFIRMED';

export type SecurityPatchGuardResult = { ok: true } | { ok: false; reason: SecurityPatchGuardReason; detail: string };

function fail(reason: SecurityPatchGuardReason, detail: string): SecurityPatchGuardResult {
  return { ok: false, reason, detail };
}

/**
 * `decision` = the ALREADY-COMPUTED, trusted eligibility decision (from
 * classifySecurityAutoFixEligibility, via SecurityFindingDecisionService).
 * `request` = the exact request that was used to build `candidate` (needed
 * to re-derive it independently). `candidate` = the proposed write.
 */
export function assertSecurityPatchSafeToWrite(
  decision: SecurityFindingDecision,
  request: SecurityPatchRequest,
  candidate: SecurityPatchCandidate,
): SecurityPatchGuardResult {
  if (JSON.stringify(decision.remediationScope) !== JSON.stringify(request.remediationScope)) {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', 'The request omitted or changed the complete trusted remediation scope.');
  }
  // 9. provenance kind is DIRECT_EXPLICIT or PROPERTY_MANAGED.
  if (candidate.provenanceKind !== 'DIRECT_EXPLICIT' && candidate.provenanceKind !== 'PROPERTY_MANAGED') {
    return fail('SECURITY_PATCH_PROVENANCE_NOT_AUTOFIXABLE', `provenanceKind "${candidate.provenanceKind}" is never auto-fixable.`);
  }

  // 1. finding identity matches the eligibility decision.
  if (candidate.findingIdentity !== decision.findingIdentity || request.findingIdentity !== decision.findingIdentity) {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', `findingIdentity mismatch: candidate="${candidate.findingIdentity}", request="${request.findingIdentity}", decision="${decision.findingIdentity}".`);
  }

  // Eligibility must have actually concluded AUTO_FIX_ELIGIBLE -- a guard
  // call for any other decision is a caller bug, never silently accepted.
  if (decision.remediationType !== 'AUTO_FIX_ELIGIBLE' || decision.selectedTargetVersion === null) {
    return fail('SECURITY_PATCH_ELIGIBILITY_NOT_CONFIRMED', `decision.remediationType="${decision.remediationType}" (reason=${decision.reason}) -- not AUTO_FIX_ELIGIBLE.`);
  }

  // 2. requested/evaluated SHA exact match, and genuinely a full 40-hex SHA
  // (equality alone is not proof -- same discipline as write-guard.ts's own
  // candidateBaseSha check: two equally-malformed values must never pass).
  if (!isFullGitSha(decision.evaluatedSha) || !isFullGitSha(request.evaluatedSha) || !isFullGitSha(candidate.evaluatedSha)
    || decision.evaluatedSha!.toLowerCase() !== request.evaluatedSha.toLowerCase()
    || request.evaluatedSha.toLowerCase() !== candidate.evaluatedSha.toLowerCase()) {
    return fail('SECURITY_PATCH_SHA_NOT_GROUNDED', `evaluatedSha not consistently a proven full-SHA across decision/request/candidate: decision="${decision.evaluatedSha}", request="${request.evaluatedSha}", candidate="${candidate.evaluatedSha}".`);
  }

  // 4. changed file == authorized controllingFile.
  if (candidate.file.path !== request.controllingFile) {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', `candidate.file.path="${candidate.file.path}" does not match the authorized controllingFile="${request.controllingFile}".`);
  }
  if (candidate.file.operation !== 'MODIFY') {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', `candidate.file.operation="${candidate.file.operation}" -- a security dependency patch is always a MODIFY, never a CREATE.`);
  }

  // 6. old version == grounded installed/old value.
  if (candidate.oldVersion !== request.installedVersion || candidate.oldVersion !== decision.provenance?.installedVersion) {
    return fail('SECURITY_PATCH_OLD_VERSION_MISMATCH', `oldVersion mismatch: candidate="${candidate.oldVersion}", request="${request.installedVersion}", decision.provenance="${decision.provenance?.installedVersion}".`);
  }

  // 7. new version == approved targetVersion.
  if (candidate.targetVersion !== request.targetVersion || candidate.targetVersion !== decision.selectedTargetVersion) {
    return fail('SECURITY_PATCH_TARGET_VERSION_MISMATCH', `targetVersion mismatch: candidate="${candidate.targetVersion}", request="${request.targetVersion}", decision.selectedTargetVersion="${decision.selectedTargetVersion}".`);
  }

  // 8. same-major policy still holds -- independent re-check, never trusts
  // that the writer (or the classifier) already enforced it correctly.
  const oldParsed = parseVersion(candidate.oldVersion);
  const targetParsed = parseVersion(candidate.targetVersion);
  if (!oldParsed || !targetParsed || majorOf(oldParsed) !== majorOf(targetParsed)) {
    return fail('SECURITY_PATCH_CROSS_MAJOR_REJECTED', `oldVersion="${candidate.oldVersion}" -> targetVersion="${candidate.targetVersion}" is not same-major.`);
  }

  // 3. original content integrity: sourceContent must hash to the claimed
  // originalBlobSha -- the EXACT R81.3 write-guard invariant, reused, not
  // reimplemented differently.
  if (computeGitBlobSha1(candidate.file.sourceContent ?? '').toLowerCase() !== String(candidate.file.originalBlobSha ?? '').toLowerCase()) {
    return fail('ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'computeGitBlobSha1(candidate.file.sourceContent) does not match candidate.file.originalBlobSha.');
  }
  // sourceContent itself must be the SAME text the request claims was read
  // at evaluatedSha -- otherwise a caller could swap in different "original"
  // content whose hash happens to validate against a DIFFERENT originalBlobSha
  // than the one actually recorded in the grounded provenance.
  if (candidate.file.sourceContent !== request.sourceContent) {
    return fail('ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'candidate.file.sourceContent does not match request.sourceContent (the grounded pre-edit text).');
  }

  // 5 & 10-15, collapsed into one re-derivation check (see file header):
  // independently recompute the patch from the SAME trusted request and
  // require byte-exact equality with what is being proposed for write.
  const rederived = writeSecurityPatch(request);
  if (rederived.ok !== true) {
    return fail('SECURITY_PATCH_UNAUTHORIZED_CHANGE', `Independent re-derivation of the patch from the same request FAILED (reason=${(rederived as any).reason}) -- the proposed candidate cannot be trusted.`);
  }
  const expected = rederived.candidate;
  if (expected.file.content !== candidate.file.content) {
    return fail('SECURITY_PATCH_UNAUTHORIZED_CHANGE', 'candidate.file.content differs from the deterministic re-derivation -- something beyond the complete authorized version/property substitutions was changed.');
  }
  if (expected.file.path !== candidate.file.path || expected.file.sourceContent !== candidate.file.sourceContent) {
    return fail('SECURITY_PATCH_UNAUTHORIZED_CHANGE', 'candidate.file.path/sourceContent differs from the deterministic re-derivation.');
  }

  return { ok: true };
}

// V1.8 Phase 7B — the PARENT_VERSION counterpart of assertSecurityPatchSafeToWrite()
// above. A SEPARATE, self-contained function (that function is NEVER
// modified for this -- "do not weaken the existing guard"): a
// ParentVersionPatchCandidate carries a different shape entirely
// (actualEditTarget/editType, no provenanceKind/controllingProperty), and
// mixing the two guards would mean one of them silently accepting fields
// the other never checks. Same core discipline as the existing guard:
// independently RE-DERIVE the patch from the same trusted plan and require
// byte-identical output -- never a second, separately-maintained "did
// anything else change" implementation.
export type ParentVersionPatchGuardReason =
  | 'PARENT_PATCH_ELIGIBILITY_NOT_CONFIRMED'
  | 'PARENT_PATCH_SCOPE_MISMATCH'
  | 'PARENT_PATCH_EDIT_TARGET_MISMATCH'
  | 'PARENT_PATCH_FROM_VERSION_MISMATCH'
  | 'PARENT_PATCH_TARGET_VERSION_MISMATCH'
  | 'PARENT_PATCH_SHA_NOT_GROUNDED'
  | 'PARENT_PATCH_ORIGINAL_CONTENT_INTEGRITY_MISMATCH'
  | 'PARENT_PATCH_UNAUTHORIZED_CHANGE';

export type ParentVersionPatchGuardResult = { ok: true } | { ok: false; reason: ParentVersionPatchGuardReason; detail: string };

function failParent(reason: ParentVersionPatchGuardReason, detail: string): ParentVersionPatchGuardResult {
  return { ok: false, reason, detail };
}

/**
 * `decision` = the already-computed SecurityFindingDecision produced by
 * SecurityFindingDecisionService.decide()'s PARENT_VERSION branch.
 * `request` = the exact ParentVersionPatchRequest used to build `candidate`.
 * `candidate` = the proposed write. Requires every field to agree across
 * all three, then independently re-calls writeParentVersionPatch() from
 * the SAME request and requires byte-exact candidate.file.content --
 * exactly the "guardedPatchBytes == candidatePatchBytes" invariant V1.8
 * Phase 7B's own ticket asks for.
 */
export function assertParentVersionPatchSafeToWrite(
  decision: SecurityFindingDecision,
  request: ParentVersionPatchRequest,
  candidate: ParentVersionPatchCandidate,
): ParentVersionPatchGuardResult {
  if (decision.editType !== 'PARENT_VERSION' || decision.remediationType !== 'AUTO_FIX_ELIGIBLE' || decision.selectedTargetVersion === null) {
    return failParent('PARENT_PATCH_ELIGIBILITY_NOT_CONFIRMED', `decision.editType="${decision.editType}" remediationType="${decision.remediationType}" -- not a confirmed AUTO_FIX_ELIGIBLE PARENT_VERSION decision.`);
  }
  const plan = decision.parentRemediationPlan;
  if (!plan) {
    return failParent('PARENT_PATCH_SCOPE_MISMATCH', 'decision carries no parentRemediationPlan.');
  }
  if (plan.actualEditTarget !== request.actualEditTarget || request.actualEditTarget !== candidate.actualEditTarget) {
    return failParent('PARENT_PATCH_EDIT_TARGET_MISMATCH', `actualEditTarget mismatch: decision="${plan.actualEditTarget}", request="${request.actualEditTarget}", candidate="${candidate.actualEditTarget}".`);
  }
  if (plan.fromVersion !== request.fromVersion || request.fromVersion !== candidate.oldVersion) {
    return failParent('PARENT_PATCH_FROM_VERSION_MISMATCH', `fromVersion mismatch: decision="${plan.fromVersion}", request="${request.fromVersion}", candidate.oldVersion="${candidate.oldVersion}".`);
  }
  if (plan.toVersion !== request.toVersion || request.toVersion !== candidate.targetVersion || decision.selectedTargetVersion !== candidate.targetVersion) {
    return failParent('PARENT_PATCH_TARGET_VERSION_MISMATCH', `toVersion mismatch: decision plan="${plan.toVersion}", decision.selectedTargetVersion="${decision.selectedTargetVersion}", request="${request.toVersion}", candidate.targetVersion="${candidate.targetVersion}".`);
  }
  if (!isFullGitSha(decision.evaluatedSha) || !isFullGitSha(request.evaluatedSha) || !isFullGitSha(candidate.evaluatedSha)
    || decision.evaluatedSha!.toLowerCase() !== request.evaluatedSha.toLowerCase()
    || request.evaluatedSha.toLowerCase() !== candidate.evaluatedSha.toLowerCase()) {
    return failParent('PARENT_PATCH_SHA_NOT_GROUNDED', `evaluatedSha not consistently a proven full-SHA across decision/request/candidate: decision="${decision.evaluatedSha}", request="${request.evaluatedSha}", candidate="${candidate.evaluatedSha}".`);
  }
  if (computeGitBlobSha1(candidate.file.sourceContent ?? '').toLowerCase() !== String(candidate.file.originalBlobSha ?? '').toLowerCase()) {
    return failParent('PARENT_PATCH_ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'computeGitBlobSha1(candidate.file.sourceContent) does not match candidate.file.originalBlobSha.');
  }
  if (candidate.file.sourceContent !== request.sourceContent) {
    return failParent('PARENT_PATCH_ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'candidate.file.sourceContent does not match request.sourceContent (the grounded pre-edit text).');
  }

  const rederived: any = writeParentVersionPatch(request);
  if (rederived.ok !== true) {
    return failParent('PARENT_PATCH_UNAUTHORIZED_CHANGE', `Independent re-derivation of the parent patch from the same request FAILED (reason=${rederived.reason}) -- the proposed candidate cannot be trusted.`);
  }
  if (rederived.candidate.file.content !== candidate.file.content) {
    return failParent('PARENT_PATCH_UNAUTHORIZED_CHANGE', 'candidate.file.content differs from the deterministic re-derivation -- something beyond the single authorized <parent> version substitution was changed.');
  }
  if (rederived.candidate.file.path !== candidate.file.path || rederived.candidate.file.sourceContent !== candidate.file.sourceContent) {
    return failParent('PARENT_PATCH_UNAUTHORIZED_CHANGE', 'candidate.file.path/sourceContent differs from the deterministic re-derivation.');
  }

  return { ok: true };
}
