// R22-E2C2 — CandidateVerificationService is now a thin HTTP client to the
// candidate-verifier worker. These tests mock global fetch (the ONLY
// dependency this class has) rather than exercising real git/Maven --
// that real, unmocked, real-repository proof now lives in
// candidate-verifier/src/candidate-verification-executor.spec.ts, moved
// along with the execution logic it tests.
import * as assert from 'node:assert/strict';
import { CandidateVerificationService } from './candidate-verification.service';
import { computeCandidateDigest, computeContentSha256 } from './candidate-digest';
import { CandidateManifest, CandidateVerification } from './candidate-verification.types';
import { computeSecurityCandidateIdentity } from '../security-remediation/security-candidate-identity';
import { WORKER_DEADLINE_MS, BACKEND_TRANSPORT_SLACK_MS, BACKEND_HTTP_TIMEOUT_MS } from '../security-remediation/security-remediation-deadline-contract';

function manifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  const m: CandidateManifest = {
    candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0,
    repository: 'souhaiel11/pfe-app-test', candidateBaseSha: '8a315b0dd508eb9843bb3037fe2827f02f6faa78',
    files: [{ path: 'A.java', operation: 'MODIFY', content: 'x', contentSha256: computeContentSha256('x') }],
    ...overrides,
  };
  m.candidateDigest = m.candidateDigest ?? computeCandidateDigest(m);
  return m;
}

