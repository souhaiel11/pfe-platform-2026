import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

const sha = '10e90dd5a0d21941dea1a544c3026d0955a029b1';
const incident: any = {
  id: 'incident-1', projectId: 'project-1', status: 'fix_generated',
  prUrl: 'https://github.com/owner/repo/pull/24', metadata: { fixRequest: {
    status: 'PR_CREATED', requestId: 'request-1', batchId: 'batch-1', batchKey: 'batch-1',
    attemptCount: 7, prNumber: 24, prHeadSha: sha, findingIds: ['a', 'b'],
  } },
};
const project: any = {
  id: 'project-1', githubRepo: 'owner/repo', githubToken: 'not-printed',
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
  globalThis.fetch = async (url: any) => {
    const value = String(url);
    if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-request-1` } }), { status: 200 });
    if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob' }), { status: 200 });
    if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
    if (value.includes('/build?cause=')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/42/' } }); }
    throw new Error(`unexpected URL ${value}`);
  };
  try {
    const user = { id: 'developer-1', role: 'developer' };
    const results = await Promise.all([service.requestPrValidation(incident.id, user), service.requestPrValidation(incident.id, user)]);
    assert.equal(triggers, 1);
    assert.equal(results.filter((result: any) => result.duplicate).length, 1);
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, sha);

    incident.metadata.prValidationRequest = null;
    globalThis.fetch = async (url: any) => {
      if (String(url).includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha: 'b'.repeat(40), ref: `fix/pfe-${incident.id}-request-1` } }), { status: 200 });
      triggers++;
      throw new Error('Jenkins must not be reached');
    };
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /Pull Request a changé/);
    assert.equal(triggers, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('PR validation contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
