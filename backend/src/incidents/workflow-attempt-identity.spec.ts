// Teste le composant « workflow-attempt-identity » et ses cas d’erreur.
import { emptyReservationQuery } from './sonar-file-reservation.test-double';
import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';
import { resolveAttemptWorkflowIdentity } from './workflow-attempt-identity';

const CURRENT = 'u3eeMwTuhCsetfcS';
const LEGACY = '9adcV31eaIgJyMR0';
const SHA = 'a'.repeat(40);
const admin = { id: 'admin', role: 'admin' };
/** Prépare les données nécessaires à ce scénario. */
function fixture() {
  const finding = { id: 'a', findingId: 'a', source: 'SONARQUBE', stage: 'sonar',
    remediationType: 'AUTO_FIX_ELIGIBLE', rule: 'java:S125', file: 'A.java', message: 'comment' };
  const project = { id: 'p', githubRepo: 'owner/repo' };
  const incident: any = { id: 'i', projectId: 'p', project, status: 'blocked', buildNumber: 1,
    metadata: { enrichedData: { sonar: { issues: [finding] } }, sourceCommitSha: SHA } };
  let writes = 0;
  const repo: any = {
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne: async () => incident,
    /** Applique les modifications autorisées à l’élément. */
    update: async (_id: string, patch: any) => { writes++; Object.assign(incident, patch); } };
  const projects: any = {
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne: async () => project };
  repo.manager = {
  /** Exécute les opérations dans le cadre transactionnel prévu. */
  transaction: async (fn: any) => fn({
  /** Simule la lecture des données demandées par le composant. */
  query: emptyReservationQuery, getRepository: (entity: any) => entity.name === 'Project' ? projects : repo }) };
  const service = new IncidentsService(repo, projects, {
  /** Diffuse ou construit le résultat prévu. */
  emit: () => undefined } as any,
    {
    /** Prépare les données nécessaires à ce scénario. */
    syncIncident: async () => undefined } as any, {} as any);
  /** Prépare les données nécessaires à ce scénario. */
  (service as any).dispatchAutomaticInitialPrValidation = async () => undefined;
  return { incident, service,
  /** Prépare les données nécessaires à ce scénario. */
  writes: () => writes };
}
/** Traite le retour de l’opération du scénario. */
function callback(incident: any, workflowId = CURRENT, attemptCount = incident.metadata.fixRequest.attemptCount): any {
  const fix = incident.metadata.fixRequest;
  return { incidentId: incident.id, requestId: fix.requestId, batchId: fix.batchId, batchKey: fix.batchId,
    attemptCount, workflowId, executionId: `exec-${attemptCount}`, status: 'FAILED', failureCode: 'TEST_FAILURE' };
}
/** Exécute les étapes principales de ce programme. */
async function main() {
  const savedEnv = process.env.N8N_WF2_ID;
  const savedFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response('{}', { status: 200 }); }) as any;
  try {
    process.env.N8N_WF2_ID = CURRENT;
    const h = fixture();
    await h.service.approveFix('i', admin, { findingIds: ['a'] });
    assert.equal(h.incident.metadata.fixRequest.attempts[0].expectedWorkflowId, CURRENT, 'A: frozen at dispatch');
    process.env.N8N_WF2_ID = LEGACY;
    await assert.rejects(() => h.service.saveWorkflowBatchStatus('i', callback(h.incident, LEGACY)), /identité/, 'C: wrong legacy callback');
    assert.equal((await h.service.saveWorkflowBatchStatus('i', callback(h.incident))).applied, true, 'B/F: frozen ID wins over changed config');
    assert.equal(h.incident.metadata.fixRequest.workflowId, CURRENT);

    // A retry freezes a fresh identity and preserves the prior attempt verbatim.
    const old = JSON.parse(JSON.stringify(h.incident.metadata.fixRequest.attempts[0]));
    await h.service.retryFix('i', admin);
    assert.deepEqual(h.incident.metadata.fixRequest.attempts[0], old);
    assert.equal(h.incident.metadata.fixRequest.attempts[1].expectedWorkflowId, LEGACY);

    // Legacy completed attempt remains historical, even inside a new current batch.
    const legacy = fixture();
    legacy.incident.metadata.fixRequest = { requestId: 'r', batchId: 'b', workflow: 'WF2', status: 'DISPATCHED',
      attemptCount: 2, attempts: [{ attempt: 1, status: 'PR_CREATED', workflowId: LEGACY, workflowExecutionId: 'exec-1' },
        { attempt: 2, status: 'DISPATCHED', expectedWorkflowId: CURRENT }],
      workflowEvents: [{ attempt: 1, workflowId: LEGACY, identity: `${LEGACY}:exec-1:PR_CREATED` }] };
    const before = JSON.stringify(legacy.incident);
    assert.equal((await legacy.service.saveWorkflowBatchStatus('i', { ...callback(legacy.incident, LEGACY, 1), status: 'PR_CREATED' })).duplicate, true, 'D/G: replay legacy');
    assert.equal((await legacy.service.saveWorkflowBatchStatus('i', callback(legacy.incident, LEGACY, 1))).stale, true, 'D/G: delayed legacy');
    assert.equal(JSON.stringify(legacy.incident), before);

    const unresolved = fixture();
    unresolved.incident.metadata.fixRequest = { requestId: 'r', batchId: 'b', workflow: 'WF2', status: 'DISPATCHED',
      attemptCount: 1, attempts: [{ attempt: 1, status: 'DISPATCHED' }] };
    for (const id of [CURRENT, LEGACY]) {
      await assert.rejects(() => unresolved.service.saveWorkflowBatchStatus('i', callback(unresolved.incident, id)),
        (e: any) => e.getStatus() === 409 && e.getResponse().code === 'WF2_ATTEMPT_IDENTITY_UNRESOLVED');
    }
    assert.equal(unresolved.writes(), 0, 'H: unresolved migration batch never mutated');
    assert.equal(resolveAttemptWorkflowIdentity({ workflowId: CURRENT, attemptCount: 2, workflowExecutionId: 'exec-2' },
      { attempt: 1 }), null, 'no later batch identity inherited');
    assert.equal(resolveAttemptWorkflowIdentity({}, { expectedWorkflowId: '', workflowId: LEGACY }), null);

    // Real corrective dispatch: mixed historical/current identities, same branch and PR.
    const c = fixture();
    const historical = { attempt: 1, status: 'PR_CREATED', workflowId: LEGACY, workflowExecutionId: 'exec-1' };
    c.incident.prUrl = 'https://github.com/owner/repo/pull/1';
    c.incident.metadata.fixRequest = { requestId: 'r', batchId: 'b', workflow: 'WF2', status: 'VALIDATED',
      prNumber: 1, prHeadSha: SHA, attemptCount: 1, attempts: [historical], workflowId: LEGACY,
      findingIds: ['a'], findings: [{ findingId: 'a', file: 'A.java' }] };
    c.incident.metadata.validation = { checkoutSha: SHA,
      findingResults: [{ findingId: 'a', result: 'INVALID', evidence: 'still present' }],
      mergeAuthorization: { authorization: 'BLOCKED', correctiveActionAllowed: true } };
    /** Prépare les données nécessaires à ce scénario. */
    (c.service as any).githubPullRequest = async () => ({ state: 'open', head: { sha: SHA, ref: 'fix/pfe-i-r' } });
    process.env.N8N_WF2_ID = CURRENT;
    await c.service.correctAndRevalidate('i', admin);
    assert.deepEqual(c.incident.metadata.fixRequest.attempts[0], historical, 'E: history unchanged');
    assert.equal(c.incident.metadata.fixRequest.workflowId, LEGACY, 'do not rewrite old callback evidence at dispatch');
    assert.equal(c.incident.metadata.fixRequest.attempts[1].expectedWorkflowId, CURRENT, 'E: corrective identity frozen');
    // Success callback validates the same frozen identity as the failure path.
    const success = { ...callback(c.incident), status: 'PR_CREATED', prUrl: c.incident.prUrl, prNumber: 1,
      prHeadSha: 'b'.repeat(40), completenessPassed: true, candidateAcceptedFindingIds: ['a'],
      candidateVerifiedFiles: ['A.java'], plannedFiles: ['A.java'],
      fileResults: [{ targetFile: 'A.java', candidateStateVerified: true, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION' }] };
    assert.equal((await c.service.saveWorkflowBatchStatus('i', success)).applied, true);
    assert.equal(c.incident.metadata.fixRequest.workflowId, CURRENT);
    assert.deepEqual(c.incident.metadata.fixRequest.attempts[0], historical);

    delete process.env.N8N_WF2_ID;
    const noConfig = fixture(); const count = requests;
    await assert.rejects(() => noConfig.service.approveFix('i', admin, { findingIds: ['a'] }),
      (e: any) => e.getResponse().code === 'WF2_DISPATCH_IDENTITY_UNCONFIGURED');
    assert.equal(noConfig.writes(), 0);
    assert.equal(requests, count);
    console.log('Attempt-scoped WF2 identity A-H: PASS (all external calls mocked)');
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEnv === undefined) delete process.env.N8N_WF2_ID; else process.env.N8N_WF2_ID = savedEnv;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
