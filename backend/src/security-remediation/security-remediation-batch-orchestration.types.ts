// Increment 1 — multi-CVE remediation, ONE candidate/build/scan/PR for N
// findings. Deliberately a SEPARATE type family from
// security-remediation-orchestration.types.ts (SecurityRemediationOrchestrationInput
// stays untouched, singular, byte-for-byte -- see this increment's own
// non-regression requirement: a 1-element batch must be a NEW code path,
// never a modification of the proven single-CVE one). Pure types only; no I/O.
import { CandidateManifest } from '../candidate-verification/candidate-verification.types';
import { SecurityFindingDecision, SecurityFindingDecisionInput } from './security-finding-decision.types';
import { SecurityPatchGuardResult } from './security-patch-guard';
import { DependencyProvenanceKind } from './dependency-provenance.types';

/**
 * Every finding in a batch MUST carry its own cveId (unlike the singular
 * flow, where cveId is optional/cosmetic-only): the whole point of a batch
 * is to name each CVE individually in conflicts, per-CVE closure evidence,
 * and the final PR body -- an unnamed finding could never be reported on
 * individually, defeating the increment's own honesty requirement (§4/§6).
 */
export interface SecurityRemediationBatchFindingInput extends SecurityFindingDecisionInput {
  cveId: string;
}

export interface SecurityRemediationBatchOrchestrationInput {
  findings: SecurityRemediationBatchFindingInput[];
  repository: string;
  candidateBaseSha: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  overallDeadlineMs?: number;
}

/** Per-CVE closure verdict — §4's "intersection baseline/candidat". */
export type CveClosureStatus = 'CLOSED' | 'STILL_OPEN' | 'NOT_OBSERVED';

export interface SecurityRemediationBatchFindingEvidence {
  findingIdentity: string;
  cveId: string;
  /**
   * 'PENDING' only ever appears transiently inside error paths that abort
   * before reaching the closure scan (e.g. a conflict or a non-eligible
   * finding) -- a terminal SecurityRemediationBatchCandidateResult never
   * leaves a finding at 'PENDING'.
   */
  status: CveClosureStatus | 'NOT_ELIGIBLE' | 'GROUNDING_FAILED' | 'PATCH_CONFLICT' | 'PENDING';
  reason: string;
  patchEvidence: {
    provenanceKind: DependencyProvenanceKind;
    oldVersion: string;
    targetVersion: string;
    controllingFile: string;
    controllingElement: string | null;
    controllingProperty: string | null;
  } | null;
}

export type SecurityRemediationBatchCandidateStatus =
  | 'TECHNICAL_FAILURE'
  | 'WORKSPACE_FAILURE'
  | 'NOT_ELIGIBLE'
  | 'PATCH_CONFLICT'
  | 'MAVEN_RESOLUTION_FAILED'
  | 'MAVEN_RESOLUTION_MISMATCH'
  | 'CANDIDATE_BUILD_FAILED'
  | 'CANDIDATE_SECURITY_VALIDATION_FAILED'
  | 'CANDIDATE_READY';

export interface SecurityRemediationBatchCandidateResult {
  executionTimings?: Record<string, number>;
  failureClass?: 'VERIFIER_TIMEOUT' | 'VERIFIER_UNAVAILABLE' | 'VERIFIER_PROTOCOL_ERROR';
  status: SecurityRemediationBatchCandidateStatus;
  reason: string;
  /**
   * Always present, always exactly one entry per input finding, in input
   * order -- §4/§6's per-CVE requirement. Global tout-ou-rien (§3): `status`
   * is only 'CANDIDATE_READY' when EVERY entry here is 'CLOSED'; any other
   * global status still carries the full per-CVE detail so the caller can
   * report WHICH CVE(s) blocked the batch, never just an opaque failure.
   */
  findings: SecurityRemediationBatchFindingEvidence[];
  decisions: SecurityFindingDecision[];
  candidateIdentity: string | null;
  candidateManifest: CandidateManifest | null;
  guardResult: SecurityPatchGuardResult | null;
  /**
   * §5 — captured verbatim on CANDIDATE_BUILD_FAILED, deliberately WITHOUT
   * attributing the failure to any one CVE (a combined multi-dependency
   * Maven failure is not reliably attributable -- see this increment's own
   * design cadrage). Absent for every other status.
   */
  buildOutput?: string;
}

export class SecurityRemediationBatchRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityRemediationBatchRequestValidationError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertSecurityRemediationBatchOrchestrationInput(body: any): asserts body is SecurityRemediationBatchOrchestrationInput {
  const fail = (msg: string): never => { throw new SecurityRemediationBatchRequestValidationError(msg); };
  if (!body || typeof body !== 'object') fail('Request body must be an object.');
  if (!Array.isArray(body.findings) || body.findings.length < 1) fail('findings must be a non-empty array.');
  if (body.findings.length > 8) fail('findings exceeds the maximum batch size (8).');
  const seenIdentity = new Set<string>(), seenCve = new Set<string>();
  for (const f of body.findings) {
    if (!f || typeof f !== 'object') fail('Each finding must be an object.');
    if (!isNonEmptyString(f.findingIdentity)) fail('finding.findingIdentity is required.');
    if (!isNonEmptyString(f.cveId)) fail('finding.cveId is required for every finding in a batch.');
    if (!isNonEmptyString(f.source)) fail('finding.source is required.');
    if (!isNonEmptyString(f.package)) fail('finding.package is required.');
    if (!isNonEmptyString(f.expectedInstalledVersion)) fail('finding.expectedInstalledVersion is required.');
    if (f.fixedVersion !== null && !isNonEmptyString(f.fixedVersion)) fail('finding.fixedVersion must be a non-empty string or null.');
    if (seenIdentity.has(f.findingIdentity)) fail(`Duplicate finding.findingIdentity "${f.findingIdentity}" in the same batch.`);
    seenIdentity.add(f.findingIdentity);
    if (seenCve.has(f.cveId)) fail(`Duplicate finding.cveId "${f.cveId}" in the same batch.`);
    seenCve.add(f.cveId);
  }
  if (!isNonEmptyString(body.repository)) fail('repository is required.');
  if (!isNonEmptyString(body.candidateBaseSha)) fail('candidateBaseSha is required.');
  if (!isNonEmptyString(body.requestId)) fail('requestId is required.');
  if (!isNonEmptyString(body.batchId)) fail('batchId is required.');
  if (!Number.isInteger(body.candidateAttempt) || body.candidateAttempt < 0) fail('candidateAttempt must be a non-negative integer.');
  if (body.overallDeadlineMs !== undefined && !(typeof body.overallDeadlineMs === 'number' && Number.isFinite(body.overallDeadlineMs) && body.overallDeadlineMs > 0))
    fail('overallDeadlineMs must be a positive finite number when present.');
}
