import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

const sha = '10e90dd5a0d21941dea1a544c3026d0955a029b1';
const incident: any = {
  id: 'd1f5e9ce-f039-475d-9a50-41f217e6444b', projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', status: 'fix_generated',
  prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/24', metadata: { fixRequest: {
    status: 'PR_CREATED', requestId: '9b62e087-02a8-409d-bfb1-a951629a8814', batchId: '6396353230fd100bf80c3417271c70cb7808273ebd6500571a46c2a4505af431',
    attemptCount: 7, prNumber: 24, prHeadSha: sha, findingIds: ['a', 'b'],
  } },
};
const project: any = {
  id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', githubRepo: 'souhaiel11/pfe-app-test', githubToken: null,
  jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: 'pfe-app-test',
};
incident.project = project;
const incidentRepo: any = {
  findOne: async () => incident,
  update: async (_id: string, patch: any) => Object.assign(incident, patch),
};
const projectRepo: any = { findOne: async () => project };
let tail = Promise.resolve();
const repository: any = {
  manager: { transaction: async (fn: any) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn({ getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }); }
    finally { release(); }
  } },
  findOne: incidentRepo.findOne,
  update: incidentRepo.update,
};

async function main() {
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any);
  const originalFetch = globalThis.fetch;
  let triggers = 0;
  globalThis.fetch = async (url: any, init?: RequestInit) => {
    const value = String(url);
    if (value.includes('api.github.com')) {
      assert.equal(new Headers(init?.headers).has('authorization'), false, 'public PR lookup must not fabricate authentication');
      return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
    }
    if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
    if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
    if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/42/' } }); }
    throw new Error(`unexpected URL ${value}`);
  };
  try {
    const user = { id: 'developer-1', role: 'developer' };
    const results = await Promise.all([service.requestPrValidation(incident.id, user), service.requestPrValidation(incident.id, user)]);
    assert.equal(triggers, 1);
    assert.equal(results.filter((result: any) => result.duplicate).length, 1);
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, sha);
    assert.equal(incident.metadata.prValidationRequest.batchKey, incident.metadata.fixRequest.batchId, 'historical missing batchKey must derive from canonical batchId');
    assert.equal(incident.metadata.prValidationRequest.repository, 'souhaiel11/pfe-app-test');
    const realValidationRequestId = incident.metadata.prValidationRequest.validationRequestId;

    incident.metadata.prValidationRequest = null;
    globalThis.fetch = async (url: any) => {
      if (String(url).includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha: 'b'.repeat(40), ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
      triggers++;
      throw new Error('Jenkins must not be reached');
    };
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /Pull Request a changé/);
    assert.equal(triggers, 1);

    // R28 — un échec de transport Jenkins (FAILED) doit rester réessayable
    // explicitement, sur la même identité logique, avec l'historique préservé.
    incident.metadata.prValidationRequest = {
      validationRequestId: realValidationRequestId, validationType: 'PR_VALIDATION', status: 'FAILED',
      projectId: incident.projectId, incidentId: incident.id, fixRequestId: incident.metadata.fixRequest.requestId,
      requestId: incident.metadata.fixRequest.requestId, batchId: incident.metadata.fixRequest.batchId,
      batchKey: incident.metadata.fixRequest.batchId, attemptCount: 7, repository: 'souhaiel11/pfe-app-test',
      prNumber: 24, prUrl: incident.prUrl, prHeadBranch: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`,
      expectedPrHeadSha: sha, createdBy: 'developer-1', createdAt: 't0', updatedAt: 't0',
      failureCode: 'JENKINS_TRIGGER_FAILED', failureSummary: 'Le build PR n’a pas pu être mis en file.', failedAt: 't0',
    };
    const priorFailed = incident.metadata.prValidationRequest;
    triggers = 0;
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) {
        assert.equal(new Headers(init?.headers).has('authorization'), false);
        return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
      }
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/43/' } }); }
      throw new Error(`unexpected URL ${value}`);
    };
    const retryResult: any = await service.requestPrValidation(incident.id, user);
    assert.equal(triggers, 1, 'explicit retry after FAILED must reach Jenkins exactly once');
    assert.equal(retryResult.duplicate, false, 'a FAILED->retry transition is not a duplicate');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    assert.equal(incident.metadata.prValidationRequest.validationRequestId, realValidationRequestId, 'retry preserves the same logical identity');
    assert.equal(incident.metadata.prValidationRequest.retryAttempt, 1);
    assert.equal(incident.metadata.prValidationRequest.previousAttempts.length, 1);
    assert.equal(incident.metadata.prValidationRequest.previousAttempts[0], priorFailed, 'prior FAILED attempt history preserved verbatim');

    // R28 concurrency — two explicit retries fired at once against a FAILED
    // state (same logical identity) must yield exactly one Jenkins trigger
    // and one duplicate response, thanks to the pessimistic_write lock.
    incident.metadata.prValidationRequest = { ...priorFailed, retryAttempt: 1, previousAttempts: [priorFailed] };
    triggers = 0;
    const concurrent = await Promise.all([
      service.requestPrValidation(incident.id, user),
      service.requestPrValidation(incident.id, user),
    ]);
    assert.equal(triggers, 1, 'at most one Jenkins trigger for two concurrent retry clicks');
    assert.equal(concurrent.filter((r: any) => r.duplicate).length, 1, 'exactly one of the two concurrent clicks must observe a duplicate');

    // R42A — reconciliation of a stale QUEUED validation whose exact Jenkins
    // build already went terminal without ever sending a callback (proven by
    // real PR-24 build #1: a Shared Library CPS crash right after checkout).
    const queuedWithHistory = {
      validationRequestId: realValidationRequestId, validationType: 'PR_VALIDATION', status: 'QUEUED',
      projectId: incident.projectId, incidentId: incident.id, requestId: incident.metadata.fixRequest.requestId,
      batchId: incident.metadata.fixRequest.batchId, batchKey: incident.metadata.fixRequest.batchId,
      attemptCount: 7, repository: 'souhaiel11/pfe-app-test', prNumber: 24, prUrl: incident.prUrl,
      prHeadBranch: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`, expectedPrHeadSha: sha,
      queueUrl: 'http://jenkins:8080/queue/item/1261/', prValidationJob: 'pfe-app-test-multibranch/job/PR-24',
      createdBy: 'developer-1', createdAt: 't0', updatedAt: 't0', retryAttempt: 1, previousAttempts: [priorFailed],
    };

    // R42A-TEST A: queue item's build not found among recent builds (queueId
    // 1261 unmatched) -- genuinely still queued/unresolved, no write.
    incident.metadata.prValidationRequest = { ...queuedWithHistory };
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test A: ${url}`);
    };
    const stillQueued: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(stillQueued.reconciled, false);
    assert.equal(stillQueued.reason, 'STILL_QUEUED');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'no DB write when the build has not started yet');

    // R42A-TEST B: matching build found by queueId but still building -- no write yet.
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 1, queueId: 1261, building: true, result: null }] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test B: ${value}`);
    };
    const stillRunning: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(stillRunning.reconciled, false);
    assert.equal(stillRunning.reason, 'STILL_RUNNING');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'no DB write while the build is still executing');

    // R42A-TEST C: matching build (by queueId, not the ephemeral queue endpoint --
    // proven necessary: the real queue/item/1261 had already 404'd by the time
    // reconciliation ran) terminal FAILURE, no callback ever received -- reconciles
    // to FAILED/JENKINS_PIPELINE_FAILED, preserves prior history, never touches fixRequest.
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 1, queueId: 1261, building: false, result: 'FAILURE' }] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test C: ${value}`);
    };
    const fixRequestStatusBefore = incident.metadata.fixRequest.status;
    const reconcileResult: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(reconcileResult.reconciled, true);
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'JENKINS_PIPELINE_FAILED');
    assert.equal(incident.metadata.prValidationRequest.jenkinsBuildNumber, 1);
    assert.equal(incident.metadata.prValidationRequest.validationRequestId, realValidationRequestId, 'reconciliation preserves the same logical identity');
    assert.equal(incident.metadata.prValidationRequest.previousAttempts.length, 1, 'prior attempt history untouched by reconciliation');
    assert.equal(incident.metadata.prValidationRequest.previousAttempts[0].failureCode, 'JENKINS_TRIGGER_FAILED', 'original attempt-1 evidence preserved verbatim');
    assert.equal(incident.metadata.fixRequest.status, fixRequestStatusBefore, 'reconciliation never touches fixRequest.status (stays PR_CREATED)');

    // R42A-TEST D: a genuinely reconciled FAILED state is retry-eligible again,
    // same governance as any other FAILED -> retryAttempt increments, identity preserved.
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/44/' } }); }
      throw new Error(`unexpected URL in reconcile test D: ${value}`);
    };
    triggers = 0;
    const retryAfterReconcile: any = await service.requestPrValidation(incident.id, user);
    assert.equal(triggers, 1, 'retry after reconciliation reaches Jenkins exactly once');
    assert.equal(retryAfterReconcile.duplicate, false);
    assert.equal(incident.metadata.prValidationRequest.retryAttempt, 2, 'second retry attempt correctly incremented');
    assert.equal(incident.metadata.prValidationRequest.previousAttempts.length, 2, 'both prior attempts (original FAILED + reconciled FAILED) preserved');

    // R42A-TEST E: fail-closed refusal to auto-reconcile a SUCCESS build with no callback.
    incident.metadata.prValidationRequest = { ...queuedWithHistory, status: 'QUEUED' };
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 1, queueId: 1261, building: false, result: 'SUCCESS' }] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test E: ${value}`);
    };
    await assert.rejects(() => service.reconcilePrValidation(incident.id, user), /SUCCESS sans callback/);
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'a SUCCESS build is never auto-reconciled to VALIDATED');
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('PR validation contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
