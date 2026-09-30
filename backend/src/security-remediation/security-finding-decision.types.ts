// R-SEC-V1.1 §8 — decision/evidence-only output. Deliberately does NOT
// include anything routing- or writer-related (no workflow id, no PR
// target) — this phase produces a decision record, never a dispatch.
import { DependencyProvenance } from './dependency-provenance.types';
import { SecurityRemediationType } from './security-eligibility-classifier';

import { MavenRemediationScope } from './maven-remediation-scope';
import { ParentVersionPatchCandidate } from './maven-parent-patch-writer';

/**
 * V1.8 Phase 7B — an owner/parent-targeted remediation plan. Deliberately a
 * SEPARATE shape from `pinnedTargetVersion` (SecurityFindingDecisionInput
 * below): `actualEditTarget` here is a DIFFERENT Maven coordinate than the
 * finding's own `package` by construction (that is the whole point of a
 * parent-managed fix) -- see maven-parent-patch-writer.ts's own header for
 * why this is never folded into the DIRECT_EXPLICIT/PROPERTY_MANAGED
 * contract.
 */
export interface ParentVersionRemediationPlan {
  /** groupId:artifactId of the <parent> this plan targets -- NOT the finding's own package. */
  actualEditTarget: string;
  fromVersion: string;
  toVersion: string;
  /**
   * The version THIS finding's own vulnerable package (SecurityFindingDecisionInput.package)
   * is expected to resolve to AFTER the parent bump -- e.g. jackson-databind
   * -> "2.13.5" while actualEditTarget/toVersion describe the Spring Boot
   * parent itself ("2.7.18"). Never the same value as toVersion (a same-
   * value here would almost always indicate the two were confused
   * upstream). Required for the real dependency:tree effective-model
   * assertion (parent-version-effective-model-check.ts) -- never inferred
   * from the parent version bump succeeding structurally alone.
   */
  expectedResolvedDependency?: string;
}

export interface SecurityFindingDecisionInput {
  /** Backend-persisted advisory identity, never supplied by the webhook caller. */
  cveId?: string;
  /** Stable cross-build identity — reuse findingFingerprint() (manual-remediation/finding-fingerprint.ts) at the call site; not recomputed here. */
  findingIdentity: string;
  source: string;
  /** groupId:artifactId */
  package: string;
  expectedInstalledVersion: string;
  /** Raw scanner fixedVersion string (pre-split) — parsed internally via parseFixedVersions(). */
  fixedVersion: string | null;
  /**
   * V1.8 — a server-persisted, already-validated target version that is
   * authoritative over selectEligibleTargetVersion()'s own pure numeric
   * policy when present. The ONLY writer of this field is
   * security-finding-resolver.service.ts, reading it back from
   * ManualRemediationTask.securityFindingRemediation.v1_8Plan (itself
   * written ONLY by ManualRemediationService.launchBatchRemediation() in
   * ENFORCED mode, from evidence that already passed
   * canDispatchSecurityRemediationV1_8()) -- never a caller-supplied
   * override, never present in SHADOW mode.
   */
  pinnedTargetVersion?: string;
  /**
   * V1.8 Phase 7B — present ONLY when the persisted v1_8Plan's editType is
   * PARENT_VERSION. Mutually exclusive with pinnedTargetVersion (a plan is
   * either a direct/property pin or a parent-owner plan, never both) --
   * the ONLY writer is security-finding-resolver.service.ts, same
   * provenance discipline as pinnedTargetVersion's own header comment.
   * `package`/`expectedInstalledVersion` above still describe the CVE's
   * OWN vulnerable component throughout (reporting/closure-verification
   * purposes) -- never the edit target when this field is present.
   */
  parentRemediationPlan?: ParentVersionRemediationPlan;
}

export interface SecurityFindingDecision {
  remediationScope?: MavenRemediationScope;
  findingIdentity: string;
  /** null when grounding itself failed (checkout/tree failure) — never a guess. */
  evaluatedSha: string | null;
  provenance: DependencyProvenance | null;
  fixedVersions: string[];
  selectedTargetVersion: string | null;
  remediationType: SecurityRemediationType;
  reason: string;
  /** V1.8 Phase 7B — present only when this decision was produced via the PARENT_VERSION path; absent (undefined) for every DEPENDENCY_VERSION/PROPERTY_VERSION decision, byte-for-byte unchanged from before this phase. */
  editType?: 'PARENT_VERSION';
  parentRemediationPlan?: ParentVersionRemediationPlan;
  /** The already-produced, already-independently-reproducible (see security-patch-guard.ts's assertParentVersionPatchSafeToWrite) candidate for a PARENT_VERSION decision — built once, here, never re-derived ad hoc by a caller. Null/absent for every non-PARENT_VERSION or failed decision. */
  parentPatchCandidate?: ParentVersionPatchCandidate | null;
}
