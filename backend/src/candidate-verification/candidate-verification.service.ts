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
import { CandidateManifest, CandidateVerification, FailureClass, HeadVerificationRequest, HeadVerification, assertHeadVerificationRequest } from './candidate-verification.types';
import { computeCandidateDigest } from './candidate-digest';

export interface VerifyOptions {
  allowedPaths?: string[];
  timeoutMs?: number;
}

const DEFAULT_WORKER_URL = 'http://candidate-verifier:4100/verify';
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000; // execution can legitimately take several minutes (compile + test)

function isCandidateVerificationShape(value: any): value is CandidateVerification {
  return !!value && typeof value === 'object'
    && value.identity && typeof value.identity.candidateDigest === 'string'
    && value.workspace && typeof value.workspace.exactShaVerified === 'boolean'
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
    };
    const workspaceId = `${manifest.requestId}/${manifest.batchId}/attempt-${manifest.candidateAttempt}`;

    const transportFailure = (failureClass: FailureClass): CandidateVerification => ({
      identity,
      workspace: { workspaceId, exactShaVerified: false, created: false, cleaned: false },
      manifestValidation: { status: 'PASS', errors: [] },
      compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
      tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
      staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
      // Transport failures are infrastructure facts, never a proven
      // candidate defect -- always INCONCLUSIVE, never FAIL (R22-E2C2 Phase 5).
      overall: 'INCONCLUSIVE',
      verificationLevel: 'COMPILE_TEST_VERIFIED',
      failureClass,
    });

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response: Response;
    try {
      response = await fetch(this.workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest, allowedPaths: options.allowedPaths, options: { timeoutMs } }),
        signal: AbortSignal.timeout(timeoutMs + 10_000), // a little slack over the worker's own internal timeout
      });
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
  }
  async verifyHead(request: HeadVerificationRequest): Promise<HeadVerification> {
    assertHeadVerificationRequest(request);
    const identity = { repository: request.repository, targetSha: request.targetSha.toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt };
    const failure = (failureClass: FailureClass): HeadVerification => ({
      mode: 'HEAD_ONLY', identity,
      workspace: { workspaceId: `${request.requestId}/${request.batchId}/attempt-${request.candidateAttempt}`,
        checkoutSha: null, exactShaVerified: false, created: false, cleaned: false },
      compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
      tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
        regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
      staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
      overall: 'INCONCLUSIVE', verificationLevel: 'COMPILE_TEST_VERIFIED', failureClass,
    });
    let response: Response;
    try {
      response = await fetch(this.workerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout((request.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 10_000) });
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
  }

}
