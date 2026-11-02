// Contrats de données de la vérification de candidat (P3).

export type CandidateFileOperation = 'MODIFY' | 'CREATE';

export interface CandidateFile {
  path: string;
  operation: CandidateFileOperation;
  originalBlobSha?: string;
  content: string;
  contentSha256: string;
  sourceContent?: string | null;
}

export interface CandidateManifest {
  candidateId: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  repository: string;
  candidateBaseSha: string;
  files: CandidateFile[];
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

// Valide la forme d'une requête de vérification « HEAD seulement » (SHA cible complet,
// nom de dépôt bien formé, identifiants présents) ; lève une erreur si quelque chose cloche.
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

// Vérifie que le mode de vérification est connu et que l'étape progressive fournie
// (séquence, phase, empreinte d'état) est cohérente avec ce mode ; lève une erreur sinon.
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
