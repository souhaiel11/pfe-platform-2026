// Offline contract tests for "Modifier la sélection" -- after a fixRequest
// reaches FIX_FAILED, the user may submit a REDUCED/DIFFERENT finding
// selection through the existing approveFix/approveFixBatch contract instead
// of retryFix(). This must create a brand new fixRequest (new requestId,
// new deterministic batchId, fresh attempt lifecycle) and must NEVER mutate
// the old failed fixRequest in place -- it is archived, unchanged, into
// metadata.previousFixRequests.
//
// RETRY (explicitRetry=true, retryFix()) is a completely separate contract
// (same requestId/batchId, attempt+1) and is proven unaffected here too.
//
// No live n8n execution, no network, no database. fetch/N8N_WF2_ID mocked.
import * as assert from 'node:assert/strict';
import { IncidentsService, remediationBatchIdentity } from './incidents.service';

const sonar = (id: string, extra: any = {}) => ({
  id, source: 'SONARQUBE', stage: 'sonar', remediationType: 'AUTO_FIX_ELIGIBLE',
  rule: 'java:S1068', file: `src/${id}.java`, line: 10, message: `Finding ${id}`, ...extra,
});

function makeIncident(issues: any[], overrides: any = {}) {
  return {
    id: 'incident-modify', projectId: 'project-1', status: 'blocked', prUrl: null, buildNumber: 200,
    metadata: { enrichedData: { sonar: { issues } }, sourceCommitSha: 'a'.repeat(40), ...overrides },
  };
}
function makeService(incident: any) {
  const project = { id: 'project-1', githubRepo: 'owner/repo' };
  const projectRepo = { findOne: async () => project };
  const incidentRepo = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const repository: any = {
    manager: { transaction: async (fn: any) => fn({ getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }) },
    findOne: async () => incident, update: incidentRepo.update,
  };
  return new IncidentsService(repository, projectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalWorkflowId = process.env.N8N_WF2_ID;
  process.env.N8N_WF2_ID = '9adcV31eaIgJyMR0';
  let dispatches = 0;
  globalThis.fetch = async () => { dispatches++; return new Response('{}', { status: 200 }); };
  const user = { id: 'developer-1', role: 'developer' };
  try {

  // ── Setup: a real FIX_FAILED batch [A, B, C] (all AUTO_FIX_ELIGIBLE) ─────
  const incident = makeIncident([sonar('A'), sonar('B'), sonar('C')]);
  const service = makeService(incident);
  const first: any = await service.approveFix(incident.id, user, { findingIds: ['A', 'B', 'C'] });
  assert.equal(first.duplicate, false);
  assert.equal(dispatches, 1);
  const oldRequestId = incident.metadata.fixRequest.requestId;
  const oldBatchId = incident.metadata.fixRequest.batchId;
  // Simulate the batch failing terminally (mirrors saveWorkflowBatchStatus's FAILED transition).
  incident.metadata.fixRequest = { ...incident.metadata.fixRequest, status: 'FIX_FAILED', retryEligible: true,
    lastError: 'simulated failure', failedAt: new Date().toISOString(),
    attempts: [{ ...incident.metadata.fixRequest.attempts[0], status: 'FIX_FAILED' }] };
  const oldFixRequestSnapshot = JSON.stringify(incident.metadata.fixRequest);

  // ── A/C. reduced selection [A, C] (deselect B) succeeds and creates a NEW fixRequest ──
  const modified: any = await service.approveFix(incident.id, user, { findingIds: ['A', 'C'] });
  assert.equal(modified.duplicate, false);
  assert.deepEqual(modified.findingIds, ['A', 'C']);
  assert.equal(dispatches, 2, 'the reduced selection must dispatch a real new request');

  // ── E. new fixRequest gets a different ID ────────────────────────────────
  assert.notEqual(incident.metadata.fixRequest.requestId, oldRequestId);

  // ── F. different finding set produces the correct new deterministic batchId ──
  assert.equal(incident.metadata.fixRequest.batchId, remediationBatchIdentity(incident.id, ['A', 'C']));
  assert.notEqual(incident.metadata.fixRequest.batchId, oldBatchId);
  assert.deepEqual(incident.metadata.fixRequest.findingIds, ['A', 'C']);
  assert.equal(incident.metadata.fixRequest.status, 'DISPATCHED');
  assert.equal(incident.metadata.fixRequest.attemptCount, 1, 'a modified selection starts a fresh attempt lifecycle');
  assert.equal(incident.metadata.fixRequest.attempts.length, 1);
  assert.equal(incident.metadata.fixRequest.lastError, null);
  assert.equal(incident.metadata.fixRequest.failedAt, null);
  assert.equal(incident.metadata.fixRequest.baselineSha, 'a'.repeat(40));

  // ── D. old fixRequest remains FIX_FAILED and byte-unchanged, archived ────
  assert.equal(incident.metadata.previousFixRequests.length, 1);
  assert.equal(JSON.stringify(incident.metadata.previousFixRequests[0]), oldFixRequestSnapshot,
    'the archived old fixRequest must be stored exactly as it was, never mutated');
  assert.equal(incident.metadata.previousFixRequests[0].requestId, oldRequestId);
  assert.equal(incident.metadata.previousFixRequests[0].status, 'FIX_FAILED');
  assert.deepEqual(incident.metadata.previousFixRequests[0].findingIds, ['A', 'B', 'C']);

  console.log('modify-failed-selection A/C/D/E/F: PASS');

  // ── G. a DEVELOPER_ACTION_REQUIRED finding can never be selected ─────────
  {
    // B is DEVELOPER_ACTION_REQUIRED from the start (e.g. java:S3305) --
    // it could never have been part of any AUTO_FIX_ELIGIBLE batch, failed
    // or not. The initial failed batch is [A, C] only.
    const incidentG = makeIncident([sonar('A'), sonar('B', { remediationType: 'DEVELOPER_ACTION_REQUIRED', rule: 'java:S3305' }), sonar('C')]);
    const serviceG = makeService(incidentG);
    await serviceG.approveFix(incidentG.id, user, { findingIds: ['A', 'C'] });
    incidentG.metadata.fixRequest.status = 'FIX_FAILED';
    incidentG.metadata.fixRequest.retryEligible = true;
    // A "modify selection" attempt that tries to smuggle in B must be rejected.
    await assert.rejects(
      () => serviceG.approveFix(incidentG.id, user, { findingIds: ['A', 'B'] }),
      /correction automatisable/,
      'a modified selection including a DEVELOPER_ACTION_REQUIRED finding must be rejected',
    );
    // A reduced eligible-only selection must still succeed.
    const okG: any = await serviceG.approveFix(incidentG.id, user, { findingIds: ['A'] });
    assert.equal(okG.duplicate, false);
    assert.deepEqual(okG.findingIds, ['A']);
    console.log('modify-failed-selection G: PASS');
  }

  // ── H. a finding no longer present on the incident (resolved/stale) cannot be selected ──
  {
    const incidentH = makeIncident([sonar('A'), sonar('B'), sonar('C')]);
    const serviceH = makeService(incidentH);
    await serviceH.approveFix(incidentH.id, user, { findingIds: ['A', 'B', 'C'] });
    incidentH.metadata.fixRequest.status = 'FIX_FAILED';
    incidentH.metadata.fixRequest.retryEligible = true;
    // Simulate B having been resolved/removed from the live baseline since the failed attempt.
    incidentH.metadata.enrichedData.sonar.issues = [sonar('A'), sonar('C')];
    await assert.rejects(
      () => serviceH.approveFix(incidentH.id, user, { findingIds: ['A', 'B'] }),
      /n’appartiennent pas à cet incident/,
      'a stale finding id no longer on the incident must be rejected',
    );
    const okH: any = await serviceH.approveFix(incidentH.id, user, { findingIds: ['A', 'C'] });
    assert.equal(okH.duplicate, false);
    console.log('modify-failed-selection H: PASS');
  }

  // Explicit empty selection never falls back to a legacy implicit finding.
  {
    const empty = makeIncident([sonar('A')]);
    await assert.rejects(() => makeService(empty).approveFix(empty.id, user, { findingIds: [] }), /au moins une erreur/);
    assert.equal(empty.metadata.fixRequest, undefined);
  }
  for (const extra of [{status:'RESOLVED'}, {stale:true}, {baselineSha:'b'.repeat(40)}]) {
    const stale = makeIncident([sonar('A'), sonar('B', extra)]);
    await assert.rejects(() => makeService(stale).approveFix(stale.id, user, { findingIds: ['A','B'] }), /résolu, obsolète/);
    assert.equal(stale.metadata.fixRequest, undefined);
  }
  {
    const validated = makeIncident([sonar('A')], {validation:{derived:{findings:[{findingId:'A',verdict:'VALID'}]}}});
    await assert.rejects(() => makeService(validated).approveFix(validated.id,user,{findingIds:['A']}), /résolu, obsolète/);
  }

  // ── B. exact-SAME batch resubmitted via approve (not retry) still redirects to "Réessayer" ──
  {
    const incidentB = makeIncident([sonar('A'), sonar('B')]);
    const serviceB = makeService(incidentB);
    await serviceB.approveFix(incidentB.id, user, { findingIds: ['A', 'B'] });
    incidentB.metadata.fixRequest.status = 'FIX_FAILED';
    incidentB.metadata.fixRequest.retryEligible = true;
    await assert.rejects(
      () => serviceB.approveFix(incidentB.id, user, { findingIds: ['B', 'A'] }),
      /Une demande de correction existe déjà.*Réessayer la correction/,
      'the exact same batch must still be pushed toward retryFix, not silently re-created',
    );
    console.log('modify-failed-selection B (sameBatch still blocked): PASS');
  }

  // ── A (existing retry). retryFix() keeps meaning "same fixRequest, same findings, attempt+1" ──
  {
    const incidentRetry = makeIncident([sonar('A'), sonar('B'), sonar('C')]);
    const serviceRetry = makeService(incidentRetry);
    const initial: any = await serviceRetry.approveFix(incidentRetry.id, user, { findingIds: ['A', 'B', 'C'] });
    incidentRetry.metadata.fixRequest.status = 'FIX_FAILED';
    incidentRetry.metadata.fixRequest.retryEligible = true;
    incidentRetry.metadata.fixRequest.attempts = [{ attempt: 1, status: 'FIX_FAILED' }];
    const retried: any = await serviceRetry.retryFix(incidentRetry.id, user);
    assert.equal(retried.duplicate, false);
    assert.equal(retried.requestId, initial.requestId, 'retry must keep the SAME requestId');
    assert.equal(retried.batchId, initial.batchId, 'retry must keep the SAME batchId');
    assert.deepEqual(retried.findingIds, ['A', 'B', 'C'], 'retry must keep the SAME findings, never a reduced set');
    assert.equal(incidentRetry.metadata.fixRequest.attemptCount, 2, 'retry increments the SAME attempt lifecycle');
    assert.ok(!incidentRetry.metadata.previousFixRequests || incidentRetry.metadata.previousFixRequests.length === 0,
      'a plain retry must never archive anything -- it is not a modified selection');
    console.log('modify-failed-selection A (existing retry contract unaffected): PASS');
  }

  // ── J. no regression for normal first-time remediation (current === undefined) ──
  {
    const incidentJ = makeIncident([sonar('A'), sonar('B')]);
    const serviceJ = makeService(incidentJ);
    const firstJ: any = await serviceJ.approveFix(incidentJ.id, user, { findingIds: ['A'] });
    assert.equal(firstJ.duplicate, false);
    assert.deepEqual(firstJ.findingIds, ['A']);
    assert.equal(incidentJ.metadata.fixRequest.attemptCount, 1);
    assert.ok(!incidentJ.metadata.previousFixRequests || incidentJ.metadata.previousFixRequests.length === 0);
    console.log('modify-failed-selection J (first-time remediation unaffected): PASS');
  }

  // ── K. no regression once a real PR exists (MERGE_READY / validated-style incidents) ──
  {
    const incidentK = makeIncident([sonar('A'), sonar('B'), sonar('C')]);
    const serviceK = makeService(incidentK);
    await serviceK.approveFix(incidentK.id, user, { findingIds: ['A', 'B', 'C'] });
    incidentK.metadata.fixRequest.status = 'FIX_FAILED';
    incidentK.metadata.fixRequest.retryEligible = true;
    (incidentK as any).prUrl = 'https://github.com/owner/repo/pull/9';
    await assert.rejects(
      () => serviceK.approveFix(incidentK.id, user, { findingIds: ['A', 'C'] }),
      /Pull Request existe déjà/,
      'a real PR must still block any new/modified selection, exactly as before',
    );
    console.log('modify-failed-selection K (real PR still blocks unconditionally): PASS');
  }

  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorkflowId === undefined) delete process.env.N8N_WF2_ID; else process.env.N8N_WF2_ID = originalWorkflowId;
  }

  console.log('modify-failed-selection contract (A,B,C,D,E,F,G,H,I,J,K): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
