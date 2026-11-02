/** Garde-fou déterministe et fail-closed avant toute écriture GitHub d'un patch de sécurité : re-dérive indépendamment le patch attendu et exige une égalité stricte avec le candidat proposé. */
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
  | 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH'
  | 'SECURITY_PATCH_PROVENANCE_NOT_AUTOFIXABLE'
  | 'SECURITY_PATCH_CROSS_MAJOR_REJECTED'
  | 'SECURITY_PATCH_SHA_NOT_GROUNDED'
  | 'SECURITY_PATCH_ELIGIBILITY_NOT_CONFIRMED';

export type SecurityPatchGuardResult = { ok: true } | { ok: false; reason: SecurityPatchGuardReason; detail: string };

/** Construit un résultat d'échec typé avec son détail explicatif. */
function fail(reason: SecurityPatchGuardReason, detail: string): SecurityPatchGuardResult {
  return { ok: false, reason, detail };
}

/** Vérifie qu'un patch de sécurité candidat (DIRECT_EXPLICIT/PROPERTY_MANAGED) est sûr à écrire : cohérence décision/requête/candidat sur chaque champ, puis re-dérivation byte-exacte du patch. */
export function assertSecurityPatchSafeToWrite(
  decision: SecurityFindingDecision,
  request: SecurityPatchRequest,
  candidate: SecurityPatchCandidate,
): SecurityPatchGuardResult {
  if (JSON.stringify(decision.remediationScope) !== JSON.stringify(request.remediationScope)) {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', 'The request omitted or changed the complete trusted remediation scope.');
  }
  if (candidate.provenanceKind !== 'DIRECT_EXPLICIT' && candidate.provenanceKind !== 'PROPERTY_MANAGED') {
    return fail('SECURITY_PATCH_PROVENANCE_NOT_AUTOFIXABLE', `provenanceKind "${candidate.provenanceKind}" is never auto-fixable.`);
  }

  if (candidate.findingIdentity !== decision.findingIdentity || request.findingIdentity !== decision.findingIdentity) {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', `findingIdentity mismatch: candidate="${candidate.findingIdentity}", request="${request.findingIdentity}", decision="${decision.findingIdentity}".`);
  }

  if (decision.remediationType !== 'AUTO_FIX_ELIGIBLE' || decision.selectedTargetVersion === null) {
    return fail('SECURITY_PATCH_ELIGIBILITY_NOT_CONFIRMED', `decision.remediationType="${decision.remediationType}" (reason=${decision.reason}) -- not AUTO_FIX_ELIGIBLE.`);
  }

  if (!isFullGitSha(decision.evaluatedSha) || !isFullGitSha(request.evaluatedSha) || !isFullGitSha(candidate.evaluatedSha)
    || decision.evaluatedSha!.toLowerCase() !== request.evaluatedSha.toLowerCase()
    || request.evaluatedSha.toLowerCase() !== candidate.evaluatedSha.toLowerCase()) {
    return fail('SECURITY_PATCH_SHA_NOT_GROUNDED', `evaluatedSha not consistently a proven full-SHA across decision/request/candidate: decision="${decision.evaluatedSha}", request="${request.evaluatedSha}", candidate="${candidate.evaluatedSha}".`);
  }

  if (candidate.file.path !== request.controllingFile) {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', `candidate.file.path="${candidate.file.path}" does not match the authorized controllingFile="${request.controllingFile}".`);
  }
  if (candidate.file.operation !== 'MODIFY') {
    return fail('SECURITY_PATCH_SCOPE_MISMATCH', `candidate.file.operation="${candidate.file.operation}" -- a security dependency patch is always a MODIFY, never a CREATE.`);
  }

  if (candidate.oldVersion !== request.installedVersion || candidate.oldVersion !== decision.provenance?.installedVersion) {
    return fail('SECURITY_PATCH_OLD_VERSION_MISMATCH', `oldVersion mismatch: candidate="${candidate.oldVersion}", request="${request.installedVersion}", decision.provenance="${decision.provenance?.installedVersion}".`);
  }

  if (candidate.targetVersion !== request.targetVersion || candidate.targetVersion !== decision.selectedTargetVersion) {
    return fail('SECURITY_PATCH_TARGET_VERSION_MISMATCH', `targetVersion mismatch: candidate="${candidate.targetVersion}", request="${request.targetVersion}", decision.selectedTargetVersion="${decision.selectedTargetVersion}".`);
  }

  const oldParsed = parseVersion(candidate.oldVersion);
  const targetParsed = parseVersion(candidate.targetVersion);
  if (!oldParsed || !targetParsed || majorOf(oldParsed) !== majorOf(targetParsed)) {
    return fail('SECURITY_PATCH_CROSS_MAJOR_REJECTED', `oldVersion="${candidate.oldVersion}" -> targetVersion="${candidate.targetVersion}" is not same-major.`);
  }

  if (computeGitBlobSha1(candidate.file.sourceContent ?? '').toLowerCase() !== String(candidate.file.originalBlobSha ?? '').toLowerCase()) {
    return fail('ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'computeGitBlobSha1(candidate.file.sourceContent) does not match candidate.file.originalBlobSha.');
  }
  if (candidate.file.sourceContent !== request.sourceContent) {
    return fail('ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'candidate.file.sourceContent does not match request.sourceContent (the grounded pre-edit text).');
  }

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

/** Construit un résultat d'échec typé (variante parent) avec son détail explicatif. */
function failParent(reason: ParentVersionPatchGuardReason, detail: string): ParentVersionPatchGuardResult {
  return { ok: false, reason, detail };
}

/** Garde-fou équivalent à assertSecurityPatchSafeToWrite(), pour un patch ciblant le `<parent>` Maven : vérifie la cohérence décision/requête/candidat puis re-dérive byte-exact. */
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