function fakeVerification(m: CandidateManifest, overrides: Partial<CandidateVerification> = {}): CandidateVerification {
  return {
    identity: { candidateId: m.candidateId, requestId: m.requestId, batchId: m.batchId, candidateAttempt: m.candidateAttempt, candidateBaseSha: m.candidateBaseSha, candidateDigest: m.candidateDigest! },
    workspace: { workspaceId: `${m.requestId}/${m.batchId}/attempt-${m.candidateAttempt}`, requestedSha: m.candidateBaseSha, checkoutSha: m.candidateBaseSha, exactShaVerified: true, created: true, cleaned: true },
    manifestValidation: { status: 'PASS', errors: [] },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 100, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, regression: { status: 'SUCCESS', total: 22, failures: 0, errors: 0, skipped: 0, durationMs: 5000, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS',
    verificationLevel: 'COMPILE_TEST_VERIFIED',
    failureClass: null,
    ...overrides,
  };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;

  // --- Test 1/2/3 (spec): backend sends the exact manifest, candidateDigest, candidateBaseSha to the worker ---
  {
    let capturedUrl: string | undefined;
    let capturedBody: any;
    const m = manifest();
    const workerResponse = fakeVerification(m);
    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify(workerResponse), { status: 200 });
    }) as any;

    const service = new CandidateVerificationService();
    const result = await service.verify(m, { allowedPaths: ['A.java'] });

    assert.equal(capturedUrl, 'http://candidate-verifier:4100/verify', 'Test - default worker URL used');
    assert.deepEqual(capturedBody.manifest, m, 'Test 1 - the exact CandidateManifest is sent to the worker, unchanged');
    assert.equal(capturedBody.manifest.candidateDigest, m.candidateDigest, 'Test 2 - candidateDigest preserved exactly in transit');
    assert.equal(capturedBody.manifest.candidateBaseSha, m.candidateBaseSha, 'Test 3 - candidateBaseSha preserved exactly in transit');
    assert.deepEqual(result, workerResponse, 'Test 18 - the worker\'s result passes through the backend completely unchanged');
  }

  // --- Test 15 (spec): worker unavailable -> INCONCLUSIVE / VERIFIER_UNAVAILABLE, not a candidate FAIL ---
  {
    globalThis.fetch = (async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' }); }) as any;
    const service = new CandidateVerificationService();
    const result = await service.verify(manifest());
    assert.equal(result.overall, 'INCONCLUSIVE', 'Test 15 - connection failure is INCONCLUSIVE, never FAIL');
    assert.equal(result.failureClass, 'VERIFIER_UNAVAILABLE');
  }

  // --- Test 16 (spec): worker timeout -> INCONCLUSIVE / VERIFIER_TIMEOUT ---
  {
    globalThis.fetch = (async (_url: any, init: any) => {
      if (init?.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      throw new Error('unreachable: signal was not pre-aborted');
    }) as any;
    (AbortSignal as any).timeout = () => { const c = new AbortController(); c.abort(); return c.signal; };
    const service = new CandidateVerificationService();
    const result = await service.verify(manifest());
    assert.equal(result.overall, 'INCONCLUSIVE', 'Test 16 - a timeout is INCONCLUSIVE, never FAIL');
    assert.equal(result.failureClass, 'VERIFIER_TIMEOUT');
    (AbortSignal as any).timeout = originalTimeout;
  }

  // --- Test 17 (spec): malformed/unexpected worker response -> INCONCLUSIVE / VERIFIER_PROTOCOL_ERROR ---
  {
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as any;
    const service = new CandidateVerificationService();
    const result = await service.verify(manifest());
    assert.equal(result.overall, 'INCONCLUSIVE', 'Test 17a - unparseable worker response is INCONCLUSIVE');
    assert.equal(result.failureClass, 'VERIFIER_PROTOCOL_ERROR');
  }
  {
    globalThis.fetch = (async () => new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 })) as any;
    const service = new CandidateVerificationService();
    const result = await service.verify(manifest());
    assert.equal(result.overall, 'INCONCLUSIVE', 'Test 17b - well-formed JSON but wrong shape is still VERIFIER_PROTOCOL_ERROR');
    assert.equal(result.failureClass, 'VERIFIER_PROTOCOL_ERROR');
  }
  {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as any;
    const service = new CandidateVerificationService();
    const result = await service.verify(manifest());
    assert.equal(result.overall, 'INCONCLUSIVE', 'Test 17c - a non-2xx HTTP status is VERIFIER_PROTOCOL_ERROR');
    assert.equal(result.failureClass, 'VERIFIER_PROTOCOL_ERROR');
  }

  // --- Test: a genuine candidate FAIL from the worker (e.g. real compile failure) still passes through as FAIL, never reclassified as a transport issue ---
  {
    const m = manifest();
    const workerResponse = fakeVerification(m, { overall: 'FAIL', failureClass: 'CANDIDATE_COMPILE_FAILURE', compile: { status: 'FAILED', exitCode: 1, durationMs: 200, evidenceRef: 'COMPILATION ERROR' } });
    globalThis.fetch = (async () => new Response(JSON.stringify(workerResponse), { status: 200 })) as any;
    const service = new CandidateVerificationService();
    const result = await service.verify(m);
    assert.equal(result.overall, 'FAIL', 'a real candidate defect reported by the worker stays FAIL, not INCONCLUSIVE');
    assert.equal(result.failureClass, 'CANDIDATE_COMPILE_FAILURE');
  }

  // --- R-SEC-V1.4 §5 — evaluateSecurityRemediation(): the smallest new
  // method added to this SAME thin client, reusing the SAME failure
  // vocabulary. Mocks global fetch exactly like the tests above; the real,
  // unmocked worker-side proof lives in candidate-verifier/src/security-
  // remediation-http.spec.ts and security-remediation-orchestrator.spec.ts. ---
  const secInput = { finding: { findingIdentity: 'fp-x', source: 'TRIVY', package: 'g:a', expectedInstalledVersion: '1.0.0', fixedVersion: '1.0.1' }, repository: 'souhaiel11/pfe-app-test', candidateBaseSha: 'a'.repeat(40), requestId: 'sec-eval-x', batchId: 'internal-security-evaluate', candidateAttempt: 0 };

  // Happy path: correct derived URL (no new env var), exact input forwarded, real shape passed through unchanged.
  {
    let capturedUrl: string | undefined;
    let capturedBody: any;
    const workerResponse = { status: 'CANDIDATE_READY', reason: 'DETERMINISTIC_CANDIDATE_READY', decision: { findingIdentity: 'fp-x', evaluatedSha: secInput.candidateBaseSha, provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'g:a', installedVersion: '1.0.0', controllingFile: 'pom.xml', controllingElement: null, controllingProperty: null, groundedSha: secInput.candidateBaseSha, evidence: 'x' }, fixedVersions: ['1.0.1'], selectedTargetVersion: '1.0.1', remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'DIRECT_EXPLICIT:SELECTED' }, candidateIdentity: 'deadbeef', candidateManifest: null, patchEvidence: null, guardResult: { ok: true }, dependencyResolutionEvidence: null };
    globalThis.fetch = (async (url: any, init: any) => { capturedUrl = String(url); capturedBody = JSON.parse(init.body); return new Response(JSON.stringify(workerResponse), { status: 200 }); }) as any;
    const service = new CandidateVerificationService();
    const result = await service.evaluateSecurityRemediation(secInput);
    assert.equal(capturedUrl, 'http://candidate-verifier:4100/security-remediation/evaluate', 'the worker base URL is derived from the SAME workerUrl, no new env var');
    // V1.7 Blocker B: the exact trusted input is forwarded unchanged, EXTENDED
    // with overallDeadlineMs == this call's own timeoutMs (the default here,
    // since evaluateSecurityRemediation() was called with no explicit
    // timeoutMs) -- so the worker's internal deadline finally agrees with
    // the backend's own HTTP abort instead of being a disconnected figure.
    assert.deepEqual(capturedBody, { ...secInput, overallDeadlineMs: WORKER_DEADLINE_MS }, 'the exact trusted input is forwarded, plus the caller\'s own timeout (defaulting to the shared WORKER_DEADLINE_MS contract) as overallDeadlineMs');
    assert.equal(result.status, 'TECHNICAL_FAILURE', 'V1.6 ready response without candidate-wide closure must be rejected');
  }

  // V1.7: complete, candidate-bound proof passes; stale or detached proof fails.
  {
    const input = { ...secInput, finding: { ...secInput.finding, cveId: 'CVE-2023-6378' } };
    const scope: any = { kind: 'SINGLE_CONTROL', targetCve: input.finding.cveId, evaluatedSha: input.candidateBaseSha,
      controllingFile: 'pom.xml', originalBlobSha: 'b'.repeat(40),
      affectedPackages: [{ package: 'g:a', installedVersion: '1.0.0', targetVersion: '1.0.1' }],
      controls: [{ kind: 'DEPENDENCY_VERSION', key: 'g:a', start: 0, end: 5, oldVersion: '1.0.0', targetVersion: '1.0.1' }] };
    const m = manifest({ repository: input.repository, candidateBaseSha: input.candidateBaseSha,
      files: [{ path: 'pom.xml', operation: 'MODIFY', content: '1.0.1', contentSha256: computeContentSha256('1.0.1'), originalBlobSha: scope.originalBlobSha }] });
    const ready: any = { status: 'CANDIDATE_READY', candidateManifest: m,
      decision: { findingIdentity: input.finding.findingIdentity, evaluatedSha: input.candidateBaseSha,
        provenance: { package: 'g:a', installedVersion: '1.0.0' }, selectedTargetVersion: '1.0.1', remediationScope: scope },
      candidateIdentity: computeSecurityCandidateIdentity({ findingIdentity: input.finding.findingIdentity, evaluatedSha: input.candidateBaseSha,
        package: 'g:a', installedVersion: '1.0.0', targetVersion: '1.0.1', controllingFile: 'pom.xml', remediationScope: scope }),
      securityValidationEvidence: { status: 'TARGET_CVE_CLOSED', targetCveMatchCount: 0, buildPassed: true,
        mode: 'TRIVY_IMAGE_ARCHIVE', targetCve: input.finding.cveId, evaluatedSha: input.candidateBaseSha,
        artifactDigest: 'c'.repeat(64), reportDigest: 'd'.repeat(64), candidateContentSha256: computeContentSha256('1.0.1') } };
    globalThis.fetch = (async () => new Response(JSON.stringify(ready))) as any;
    assert.equal((await new CandidateVerificationService().evaluateSecurityRemediation(input)).status, 'CANDIDATE_READY');
    for (const mutate of [
      (r: any) => { delete r.securityValidationEvidence; },
      (r: any) => { r.securityValidationEvidence.targetCveMatchCount = 1; },
      (r: any) => { r.securityValidationEvidence.targetCve = 'CVE-2024-12345'; },
      (r: any) => { r.securityValidationEvidence.evaluatedSha = 'e'.repeat(40); },
      (r: any) => { r.securityValidationEvidence.buildPassed = false; },
      (r: any) => { r.candidateManifest.files[0].content = 'extra mutation'; },
      (r: any) => { r.decision.remediationScope.controls.push({ ...scope.controls[0], key: 'g:b' }); },
      (r: any) => { r.candidateIdentity = 'e'.repeat(64); },
    ]) {
      const invalid = JSON.parse(JSON.stringify(ready)); mutate(invalid);
      globalThis.fetch = (async () => new Response(JSON.stringify(invalid))) as any;
      assert.equal((await new CandidateVerificationService().evaluateSecurityRemediation(input)).status, 'TECHNICAL_FAILURE');
    }
  }

  // I: candidate-verifier timeout -> TECHNICAL_FAILURE / VERIFIER_TIMEOUT
  for (const failureClass of ['VERIFIER_TIMEOUT', 'VERIFIER_UNAVAILABLE']) {
    const runtimeFailure: any = { status: 'TECHNICAL_FAILURE', failureClass, reason: 'runtime-failure',
      decision: { findingIdentity: secInput.finding.findingIdentity }, candidateManifest: null, candidateIdentity: null };
    globalThis.fetch = (async () => new Response(JSON.stringify(runtimeFailure))) as any;
    assert.deepEqual(await new CandidateVerificationService().evaluateSecurityRemediation(secInput), runtimeFailure);
    for (const key of ['candidateManifest', 'candidateIdentity', 'securityValidationEvidence']) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ ...runtimeFailure, [key]: 'forged-success' }))) as any;
      assert.equal((await new CandidateVerificationService().evaluateSecurityRemediation(secInput) as any).failureClass, 'VERIFIER_PROTOCOL_ERROR');
    }
  }
  {
    globalThis.fetch = (async (_url: any, init: any) => {
      if (init?.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      throw new Error('unreachable: signal was not pre-aborted');
    }) as any;
    (AbortSignal as any).timeout = () => { const c = new AbortController(); c.abort(); return c.signal; };
    const service = new CandidateVerificationService();
    const result: any = await service.evaluateSecurityRemediation(secInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE', 'I: a real timeout must never be reported as NOT_ELIGIBLE or any business status');
    assert.equal(result.failureClass, 'VERIFIER_TIMEOUT');
    (AbortSignal as any).timeout = originalTimeout;
  }

  // J: candidate-verifier unavailable -> TECHNICAL_FAILURE / VERIFIER_UNAVAILABLE
  {
    globalThis.fetch = (async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' }); }) as any;
    const service = new CandidateVerificationService();
    const result: any = await service.evaluateSecurityRemediation(secInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.failureClass, 'VERIFIER_UNAVAILABLE', 'J: connection failure is a technical failure, never a business decision');
  }

  // K: malformed verifier response -> TECHNICAL_FAILURE / VERIFIER_PROTOCOL_ERROR (three shapes)
  {
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as any;
    const service = new CandidateVerificationService();
    const result: any = await service.evaluateSecurityRemediation(secInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.failureClass, 'VERIFIER_PROTOCOL_ERROR', 'K: unparseable JSON');
  }
  {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'CANDIDATE_READY' /* no decision */ }), { status: 200 })) as any;
    const service = new CandidateVerificationService();
    const result: any = await service.evaluateSecurityRemediation(secInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.failureClass, 'VERIFIER_PROTOCOL_ERROR', 'K: well-formed JSON but wrong shape (missing decision)');
  }
  {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'SOMETHING_MADE_UP', decision: { findingIdentity: 'x' } }), { status: 200 })) as any;
    const service = new CandidateVerificationService();
    const result: any = await service.evaluateSecurityRemediation(secInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.failureClass, 'VERIFIER_PROTOCOL_ERROR', 'K: an unrecognized status value is never trusted');
  }
  {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as any;
    const service = new CandidateVerificationService();
    const result: any = await service.evaluateSecurityRemediation(secInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.failureClass, 'VERIFIER_PROTOCOL_ERROR', 'K: non-2xx HTTP status');
  }
  // V1.7 predeploy phase — Phase A deadline contract: one shared source of
  // truth, never a state where the worker could legitimately still be
  // running after the backend has already given up.
  {
    // Not pinned to a specific literal here (see
    // n8n-workflows/WF6-V1_7-RUNTIME-INTEGRATION-AUDIT.md for the real
    // evidence WORKER_DEADLINE_MS is currently sized against) -- only the
    // INVARIANT the shared contract must always hold: derived, never a
    // second hand-maintained literal, and strictly ordered.
    assert.equal(BACKEND_HTTP_TIMEOUT_MS, WORKER_DEADLINE_MS + BACKEND_TRANSPORT_SLACK_MS, 'derived, never a second hand-maintained literal');
    assert.ok(BACKEND_HTTP_TIMEOUT_MS > WORKER_DEADLINE_MS, 'backend must always wait strictly longer than the worker deadline it forwards');
  }
  for (const timeoutMs of [WORKER_DEADLINE_MS - 1, WORKER_DEADLINE_MS]) {
    let capturedBody: any;
    globalThis.fetch = (async (_url: any, init: any) => { capturedBody = JSON.parse(init.body); return new Response(JSON.stringify({ status: 'TECHNICAL_FAILURE', failureClass: 'VERIFIER_UNAVAILABLE', reason: 'x', decision: { findingIdentity: 'fp-x' } })); }) as any;
    await new CandidateVerificationService().evaluateSecurityRemediation(secInput, timeoutMs);
    assert.equal(capturedBody.overallDeadlineMs, timeoutMs, `an explicit ${timeoutMs}ms request is forwarded unchanged, not silently clamped by the CALLER side`);
  }
  console.log(`CandidateVerificationService: WORKER_DEADLINE_MS/BACKEND_HTTP_TIMEOUT_MS shared-contract invariant: PASS (${WORKER_DEADLINE_MS - 1}/${WORKER_DEADLINE_MS} forwarded unchanged; clamping itself is the worker's own responsibility, proven in worker-deadline.spec.ts)`);
  console.log('CandidateVerificationService.evaluateSecurityRemediation (thin HTTP client, R-SEC-V1.4): PASS');

  globalThis.fetch = originalFetch;
  (AbortSignal as any).timeout = originalTimeout;
  console.log('CandidateVerificationService (thin HTTP client): PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
