/** Types de l'orchestration multi-CVE : un seul candidat/build/scan/PR couvrant N findings, famille de types séparée de l'orchestration singulière pour garantir la non-régression du cas N=1. */
import { CandidateManifest } from '../candidate-verification/candidate-verification.types';
import { SecurityFindingDecision, SecurityFindingDecisionInput } from './security-finding-decision.types';
import { SecurityPatchGuardResult } from './security-patch-guard';
import { DependencyProvenanceKind } from './dependency-provenance.types';
import { ApplicationTestEvidence } from './security-remediation-orchestration.types';

/** Un finding de lot doit obligatoirement porter son propre cveId (contrairement au flux singulier), pour pouvoir être nommé individuellement dans les conflits et le corps de la PR. */
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

/** Verdict de fermeture par CVE. */
export type CveClosureStatus = 'CLOSED' | 'STILL_OPEN' | 'NOT_OBSERVED';

export interface SecurityRemediationBatchFindingEvidence {
  findingIdentity: string;
  cveId: string;
  /** 'PENDING' apparaît seulement de façon transitoire dans un chemin d'erreur abandonné avant le scan de clôture. */
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
  | 'APPLICATION_TESTS_FAILED'
  | 'APPLICATION_TESTS_NOT_EXECUTED'
  | 'CANDIDATE_SECURITY_VALIDATION_FAILED'
  | 'CANDIDATE_READY';

export interface SecurityRemediationBatchCandidateResult {
  executionTimings?: Record<string, number>;
  failureClass?: 'VERIFIER_TIMEOUT' | 'VERIFIER_UNAVAILABLE' | 'VERIFIER_PROTOCOL_ERROR';
  status: SecurityRemediationBatchCandidateStatus;
  reason: string;
  /** Toujours présent, exactement une entrée par finding d'entrée, dans l'ordre d'entrée. */
  findings: SecurityRemediationBatchFindingEvidence[];
  decisions: SecurityFindingDecision[];
  candidateIdentity: string | null;
  candidateManifest: CandidateManifest | null;
  guardResult: SecurityPatchGuardResult | null;
  /** Capturé uniquement sur CANDIDATE_BUILD_FAILED, sans attribuer l'échec à une CVE précise. */
  buildOutput?: string;
  applicationTests?: ApplicationTestEvidence;
}

export class SecurityRemediationBatchRequestValidationError extends Error {
  /** Initialise l’erreur avec son contexte. */
  constructor(message: string) {
    super(message);
    this.name = 'SecurityRemediationBatchRequestValidationError';
  }
}

/** Vérifie qu'une valeur est une chaîne non vide. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Valide la forme complète d'une requête d'orchestration de lot (jusqu'à 8 findings, chacun avec cveId/identité unique), en levant une erreur nommée au premier champ invalide. */
export function assertSecurityRemediationBatchOrchestrationInput(body: any): asserts body is SecurityRemediationBatchOrchestrationInput {
  /** Signale une erreur pour fail. */
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
