// Teste le composant « wf2-cancellation » et ses cas d’erreur.
import { emptyReservationQuery } from './sonar-file-reservation.test-double';
import * as assert from 'node:assert/strict';
import { IncidentsService, canRetryFixRequest } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const admin = { id: 'admin-1', role: 'admin' };
const developer = { id: 'developer-1', role: 'developer' };

/** Prépare les données nécessaires à ce scénario. */
export const makeIncident = (overrides: any = {}) => ({
  id: 'incident-1', projectId: 'project-1', status: 'blocked', prUrl: null,
  metadata: { fixRequest: {
    requestId: 'request-1', batchId: 'batch-1', workflow: 'WF2', status: 'DISPATCHED',
    findingIds: ['finding-1'], attemptCount: 1, retryEligible: false,
    attempts: [{ attempt: 1, status: 'DISPATCHED', dispatchedAt: new Date().toISOString() }],
    workflowEvents: [],
    // Supplied IDs in unit fixtures represent an internally registered execution.
    ...(overrides.fixRequest?.n8nExecutionId ? { executionRegisteredAt: new Date().toISOString() } : {}),
    ...(overrides.fixRequest || {}),
  } },
  ...overrides.incident,
});

/** Vérifie les résultats attendus dans ce scénario. */
export const harness = (incident: any) => {
  const updates: any[] = [];
  const txRepo = {
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async ({ where, lock }: any) => {
      assert.equal(lock?.mode, 'pessimistic_write');
      return where.id === incident.id ? incident : null;
    },
    /** Applique les modifications autorisées à l’élément. */
    update: async (_id: string, patch: any) => { updates.push(patch); Object.assign(incident, patch); },
  };
  let tail = Promise.resolve();
  let locked = false;
  const repository: any = {
    manager: { 
    /** Exécute les opérations dans le cadre transactionnel prévu. */
    transaction: async (fn: any) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      locked = true;
      try { return await fn({ 
      /** Simule la lecture des données demandées par le composant. */
      query: emptyReservationQuery, getRepository: () => txRepo }); } finally { locked = false; release(); }
    } },
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async ({ where }: any) => where.id === incident.id ? incident : null,
    update: txRepo.update,
  };
  const service = new IncidentsService(repository, {} as any, { 
  /** Diffuse ou construit le résultat prévu. */
  emit: () => undefined } as any,
    { 
    /** Prépare les données nécessaires à ce scénario. */
    syncIncident: async () => undefined } as any, {} as any);
  return { service, updates, 
  /** Prépare les données nécessaires à ce scénario. */
  isLocked: () => locked };
};

/** Simule les dépendances nécessaires au scénario. */
function mockN8nStopFetch(outcomes: Array<{ status: number; ok?: boolean; text?: string } | 'network-error'>, inspect?: () => void) {
  const calls: any[] = [];
  let i = 0;
  const original = globalThis.fetch;
  /** Envoie la requête et lit la réponse distante. */
  (globalThis as any).fetch = async (url: any, opts: any) => {
    inspect?.();
    calls.push({ url: String(url), opts });
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i++;
    if (outcome === 'network-error') throw new Error('simulated network failure');
    const ok = outcome.ok ?? (outcome.status >= 200 && outcome.status < 300);
    return { ok, status: outcome.status, 
    /** Renvoie un texte utilisable à partir de la valeur. */
    text: async () => outcome.text || '' } as any;
  };
  return { calls, 
  /** Restaure l’état sauvegardé par le scénario. */
  restore: () => { (globalThis as any).fetch = original; } };
}

