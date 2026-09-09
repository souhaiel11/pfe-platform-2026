import * as assert from 'node:assert/strict';
import { IncidentsService, classifyJenkinsTriggerStatus } from './incidents.service';

// BRIQUE 2 — see pr-validation-contract.spec.ts for rationale: this suite is
// about Jenkins-side failure taxonomy, so HEAD_ONLY is stubbed to always pass
// for whatever exact SHA it is asked to verify.
const passingCandidateVerification: any = {
  verifyHead: async (request: any) => ({
    mode: 'HEAD_ONLY',
    identity: { repository: request.repository, targetSha: String(request.targetSha).toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt },
    workspace: { workspaceId: 'stub', checkoutSha: String(request.targetSha).toLowerCase(), exactShaVerified: true, created: true, cleaned: true },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
      regression: { status: 'SUCCESS', total: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS', verificationLevel: 'COMPILE_TEST_VERIFIED', failureClass: null,
  }),
};

// R21-AR — proves requestPrValidation() classifies every distinct Jenkins
// failure mode instead of collapsing all of them into JENKINS_TRIGGER_FAILED
// (the exact gap that made PR-25's real JENKINS_JOB_NOT_FOUND/bootstrap
// failure indistinguishable from a generic transport error). Also proves
// classifyJenkinsTriggerStatus's own contract for every code it now emits.

// --- Unit contract for the shared classifier -------------------------------
assert.deepEqual(classifyJenkinsTriggerStatus(201), { accepted: true });
assert.equal(classifyJenkinsTriggerStatus(200).code, 'JENKINS_TRIGGER_NOT_ACCEPTED');
assert.equal(classifyJenkinsTriggerStatus(401).code, 'JENKINS_AUTH_FAILED');
assert.equal(classifyJenkinsTriggerStatus(403).code, 'JENKINS_AUTH_FAILED');
assert.equal(classifyJenkinsTriggerStatus(404).code, 'JENKINS_JOB_NOT_FOUND');
assert.equal(classifyJenkinsTriggerStatus(400).code, 'JENKINS_TRIGGER_REJECTED');
assert.equal(classifyJenkinsTriggerStatus(409).code, 'JENKINS_TRIGGER_CONFLICT');
assert.equal(classifyJenkinsTriggerStatus(500).code, 'JENKINS_UNAVAILABLE');
assert.equal(classifyJenkinsTriggerStatus(503).code, 'JENKINS_UNAVAILABLE');
assert.equal(classifyJenkinsTriggerStatus(418).code, 'JENKINS_TRIGGER_FAILED');
for (const code of [201, 200, 401, 403, 404, 400, 409, 500, 418]) assert.equal(classifyJenkinsTriggerStatus(code).accepted, code === 201);

// --- End-to-end: requestPrValidation() must persist the granular code ------
const sha = 'ea6230b79b99f0c5fcb3c7da3f838bb3efbe81be';
const makeIncident = () => {
  const incident: any = {
    id: '65e35d1b-212f-4153-bd63-fba6e8eebc2c', projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', status: 'fix_generated',
    prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/25', metadata: { fixRequest: {
      status: 'PR_CREATED', requestId: 'f1af3192-40f0-4400-869a-3854246d7a11', batchId: '9c190dbec8d6f3d17b2b7e961e329bdc122e00ed18f88586b85bdca7a8d1c49d',
      attemptCount: 16, prNumber: 25, prHeadSha: sha, findingIds: ['b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', 'f11d4686-a7ba-4c0c-abbb-a12998c57220'],
    } },
  };
  const project: any = {
    id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', githubRepo: 'souhaiel11/pfe-app-test', githubToken: null,
    jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: 'pfe-app-test',
    sonarqubeKey: 'pfe-app-test',
  };
  incident.project = project;
  const incidentRepo: any = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const projectRepo: any = { findOne: async () => project };
  let tail = Promise.resolve();
  const repository: any = {
    manager: { transaction: async (fn: any) => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await fn({ getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }); }
      finally { release(); }
    } },
    findOne: incidentRepo.findOne, update: incidentRepo.update,
  };
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, passingCandidateVerification);
  return { incident, project, service };
};

const githubOpenPr = () => new Response(JSON.stringify({ state: 'open', head: { sha, ref: 'fix/pfe-65e35d1b-212f-4153-bd63-fba6e8eebc2c-f1af3192-40f0-4400-869a-3854246d7a11' } }), { status: 200 });
const validMetadata = () => new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
const validCrumb = () => new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });

