// R-SEC-V1.1 — request/result contract for the grounded provenance
// resolution service (candidate-verifier/src/grounded-maven-provenance.
// service.ts). Types live here (backend) rather than in candidate-verifier,
// matching the existing cross-import convention already used for
// CandidateManifest/CandidateVerification (see maven-build-adapter.ts's own
// import of RegressionTestResult) — candidate-verifier depends on backend's
// types, never the reverse.
import { DependencyProvenance } from './dependency-provenance.types';

/**
 * Reuses the platform's EXISTING identity fields (repository/requestId/
 * batchId/candidateAttempt — the same ones CandidateManifest and
 * HeadVerificationRequest already carry) rather than inventing a parallel
 * identity scheme. `candidateBaseSha` matches the exact field name
 * WorkspaceManager.createWorkspace() already expects.
 */
export interface GroundedMavenProvenanceRequest {
  repository: string; // "owner/name"
  candidateBaseSha: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  /** groupId:artifactId */
  package: string;
  expectedInstalledVersion: string;
  timeoutMs?: number;
}

/**
 * Failure vocabulary deliberately reuses WorkspaceError's own failureClass
 * values (WORKSPACE_CREATION_FAILED / WORKSPACE_SHA_MISMATCH /
 * WORKSPACE_INFRA_FAILURE) for every failure mode this service shares with
 * the rest of candidate-verifier, and adds only the few genuinely new ones
 * this phase introduces (pom.xml absent, dependency:tree itself failing).
 *
 * Best-effort warm-up always precedes the offline sufficiency probe.
 * WARMUP_* describes infrastructure/ambiguous preparation when the probe
 * also failed, never a candidate defect. DEPENDENCY_NOT_IN_CACHE is a
 * local absence with exact coordinates, not proof of nonexistence remotely.
 */
export type GroundedMavenProvenanceFailureClass =
  | 'WORKSPACE_CREATION_FAILED'
  | 'WORKSPACE_SHA_MISMATCH'
  | 'WORKSPACE_INFRA_FAILURE'
  | 'POM_NOT_FOUND'
  | 'DEPENDENCY_TREE_FAILED'
  | 'DEPENDENCY_TREE_TIMEOUT'
  | 'WARMUP_TIMEOUT'
  | 'WARMUP_NETWORK_FAILURE'
  | 'WARMUP_FAILED'
  | 'DEPENDENCY_NOT_IN_CACHE';

/** Bounded, redacted command evidence; tree text is consumed by the resolver,
 * not duplicated in the response. Kept for success as well as failure. */
export interface MavenStepEvidence {
  status: 'SUCCESS' | 'FAILED';
  timedOut: boolean;
  evidenceTail: string;
  exitCode?: number | null;
  durationMs?: number;
  networkFailure?: { code: 'WARMUP_NETWORK_FAILURE'; matchedSignature: string; detail: string };
  resolutionFailure?: { code: 'ARTIFACT_NOT_FOUND'; artifact: string };
  timeoutEvidence?: { lastArtifact: string | null; retryCount: number; stdoutTail: string; stderrTail: string };
  offlineFailure?: { code: 'DEPENDENCY_NOT_IN_CACHE'; missingArtifacts: string[]; primaryMissingArtifact: string };
}

export interface GroundedMavenProvenanceEvidence {
  mavenResolution?: {
    baselineWarmup: MavenStepEvidence;
    targetWarmups: Array<{ gav: string; result: MavenStepEvidence }>;
    analysis: MavenStepEvidence;
  };
  requestedSha: string;
  checkoutSha: string | null;
  /** Only set once checkoutSha has been proven === requestedSha — see §3. */
  evaluatedSha: string | null;
  /**
   * V1.8 Phase 7B — the real, raw pom.xml text read from the exact-SHA
   * worktree (BEFORE any patch), additive alongside the existing
   * dependency-classification result. Exists so a PARENT_VERSION decision
   * (which needs the raw source text for maven-parent-patch-writer.ts, not
   * a dependency-tree classification of an unrelated package) can reuse
   * this SAME checkout instead of a second one — "no second validation
   * architecture" (V1.8 Phase 7B's own instruction). Null whenever pom.xml
   * itself was never successfully read (workspace/checkout failures).
   */
  pomXmlText: string | null;
}

export type GroundedMavenProvenanceResult =
  | { ok: true; provenance: DependencyProvenance; evidence: GroundedMavenProvenanceEvidence }
  | { ok: false; failureClass: GroundedMavenProvenanceFailureClass; retryable?: boolean; detail: string; evidence: GroundedMavenProvenanceEvidence };
