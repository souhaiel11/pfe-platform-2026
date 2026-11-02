// Client HTTP léger vers le worker candidate-verifier.
import { Injectable } from '@nestjs/common';
import { CandidateManifest, CandidateVerification, FailureClass, HeadVerificationRequest, HeadVerification, VerificationMode, VerificationStep, assertHeadVerificationRequest } from './candidate-verification.types';
import { computeSecurityCandidateIdentity, computeSecurityBatchCandidateIdentity } from '../security-remediation/security-candidate-identity';
import { computeCandidateDigest, computeContentSha256 } from './candidate-digest';
import { SecurityRemediationOrchestrationInput, SecurityRemediationEvaluationResult, SecurityRemediationTransportFailure } from '../security-remediation/security-remediation-orchestration.types';
import { SecurityRemediationBatchOrchestrationInput, SecurityRemediationBatchCandidateResult } from '../security-remediation/security-remediation-batch-orchestration.types';
import { WORKER_DEADLINE_MS, BACKEND_TRANSPORT_SLACK_MS } from '../security-remediation/security-remediation-deadline-contract';
import { Agent } from 'undici';

// Calcule les délais internes (headers/body) du dispatcher HTTP, toujours un peu
// au-dessus du délai gouvernant réel, pour que ce dernier reste le seul à déclencher l'abandon.
export function transportDispatcherTimeoutsMs(governingTimeoutMs: number): { headersTimeout: number; bodyTimeout: number } {
  const ceiling = Math.max(0, Math.floor(governingTimeoutMs)) + 30_000;
  return { headersTimeout: ceiling, bodyTimeout: ceiling };
}

// Exécute `fn` avec un dispatcher HTTP dédié à cet appel, puis le referme proprement
// (best-effort) une fois l'appel terminé, succès ou échec.
async function withTransportDispatcher<T>(governingTimeoutMs: number, fn: (dispatcher: Agent) => Promise<T>): Promise<T> {
  const dispatcher = new Agent(transportDispatcherTimeoutsMs(governingTimeoutMs));
  try {
    return await fn(dispatcher);
  } finally {
    try { await dispatcher.close(); } catch { /* nettoyage best-effort uniquement */ }
  }
}

export interface VerifyOptions {
  allowedPaths?: string[];
  timeoutMs?: number;
  mode?: VerificationMode;
  verificationStep?: VerificationStep;
}

const DEFAULT_WORKER_URL = 'http://candidate-verifier:4100/verify';
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;

// Vérifie que la réponse du worker a bien la forme attendue d'un CandidateVerification
// (identité, workspace cohérent, étapes présentes) avant de lui faire confiance.
function isCandidateVerificationShape(value: any): value is CandidateVerification {
  return !!value && typeof value === 'object'
    && value.identity && typeof value.identity.candidateDigest === 'string'
    && value.workspace && typeof value.workspace.exactShaVerified === 'boolean'
    && typeof value.workspace.requestedSha === 'string'
    && (value.workspace.checkoutSha === null || typeof value.workspace.checkoutSha === 'string')
    && (!value.workspace.exactShaVerified
      || value.workspace.checkoutSha?.toLowerCase() === value.workspace.requestedSha.toLowerCase())
    && value.compile && value.tests && value.staticAnalysis
    && typeof value.overall === 'string' && typeof value.verificationLevel === 'string';
}

@Injectable()
export class CandidateVerificationService {
  private readonly workerUrl = process.env.CANDIDATE_VERIFIER_URL || DEFAULT_WORKER_URL;

