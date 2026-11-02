// Définit les données et résultats de l’orchestration unitaire : finding fiable, dépôt/commit, candidat, preuves de tests, sécurité, statuts et classes d’échec.
import { CandidateManifest } from '../candidate-verification/candidate-verification.types';
import { SecurityFindingDecision, SecurityFindingDecisionInput } from './security-finding-decision.types';
import { SecurityPatchGuardResult } from './security-patch-guard';
import { DependencyProvenanceKind } from './dependency-provenance.types';

/**
 * §4 step 1 input: trusted finding identity + project/repository context +
 * requested SHA. `finding` is passed through unchanged to
 * SecurityFindingDecisionService.decide() -- the orchestrator adds no new
 * input surface beyond what that already-proven service accepts.
 */
export interface SecurityRemediationOrchestrationInput {
  finding: SecurityFindingDecisionInput;
  repository: string;
  candidateBaseSha: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  overallDeadlineMs?: number;
  additionalCveIds?: string[];
}

/**
 * Every non-terminal status is a proven, deterministic REASON to stop --
 * never a fabricated AUTO_FIX_ELIGIBLE (§5). `CANDIDATE_READY` is the only
 * status carrying a non-null candidateManifest.
 */
export type SecurityRemediationCandidateStatus =
  | 'TECHNICAL_FAILURE'
  | 'REMEDIATION_SCOPE_UNPROVEN'
  | 'CANDIDATE_BUILD_FAILED'
  // V1.8 — a candidate package build that failed BECAUSE the application
  // test suite failed (distinguished from CANDIDATE_BUILD_FAILED, which now
  // means compilation/packaging itself failed before or without a test
  // verdict). Never CANDIDATE_READY when this occurs.
  | 'APPLICATION_TESTS_FAILED'
  // V1.8 — the package build succeeded but no Surefire report was ever
  // produced (e.g. zero test classes, or a misconfigured/skipped test
  // plugin) -- fail-closed rather than silently treating "no tests ran" as
  // "tests passed".
  | 'APPLICATION_TESTS_NOT_EXECUTED'
  | 'CANDIDATE_SECURITY_VALIDATION_FAILED'
  | 'CANDIDATE_READY'
  | 'NOT_ELIGIBLE'
  | 'GROUNDING_FAILED'
  | 'PATCH_GENERATION_FAILED'
  | 'GUARD_REJECTED'
  | 'WORKSPACE_FAILURE'
  | 'MAVEN_RESOLUTION_FAILED'
  | 'MAVEN_RESOLUTION_MISMATCH';

export interface ApplicationTestEvidence {
  executed: boolean;
  passed: boolean | null;
  total: number | null;
  failures: number | null;
  errors: number | null;
  skipped: number | null;
  durationMs: number;
  evidenceTail: string;
}

export interface SecurityClosureEvidence {
  status: 'TARGET_CVE_CLOSED';
  targetCve: string;
  mode: 'TRIVY_IMAGE_ARCHIVE';
  evaluatedSha: string;
  candidateContentSha256: string;
  artifactDigest: string;
  reportDigest: string;
  scannerVersion: string;
  targetCveMatchCount: 0;
  buildPassed: true;
  // V1.8 — was unconditionally 'SKIPPED' (mvn clean package -DskipTests).
  // CANDIDATE_READY is only ever reached now once the application test
  // suite has actually run and passed (see ApplicationTestEvidence above /
  // orchestrate()'s own gate) -- 'SKIPPED' can no longer occur here.
  tests: 'PASSED';
  newHighCriticalCount: number | null;
  /**
   * V1.8 Phase 3 ticket — one entry per input.additionalCveIds, each
   * independently checked against this SAME real candidate scan via the
   * existing cveTargets() (never assumed closed just because the primary
   * targetCve closed). Absent/empty when additionalCveIds was absent/empty.
   */
  additionalCveClosure?: { cve: string; closed: boolean }[];
}

export interface SecurityRemediationCandidateResult {
  /** Observational timings, excluded from candidate identity/digest. */
  executionTimings?: Record<string, number>;
  failureClass?: 'VERIFIER_TIMEOUT' | 'VERIFIER_UNAVAILABLE' | 'VERIFIER_PROTOCOL_ERROR';
  securityValidationEvidence?: SecurityClosureEvidence;
  /** V1.8 — see ApplicationTestEvidence's own header comment. */
  applicationTests?: ApplicationTestEvidence;
  status: SecurityRemediationCandidateStatus;
  reason: string;
  decision: SecurityFindingDecision;
  candidateIdentity: string | null;
  candidateManifest: CandidateManifest | null;
  patchEvidence: {
    provenanceKind: DependencyProvenanceKind;
    oldVersion: string;
    targetVersion: string;
    controllingFile: string;
    controllingElement: string | null;
    controllingProperty: string | null;
  } | null;
  guardResult: SecurityPatchGuardResult | null;
  dependencyResolutionEvidence: {
    checked: boolean;
    resolvedMatch: boolean | null;
    evaluatedAtSha: string;
  } | null;
}

export class SecurityRemediationRequestValidationError extends Error {
  /** Initialise l’erreur avec son contexte. */
  constructor(message: string) {
    super(message);
    this.name = 'SecurityRemediationRequestValidationError';
  }
}

/** Vérifie l’état suivant : Non vide chaîne. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Vérifie sécurité correction Orchestration entrée. */
export function assertSecurityRemediationOrchestrationInput(body: any): asserts body is SecurityRemediationOrchestrationInput {
  /** Signale une erreur pour fail. */
  const fail = (msg: string): never => { throw new SecurityRemediationRequestValidationError(msg); };
  if (!body || typeof body !== 'object') fail('Request body must be an object.');
  const f = body.finding;
  if (!f || typeof f !== 'object') fail('finding is required.');
  if (!isNonEmptyString(f.findingIdentity)) fail('finding.findingIdentity is required.');
  if (!isNonEmptyString(f.source)) fail('finding.source is required.');
  if (!isNonEmptyString(f.package)) fail('finding.package is required.');
  if (!isNonEmptyString(f.expectedInstalledVersion)) fail('finding.expectedInstalledVersion is required.');
  if (f.fixedVersion !== null && !isNonEmptyString(f.fixedVersion)) fail('finding.fixedVersion must be a non-empty string or null.');
  if (!isNonEmptyString(body.repository)) fail('repository is required.');
  if (!isNonEmptyString(body.candidateBaseSha)) fail('candidateBaseSha is required.');
  if (!isNonEmptyString(body.requestId)) fail('requestId is required.');
  if (!isNonEmptyString(body.batchId)) fail('batchId is required.');
  if (!Number.isInteger(body.candidateAttempt) || body.candidateAttempt < 0) fail('candidateAttempt must be a non-negative integer.');
  if (body.overallDeadlineMs !== undefined && !(typeof body.overallDeadlineMs === 'number' && Number.isFinite(body.overallDeadlineMs) && body.overallDeadlineMs > 0))
    fail('overallDeadlineMs must be a positive finite number when present.');
}

export interface SecurityRemediationTransportFailure {
  status: 'TECHNICAL_FAILURE';
  failureClass: 'VERIFIER_TIMEOUT' | 'VERIFIER_UNAVAILABLE' | 'VERIFIER_PROTOCOL_ERROR';
  reason: string;
}

export type SecurityRemediationEvaluationResult = SecurityRemediationCandidateResult | SecurityRemediationTransportFailure;
