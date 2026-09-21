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
  /**
   * R81/R81.2 — the exact pre-edit file text the writer used as its editing
   * context. Named `sourceContent`, not a new field, because that is what
   * the real WF2 manifest ALREADY carries here today (verified directly
   * against a real historical execution, id 2038: `Prepare Candidate
   * Manifest` already includes `sourceContent:it.sourceContent` — sourced
   * from the writer's own decoded pre-edit fetch, before the LLM ever runs
   * — for every file, unconditionally). No n8n change was needed to make
   * this field exist; R81.2's fail-closed gate (generated-comment-guard.ts)
   * is what makes ITS ABSENCE on a MODIFY of a supported extension an
   * outright rejection instead of a silent skip. Absent/null only for a
   * caller that predates this field (never a false rejection — see
   * generated-comment-guard.ts's own doc for exactly how absence is
   * handled); CREATE's own seeded value is the empty string, not null.
   */
  sourceContent?: string | null;
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
export type VerificationMode = 'COMPILE_MAIN' | 'COMPILE_TESTS' | 'FULL_TEST';
export interface VerificationStep {
  sequence: number;
  phase: 'INITIAL_COMPILE' | 'TEST_COMPILE' | 'FULL_TEST' | 'FINAL_WRITE_GUARD';
  stateDigest: string;
}

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
  | 'CANDIDATE_TEST_COMPILE_FAILURE'
  | 'CANDIDATE_TEST_REGRESSION'
  | 'VERIFICATION_MODE_UNSUPPORTED'
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
  mode?: VerificationMode;
  identity: {
    candidateId: string;
    requestId: string;
    batchId: string;
    candidateAttempt: number;
    candidateBaseSha: string;
    candidateDigest: string;
    verificationStep?: number | null;
    phase?: string | null;
    stateDigest?: string | null;
  };
  workspace: {
    workspaceId: string;
    requestedSha: string;
    checkoutSha: string | null;
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
  diagnostics?: {
    boundedCompilerTail: string | null;
    implicatedPaths: string[];
    implicatedSymbols: string[];
  };
}

/** Read-only verification of an existing commit, without candidate overlays. */
export interface HeadVerificationRequest {
  verifyHeadOnly: true;
  repository: string;
  targetSha: string;
  validationRequestId: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  options?: { timeoutMs?: number };
  manifest?: never;
}

export interface HeadVerification extends Omit<CandidateVerification, 'identity' | 'workspace' | 'manifestValidation' | 'failureClass' | 'mode'> {
  mode: 'HEAD_ONLY';
  identity: {
    repository: string;
    targetSha: string;
    validationRequestId: string;
    requestId: string;
    batchId: string;
    candidateAttempt: number;
  };
  workspace: CandidateVerification['workspace'];
  failureClass: FailureClass | 'SHA_UNAVAILABLE';
}

/**
 * R76 -- bounded, redaction-safe diagnostic summary of a non-PASS
 * CandidateVerification, small enough to persist on a fixRequest attempt.
 * Deliberately excludes: full compiler/test logs, environment variables,
 * credentials, request headers, workspace content. See
 * verification-evidence.ts for the only place this is constructed.
 */
export interface VerificationEvidence {
  overall: OverallVerdict | null;
  failureClass: FailureClass | null;
  compile: { status: CompileStatus | null; exitCode: number | null; evidenceTail: string | null };
  tests: { regressionStatus: TestStatus | null; evidenceTail: string | null };
  staticAnalysis: { status: StaticAnalysisStatus | null };
}

export type VerificationResult = CandidateVerification | HeadVerification;
export type VerificationRequest = HeadVerificationRequest | {
  verifyHeadOnly?: false;
  manifest: CandidateManifest;
  allowedPaths?: string[];
  options?: { timeoutMs?: number; mode?: VerificationMode };
  verificationStep?: VerificationStep;
};

/** Shared by both HTTP boundaries; no Git or build side effects. */
export function assertHeadVerificationRequest(value: HeadVerificationRequest): void {
  const id = /^[A-Za-z0-9_-]{1,128}$/;
  if (!value || value.verifyHeadOnly !== true || 'manifest' in value
    || 'candidateDigest' in value || 'files' in value
    || typeof value.targetSha !== 'string' || !/^[a-f0-9]{40}$/i.test(value.targetSha)
    || typeof value.repository !== 'string'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)
    || value.repository.split('/').some(s => s === '.' || s === '..')
    || ![value.validationRequestId, value.requestId, value.batchId].every(v => typeof v === 'string' && id.test(v))
    || !Number.isInteger(value.candidateAttempt) || value.candidateAttempt < 0
    || (value.options?.timeoutMs !== undefined && (!Number.isFinite(value.options.timeoutMs) || value.options.timeoutMs <= 0))) {
    throw new Error('INVALID_HEAD_VERIFICATION_REQUEST');
  }
}

/** Runtime boundary for progressive verification metadata. */
export function assertVerificationStep(value: VerificationStep | undefined, mode: VerificationMode | undefined): void {
  const modes: VerificationMode[] = ['COMPILE_MAIN', 'COMPILE_TESTS', 'FULL_TEST'];
  if (mode !== undefined && !modes.includes(mode)) throw new Error('INVALID_VERIFICATION_MODE');
  if (value === undefined) return;
  const phases: VerificationStep['phase'][] = ['INITIAL_COMPILE', 'TEST_COMPILE', 'FULL_TEST', 'FINAL_WRITE_GUARD'];
  const phaseForMode: Partial<Record<VerificationMode, VerificationStep['phase']>> = {
    COMPILE_MAIN: 'INITIAL_COMPILE', COMPILE_TESTS: 'TEST_COMPILE', FULL_TEST: 'FULL_TEST',
  };
  if (!Number.isInteger(value.sequence) || value.sequence < 1
    || !phases.includes(value.phase)
    || !/^[a-f0-9]{64}$/i.test(value.stateDigest)
    || (mode !== undefined && phaseForMode[mode] !== value.phase)) {
    throw new Error('INVALID_VERIFICATION_STEP');
  }
}
