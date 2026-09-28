// Increment 1 — launchBatchRemediation() / recordWf6BatchResult(): the
// backend half of "select N CVE -> one PR". Same hand-rolled in-memory
// fake repo convention as manual-remediation.service.wf6-result.spec.ts,
// extended to understand TypeORM's In([...]) operator (real shape verified
// against the real typeorm package: {type:'in', value:[...]}) since
// launchBatchRemediation() looks tasks up by a list of ids, and to accept
// an ARRAY to save() (repo.save(tasks)), both of which the singular spec's
// fake never needed. No real HTTP call is ever made -- the dispatcher is
// always a fake injected via the constructor's 3rd parameter.
import { strict as assert } from 'assert';
import { ManualRemediationService, Wf6BatchDispatchPayload, Wf6BatchDispatcher } from './manual-remediation.service';
import { ManualRemediationStatus, ScannerFindingStatus } from './manual-remediation.entity';

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === 'object' && v.type === 'in' && Array.isArray(v.value)) return v.value.includes(row[k]);
    return row[k] === v;
  });
}

function makeService(seedTasks: any[], dispatcher: Wf6BatchDispatcher) {
  const rows: any[] = seedTasks.map(t => ({ ...t }));
  const repo: any = {
    count: async ({ where }: any) => rows.filter(r => matches(r, where)).length,
    find: async ({ where }: any) => rows.filter(r => matches(r, where)),
    findOne: async ({ where }: any) => rows.find(r => matches(r, where)) || null,
    save: async (value: any) => {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) { const i = rows.findIndex(r => r.id === v.id); if (i < 0) rows.push(v); else rows[i] = v; }
      return value;
    },
    update: async () => {},
  };
  const incidents: any = { find: async () => [], findOne: async () => null };
  return { service: new ManualRemediationService(repo, incidents, dispatcher), rows };
}

const PROJECT_ID = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
function seedTask(overrides: any = {}) {
  return {
    id: overrides.id || 'task-1', projectId: PROJECT_ID, incidentId: 'incident-1', findingId: 'x',
    findingFingerprint: overrides.id || 'fp-1', source: 'TRIVY', ruleOrCve: 'CVE-2023-6378',
    title: 'logback', severity: 'HIGH', remediationType: 'DEVELOPER_ACTION_REQUIRED',
    findingSnapshot: { component: 'ch.qos.logback:logback-classic', currentVersion: '1.2.11', fixedVersion: '1.2.13' },
    status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED,
    completedByUserId: null, completedByDisplayName: null, completedAt: null, completionNote: null,
    lastSeenBuild: 5, verifiedBuild: null, verifiedAt: null, events: [],
    securityFindingRemediation: null, securityRemediationBatchId: null,
    ...overrides,
  };
}
const DEV_USER = { id: 'u1', role: 'developer', name: 'Dev' };
const ADMIN_USER = { id: 'u2', role: 'admin', name: 'Admin' };

function fakeDispatcher(behavior: (p: Wf6BatchDispatchPayload) => void | Promise<void>): Wf6BatchDispatcher {
  return { dispatch: async (p) => { await behavior(p); } };
}

