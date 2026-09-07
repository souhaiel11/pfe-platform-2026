import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

const old = new Date(Date.now() - 60_000).toISOString();
const admin = { id: 'admin-1', role: 'admin' };
const developer = { id: 'developer-1', role: 'developer' };

const makeIncident = (overrides: any = {}) => ({
  id: 'incident-1', projectId: 'project-1', status: 'blocked', prUrl: null,
  metadata: { fixRequest: {
    requestId: 'request-1', batchId: 'batch-1', workflow: 'WF2', status: 'DISPATCHED',
    findingIds: ['finding-1'], attemptCount: 14, retryEligible: false, dispatchedAt: old,
    attempts: [{ attempt: 14, status: 'DISPATCHED', dispatchedAt: old }],
    workflowEvents: [],
    ...(overrides.fixRequest || {}),
  } },
  ...overrides.incident,
});

const harness = (incident: any) => {
  const updates: any[] = [];
  const txRepo = {
    findOne: async ({ where }: any) => where.id === incident.id ? incident : null,
    update: async (_id: string, patch: any) => { updates.push(patch); Object.assign(incident, patch); },
  };
  let tail = Promise.resolve();
  const repository: any = {
    manager: { transaction: async (fn: any) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await fn({ getRepository: () => txRepo }); } finally { release(); }
    } },
    findOne: async ({ where }: any) => where.id === incident.id ? incident : null,
    update: txRepo.update,
  };
  const service = new IncidentsService(repository, {} as any, { emit: () => undefined } as any,
    { syncIncident: async () => undefined } as any);
  return { service, updates };
};

const recovery = { batchId: 'batch-1', attemptCount: 14 };
const callback = (status: 'FAILED' | 'PR_CREATED', attemptCount = 14) => ({
  status, workflowId: '9adcV31eaIgJyMR0', executionId: 'execution-14', incidentId: 'incident-1',
  requestId: 'request-1', batchId: 'batch-1', batchKey: 'batch-1', attemptCount,
  failureCode: 'WF2_EXECUTION_ERROR', failureSummary: 'late callback',
});

async function expectRecoveryRejected(overrides: any, input: any = recovery, pattern = /récupér|correspond|Pull Request|callback/) {
  const { service } = harness(makeIncident(overrides));
  await assert.rejects(() => service.reconcileStaleDispatch('incident-1', 'request-1', input, admin), pattern);
}

