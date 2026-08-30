import * as assert from 'node:assert/strict';
import { IncidentsService, remediationBatchIdentity, resolveRemediationBatch } from './incidents.service';

const sonar = (id: string, extra: any = {}) => ({
  id, source: 'SONARQUBE', stage: 'sonar', remediationType: 'AUTO_FIX_ELIGIBLE',
  rule: 'java:S1068', file: `src/${id}.java`, line: 10, message: `Finding ${id}`, ...extra,
});

const deduped = resolveRemediationBatch([sonar('a'), sonar('b')], ['b', 'a', 'a']);
assert.deepEqual(deduped.findingIds, ['a', 'b']);
assert.equal(deduped.workflow, 'WF2');
assert.equal(remediationBatchIdentity('incident', ['b', 'a', 'a']), remediationBatchIdentity('incident', ['a', 'b']));
assert.throws(() => resolveRemediationBatch([sonar('a')], ['missing']), /appartiennent pas à cet incident/);
assert.throws(() => resolveRemediationBatch([sonar('a', { remediationType: 'DEVELOPER_ACTION_REQUIRED' })], ['a']), /correction automatisable/);
assert.throws(() => resolveRemediationBatch([sonar('a'), { ...sonar('b'), source: 'DOCKER', stage: 'docker' }], ['a', 'b']), /même stratégie/);

