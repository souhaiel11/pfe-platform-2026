// Teste le composant « reconcile-stale-wf6-dispatch » et ses cas d’erreur.
import { targetReservationTestQuery } from './target-reservation-test-query';
import { strict as assert } from 'assert';
import { ManualRemediationService } from './manual-remediation.service';
import { ManualRemediationStatus, ScannerFindingStatus } from './manual-remediation.entity';

/** Prépare les données nécessaires à ce scénario. */
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === 'object' && v.type === 'in' && Array.isArray(v.value)) return v.value.includes(row[k]);
    return row[k] === v;
  });
}

const admin = { id: 'admin-1', role: 'admin' };
const developer = { id: 'dev-1', role: 'developer' };
const PROJECT_ID = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
/** Prépare les données nécessaires à ce scénario. */
const old = (ms = 60 * 60 * 1000) => new Date(Date.now() - ms).toISOString();

/** Prépare les données nécessaires à ce scénario. */
const seedTask = (overrides: any = {}) => {
  const base = {
    id: 'task-1', projectId: PROJECT_ID, incidentId: null, findingId: null,
    findingFingerprint: 'fp-1', source: 'TRIVY', ruleOrCve: 'CVE-2022-38749',
    title: 'snakeyaml', severity: 'HIGH', remediationType: null, findingSnapshot: {},
    status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED,
    completedByUserId: null, completedByDisplayName: null, completedAt: null, completionNote: null,
    lastSeenBuild: null, verifiedBuild: null, verifiedAt: null, events: [],
    securityRemediationBatchId: 'batch-1',
    securityFindingRemediation: {
      status: 'DISPATCHING', reason: null, batchId: 'batch-1',
      candidateIdentity: null, evaluatedSha: null, branchName: null, prUrl: null, prNumber: null,
      patchEvidence: null, securityValidationEvidence: null, attemptCount: 1, updatedAt: old(),
      attempts: [{ attempt: 1, at: old(), status: 'DISPATCHING', reason: null, batchId: 'batch-1' }],
    },
  };
  return { ...base, ...overrides, securityFindingRemediation: { ...base.securityFindingRemediation, ...(overrides.securityFindingRemediation || {}) } };
};

/** Prépare les données nécessaires à ce scénario. */
function harness(tasks: any[]) {
  const rows: any[] = tasks.map(t => ({ ...t }));
  let tail = Promise.resolve();
  const txRepo = {
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async ({ where }: any) => rows.find(r => matches(r, where)) || null,
    /** Recherche les éléments correspondants. */
    find: async ({ where }: any) => rows.filter(r => matches(r, where)),
    /** Enregistre les données fournies. */
    save: async (value: any) => {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) { const i = rows.findIndex(r => r.id === v.id); if (i < 0) rows.push(v); else rows[i] = v; }
      return value;
    },
  };
  const repo: any = {
    manager: {
      /** Exécute les opérations dans le cadre transactionnel prévu. */
      transaction: async (fn: any) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try { return await fn({ query: targetReservationTestQuery(), 
        /** Simule la lecture des données demandées par le composant. */
        getRepository: () => txRepo }); } finally { release(); }
      },
    },
    findOne: txRepo.findOne, find: txRepo.find, save: txRepo.save,
  };
  const incidents: any = { 
  /** Recherche les éléments correspondants. */
  find: async () => [], 
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne: async () => null };
  return { service: new ManualRemediationService(repo, incidents), rows };
}

const RECOVERY = { batchId: 'batch-1', attemptCount: 1 };

