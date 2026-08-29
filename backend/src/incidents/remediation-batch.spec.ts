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
  status: 'blocked', prUrl: null, metadata: { enrichedData: { sonar: { issues: [sonar('a'), sonar('b')] } } },
};
const transactionalRepo = {
  findOne: async () => incident,
  update: async (_id: string, patch: any) => Object.assign(incident, patch),
};
const repository: any = {
  manager: { transaction: async (fn: any) => fn({ getRepository: () => transactionalRepo }) },
  findOne: async () => incident,
  update: transactionalRepo.update,
};
async function main() {
  let dispatches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { dispatches++; return new Response('{}', { status: 200 }); };
  try {
  const service = new IncidentsService(repository, {} as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any);
  const user = { id: 'developer-1', role: 'developer' };
  const first: any = await service.approveFix(incident.id, user, { findingIds: ['b', 'a', 'a'] });
  const second: any = await service.approveFix(incident.id, user, { findingIds: ['a', 'b'] });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.batchId, second.batchId);
  assert.equal(dispatches, 1);
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
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('remediation batch contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
