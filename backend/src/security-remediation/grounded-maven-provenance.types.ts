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
 */
export type GroundedMavenProvenanceFailureClass =
  | 'WORKSPACE_CREATION_FAILED'
  | 'WORKSPACE_SHA_MISMATCH'
  | 'WORKSPACE_INFRA_FAILURE'
  | 'POM_NOT_FOUND'
  | 'DEPENDENCY_TREE_FAILED'
  | 'DEPENDENCY_TREE_TIMEOUT';

export interface GroundedMavenProvenanceEvidence {
  requestedSha: string;
  checkoutSha: string | null;
  /** Only set once checkoutSha has been proven === requestedSha — see §3. */
  evaluatedSha: string | null;
}

export type GroundedMavenProvenanceResult =
  | { ok: true; provenance: DependencyProvenance; evidence: GroundedMavenProvenanceEvidence }
  | { ok: false; failureClass: GroundedMavenProvenanceFailureClass; detail: string; evidence: GroundedMavenProvenanceEvidence };