/** Exécute les étapes principales de ce programme. */
async function main() {
  const prevThreshold = process.env.WF6_STALE_DISPATCH_MS;
  process.env.WF6_STALE_DISPATCH_MS = '1000'; // 1s, so old()'s 1h-old fixture is comfortably stale
  try {

    // R1 — valid stale DISPATCHING -> TECHNICAL_FAILURE, via the REAL
    // recordWf6BatchResult() business path (reused, not duplicated).
    {
      const { service, rows } = harness([seedTask()]);
      const result: any = await service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin);
      assert.equal(result.applied, true);
      assert.equal(result.alreadyTerminal, false);
      assert.equal(result.status, 'TECHNICAL_FAILURE');
      assert.equal(rows[0].securityFindingRemediation.status, 'TECHNICAL_FAILURE', 'actually persisted');
      assert.equal(rows[0].securityFindingRemediation.reason, 'WF6_STALE_DISPATCH_RECONCILED');
      assert.equal(rows[0].securityFindingRemediation.attemptCount, 1, 'reconciliation must not increment the reserved attempt');
      assert.equal(rows[0].securityFindingRemediation.attempts.length, 1);
      assert.equal(rows[0].securityFindingRemediation.attempts[0].reason, 'WF6_STALE_DISPATCH_RECONCILED');
    }
    console.log('R1 valid stale DISPATCHING -> TECHNICAL_FAILURE: PASS');

    // R2 — not stale yet -> rejected.
    {
      const { service } = harness([seedTask({ securityFindingRemediation: { updatedAt: new Date().toISOString(), attempts: [{ attempt: 1, at: new Date().toISOString(), status: 'DISPATCHING', reason: null, batchId: 'batch-1' }] } })]);
      await assert.rejects(() => service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin), /pas dépassé le seuil/);
    }
    console.log('R2 not stale yet -> rejected: PASS');

    // R3 — stale batchId mismatch -> rejected.
    {
      const { service } = harness([seedTask()]);
      await assert.rejects(() => service.reconcileStaleWf6Dispatch('task-1', { ...RECOVERY, batchId: 'wrong-batch' }, admin), /lot WF6/);
    }
    console.log('R3 wrong batchId -> rejected: PASS');

    // R4 — stale attemptCount mismatch -> rejected.
    {
      const { service } = harness([seedTask()]);
      await assert.rejects(() => service.reconcileStaleWf6Dispatch('task-1', { ...RECOVERY, attemptCount: 2 }, admin), /tentative WF6 active/);
    }
    console.log('R4 wrong attemptCount -> rejected: PASS');

    // R5 — a newer attempt already superseded this one (task's own
    // attemptCount moved on) -> rejected via the SAME attemptCount check.
    {
      const { service } = harness([seedTask({ securityFindingRemediation: { attemptCount: 2, attempts: [
        { attempt: 1, at: old(), status: 'DISPATCHING', reason: null, batchId: 'batch-1' },
        { attempt: 2, at: old(), status: 'DISPATCHING', reason: null, batchId: 'batch-1' },
      ] } })]);
      await assert.rejects(() => service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin), /tentative WF6 active/);
    }
    console.log('R5 newer attempt exists -> rejected: PASS');

    // R6 — CANDIDATE_READY preserved (idempotent, not overwritten).
    {
      const { service, rows } = harness([seedTask({ securityFindingRemediation: { status: 'CANDIDATE_READY' } })]);
      const result: any = await service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin);
      assert.equal(result.applied, false);
      assert.equal(result.alreadyTerminal, true);
      assert.equal(result.status, 'CANDIDATE_READY');
      assert.equal(rows[0].securityFindingRemediation.status, 'CANDIDATE_READY', 'never overwritten');
    }
    console.log('R6 CANDIDATE_READY preserved: PASS');

    // R7 — CLOSED preserved.
    {
      const { service, rows } = harness([seedTask({ securityFindingRemediation: { status: 'CLOSED' } })]);
      const result: any = await service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin);
      assert.equal(result.alreadyTerminal, true);
      assert.equal(rows[0].securityFindingRemediation.status, 'CLOSED');
    }
    console.log('R7 CLOSED preserved: PASS');

    // R8 — existing TECHNICAL_FAILURE -> idempotent (no mutation, no error).
    {
      const { service, rows } = harness([seedTask({ securityFindingRemediation: { status: 'TECHNICAL_FAILURE', reason: 'SOME_EARLIER_REAL_REASON' } })]);
      const result: any = await service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin);
      assert.equal(result.applied, false);
      assert.equal(result.alreadyTerminal, true);
      assert.equal(result.status, 'TECHNICAL_FAILURE');
      assert.equal(rows[0].securityFindingRemediation.reason, 'SOME_EARLIER_REAL_REASON', 'untouched, not re-reconciled');
    }
    console.log('R8 existing TECHNICAL_FAILURE -> idempotent: PASS');

    // R9 — PR already recorded (even though status still says DISPATCHING,
    // a defensive belt-and-braces check) -> no destructive reconciliation.
    {
      const { service, rows } = harness([seedTask({ securityFindingRemediation: { prUrl: 'https://github.com/x/y/pull/1' } })]);
      await assert.rejects(() => service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin), /Pull Request est déjà enregistrée/);
      assert.equal(rows[0].securityFindingRemediation.status, 'DISPATCHING', 'must not have been touched');
    }
    console.log('R9 PR already recorded -> no destructive reconciliation: PASS');

    // R10 — concurrent duplicate requests -> exactly one terminal
    // transition (the tail-chain-serialized fake transaction proves the
    // SECOND call sees the FIRST call's committed state).
    {
      const { service, rows } = harness([seedTask()]);
      const [a, b]: any = await Promise.all([
        service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin),
        service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin),
      ]);
      const appliedCount = [a, b].filter(r => r.applied).length;
      const idempotentCount = [a, b].filter(r => r.alreadyTerminal).length;
      assert.equal(appliedCount, 1, 'exactly one call must have performed the transition');
      assert.equal(idempotentCount, 1, 'the other must have observed it already terminal');
      assert.equal(rows[0].securityFindingRemediation.status, 'TECHNICAL_FAILURE');
      assert.equal(rows[0].securityFindingRemediation.attemptCount, 1, 'reconciliation completes the same attempt');
    }
    console.log('R10 concurrent double reconcile -> exactly one transition: PASS');

    // R11 — normal non-admin caller -> rejected, before any read/lock.
    {
      const { service, rows } = harness([seedTask()]);
      await assert.rejects(() => service.reconcileStaleWf6Dispatch('task-1', RECOVERY, developer), /administrateur/);
      assert.equal(rows[0].securityFindingRemediation.status, 'DISPATCHING', 'untouched');
      await assert.rejects(() => service.reconcileStaleWf6Dispatch('task-1', RECOVERY, null), /administrateur/);
    }
    console.log('R11 normal non-admin caller -> rejected: PASS');

    // R12 — arbitrary status in payload is impossible: the DTO's TS shape
    // carries no `status` field, and even a raw object with an extra key
    // (simulating a pre-ValidationPipe payload) is simply ignored by the
    // service, which only ever reads batchId/attemptCount from `input`.
    {
      const { service, rows } = harness([seedTask()]);
      const result: any = await service.reconcileStaleWf6Dispatch('task-1', { ...RECOVERY, status: 'CLOSED' } as any, admin);
      assert.equal(result.status, 'TECHNICAL_FAILURE', 'the injected "status" field was never consulted');
      assert.equal(rows[0].securityFindingRemediation.status, 'TECHNICAL_FAILURE');
    }
    console.log('R12 arbitrary status in payload -> ignored (service never reads it): PASS');

    // R13 — legacy reconciliation preserves fields without minting a modern identity.
    {
      const { service, rows } = harness([seedTask()]);
      await service.reconcileStaleWf6Dispatch('task-1', RECOVERY, admin);
      const persisted = rows[0].securityFindingRemediation;
      assert.equal(persisted.batchId, 'batch-1');
      assert.equal(persisted.attemptCount, 1);
      assert.equal(persisted.attempts[0].legacyAttempt, true);
      assert.ok(persisted.attempts[0].finishedAt);
      assert.equal(persisted.retryable, false);
    }
    console.log('R13 legacy reconciliation completes same historical attempt fail-closed: PASS');

    // R14 — the two REAL historical tasks (shape copied, never the live
    // rows) would reconcile safely to TECHNICAL_FAILURE.
    {
      const real1 = seedTask({
        id: '83555b3a-efa1-45e1-90a8-008debddba92', ruleOrCve: 'CVE-2022-38749',
        securityRemediationBatchId: 'sec-batch-d359edf8f878f1dd',
        securityFindingRemediation: { batchId: 'sec-batch-d359edf8f878f1dd', updatedAt: old(),
          attempts: [{ attempt: 1, at: old(), status: 'DISPATCHING', reason: null, batchId: 'sec-batch-d359edf8f878f1dd' }] },
      });
      const real2 = seedTask({
        id: 'b52ea617-f5c3-47a3-bc6e-6230ea648d63', ruleOrCve: 'CVE-2022-38751',
        securityRemediationBatchId: 'sec-batch-bd22285c1649ea80',
        securityFindingRemediation: { batchId: 'sec-batch-bd22285c1649ea80', updatedAt: old(),
          attempts: [{ attempt: 1, at: old(), status: 'DISPATCHING', reason: null, batchId: 'sec-batch-bd22285c1649ea80' }] },
      });
      const { service, rows } = harness([real1, real2]);
      const r1: any = await service.reconcileStaleWf6Dispatch(real1.id, { batchId: 'sec-batch-d359edf8f878f1dd', attemptCount: 1 }, admin);
      const r2: any = await service.reconcileStaleWf6Dispatch(real2.id, { batchId: 'sec-batch-bd22285c1649ea80', attemptCount: 1 }, admin);
      assert.equal(r1.status, 'TECHNICAL_FAILURE');
      assert.equal(r2.status, 'TECHNICAL_FAILURE');
      assert.equal(rows.find(r => r.id === real1.id).securityFindingRemediation.status, 'TECHNICAL_FAILURE');
      assert.equal(rows.find(r => r.id === real2.id).securityFindingRemediation.status, 'TECHNICAL_FAILURE');
    }
    console.log('R14 two current historical task fixtures -> would reconcile safely to TECHNICAL_FAILURE: PASS');

  } finally {
    if (prevThreshold === undefined) delete process.env.WF6_STALE_DISPATCH_MS; else process.env.WF6_STALE_DISPATCH_MS = prevThreshold;
  }

  console.log('reconcile-stale-wf6-dispatch.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