async function expectFailureCode(mockFetch: (url: string) => Promise<Response>, expectedCode: string, label: string) {
  const { incident, service } = makeIncident();
  const user = { id: 'admin-1', role: 'admin' };
  globalThis.fetch = mockFetch as any;
  await assert.rejects(() => service.requestPrValidation(incident.id, user), /validation PR/);
  assert.equal(incident.metadata.prValidationRequest.status, 'FAILED', label + ': status');
  assert.equal(incident.metadata.prValidationRequest.failureCode, expectedCode, label + ': failureCode');
  assert.ok(incident.metadata.prValidationRequest.failureSummary.length <= 300, label + ': bounded summary');
  assert.ok(!/Authorization|Basic |token /.test(incident.metadata.prValidationRequest.failureSummary), label + ': no credential leakage');
}

async function main() {
  // Case 1: job not yet indexed at all -- proven Attempt-15/PR-25 failure #1.
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('crumbIssuer') || value.includes('/api/json')) return new Response('', { status: 404 });
    throw new Error('unexpected ' + value);
  }, 'JENKINS_JOB_NOT_FOUND', '404 job not found');

  // Case 2: job exists, buildable, PFE_VALIDATION_CONTEXT not yet registered
  // -- proven Attempt-15/PR-25 failure #2 (bootstrap gap) -- and the R21-AS
  // on-demand injection attempt itself also fails (script console rejects).
  // The successful-injection path is covered in
  // pr-validation-parameter-bootstrap.spec.ts.
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('crumbIssuer')) return validCrumb();
    if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [] }), { status: 200 });
    if (value.includes('/scriptText')) return new Response('', { status: 403 });
    throw new Error('unexpected ' + value);
  }, 'JENKINS_AUTH_FAILED', 'parameter not yet materialized, bootstrap script rejected');

  // Case 3: auth failure on metadata fetch.
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('/api/json')) return new Response('', { status: 403 });
    throw new Error('unexpected ' + value);
  }, 'JENKINS_AUTH_FAILED', '403 auth failed');

  // Case 4: crumb endpoint returns malformed JSON.
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('crumbIssuer')) return new Response('not json', { status: 200 });
    if (value.includes('/api/json')) return validMetadata();
    throw new Error('unexpected ' + value);
  }, 'JENKINS_RESPONSE_INVALID', 'malformed crumb JSON');

  // Case 5: crumb endpoint returns 200 but missing required fields.
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (value.includes('/api/json')) return validMetadata();
    throw new Error('unexpected ' + value);
  }, 'JENKINS_CRUMB_FAILED', 'crumb missing fields');

  // Case 6: Jenkins queue rejects the trigger with 409 (already building).
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('crumbIssuer')) return validCrumb();
    if (value.includes('/api/json')) return validMetadata();
    if (value.includes('/buildWithParameters')) return new Response('', { status: 409 });
    throw new Error('unexpected ' + value);
  }, 'JENKINS_TRIGGER_CONFLICT', '409 conflict');

  // Case 7: Jenkins is down (metadata fetch 503).
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('/api/json')) return new Response('', { status: 503 });
    throw new Error('unexpected ' + value);
  }, 'JENKINS_UNAVAILABLE', '503 unavailable');

  // Case 8: accepted status but malformed/missing queue location header.
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('crumbIssuer')) return validCrumb();
    if (value.includes('/api/json')) return validMetadata();
    if (value.includes('/buildWithParameters')) return new Response('', { status: 201 }); // no location header
    throw new Error('unexpected ' + value);
  }, 'JENKINS_TRIGGER_NOT_ACCEPTED', 'accepted status, no queue url');

  // Case 9: timeout (AbortSignal.timeout fires before Jenkins responds).
  // The signal is forced pre-aborted, so the mock must check `.aborted`
  // synchronously rather than await a future 'abort' event that will never
  // fire on an already-aborted signal (that event already happened).
  {
    const { incident, service } = makeIncident();
    globalThis.fetch = (async (url: any, init?: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr();
      if (value.includes('/api/json')) {
        if (init?.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
        throw new Error('unreachable: signal was not pre-aborted');
      }
      throw new Error('unexpected ' + value);
    }) as any;
    // Force an immediate abort instead of waiting the real 10s.
    const originalTimeout = AbortSignal.timeout;
    (AbortSignal as any).timeout = () => { const c = new AbortController(); c.abort(); return c.signal; };
    try {
      await assert.rejects(() => service.requestPrValidation(incident.id, { id: 'admin-1', role: 'admin' }), /validation PR/);
    } finally {
      (AbortSignal as any).timeout = originalTimeout;
    }
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'JENKINS_TIMEOUT', 'timeout: failureCode');
  }

  // Case 10: no credential/body leakage even on a raw thrown error with a
  // sensitive-looking message (defense in depth for the catch-all path).
  await expectFailureCode(async url => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubOpenPr();
    if (value.includes('/api/json')) throw new Error('connect ECONNREFUSED 10.0.0.5:8080');
    throw new Error('unexpected ' + value);
  }, 'JENKINS_TRIGGER_FAILED', 'unknown thrown error falls back to generic code');

  console.log('PR validation failure taxonomy: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