  /** Envoie un manifeste candidat au worker candidate-verifier pour compilation + tests, et renvoie son verdict tel quel. */
  async verify(manifest: CandidateManifest, options: VerifyOptions = {}): Promise<CandidateVerification> {
    const candidateDigest = manifest.candidateDigest ?? computeCandidateDigest(manifest);
    const identity = {
      candidateId: manifest.candidateId, requestId: manifest.requestId, batchId: manifest.batchId,
      candidateAttempt: manifest.candidateAttempt, candidateBaseSha: manifest.candidateBaseSha, candidateDigest,
      verificationStep: options.verificationStep?.sequence ?? null, phase: options.verificationStep?.phase ?? null,
      stateDigest: options.verificationStep?.stateDigest ?? null,
    };
    const workspaceId = `${manifest.requestId}/${manifest.batchId}/attempt-${manifest.candidateAttempt}${options.verificationStep ? `/step-${options.verificationStep.sequence}` : ''}`;

    /** Construit le résultat transport échec. */
    const transportFailure = (failureClass: FailureClass): CandidateVerification => ({
      mode: options.mode ?? 'FULL_TEST', identity,
      workspace: { workspaceId, requestedSha: manifest.candidateBaseSha.toLowerCase(), checkoutSha: null, exactShaVerified: false, created: false, cleaned: false },
      manifestValidation: { status: 'PASS', errors: [] },
      compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
      tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
      staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
      overall: 'INCONCLUSIVE',
      verificationLevel: 'COMPILE_TEST_VERIFIED',
      failureClass,
      diagnostics: { boundedCompilerTail: null, implicatedPaths: [], implicatedSymbols: [] },
    });

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const governingTimeoutMs = timeoutMs + 10_000;
    return withTransportDispatcher(governingTimeoutMs, async (dispatcher) => {
      let response: Response;
      try {
        response = await fetch(this.workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifest, allowedPaths: options.allowedPaths, options: { timeoutMs, mode: options.mode }, verificationStep: options.verificationStep }),
          signal: AbortSignal.timeout(governingTimeoutMs),
          dispatcher,
        } as RequestInit & { dispatcher: Agent });
      } catch (err: any) {
        const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
        return transportFailure(timedOut ? 'VERIFIER_TIMEOUT' : 'VERIFIER_UNAVAILABLE');
      }

      if (!response.ok) {
        return transportFailure('VERIFIER_PROTOCOL_ERROR');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return transportFailure('VERIFIER_PROTOCOL_ERROR');
      }

      if (!isCandidateVerificationShape(body)) {
        return transportFailure('VERIFIER_PROTOCOL_ERROR');
      }

