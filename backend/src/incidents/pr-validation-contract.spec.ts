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
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('PR validation contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