async function main() {
  const previousThreshold = process.env.WF2_STALE_DISPATCH_MS;
  process.env.WF2_STALE_DISPATCH_MS = '1000';
  try {
    const incident = makeIncident();
    const { service, updates } = harness(incident);
    const result: any = await service.reconcileStaleDispatch('incident-1', 'request-1', recovery, admin);
    assert.equal(result.applied, true);
    assert.equal(incident.metadata.fixRequest.status, 'FIX_FAILED');
    assert.equal(incident.metadata.fixRequest.retryEligible, true);
    assert.equal(incident.metadata.fixRequest.attemptCount, 14);
    assert.equal(incident.metadata.fixRequest.attempts[0].status, 'FIX_FAILED');
    assert.equal(incident.metadata.fixRequest.lifecycleRecoveries.length, 1);
    assert.deepEqual(incident.metadata.fixRequest.lifecycleRecoveries[0], {
      recoveryType: 'STALE_DISPATCH', recoveredAttempt: 14, previousStatus: 'DISPATCHED',
      newStatus: 'FIX_FAILED', reason: 'WF2_STALE_DISPATCH_RECONCILED',
      recoveredAt: incident.metadata.fixRequest.lifecycleRecoveries[0].recoveredAt, authorizedBy: 'admin-1',
    });
    assert.equal(updates.length, 1, 'status, retry flag and evidence must be one atomic update');

    const duplicate: any = await service.reconcileStaleDispatch('incident-1', 'request-1', recovery, admin);
    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(updates.length, 1, 'duplicate recovery must not write');

    await assert.rejects(() => service.reconcileStaleDispatch('incident-1', 'request-1', recovery, developer), /administrateur/);
    await assert.rejects(() => service.reconcileStaleDispatch('wrong-incident', 'request-1', recovery, admin), /introuvable/);
    await expectRecoveryRejected({ fixRequest: { status: 'FIX_FAILED', retryEligible: true,
      attempts: [{ attempt: 14, status: 'FIX_FAILED', dispatchedAt: old }] } }, recovery, /dispatch.*récupérable/i);
    await expectRecoveryRejected({}, { ...recovery, batchId: 'wrong' });
    await expectRecoveryRejected({}, { ...recovery, attemptCount: 13 });
    await expectRecoveryRejected({ incident: { prUrl: 'https://github.com/o/r/pull/1' } });
    await expectRecoveryRejected({ fixRequest: { status: 'PR_CREATED', attempts: [{ attempt: 14, status: 'PR_CREATED', dispatchedAt: old }] } });
    await expectRecoveryRejected({ fixRequest: { status: 'VALIDATED', attempts: [{ attempt: 14, status: 'VALIDATED', dispatchedAt: old }] } });
    await expectRecoveryRejected({ fixRequest: { workflowEvents: [{ attempt: 14, status: 'FAILED' }] } });

    const freshIncident = makeIncident({ fixRequest: { dispatchedAt: new Date().toISOString(),
      attempts: [{ attempt: 14, status: 'DISPATCHED', dispatchedAt: new Date().toISOString() }] } });
    await assert.rejects(() => harness(freshIncident).service.reconcileStaleDispatch('incident-1', 'request-1', recovery, admin), /seuil/);

    // Both late success and late failure are fenced after recovery, with no write.
    for (const status of ['PR_CREATED', 'FAILED'] as const) {
      const recovered = makeIncident();
      const h = harness(recovered);
      await h.service.reconcileStaleDispatch('incident-1', 'request-1', recovery, admin);
      const writes = h.updates.length;
      const late: any = await h.service.saveWorkflowBatchStatus('incident-1', callback(status) as any);
      assert.equal(late.code, 'STALE_OR_TERMINAL_ATTEMPT_CALLBACK');
      assert.equal(late.stale, true);
      assert.equal(h.updates.length, writes);
      assert.equal(recovered.metadata.fixRequest.status, 'FIX_FAILED');
      assert.equal(recovered.prUrl, null);
    }

    // Attempt 14 can never mutate a later active attempt 15; the current
    // attempt callback still follows the ordinary callback path.
    const future = makeIncident({ fixRequest: {
      attemptCount: 15, dispatchedAt: old,
      attempts: [
        { attempt: 14, status: 'FIX_FAILED', dispatchedAt: old, recovery: { recoveryType: 'STALE_DISPATCH' } },
        { attempt: 15, status: 'DISPATCHED', dispatchedAt: old },
      ],
    } });
    const futureHarness = harness(future);
    const staleOld: any = await futureHarness.service.saveWorkflowBatchStatus('incident-1', callback('FAILED', 14));
    assert.equal(staleOld.code, 'STALE_OR_TERMINAL_ATTEMPT_CALLBACK');
    const current: any = await futureHarness.service.saveWorkflowBatchStatus('incident-1', {
      ...callback('FAILED', 15), executionId: 'execution-15', failureSummary: 'current failure',
    });
    assert.equal(current.applied, true);
    assert.equal(future.metadata.fixRequest.attemptCount, 15);
    assert.equal(future.metadata.fixRequest.status, 'FIX_FAILED');

    // Exact duplicate terminal callbacks remain idempotent.
    const terminal = makeIncident();
    const terminalHarness = harness(terminal);
    const first: any = await terminalHarness.service.saveWorkflowBatchStatus('incident-1', callback('FAILED'));
    const writes = terminalHarness.updates.length;
    const repeated: any = await terminalHarness.service.saveWorkflowBatchStatus('incident-1', callback('FAILED'));
    assert.equal(first.applied, true);
    assert.equal(repeated.duplicate, true);
    assert.equal(terminalHarness.updates.length, writes);

    // Serialized callback/recovery race: exactly one transition wins. Here
    // recovery obtains the lock first; the callback is fenced afterward.
    const raced = makeIncident();
    const raceHarness = harness(raced);
    const [recoveryResult, callbackResult]: any[] = await Promise.all([
      raceHarness.service.reconcileStaleDispatch('incident-1', 'request-1', recovery, admin),
      raceHarness.service.saveWorkflowBatchStatus('incident-1', callback('PR_CREATED') as any),
    ]);
    assert.equal(recoveryResult.applied, true);
    assert.equal(callbackResult.code, 'STALE_OR_TERMINAL_ATTEMPT_CALLBACK');
    assert.equal(raced.metadata.fixRequest.status, 'FIX_FAILED');
    assert.equal(raced.prUrl, null);

    // Reverse lock order: a normal terminal callback wins; recovery observes
    // the terminal state and cannot add recovery evidence or resurrect it.
    const callbackWon = makeIncident();
    const callbackWonHarness = harness(callbackWon);
    const reverse = await Promise.allSettled([
      callbackWonHarness.service.saveWorkflowBatchStatus('incident-1', callback('FAILED') as any),
      callbackWonHarness.service.reconcileStaleDispatch('incident-1', 'request-1', recovery, admin),
    ]);
    assert.equal(reverse[0].status, 'fulfilled');
    assert.equal(reverse[1].status, 'rejected');
    assert.equal(callbackWon.metadata.fixRequest.status, 'FIX_FAILED');
    assert.equal(callbackWon.metadata.fixRequest.lifecycleRecoveries, undefined);

    console.log('stale dispatch recovery contract: PASS');
  } finally {
    if (previousThreshold === undefined) delete process.env.WF2_STALE_DISPATCH_MS;
    else process.env.WF2_STALE_DISPATCH_MS = previousThreshold;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