      return body;
    });
  }

  /** Variante allégée de verify(). */
  async verifyHead(request: HeadVerificationRequest): Promise<HeadVerification> {
    assertHeadVerificationRequest(request);
    const identity = { repository: request.repository, targetSha: request.targetSha.toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt };
    /** Construit le résultat échec. */
    const failure = (failureClass: FailureClass): HeadVerification => ({
      mode: 'HEAD_ONLY', identity,
      workspace: { workspaceId: `${request.requestId}/${request.batchId}/attempt-${request.candidateAttempt}`,
        requestedSha: request.targetSha.toLowerCase(), checkoutSha: null, exactShaVerified: false, created: false, cleaned: false },
      compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
      tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
        regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
      staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
      overall: 'INCONCLUSIVE', verificationLevel: 'COMPILE_TEST_VERIFIED', failureClass,
    });
    const governingTimeoutMs = (request.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 10_000;
    return withTransportDispatcher(governingTimeoutMs, async (dispatcher) => {
      let response: Response;
      try {
        response = await fetch(this.workerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request), signal: AbortSignal.timeout(governingTimeoutMs), dispatcher } as RequestInit & { dispatcher: Agent });
      } catch (err: any) {
        return failure(err?.name === 'AbortError' || err?.name === 'TimeoutError' ? 'VERIFIER_TIMEOUT' : 'VERIFIER_UNAVAILABLE');
      }
      if (!response.ok) return failure('VERIFIER_PROTOCOL_ERROR');
      let body: any;
      try { body = await response.json(); } catch { return failure('VERIFIER_PROTOCOL_ERROR'); }
      if (!body || body.mode !== 'HEAD_ONLY' || 'manifestValidation' in body
        || !body.identity || Object.entries(identity).some(([key, value]) => body.identity[key] !== value)
        || !body.workspace || typeof body.workspace.exactShaVerified !== 'boolean'
        || !(body.workspace.checkoutSha === null || (typeof body.workspace.checkoutSha === 'string' && /^[a-f0-9]{40}$/i.test(body.workspace.checkoutSha)))
        || !['SUCCESS', 'FAILED', 'NOT_RUN'].includes(body.compile?.status)
        || !['SUCCESS', 'FAILED', 'NOT_RUN', 'UNKNOWN'].includes(body.tests?.regression?.status)
        || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(body.overall)
        || body.verificationLevel !== 'COMPILE_TEST_VERIFIED'
        || (body.workspace.exactShaVerified && body.workspace.checkoutSha?.toLowerCase() !== identity.targetSha)
        || (body.overall === 'PASS' && (!body.workspace.exactShaVerified || body.compile.status !== 'SUCCESS' || body.tests.regression.status !== 'SUCCESS'))) {
        return failure('VERIFIER_PROTOCOL_ERROR');
      }
      return body;
    });
  }

  /** Demande au worker d'évaluer une remédiation de sécurité pour UNE CVE (déjà entièrement fiabilisée par l'appelant), et recontrôle la cohérence interne de la réponse. */
  async evaluateSecurityRemediation(input: SecurityRemediationOrchestrationInput, timeoutMs: number = WORKER_DEADLINE_MS): Promise<SecurityRemediationEvaluationResult> {
    const workerBaseUrl = this.workerUrl.replace(/\/verify$/, '');
    /** Construit le résultat échec. */
    const failure = (failureClass: SecurityRemediationTransportFailure['failureClass'], reason: string): SecurityRemediationTransportFailure => ({ status: 'TECHNICAL_FAILURE', failureClass, reason });
    const requestBody: SecurityRemediationOrchestrationInput = { overallDeadlineMs: timeoutMs, ...input };

    const governingTimeoutMs = timeoutMs + BACKEND_TRANSPORT_SLACK_MS;
    return withTransportDispatcher(governingTimeoutMs, async (dispatcher) => {
      let response: Response;
      try {
        response = await fetch(`${workerBaseUrl}/security-remediation/evaluate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(governingTimeoutMs),
          dispatcher,
        } as RequestInit & { dispatcher: Agent });
      } catch (err: any) {
        const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
        return failure(timedOut ? 'VERIFIER_TIMEOUT' : 'VERIFIER_UNAVAILABLE', String(err?.message || 'fetch failed'));
      }
      if (!response.ok) return failure('VERIFIER_PROTOCOL_ERROR', `Worker responded with HTTP ${response.status}.`);
      let body: any;
      try { body = await response.json(); } catch { return failure('VERIFIER_PROTOCOL_ERROR', 'Worker response was not valid JSON.'); }
      const KNOWN_STATUSES = ['TECHNICAL_FAILURE', 'REMEDIATION_SCOPE_UNPROVEN', 'CANDIDATE_BUILD_FAILED', 'CANDIDATE_SECURITY_VALIDATION_FAILED', 'CANDIDATE_READY', 'NOT_ELIGIBLE', 'GROUNDING_FAILED', 'PATCH_GENERATION_FAILED', 'GUARD_REJECTED', 'WORKSPACE_FAILURE', 'MAVEN_RESOLUTION_FAILED', 'MAVEN_RESOLUTION_MISMATCH'];
      if (!body || typeof body !== 'object' || !KNOWN_STATUSES.includes(body.status) || !body.decision || typeof body.decision.findingIdentity !== 'string') {
        return failure('VERIFIER_PROTOCOL_ERROR', 'Worker response did not match the expected SecurityRemediationCandidateResult shape.');
      }
      if (body.status === 'TECHNICAL_FAILURE' && (
        !['VERIFIER_TIMEOUT', 'VERIFIER_UNAVAILABLE', 'VERIFIER_PROTOCOL_ERROR'].includes(body.failureClass)
        || body.candidateManifest != null || body.candidateIdentity != null || body.securityValidationEvidence != null)) {
        return failure('VERIFIER_PROTOCOL_ERROR', 'Runtime failure must not carry a writable candidate or closure claim.');
      }
      if (body.status === 'CANDIDATE_READY') {
        const proof = body.securityValidationEvidence, scope = body.decision.remediationScope;
        const file = body.candidateManifest?.files?.[0];
        if (!proof || proof.status !== 'TARGET_CVE_CLOSED' || proof.targetCveMatchCount !== 0 || proof.buildPassed !== true
          || proof.mode !== 'TRIVY_IMAGE_ARCHIVE' || proof.targetCve !== input.finding.cveId
          || proof.evaluatedSha !== input.candidateBaseSha || !scope || scope.targetCve !== proof.targetCve
          || scope.evaluatedSha !== proof.evaluatedSha || !Array.isArray(scope.controls) || !scope.controls.length
          || !Array.isArray(scope.affectedPackages) || !scope.affectedPackages.length
          || !/^[0-9a-f]{64}$/.test(proof.artifactDigest || '') || !/^[0-9a-f]{64}$/.test(proof.reportDigest || '')
          || body.candidateManifest?.files?.length !== 1 || !file || typeof file.content !== 'string'
          || proof.candidateContentSha256 !== computeContentSha256(file.content)
          || file.path !== scope.controllingFile || file.originalBlobSha !== scope.originalBlobSha
          || body.candidateManifest.candidateBaseSha !== input.candidateBaseSha
          || body.candidateManifest.repository !== input.repository
          || body.candidateManifest.candidateDigest !== computeCandidateDigest(body.candidateManifest)
          || body.decision.findingIdentity !== input.finding.findingIdentity
          || body.candidateIdentity !== computeSecurityCandidateIdentity({
            findingIdentity: body.decision.findingIdentity, evaluatedSha: body.decision.evaluatedSha,
            package: body.decision.provenance?.package, installedVersion: body.decision.provenance?.installedVersion,
            targetVersion: body.decision.selectedTargetVersion, controllingFile: file.path, remediationScope: scope,
          })) {
          return failure('VERIFIER_PROTOCOL_ERROR', 'V1.7 candidate-wide closure evidence missing or not bound to the candidate.');
        }
      }
      return body;
    });
  }

  /** Même principe que evaluateSecurityRemediation(), mais pour un lot de plusieurs CVE traitées dans un seul candidat. */
  async evaluateSecurityRemediationBatch(input: SecurityRemediationBatchOrchestrationInput, timeoutMs: number = WORKER_DEADLINE_MS): Promise<SecurityRemediationBatchCandidateResult | SecurityRemediationTransportFailure> {
    const workerBaseUrl = this.workerUrl.replace(/\/verify$/, '');
    /** Construit le résultat échec. */
    const failure = (failureClass: SecurityRemediationTransportFailure['failureClass'], reason: string): SecurityRemediationTransportFailure => ({ status: 'TECHNICAL_FAILURE', failureClass, reason });
    const requestBody: SecurityRemediationBatchOrchestrationInput = { overallDeadlineMs: timeoutMs, ...input };

    const governingTimeoutMs = timeoutMs + BACKEND_TRANSPORT_SLACK_MS;
    return withTransportDispatcher(governingTimeoutMs, async (dispatcher) => {
      let response: Response;
      try {
        response = await fetch(`${workerBaseUrl}/security-remediation/evaluate-batch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(governingTimeoutMs),
          dispatcher,
        } as RequestInit & { dispatcher: Agent });
      } catch (err: any) {
        const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
        return failure(timedOut ? 'VERIFIER_TIMEOUT' : 'VERIFIER_UNAVAILABLE', String(err?.message || 'fetch failed'));
      }
      if (!response.ok) return failure('VERIFIER_PROTOCOL_ERROR', `Worker responded with HTTP ${response.status}.`);
      let body: any;
      try { body = await response.json(); } catch { return failure('VERIFIER_PROTOCOL_ERROR', 'Worker response was not valid JSON.'); }
      const KNOWN_STATUSES = ['TECHNICAL_FAILURE', 'WORKSPACE_FAILURE', 'NOT_ELIGIBLE', 'PATCH_CONFLICT', 'MAVEN_RESOLUTION_FAILED', 'MAVEN_RESOLUTION_MISMATCH', 'CANDIDATE_BUILD_FAILED', 'CANDIDATE_SECURITY_VALIDATION_FAILED', 'CANDIDATE_READY'];
      if (!body || typeof body !== 'object' || !KNOWN_STATUSES.includes(body.status) || !Array.isArray(body.findings) || body.findings.length !== input.findings.length) {
        return failure('VERIFIER_PROTOCOL_ERROR', 'Worker response did not match the expected SecurityRemediationBatchCandidateResult shape.');
      }
      if (body.status === 'TECHNICAL_FAILURE' && (
        !['VERIFIER_TIMEOUT', 'VERIFIER_UNAVAILABLE', 'VERIFIER_PROTOCOL_ERROR'].includes(body.failureClass)
        || body.candidateManifest != null || body.candidateIdentity != null)) {
        return failure('VERIFIER_PROTOCOL_ERROR', 'Runtime failure must not carry a writable candidate claim.');
      }
      if (body.status === 'CANDIDATE_READY') {
        const file = body.candidateManifest?.files?.[0];
        const allClosed = Array.isArray(body.findings) && body.findings.length === input.findings.length
          && body.findings.every((f: any) => f.status === 'CLOSED');
        const recomputedIdentity = Array.isArray(body.decisions) && body.decisions.length === input.findings.length
          ? computeSecurityBatchCandidateIdentity(body.decisions.map((d: any) => ({
            findingIdentity: d?.findingIdentity, evaluatedSha: d?.evaluatedSha, package: d?.provenance?.package,
            installedVersion: d?.provenance?.installedVersion, targetVersion: d?.selectedTargetVersion, controllingFile: d?.provenance?.controllingFile,
            remediationScope: d?.remediationScope,
          })))
          : null;
        if (!allClosed || !file || typeof file.content !== 'string' || body.candidateManifest?.files?.length !== 1
          || body.candidateManifest.candidateBaseSha !== input.candidateBaseSha
          || body.candidateManifest.repository !== input.repository
          || body.candidateManifest.candidateDigest !== computeCandidateDigest(body.candidateManifest)
          || body.candidateIdentity !== recomputedIdentity) {
          return failure('VERIFIER_PROTOCOL_ERROR', 'V1.7 batch closure evidence missing, incomplete, or not bound to the candidate.');
        }
      }
      return body;
    });
  }
}
