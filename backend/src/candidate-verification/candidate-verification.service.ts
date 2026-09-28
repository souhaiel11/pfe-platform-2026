// R22-E2C2 — thin control-plane client. This class used to instantiate
// WorkspaceManager/CandidateMaterializer/MavenBuildAdapter directly and run
// the whole verify pipeline in-process (R22-C). That execution logic moved
// verbatim to candidate-verifier/src/candidate-verification-executor.ts
// (R22-E2C1's audited security boundary: repository-controlled build code
// must never run in the same process as JWT_SECRET/DB_PASS). This class now
// does exactly one thing: call the worker over HTTP and classify transport
// failures -- it makes no verification decision of its own, and passes the
// worker's real result through unchanged.
import { Injectable } from '@nestjs/common';
import { CandidateManifest, CandidateVerification, FailureClass, HeadVerificationRequest, HeadVerification, VerificationMode, VerificationStep, assertHeadVerificationRequest } from './candidate-verification.types';
import { computeSecurityCandidateIdentity, computeSecurityBatchCandidateIdentity } from '../security-remediation/security-candidate-identity';
import { computeCandidateDigest, computeContentSha256 } from './candidate-digest';
import { SecurityRemediationOrchestrationInput, SecurityRemediationEvaluationResult, SecurityRemediationTransportFailure } from '../security-remediation/security-remediation-orchestration.types';
import { SecurityRemediationBatchOrchestrationInput, SecurityRemediationBatchCandidateResult } from '../security-remediation/security-remediation-batch-orchestration.types';
import { WORKER_DEADLINE_MS, BACKEND_TRANSPORT_SLACK_MS } from '../security-remediation/security-remediation-deadline-contract';
import { Agent } from 'undici';

// V1.7.2 execution-2055 root-cause fix — Node's global fetch() (undici)
// applies its OWN internal headersTimeout/bodyTimeout default of 300_000ms
// to every request, completely independent of and shorter than this call's
// real AbortSignal-based deadline below. This was the PROVEN cause of
// execution 2055's "fetch failed after 300819ms" -> VERIFIER_UNAVAILABLE:
// a legitimate, still-in-progress evaluation (a base-image-pull retry
// sequence alone can legitimately run past 700,000ms, per
// WORKER_DEADLINE_MS's own real-world evidence) was reported as
// transport-unavailable purely because undici gave up on receiving
// response headers long before the INTENDED deadline ever got a chance to
// fire -- the declared 900000/910000ms contract was never actually the
// thing enforced end-to-end. This computes a per-call Dispatcher whose own
// internal ceiling is held comfortably ABOVE the real governing
// AbortSignal timeout (below), so that signal remains the ONE thing that
// ever fires first -- this never raises, replaces, or races the existing
// deadline contract, it only stops an unrelated, shorter, undocumented
// default from silently overriding it.
export function transportDispatcherTimeoutsMs(governingTimeoutMs: number): { headersTimeout: number; bodyTimeout: number } {
  // +30s margin: comfortably larger than any realistic scheduling jitter
  // between the AbortController's own timer and undici's internal ones,
  // while remaining a small, bounded addition -- never a second competing
  // deadline a caller could observe or depend on.
  const ceiling = Math.max(0, Math.floor(governingTimeoutMs)) + 30_000;
  return { headersTimeout: ceiling, bodyTimeout: ceiling };
}

// Code-review correction — a fresh per-call Agent that is never closed
// leaks its underlying connection-pool resources (open sockets, keep-alive
// timers) for the life of this process; every caller below constructs
// exactly one Agent for its one request and must release it once that
// request (success OR failure, at any of this method's several return
// points) is fully done with it. `.close()` (not `.destroy()`) is used
// deliberately: it waits for any already-in-flight work on this dispatcher
// to finish before releasing sockets, rather than aborting anything still
// technically pending -- safe here specifically because this Agent is
// NEVER shared across calls or reused, so there is nothing else that could
// ever depend on it staying open. Best-effort: a close failure must never
// mask or replace the real result/failure this call already produced.
async function withTransportDispatcher<T>(governingTimeoutMs: number, fn: (dispatcher: Agent) => Promise<T>): Promise<T> {
  const dispatcher = new Agent(transportDispatcherTimeoutsMs(governingTimeoutMs));
  try {
    return await fn(dispatcher);
  } finally {
    try { await dispatcher.close(); } catch { /* best-effort cleanup only -- never masks the real result above */ }
  }
}

export interface VerifyOptions {
  allowedPaths?: string[];
  timeoutMs?: number;
  mode?: VerificationMode;
  verificationStep?: VerificationStep;
}