/** Exécute les étapes principales de ce programme. */
async function main() {
  const originalApiUrl = process.env.N8N_API_URL;
  const originalApiKey = process.env.N8N_API_KEY;
  process.env.N8N_API_URL = 'http://n8n-fake:5678';
  process.env.N8N_API_KEY = 'super-secret-test-key';
  try {

  // ── B1: cancel DISPATCHED with executionId -> CANCEL_REQUESTED -> n8n stop called once -> CANCELLED
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service, isLocked } = harness(incident);
    const mock = mockN8nStopFetch([{ status: 200 }], () => {
      assert.equal(incident.metadata.fixRequest.status, 'CANCEL_REQUESTED');
      assert.equal(isLocked(), false, 'n8n HTTP must execute after transaction commit');
    });
    try {
      const result: any = await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.equal(mock.calls.length, 1, 'n8n stop must be called exactly once');
      assert.equal(mock.calls[0].url, 'http://n8n-fake:5678/api/v1/executions/123/stop');
      assert.equal(mock.calls[0].opts.headers['X-N8N-API-KEY'], 'super-secret-test-key');
      assert.equal(result.status, 'CANCELLED');
      assert.equal(incident.metadata.fixRequest.status, 'CANCELLED');
      assert.ok(incident.metadata.fixRequest.cancelledAt);
      assert.equal(incident.metadata.fixRequest.retryEligible, true);
      assert.equal(incident.metadata.fixRequest.attempts[0].status, 'CANCELLED');
    } finally { mock.restore(); }
    console.log('B1 PASS');
  }

  // ── B2: double cancel (concurrent) -> idempotent -> n8n stop not called twice
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const mock = mockN8nStopFetch([{ status: 200 }]);
    try {
      const [r1, r2]: any[] = await Promise.all([
        service.cancelFixRequest('incident-1', 'request-1', {}, admin),
        service.cancelFixRequest('incident-1', 'request-1', {}, admin),
      ]);
      assert.equal(mock.calls.length, 1, 'n8n stop must be called exactly once across both concurrent cancel calls');
      assert.equal(incident.metadata.fixRequest.status, 'CANCELLED', 'final converged state must be CANCELLED');
      for (const r of [r1, r2]) assert.ok(['CANCEL_REQUESTED', 'CANCELLED'].includes(r.status));
      // A plain sequential duplicate (after full resolution) must also be a no-op.
      const r3: any = await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.equal(r3.alreadyTerminal, true);
      assert.equal(r3.status, 'CANCELLED');
      assert.equal(mock.calls.length, 1, 'a cancel on an already-terminal request must never call n8n again');
    } finally { mock.restore(); }
    console.log('B2 PASS');
  }

  // ── B3: cancel before executionId registration -> CANCEL_REQUESTED -> no n8n stop -> later execution-started -> CANCELLED
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: undefined } });
    const { service } = harness(incident);
    const mock = mockN8nStopFetch([]);
    try {
      const r1: any = await service.cancelFixRequest('incident-1', 'request-1', { reason: 'test' }, admin);
      assert.equal(r1.status, 'CANCEL_REQUESTED');
      assert.equal(r1.waitingForExecutionRegistration, true);
      assert.equal(mock.calls.length, 0, 'no n8n call can happen without a known executionId');
      assert.equal(incident.metadata.fixRequest.status, 'CANCEL_REQUESTED');
      assert.equal(incident.metadata.fixRequest.cancelReason, 'test');

      const r2: any = await service.recordExecutionStarted('incident-1', 'request-1',
        { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '999' });
      assert.equal(r2.cancelRequested, true);
      assert.equal(r2.cancelled, true);
      assert.equal(mock.calls.length, 0, 'closing the race via execution-started must never call n8n stop either');
      assert.equal(incident.metadata.fixRequest.status, 'CANCELLED');
      assert.equal(incident.metadata.fixRequest.n8nExecutionId, '999');
      assert.equal(canRetryFixRequest(incident.metadata.fixRequest), true);
    } finally { mock.restore(); }
    console.log('B3 PASS');
  }

  // ── B4: execution-started during FIX_STARTING -> executionId persisted
  {
    const incident = makeIncident({ fixRequest: { status: 'FIX_STARTING', n8nExecutionId: undefined } });
    const { service } = harness(incident);
    const r: any = await service.recordExecutionStarted('incident-1', 'request-1',
      { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '42' });
    assert.equal(r.cancelled, false);
    assert.equal(incident.metadata.fixRequest.n8nExecutionId, '42');
    assert.equal(incident.metadata.fixRequest.status, 'FIX_STARTING', 'must not itself advance the status');
    assert.equal(incident.metadata.fixRequest.executionPhase, 'STARTED');
    assert.ok(incident.metadata.fixRequest.lastHeartbeatAt);
    console.log('B4 PASS');
  }

  // ── B5: execution-started races in BEFORE startFix's own FIX_STARTING->DISPATCHED
  // write -- the real approveFix()/startFix() code path, UNMODIFIED, must still
  // preserve n8nExecutionId and must never resurrect DISPATCHED over a
  // cancellation that happened to resolve in the same window.
  for (const scenario of ['registered', 'cancelled', 'registered-dispatch-error', 'cancelled-dispatch-error']) {
    const sonar = { id: 'A', source: 'SONARQUBE', stage: 'sonar', remediationType: 'AUTO_FIX_ELIGIBLE',
      rule: 'java:S1068', file: 'src/A.java', line: 10, message: 'Finding A' };
    const incident: any = { id: 'incident-5', projectId: 'project-1', status: 'blocked', prUrl: null, buildNumber: 1,
      metadata: { enrichedData: { sonar: { issues: [sonar] } }, sourceCommitSha: 'a'.repeat(40) } };
    const project = { id: 'project-1', githubRepo: 'owner/repo' };
    const projectRepo = { 
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async () => project };
    const incidentRepo = { 
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async () => incident, 
    /** Applique les modifications autorisées à l’élément. */
    update: async (_id: string, patch: any) => Object.assign(incident, patch) };
    const repository: any = {
      manager: { 
      /** Exécute les opérations dans le cadre transactionnel prévu. */
      transaction: async (fn: any) => fn({ 
      /** Simule la lecture des données demandées par le composant. */
      query: emptyReservationQuery, getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }) },
      /** Recherche l’élément correspondant à l’identifiant. */
      findOne: async () => incident, update: incidentRepo.update,
    };
    const service = new IncidentsService(repository, projectRepo as any, { 
    /** Diffuse ou construit le résultat prévu. */
    emit: () => undefined } as any,
      { 
      /** Prépare les données nécessaires à ce scénario. */
      syncIncident: async () => undefined } as any, {} as any);
    const originalFetch = globalThis.fetch;
    const originalWorkflowId = process.env.N8N_WF2_ID;
    process.env.N8N_WF2_ID = '9adcV31eaIgJyMR0';
    try {
      /** Envoie la requête et lit la réponse distante. */
      (globalThis as any).fetch = async () => {
        // The exact race PART 3 exists to prove safe: WF2 registers its
        // execution id WHILE the backend's own dispatch fetch() is still
        // "in flight" from startFix()'s point of view (it hasn't read this
        // response yet).
        if (scenario.startsWith('cancelled')) {
          await service.cancelFixRequest('incident-5', incident.metadata.fixRequest.requestId, {}, developer);
        }
        await service.recordExecutionStarted('incident-5', incident.metadata.fixRequest.requestId, {
          requestId: incident.metadata.fixRequest.requestId, batchId: incident.metadata.fixRequest.batchId,
          attemptCount: incident.metadata.fixRequest.attemptCount, executionId: '777',
        });
        if (scenario.endsWith('dispatch-error')) throw new Error('simulated dispatch timeout');
        return new Response('{}', { status: 200 });
      };
      const dispatch = service.approveFix('incident-5', developer, { findingIds: ['A'] });
      if (scenario.endsWith('dispatch-error')) await assert.rejects(() => dispatch);
      else {
        const response: any = await dispatch;
        assert.equal(response.status, scenario === 'cancelled' ? 'CANCELLED' : 'DISPATCHED');
      }
      assert.equal(incident.metadata.fixRequest.status, scenario.startsWith('cancelled') ? 'CANCELLED'
        : scenario.endsWith('dispatch-error') ? 'FIX_STARTING' : 'DISPATCHED');
      if (scenario.startsWith('cancelled')) assert.equal(canRetryFixRequest(incident.metadata.fixRequest), true);
      assert.equal(incident.metadata.fixRequest.n8nExecutionId, '777', 'executionId registered mid-dispatch must survive the DISPATCHED write');
      assert.equal(incident.metadata.fixRequest.executionPhase, 'STARTED');
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWorkflowId === undefined) delete process.env.N8N_WF2_ID; else process.env.N8N_WF2_ID = originalWorkflowId;
    }
    console.log(`B5 ${scenario} PASS`);
  }

  // ── B6: execution-started sees CANCEL_REQUESTED -> cancelRequested=true -> CANCELLED
  {
    const incident = makeIncident({ fixRequest: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date().toISOString(), n8nExecutionId: undefined } });
    const { service } = harness(incident);
    const r: any = await service.recordExecutionStarted('incident-1', 'request-1',
      { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '55' });
    assert.equal(r.cancelRequested, true);
    assert.equal(r.cancelled, true);
    assert.equal(incident.metadata.fixRequest.status, 'CANCELLED');
    assert.equal(incident.metadata.fixRequest.n8nExecutionId, '55', 'the executionId is still recorded even though the outcome is cancellation');
    assert.ok(incident.metadata.fixRequest.cancelledAt);
    console.log('B6 PASS');
  }

  // ── B7: pre-write gate, normal case -> sideEffectsStarted=true, allowed=true
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const r: any = await service.preWriteGate('incident-1', 'request-1',
      { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '123' });
    assert.equal(r.allowed, true);
    assert.equal(r.cancelRequested, false);
    assert.equal(incident.metadata.fixRequest.sideEffectsStarted, true);
    assert.ok(incident.metadata.fixRequest.sideEffectsStartedAt);
    assert.equal(incident.metadata.fixRequest.executionPhase, 'GIT_WRITE');
    assert.equal(incident.metadata.fixRequest.status, 'DISPATCHED', 'the gate itself never changes status on the normal path');
    console.log('B7 PASS');
  }

  // ── B8: pre-write gate after CANCEL_REQUESTED -> allowed=false -> CANCELLED, sideEffectsStarted stays false
  {
    const incident = makeIncident({ fixRequest: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date().toISOString(), n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const r: any = await service.preWriteGate('incident-1', 'request-1',
      { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '123' });
    assert.equal(r.allowed, false);
    assert.equal(r.cancelRequested, true);
    assert.equal(incident.metadata.fixRequest.status, 'CANCELLED');
    assert.notEqual(incident.metadata.fixRequest.sideEffectsStarted, true, 'sideEffectsStarted must remain unset once cancellation wins');
    console.log('B8 PASS');
  }

  // ── B9: cancel after sideEffectsStarted -> 409 CANCELLATION_TOO_LATE, n8n stop NOT called
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123', sideEffectsStarted: true, sideEffectsStartedAt: new Date().toISOString() } });
    const { service } = harness(incident);
    const mock = mockN8nStopFetch([{ status: 200 }]);
    try {
      await assert.rejects(
        () => service.cancelFixRequest('incident-1', 'request-1', {}, admin),
        (error: any) => { assert.equal(error?.getResponse?.()?.code, 'CANCELLATION_TOO_LATE'); return true; },
      );
      assert.equal(mock.calls.length, 0, 'n8n stop must never be called once Git writes may have begun');
      assert.equal(incident.metadata.fixRequest.status, 'DISPATCHED', 'status must be left untouched');
    } finally { mock.restore(); }
    console.log('B9 PASS');
  }

  // ── B10: race cancel vs pre-write-gate -> exactly one legal outcome, never both
  {
    const raceMock = mockN8nStopFetch([{ status: 200 }]);
    try {
    const gateInput = { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '123' };
    // Sub-case: cancel's transaction queues first -> cancel wins.
    {
      const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } }); // no executionId -> cancel resolves inside phase 1 alone
      const { service } = harness(incident);
      await Promise.allSettled([
        service.cancelFixRequest('incident-1', 'request-1', {}, admin),
        service.preWriteGate('incident-1', 'request-1', gateInput),
      ]);
      const fix = incident.metadata.fixRequest;
      assert.ok(!(fix.status === 'CANCELLED' && fix.sideEffectsStarted === true), 'illegal combined state');
      assert.equal(fix.status, 'CANCELLED');
      assert.notEqual(fix.sideEffectsStarted, true);
    }
    // Sub-case: pre-write-gate's transaction queues first -> gate wins.
    {
      const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
      const { service } = harness(incident);
      const outcomes = await Promise.allSettled([
        service.preWriteGate('incident-1', 'request-1', gateInput),
        service.cancelFixRequest('incident-1', 'request-1', {}, admin),
      ]);
      assert.equal(outcomes[1].status, 'rejected');
      if (outcomes[1].status === 'rejected') assert.equal(outcomes[1].reason.getResponse().code, 'CANCELLATION_TOO_LATE');
      const fix = incident.metadata.fixRequest;
      assert.ok(!(fix.status === 'CANCELLED' && fix.sideEffectsStarted === true), 'illegal combined state');
      assert.equal(fix.sideEffectsStarted, true);
      assert.notEqual(fix.status, 'CANCELLED');
    }
    console.log('B10 PASS');
    } finally { raceMock.restore(); }
  }

  // ── B11 / B12: terminal PR_CREATED / FIX_FAILED + cancel -> preserved
  for (const terminalStatus of ['PR_CREATED', 'FIX_FAILED']) {
    const incident = makeIncident({ fixRequest: { status: terminalStatus, n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const mock = mockN8nStopFetch([{ status: 200 }]);
    try {
      const r: any = await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.equal(r.alreadyTerminal, true);
      assert.equal(r.status, terminalStatus);
      assert.equal(incident.metadata.fixRequest.status, terminalStatus, `${terminalStatus} must be preserved untouched`);
      assert.equal(mock.calls.length, 0, 'n8n stop must never be called for an already-terminal request');
    } finally { mock.restore(); }
  }
  console.log('B11/B12 PASS');

  // ── B13: stale requestId -> rejected (execution-started)
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: undefined } });
    const { service } = harness(incident);
    await assert.rejects(
      () => service.recordExecutionStarted('incident-1', 'request-WRONG',
        { requestId: 'request-WRONG', batchId: 'batch-1', attemptCount: 1, executionId: '1' }),
      /ne correspond pas/,
    );
    assert.equal(incident.metadata.fixRequest.n8nExecutionId, undefined);
    console.log('B13 PASS');
  }

  // ── B14: stale attemptCount -> rejected (pre-write-gate)
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    await assert.rejects(
      () => service.preWriteGate('incident-1', 'request-1', { requestId: 'request-1', batchId: 'batch-1', attemptCount: 99, executionId: '123' }),
      /ne correspond pas/,
    );
    assert.notEqual(incident.metadata.fixRequest.sideEffectsStarted, true);
    console.log('B14 PASS');
  }

  // ── B15: n8n auth failure -> status remains CANCEL_REQUESTED, bounded error, no false CANCELLED
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const mock = mockN8nStopFetch([{ status: 401 }]);
    try {
      const r: any = await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.equal(r.status, 'CANCEL_REQUESTED');
      assert.equal(r.n8nStopOutcome, 'AUTH_ERROR');
      assert.ok(r.error && r.error.length > 0 && !r.error.includes(process.env.N8N_API_KEY));
      assert.equal(incident.metadata.fixRequest.status, 'CANCEL_REQUESTED');
      assert.notEqual(incident.metadata.fixRequest.status, 'CANCELLED');
    } finally { mock.restore(); }
    console.log('B15 PASS');
  }

  // ── B16: n8n network timeout -> CANCEL_REQUESTED retained, explicit retry behavior
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const mock = mockN8nStopFetch(['network-error']);
    try {
      const r: any = await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.equal(r.status, 'CANCEL_REQUESTED');
      assert.equal(r.n8nStopOutcome, 'NETWORK_ERROR');
      assert.equal(incident.metadata.fixRequest.status, 'CANCEL_REQUESTED');
    } finally { mock.restore(); }
    // Explicit retry behavior: calling cancel again (still CANCEL_REQUESTED,
    // same executionId) re-attempts the n8n stop call -- this time it
    // succeeds, closing the loop. Never silent, never automatic.
    const mock2 = mockN8nStopFetch([{ status: 200 }]);
    try {
      const r2: any = await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.equal(mock2.calls.length, 1, 'an explicit second cancel call after a network error must retry the n8n stop call');
      assert.equal(r2.status, 'CANCELLED');
      assert.equal(incident.metadata.fixRequest.status, 'CANCELLED');
    } finally { mock2.restore(); }
    console.log('B16 PASS');
  }

  // ── Security: N8N_API_KEY never appears in any error surfaced to the caller ──
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const mock = mockN8nStopFetch([{ status: 500, text: `secret=${process.env.N8N_API_KEY}` }]);
    try {
      const r: any = await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.ok(!JSON.stringify(r).includes(process.env.N8N_API_KEY as string), 'N8N_API_KEY must never leak into the response');
    } finally { mock.restore(); }
    console.log('N8N_API_KEY non-exposure PASS');
  }

  // ── Authorization: a non-admin/developer user cannot cancel ──
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    await assert.rejects(() => service.cancelFixRequest('incident-1', 'request-1', {}, { id: 'viewer-1', role: 'viewer' }), /autorisation/);
    console.log('authorization guard PASS');
  }

  // Fail-closed execution ownership, malformed IDs, replayed registrations.
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const identity = { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '123' };
    for (const input of [{ ...identity, executionId: '456' }, { ...identity, executionId: '0' },
      { ...identity, executionId: '../other' }, { ...identity, batchId: 'wrong' }, { ...identity, attemptCount: '1' }]) {
      await assert.rejects(() => service.preWriteGate('incident-1', 'request-1', input as any));
    }
    await assert.rejects(() => service.recordExecutionStarted('incident-1', 'request-1', { ...identity, executionId: '456' }));
    assert.equal(incident.metadata.fixRequest.n8nExecutionId, '123');
    assert.notEqual(incident.metadata.fixRequest.sideEffectsStarted, true);
    console.log('execution ownership / replay / strict attempt validation PASS');
  }

  // A new retry may reuse requestId while a previous stop HTTP response is
  // delayed. Finalization must bind batch + attempt + registered execution.
  {
    const incident = makeIncident({ fixRequest: { n8nExecutionId: '123' } });
    const { service } = harness(incident);
    const original = globalThis.fetch;
    try {
      /** Envoie la requête et lit la réponse distante. */
      (globalThis as any).fetch = async () => {
        incident.metadata.fixRequest = { ...incident.metadata.fixRequest,
          attemptCount: 2, n8nExecutionId: '222', status: 'CANCEL_REQUESTED' };
        return new Response('{}', { status: 200 });
      };
      await service.cancelFixRequest('incident-1', 'request-1', {}, admin);
      assert.equal(incident.metadata.fixRequest.status, 'CANCEL_REQUESTED');
      assert.equal(incident.metadata.fixRequest.attemptCount, 2);
      assert.equal(incident.metadata.fixRequest.cancelledAt, undefined);
    } finally { globalThis.fetch = original; }
    console.log('finalization cannot cancel newer same-request attempt PASS');
  }

  // Cancellation early callbacks update attempts[] so existing retry rules
  // actually allow a new attempt; reason cannot carry arbitrary metadata.
  {
    const incident = makeIncident();
    const { service } = harness(incident);
    await service.cancelFixRequest('incident-1', 'request-1', { reason: 'x'.repeat(1000), n8nExecutionId: '999' } as any, admin);
    assert.equal(incident.metadata.fixRequest.cancelReason.length, 300);
    assert.equal(incident.metadata.fixRequest.n8nExecutionId, undefined);
    assert.equal(canRetryFixRequest(incident.metadata.fixRequest), false);
    await service.recordExecutionStarted('incident-1', 'request-1', {
      requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '55' });
    assert.equal(canRetryFixRequest(incident.metadata.fixRequest), true);
    const replay: any = await service.recordExecutionStarted('incident-1', 'request-1', {
      requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '55' });
    assert.equal(replay.cancelRequested, true);
    assert.equal(replay.cancelled, true);
    console.log('reason bounded / metadata ignored / cancellation retry / terminal replay PASS');
  }

  assert.deepEqual(Reflect.getMetadata('__guards__', IncidentsController.prototype.recordExecutionStarted), [InternalSecretGuard]);
  assert.deepEqual(Reflect.getMetadata('__guards__', IncidentsController.prototype.preWriteGate), [InternalSecretGuard]);
  assert.deepEqual(Reflect.getMetadata('__guards__', IncidentsController.prototype.cancelFixRequest), [JwtAuthGuard]);
  console.log('internal-secret / JWT endpoint guards PASS');
  console.log('wf2-cancellation contract (B1-B16): ALL PASS');
  } finally {
    if (originalApiUrl === undefined) delete process.env.N8N_API_URL; else process.env.N8N_API_URL = originalApiUrl;
    if (originalApiKey === undefined) delete process.env.N8N_API_KEY; else process.env.N8N_API_KEY = originalApiKey;
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
