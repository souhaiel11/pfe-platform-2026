// R-SEC-V1.1 §8 — decision/evidence-only output. Deliberately does NOT
// include anything routing- or writer-related (no workflow id, no PR
// target) — this phase produces a decision record, never a dispatch.
import { DependencyProvenance } from './dependency-provenance.types';
import { SecurityRemediationType } from './security-eligibility-classifier';

import { MavenRemediationScope } from './maven-remediation-scope';

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
}