async function main() {
  // 1. Two distinct, independent CVEs -> DISPATCHING written on BOTH tasks,
  // same batchId, correct dispatch payload shape, no real HTTP anywhere.
  {
    const taskA = seedTask({ id: 'task-a', ruleOrCve: 'CVE-2023-6378', findingSnapshot: { component: 'ch.qos.logback:logback-classic', currentVersion: '1.2.11', fixedVersion: '1.2.13' } });
    const taskB = seedTask({ id: 'task-b', ruleOrCve: 'CVE-2020-36518', findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: '2.13.5' } });
    let dispatchedPayload: Wf6BatchDispatchPayload | null = null;
    const { service, rows } = makeService([taskA, taskB], fakeDispatcher(p => { dispatchedPayload = p; }));
    const result = await service.launchBatchRemediation(PROJECT_ID, ['task-a', 'task-b'], DEV_USER);
    assert.equal(result.status, 'DISPATCHING');
    assert.equal(result.findingTaskIds.length, 2);
    assert.ok(dispatchedPayload, 'dispatcher was actually called');
    assert.equal(dispatchedPayload!.projectId, PROJECT_ID);
    assert.equal(dispatchedPayload!.batchId, result.batchId);
    assert.equal(dispatchedPayload!.findingTaskIds.length, 2);
    assert.deepEqual(new Set(dispatchedPayload!.findingTaskIds), new Set(['task-a', 'task-b']), 'dispatch payload carries ONLY the ids -- WF6 re-resolves the rest itself, server-side');
    assert.equal(rows.find(r => r.id === 'task-a').securityFindingRemediation.status, 'DISPATCHING');
    assert.equal(rows.find(r => r.id === 'task-b').securityFindingRemediation.status, 'DISPATCHING');
    assert.equal(rows.find(r => r.id === 'task-a').securityRemediationBatchId, result.batchId);
    assert.equal(rows.find(r => r.id === 'task-b').securityRemediationBatchId, result.batchId);
  }
  console.log('launchBatchRemediation) two distinct CVEs -> both marked DISPATCHING under the same batchId, correct payload: PASS');

  // 2. Deterministic batchId: the SAME selection (any order) -> the SAME batchId.
  {
    const mk = () => [seedTask({ id: 'task-a' }), seedTask({ id: 'task-b', ruleOrCve: 'CVE-2020-36518', findingSnapshot: { component: 'x:y', currentVersion: '1', fixedVersion: '2' } })];
    const { service: s1 } = makeService(mk(), fakeDispatcher(() => {}));
    const { service: s2 } = makeService(mk(), fakeDispatcher(() => {}));
    const r1 = await s1.launchBatchRemediation(PROJECT_ID, ['task-a', 'task-b'], DEV_USER);
    const r2 = await s2.launchBatchRemediation(PROJECT_ID, ['task-b', 'task-a'], DEV_USER);
    assert.equal(r1.batchId, r2.batchId, 'batchId does not depend on caller array order');
  }
  console.log('launchBatchRemediation) deterministic batchId regardless of selection order: PASS');

  // 3. ★ Idempotence — a CVE already CANDIDATE_READY (elsewhere) -> explicit
  // 409, NAMED, nothing dispatched, nothing else in the batch touched either
  // (whole batch rejected, not a silent exclusion).
  {
    const taskA = seedTask({ id: 'task-a', securityFindingRemediation: { status: 'CANDIDATE_READY', prUrl: 'https://github.com/x/y/pull/1' } });
    const taskB = seedTask({ id: 'task-b', ruleOrCve: 'CVE-2020-36518', findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: '2.13.5' } });
    let dispatched = false;
    const { service, rows } = makeService([taskA, taskB], fakeDispatcher(() => { dispatched = true; }));
    await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-a', 'task-b'], DEV_USER), /CVE-2023-6378/);
    assert.equal(dispatched, false, 'dispatcher must never be called when the batch is rejected');
    assert.equal(rows.find(r => r.id === 'task-b').securityFindingRemediation, null, 'the OTHER, non-conflicting task in the same batch is untouched -- rejected as a whole, not partially');
  }
  console.log('launchBatchRemediation) a CVE already CANDIDATE_READY -> explicit named 409, whole batch refused, nothing dispatched, sibling untouched: PASS');

  // 3b. Idempotence also fires for DISPATCHING (a batch already in flight).
  {
    const taskA = seedTask({ id: 'task-a', securityFindingRemediation: { status: 'DISPATCHING' } });
    const { service } = makeService([taskA], fakeDispatcher(() => {}));
    await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-a'], DEV_USER), /CVE-2023-6378/);
  }
  console.log('launchBatchRemediation) a CVE already DISPATCHING -> also explicitly refused: PASS');

  // 4. ★ Static conflict pre-check — two CVEs on the SAME Maven component
  // -> refused BEFORE any dispatch, both named.
  {
    const taskA = seedTask({ id: 'task-a' });
    const taskB = seedTask({ id: 'task-b', ruleOrCve: 'CVE-9999-0001', findingFingerprint: 'fp-b' }); // same component as A (default findingSnapshot)
    let dispatched = false;
    const { service } = makeService([taskA, taskB], fakeDispatcher(() => { dispatched = true; }));
    await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-a', 'task-b'], DEV_USER), /ch\.qos\.logback:logback-classic/);
    assert.equal(dispatched, false);
  }
  console.log('launchBatchRemediation) two CVEs on the same Maven component -> refused before dispatch, named: PASS');

  // 5. Dispatch failure -> every task rolled back to DISPATCH_FAILED, real
  // error surfaced, nothing left silently stuck at DISPATCHING.
  {
    const taskA = seedTask({ id: 'task-a' });
    const taskB = seedTask({ id: 'task-b', ruleOrCve: 'CVE-2020-36518', findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: '2.13.5' } });
    const { service, rows } = makeService([taskA, taskB], fakeDispatcher(() => { throw new Error('n8n returned HTTP 503'); }));
    await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-a', 'task-b'], DEV_USER), /n8n returned HTTP 503/);
    assert.equal(rows.find(r => r.id === 'task-a').securityFindingRemediation.status, 'DISPATCH_FAILED');
    assert.equal(rows.find(r => r.id === 'task-b').securityFindingRemediation.status, 'DISPATCH_FAILED');
  }
  console.log('launchBatchRemediation) dispatch failure -> every task in the batch rolled back to DISPATCH_FAILED, real error surfaced: PASS');

  // 6. ADMIN_ACTION_REQUIRED task in the selection -> a developer is refused.
  {
    const taskA = seedTask({ id: 'task-a', remediationType: 'ADMIN_ACTION_REQUIRED' });
    const { service } = makeService([taskA], fakeDispatcher(() => {}));
    await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-a'], DEV_USER), /administrateur/);
    const { service: asAdmin } = makeService([taskA], fakeDispatcher(() => {}));
    const result = await asAdmin.launchBatchRemediation(PROJECT_ID, ['task-a'], ADMIN_USER);
    assert.equal(result.status, 'DISPATCHING', 'an admin CAN launch the same batch');
  }
  console.log('launchBatchRemediation) ADMIN_ACTION_REQUIRED finding -> developer refused, admin allowed: PASS');

  // 7. Unknown / cross-project task id -> named, explicit rejection.
  {
    const { service } = makeService([seedTask({ id: 'task-a' })], fakeDispatcher(() => {}));
    await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-a', 'ghost'], DEV_USER), /ghost/);
    const { service: other } = makeService([seedTask({ id: 'task-a', projectId: 'other-project' })], fakeDispatcher(() => {}));
    await assert.rejects(() => other.launchBatchRemediation(PROJECT_ID, ['task-a'], DEV_USER));
  }
  console.log('launchBatchRemediation) unknown id / cross-project task -> explicit rejection: PASS');

  // 8. recordWf6BatchResult() — persists a shared PR identity + per-CVE
  // status independently on each task, exactly the shape the UI badge
  // (already shipped) will later read per CVE.
  {
    const taskA = seedTask({ id: 'task-a', securityRemediationBatchId: 'sec-batch-abc123' });
    const taskB = seedTask({ id: 'task-b', ruleOrCve: 'CVE-2020-36518', securityRemediationBatchId: 'sec-batch-abc123', findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: '2.13.5' } });
    const { service, rows } = makeService([taskA, taskB], fakeDispatcher(() => {}));
    const saved = await service.recordWf6BatchResult({
      projectId: PROJECT_ID, batchId: 'sec-batch-abc123', status: 'CANDIDATE_READY', reason: 'DETERMINISTIC_BATCH_CANDIDATE_READY',
      candidateIdentity: 'x'.repeat(64), evaluatedSha: 'y'.repeat(40), branchName: 'security/fix/batch-abc123',
      prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/40', prNumber: 40, executionId: '2100',
      findings: [
        { findingTaskId: 'task-a', cveId: 'CVE-2023-6378', status: 'CLOSED', reason: 'TARGET_CVE_CLOSED' },
        { findingTaskId: 'task-b', cveId: 'CVE-2020-36518', status: 'CLOSED', reason: 'TARGET_CVE_CLOSED' },
      ],
    } as any);
    assert.equal(saved.length, 2);
    const a = rows.find(r => r.id === 'task-a'), b = rows.find(r => r.id === 'task-b');
    assert.equal(a.securityFindingRemediation.status, 'CLOSED');
    assert.equal(a.securityFindingRemediation.prUrl, 'https://github.com/souhaiel11/pfe-app-test/pull/40');
    assert.equal(b.securityFindingRemediation.status, 'CLOSED');
    assert.equal(b.securityFindingRemediation.prUrl, a.securityFindingRemediation.prUrl, 'both tasks share the SAME PR link');
    assert.equal(a.securityFindingRemediation.candidateIdentity, 'x'.repeat(64));
  }
  console.log('recordWf6BatchResult) shared PR identity + independent per-CVE status persisted on each task: PASS');

  // 9. recordWf6BatchResult() with a MIXED verdict (one CLOSED, one
  // STILL_OPEN) -- exactly what a tout-ou-rien-failed batch reports.
  {
    const taskA = seedTask({ id: 'task-a', securityRemediationBatchId: 'sec-batch-mixed' });
    const taskB = seedTask({ id: 'task-b', ruleOrCve: 'CVE-2020-36518', securityRemediationBatchId: 'sec-batch-mixed', findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: '2.13.5' } });
    const { service, rows } = makeService([taskA, taskB], fakeDispatcher(() => {}));
    await service.recordWf6BatchResult({
      projectId: PROJECT_ID, batchId: 'sec-batch-mixed', status: 'CANDIDATE_SECURITY_VALIDATION_FAILED', reason: 'Not every target CVE closed: CVE-2020-36518:STILL_OPEN',
      findings: [
        { findingTaskId: 'task-a', cveId: 'CVE-2023-6378', status: 'CLOSED', reason: 'TARGET_CVE_CLOSED' },
        { findingTaskId: 'task-b', cveId: 'CVE-2020-36518', status: 'STILL_OPEN', reason: 'TARGET_CVE_STILL_OPEN_AFTER_PATCH' },
      ],
    } as any);
    assert.equal(rows.find(r => r.id === 'task-a').securityFindingRemediation.status, 'CLOSED', 'the CVE that WAS fixed is reported CLOSED even though the overall batch failed');
    assert.equal(rows.find(r => r.id === 'task-b').securityFindingRemediation.status, 'STILL_OPEN');
    assert.equal(rows.find(r => r.id === 'task-a').securityFindingRemediation.prUrl, null, 'no PR exists for a failed (non-CANDIDATE_READY) batch');
  }
  console.log('recordWf6BatchResult) mixed per-CVE verdict (one closed, one still open) persisted honestly per task: PASS');

  // 10. recordWf6BatchResult() rejects a task whose batchId does not match.
  {
    const taskA = seedTask({ id: 'task-a', securityRemediationBatchId: 'sec-batch-real' });
    const { service } = makeService([taskA], fakeDispatcher(() => {}));
    await assert.rejects(() => service.recordWf6BatchResult({
      projectId: PROJECT_ID, batchId: 'sec-batch-wrong', status: 'CANDIDATE_READY',
      findings: [{ findingTaskId: 'task-a', cveId: 'CVE-2023-6378', status: 'CLOSED' }],
    } as any), /ne correspond pas au lot/);
  }
  console.log('recordWf6BatchResult) mismatched batchId -> rejected: PASS');

  console.log('manual-remediation.service.batch.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
