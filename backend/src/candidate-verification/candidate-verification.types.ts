// R22-C — P3 Candidate Verification contracts.
//
// CandidateVerification NEVER resolves a scanner finding (no VALID/INVALID
// field anywhere here) — WF3 remains the sole authority for that, per
// R22-A's FindingValidation/PipelineHealth separation. This contract only
// answers "does the exact candidate bytes compile and pass regression
// tests", nothing more, and says so explicitly via `verificationLevel`.

export type CandidateFileOperation = 'MODIFY' | 'CREATE';

export interface CandidateFile {
  path: string;
  operation: CandidateFileOperation;
  /** Required for MODIFY (the blob this content replaces); absent for CREATE. */
  originalBlobSha?: string;
  content: string;
  /** sha256 hex of `content`, declared by the caller — re-verified, never trusted blindly. */
  contentSha256: string;
}

export interface CandidateManifest {
  candidateId: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  repository: string;
  /**
   * CRITICAL INVARIANT 1: never auto-equated to main/baseline SHA. Must be
   * resolved explicitly via resolveCandidateBaseSha() before this manifest
   * is constructed — see candidate-base-sha.ts.
   */
  candidateBaseSha: string;
  files: CandidateFile[];
  /** Set by computeCandidateDigest() — present once the manifest is finalized. */
  candidateDigest?: string;
}

export type ManifestValidationStatus = 'PASS' | 'FAIL';
export type CompileStatus = 'SUCCESS' | 'FAILED' | 'NOT_RUN';
export type TestStatus = 'SUCCESS' | 'FAILED' | 'NOT_RUN' | 'UNKNOWN';
export type StaticAnalysisStatus = 'NOT_RUN';
export type OverallVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

/**
 * Deliberately limited to what R22-C can actually prove. FULL_PREFLIGHT_VERIFIED
 * does not exist as a reachable value in this phase's code — see
 * CandidateVerificationService, which hardcodes COMPILE_TEST_VERIFIED and is
 * covered by a test asserting FULL_PREFLIGHT_VERIFIED is never emitted.
 */
export type VerificationLevel = 'COMPILE_TEST_VERIFIED' | 'FULL_PREFLIGHT_VERIFIED';

export type FailureClass =
  | 'CANDIDATE_MANIFEST_INVALID'
  | 'WORKSPACE_CREATION_FAILED'
  | 'WORKSPACE_SHA_MISMATCH'
  | 'CANDIDATE_MATERIALIZATION_FAILED'
  | 'CANDIDATE_CONTENT_MISMATCH'
  | 'BUILD_TYPE_UNSUPPORTED'
  | 'CANDIDATE_COMPILE_FAILURE'
  | 'CANDIDATE_TEST_REGRESSION'
  | 'WORKSPACE_TIMEOUT'
  | 'WORKSPACE_INFRA_FAILURE'
  // R22-E2C2 — transport-layer failures talking to the candidate-verifier
  // worker (connection refused, timeout, malformed response). These are
  // INFRA/INCONCLUSIVE facts about reachability, never evidence about the
  // candidate itself -- a caller must map all three to overall:'INCONCLUSIVE',
  // never 'FAIL', and never anywhere near a scanner finding verdict.
  | 'VERIFIER_UNAVAILABLE'
  | 'VERIFIER_TIMEOUT'
  | 'VERIFIER_PROTOCOL_ERROR'
  | 'UNKNOWN';

export interface RegressionTestResult {
  status: TestStatus;
  total: number | null;
  failures: number | null;
  errors: number | null;
  skipped: number | null;
  durationMs: number | null;
  evidenceRef: string | null;
}

export interface CandidateVerification {
  identity: {
    candidateId: string;
    requestId: string;
    batchId: string;
    candidateAttempt: number;
    candidateBaseSha: string;
    candidateDigest: string;
  };
  workspace: {
    workspaceId: string;
    exactShaVerified: boolean;
    created: boolean;
    cleaned: boolean;
  };
  manifestValidation: {
    status: ManifestValidationStatus;
    errors: string[];
  };
  compile: {
    status: CompileStatus;
    exitCode: number | null;
    durationMs: number | null;
    evidenceRef: string | null;
  };
  tests: {
    targeted: { status: 'NOT_RUN'; reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' };
    regression: RegressionTestResult;
  };
  staticAnalysis: {
    status: StaticAnalysisStatus;
    reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED';
    newIssues: unknown[];
    evidenceRef: string | null;
  };
  overall: OverallVerdict;
  verificationLevel: VerificationLevel;
  failureClass: FailureClass | null;
}