const DEFAULT_WORKER_URL = 'http://candidate-verifier:4100/verify';
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000; // execution can legitimately take several minutes (compile + test)

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

  async verify(manifest: CandidateManifest, options: VerifyOptions = {}): Promise<CandidateVerification> {
    const candidateDigest = manifest.candidateDigest ?? computeCandidateDigest(manifest);
    const identity = {
      candidateId: manifest.candidateId, requestId: manifest.requestId, batchId: manifest.batchId,
      candidateAttempt: manifest.candidateAttempt, candidateBaseSha: manifest.candidateBaseSha, candidateDigest,
      verificationStep: options.verificationStep?.sequence ?? null, phase: options.verificationStep?.phase ?? null,
      stateDigest: options.verificationStep?.stateDigest ?? null,
    };
    const workspaceId = `${manifest.requestId}/${manifest.batchId}/attempt-${manifest.candidateAttempt}${options.verificationStep ? `/step-${options.verificationStep.sequence}` : ''}`;

    const transportFailure = (failureClass: FailureClass): CandidateVerification => ({
      mode: options.mode ?? 'FULL_TEST', identity,
      workspace: { workspaceId, requestedSha: manifest.candidateBaseSha.toLowerCase(), checkoutSha: null, exactShaVerified: false, created: false, cleaned: false },
      manifestValidation: { status: 'PASS', errors: [] },
      compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
      tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
      staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
      // Transport failures are infrastructure facts, never a proven
      // candidate defect -- always INCONCLUSIVE, never FAIL (R22-E2C2 Phase 5).
      overall: 'INCONCLUSIVE',
      verificationLevel: 'COMPILE_TEST_VERIFIED',
      failureClass,
      diagnostics: { boundedCompilerTail: null, implicatedPaths: [], implicatedSymbols: [] },
    });

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const governingTimeoutMs = timeoutMs + 10_000; // a little slack over the worker's own internal timeout
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

      // Pass the worker's real result through unchanged -- no re-derivation,
      // no re-classification (R22-E2C2 Phase 14 test #18/#19/#20: write-guard
      // and remote-head-drift stay control-plane-only decisions made
      // separately by the caller, never folded into this result).
      return body;
    });
  }
  async verifyHead(request: HeadVerificationRequest): Promise<HeadVerification> {
    assertHeadVerificationRequest(request);
    const identity = { repository: request.repository, targetSha: request.targetSha.toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt };
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

  // R-SEC-V1.4 §5 — the smallest addition to the EXISTING thin HTTP client
  // needed to reach the worker's new /security-remediation/evaluate route.
  // Reuses this.workerUrl (no new env var: the worker's base URL is derived
  // by stripping the already-configured '/verify' suffix), the same fetch/
  // timeout/AbortSignal conventions, and the same three-way failure
  // vocabulary (VERIFIER_TIMEOUT/VERIFIER_UNAVAILABLE/VERIFIER_PROTOCOL_ERROR)
  // as verify()/verifyHead() above -- never a fourth, bespoke failure taxonomy.
  // `input` must already be fully trusted (built by SecurityFindingResolverService,
  // never from raw caller input) -- this method makes no trust decision of
  // its own, it only classifies TRANSPORT outcomes.
  // V1.7 predeploy phase: the default is WORKER_DEADLINE_MS (600,000ms),
  // imported from security-remediation-deadline-contract.ts -- the SAME
  // shared figure worker-deadline.ts's own default/clamp uses, replacing
  // the previous locally-duplicated 360,000ms literal. Real evidence: two
  // independent real end-to-end evaluations (real rootless Podman build +
  // real Trivy scan, no fixture scanner) completed in 464,981ms/475,195ms --
  // both would have been killed by the old 360,000ms default.
  async evaluateSecurityRemediation(input: SecurityRemediationOrchestrationInput, timeoutMs: number = WORKER_DEADLINE_MS): Promise<SecurityRemediationEvaluationResult> {
    const workerBaseUrl = this.workerUrl.replace(/\/verify$/, '');
    const failure = (failureClass: SecurityRemediationTransportFailure['failureClass'], reason: string): SecurityRemediationTransportFailure => ({ status: 'TECHNICAL_FAILURE', failureClass, reason });
    // V1.7 Blocker B: forward the SAME timeoutMs this call already uses to
    // bound its own HTTP wait as the worker's internal deadline, so the
    // worker actually stops the synchronous evaluation before this client's
    // AbortSignal fires (10s slack), instead of the abort racing a worker
    // that keeps running regardless. `input.overallDeadlineMs` (never set by
    // real callers today) wins if a caller ever sets it explicitly.
    const requestBody: SecurityRemediationOrchestrationInput = { overallDeadlineMs: timeoutMs, ...input };

    const governingTimeoutMs = timeoutMs + BACKEND_TRANSPORT_SLACK_MS;
    return withTransportDispatcher(governingTimeoutMs, async (dispatcher) => {
      let response: Response;
      try {
        response = await fetch(`${workerBaseUrl}/security-remediation/evaluate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
          // BACKEND_TRANSPORT_SLACK_MS, not a bare literal: this is the SAME
          // named slack security-remediation-deadline-contract.ts derives
          // BACKEND_HTTP_TIMEOUT_MS from -- one shared number, not two.
          signal: AbortSignal.timeout(governingTimeoutMs),
          // See transportDispatcherTimeoutsMs's own comment above: without
          // this, undici's hidden 300s default -- not this signal -- is what
          // actually ends the request whenever a real evaluation legitimately
          // runs longer, exactly as proven by execution 2055.
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
        // Pass the worker's real result through unchanged when it IS shaped
        // correctly -- same "never re-derive, never re-classify" discipline
        // as verify() above -- but never trust an unrecognized shape.
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

  // Increment 1 (WF6 multi-CVE wiring) — mirrors evaluateSecurityRemediation()
  // above field for field: same transport dispatcher/timeout discipline,
  // same "never re-derive the worker's business decision, only cross-check
  // its shape and its own internal consistency" posture, extended to N
  // findings. Deliberately a SEPARATE method, never a branch inside the
  // singular one (same non-regression reasoning as the orchestrator split
  // in candidate-verifier).
  async evaluateSecurityRemediationBatch(input: SecurityRemediationBatchOrchestrationInput, timeoutMs: number = WORKER_DEADLINE_MS): Promise<SecurityRemediationBatchCandidateResult | SecurityRemediationTransportFailure> {
    const workerBaseUrl = this.workerUrl.replace(/\/verify$/, '');
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
        // Every declared finding must independently prove CLOSED -- the
        // orchestrator's own tout-ou-rien invariant, re-checked here rather
        // than trusted blindly from the top-level status alone.
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
