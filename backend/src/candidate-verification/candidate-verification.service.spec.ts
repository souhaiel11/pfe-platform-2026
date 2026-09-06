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
    workspace: { workspaceId: `${m.requestId}/${m.batchId}/attempt-${m.candidateAttempt}`, exactShaVerified: true, created: true, cleaned: true },
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

  globalThis.fetch = originalFetch;
  (AbortSignal as any).timeout = originalTimeout;
  console.log('CandidateVerificationService (thin HTTP client): PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
