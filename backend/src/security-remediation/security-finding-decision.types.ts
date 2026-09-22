// R-SEC-V1.1 §8 — decision/evidence-only output. Deliberately does NOT
// include anything routing- or writer-related (no workflow id, no PR
// target) — this phase produces a decision record, never a dispatch.
import { DependencyProvenance } from './dependency-provenance.types';
import { SecurityRemediationType } from './security-eligibility-classifier';

export interface SecurityFindingDecisionInput {
  /** Stable cross-build identity — reuse findingFingerprint() (manual-remediation/finding-fingerprint.ts) at the call site; not recomputed here. */
  findingIdentity: string;
  source: string;
  /** groupId:artifactId */
  package: string;
  expectedInstalledVersion: string;
  /** Raw scanner fixedVersion string (pre-split) — parsed internally via parseFixedVersions(). */
  fixedVersion: string | null;
}

export interface SecurityFindingDecision {
  findingIdentity: string;
  /** null when grounding itself failed (checkout/tree failure) — never a guess. */
  evaluatedSha: string | null;
  provenance: DependencyProvenance | null;
  fixedVersions: string[];
  selectedTargetVersion: string | null;
  remediationType: SecurityRemediationType;
  reason: string;
}