// Double soumission équivalente : une seule transaction crée la demande et
// une seule invocation future est dispatchée. Aucun service externe réel.
const incident: any = {
  id: 'incident-1', projectId: 'project-1', project: { id: 'project-1', githubRepo: 'owner/repo' },
  status: 'blocked', prUrl: null, buildNumber: 136, metadata: { enrichedData: { sonar: { issues: [sonar('a'), sonar('b')] } } },
};
let lockedFindOptions: any;
const transactionalRepo = {
  findOne: async (options: any) => { lockedFindOptions = options; return incident; },
  update: async (_id: string, patch: any) => Object.assign(incident, patch),
};
const project = { id: 'project-1', githubRepo: 'owner/repo' };
const transactionalProjectRepo = { findOne: async () => project };
const repository: any = {
  manager: { transaction: async (fn: any) => fn({ getRepository: (entity: any) => entity?.name === 'Project' ? transactionalProjectRepo : transactionalRepo }) },
  findOne: async () => incident,
  update: transactionalRepo.update,
};
async function main() {
  let dispatches = 0;
  const payloads: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: any, options: any) => { dispatches++; payloads.push(JSON.parse(options.body)); return new Response('{}', { status: 200 }); };
  try {
  const service = new IncidentsService(repository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any);
  const user = { id: 'developer-1', role: 'developer' };
  const first: any = await service.approveFix(incident.id, user, { findingIds: ['b', 'a', 'a'] });
  const second: any = await service.approveFix(incident.id, user, { findingIds: ['a', 'b'] });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.batchId, second.batchId);
  assert.equal(dispatches, 1);
  assert.equal(lockedFindOptions.lock.mode, 'pessimistic_write');
  assert.equal(lockedFindOptions.relations, undefined, 'locked incident query must not join project');
  assert.equal(payloads[0].buildNumber, 136);
  assert.equal(payloads[0].batchKey, first.batchId);
  assert.equal(payloads[0].batchId, first.batchId);
  assert.deepEqual(payloads[0].findingIds, ['a', 'b']);
  assert.equal(payloads[0].findings.length, 2);
  assert.deepEqual(incident.metadata.fixRequest.findingIds, ['a', 'b']);
  incident.prUrl = 'https://github.com/owner/repo/pull/7';
  incident.buildNumber = 136;
  incident.jenkinsJobName = 'project-job';
  await assert.rejects(() => service.saveValidation(incident.id, {
    projectId: 'project-1', fixRequestId: first.requestId, repository: 'owner/repo', prNumber: 7,
    buildNumber: 137, jenkinsJob: 'project-job', jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
    correlationVerified: true, sonarCorrelationVerified: true, findingResults: [{ findingId: 'a', result: 'VALID', evidence: 'analysis-a' }],
  }), /exactement un résultat/);
  const validated: any = await service.saveValidation(incident.id, {
    projectId: 'project-1', fixRequestId: first.requestId, repository: 'owner/repo', prNumber: 7,
    buildNumber: 137, jenkinsJob: 'project-job', jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
    correlationVerified: true, sonarCorrelationVerified: true,
    findingResults: [{ findingId: 'a', result: 'VALID', evidence: 'analysis-a' }, { findingId: 'b', result: 'VALID', evidence: 'analysis-b' }],
  });
  assert.equal(validated.validation.validationStatus, 'VALIDATED');
  assert.equal(validated.validation.findingResults.length, 2);

  // Un échec de dispatch conserve le batch logique. Une nouvelle autorisation
  // humaine réutilise requestId/batchId, incrémente la tentative et dispatch
  // exactement une fois.
  const retryIncident: any = {
    id: 'incident-retry', projectId: 'project-1', status: 'blocked', prUrl: null, buildNumber: 136,
    metadata: { enrichedData: { sonar: { issues: [sonar('a'), sonar('b')] } } },
  };
  const retryIncidentRepo: any = {
    findOne: async () => retryIncident,
    update: async (_id: string, patch: any) => Object.assign(retryIncident, patch),
  };
  const retryRepository: any = {
    manager: { transaction: async (fn: any) => fn({ getRepository: (entity: any) => entity?.name === 'Project' ? transactionalProjectRepo : retryIncidentRepo }) },
    findOne: async () => retryIncident,
    update: retryIncidentRepo.update,
  };
  const retryService = new IncidentsService(retryRepository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any);
  globalThis.fetch = async () => { throw new Error('simulated dispatch failure'); };
  await assert.rejects(() => retryService.approveFix(retryIncident.id, user, { findingIds: ['a', 'b'] }), /correction n’a pas pu démarrer/);
  const failedRequestId = retryIncident.metadata.fixRequest.requestId;
  const failedBatchId = retryIncident.metadata.fixRequest.batchId;
  assert.equal(retryIncident.metadata.fixRequest.status, 'FIX_FAILED');
  assert.equal(retryIncident.metadata.fixRequest.attemptCount, 1);
  let retryDispatches = 0;
  globalThis.fetch = async () => { retryDispatches++; return new Response('{}', { status: 200 }); };
  const retried: any = await retryService.approveFix(retryIncident.id, user, { findingIds: ['b', 'a'] });
  assert.equal(retried.duplicate, false);
  assert.equal(retried.requestId, failedRequestId);
  assert.equal(retried.batchId, failedBatchId);
  assert.equal(retried.attemptCount, 2);
  assert.equal(retryIncident.metadata.fixRequest.status, 'DISPATCHED');
  assert.equal(retryIncident.metadata.fixRequest.attempts.length, 2);
  assert.equal(retryDispatches, 1);
  const activeDuplicate: any = await retryService.approveFix(retryIncident.id, user, { findingIds: ['a', 'b'] });
  assert.equal(activeDuplicate.duplicate, true);
  assert.equal(retryDispatches, 1);

  // Deux autorisations concurrentes après FIX_FAILED sont sérialisées par le
  // verrou : une seule devient une tentative de dispatch.
  const concurrentIncident: any = {
    id: 'incident-concurrent', projectId: 'project-1', status: 'blocked', prUrl: null, buildNumber: 136,
    metadata: { enrichedData: { sonar: { issues: [sonar('a'), sonar('b')] } }, fixRequest: {
      requestId: 'request-concurrent', batchId: remediationBatchIdentity('incident-concurrent', ['a', 'b']),
      status: 'FIX_FAILED', findingId: 'a', findingIds: ['a', 'b'], attemptCount: 1,
      attempts: [{ attempt: 1, status: 'FIX_FAILED' }],
    } },
  };
  const concurrentIncidentRepo: any = {
    findOne: async () => concurrentIncident,
    update: async (_id: string, patch: any) => Object.assign(concurrentIncident, patch),
  };
  let transactionTail = Promise.resolve();
  const concurrentRepository: any = {
    manager: { transaction: async (fn: any) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await fn({ getRepository: (entity: any) => entity?.name === 'Project' ? transactionalProjectRepo : concurrentIncidentRepo }); }
      finally { release(); }
    } },
    findOne: async () => concurrentIncident,
    update: concurrentIncidentRepo.update,
  };
  const concurrentService = new IncidentsService(concurrentRepository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any);
  let concurrentDispatches = 0;
  globalThis.fetch = async () => { concurrentDispatches++; return new Response('{}', { status: 200 }); };
  const concurrentResults: any[] = await Promise.all([
    concurrentService.approveFix(concurrentIncident.id, user, { findingIds: ['a', 'b'] }),
    concurrentService.approveFix(concurrentIncident.id, user, { findingIds: ['b', 'a'] }),
  ]);
  assert.equal(concurrentDispatches, 1);
  assert.equal(concurrentResults.filter(result => result.duplicate === false).length, 1);
  assert.equal(concurrentResults.filter(result => result.duplicate === true).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('remediation batch contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
