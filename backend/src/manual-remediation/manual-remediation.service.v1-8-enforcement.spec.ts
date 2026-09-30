// V1.8 Phase 5 ticket — launchBatchRemediation()'s new ENFORCED-mode gate.
// Same hand-rolled fake-repo convention as manual-remediation.service.batch.spec.ts,
// extended with a fake `projects` repo (the new 6th constructor argument)
// seeded with the REAL repository/commit this session's real evidence store
// was validated against, so the known real cases (SnakeYAML/H2) can be
// exercised end-to-end through the actual dispatch path, not a synthetic one.
import { strict as assert } from 'assert';
import { ManualRemediationService, Wf6BatchDispatchPayload, Wf6BatchDispatcher } from './manual-remediation.service';
import { ManualRemediationStatus, ScannerFindingStatus } from './manual-remediation.entity';

const REAL_REPOSITORY = 'souhaiel11/pfe-app-test';
const REAL_COMMIT_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
const PROJECT_ID = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';

function makeService(seedTasks: any[], dispatcher: Wf6BatchDispatcher) {
  const rows: any[] = seedTasks.map(t => ({ ...t }));
  const repo: any = {
    count: async () => rows.length,
    find: async ({ where }: any) => rows.filter(r => (where.id?.value ?? [r.id]).includes(r.id)),
    findOne: async ({ where }: any) => rows.find(r => r.id === where.id) || null,
    save: async (value: any) => { for (const v of (Array.isArray(value) ? value : [value])) { const i = rows.findIndex(r => r.id === v.id); if (i < 0) rows.push(v); else rows[i] = v; } return value; },
  };
  const incidents: any = { findOne: async ({ where }: any) => (where.id === 'incident-1' ? { id: 'incident-1', projectId: PROJECT_ID, metadata: { sourceCommitSha: REAL_COMMIT_SHA } } : null), find: async () => [] };
  const projects: any = { findOne: async ({ where }: any) => (where.id === PROJECT_ID ? { id: PROJECT_ID, githubRepo: REAL_REPOSITORY } : null) };
  return { service: new ManualRemediationService(repo, incidents, dispatcher, undefined, projects), rows };
}

function seedTask(overrides: any = {}) {
  return {
    id: overrides.id || 'task-1', projectId: PROJECT_ID, incidentId: 'incident-1', findingId: 'x',
    findingFingerprint: overrides.id || 'fp-1', source: 'OWASP', ruleOrCve: 'CVE-2022-25857',
    title: 'snakeyaml', severity: 'HIGH', remediationType: 'AUTO_FIX_ELIGIBLE',
    findingSnapshot: { component: 'org.yaml:snakeyaml', currentVersion: '1.29', fixedVersion: '1.31' },
    status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED,
    completedByUserId: null, completedByDisplayName: null, completedAt: null, completionNote: null,
    lastSeenBuild: 5, verifiedBuild: null, verifiedAt: null, events: [],
    securityFindingRemediation: null, securityRemediationBatchId: null,
    ...overrides,
  };
}

async function run() {
  const originalEnv = process.env.V1_8_SECURITY_ENFORCEMENT;
  try {
    const dev = { id: 'dev-1', role: 'developer' };

    // 1. SHADOW mode (default, no env var set): dispatch proceeds even for
    // a task whose real V1.8 evidence would BLOCK (H2 -- NO_COMPATIBLE_CANDIDATE) --
    // proves SHADOW mode never gates anything, exactly the ticket's own
    // "current WF6 behavior, V1.8 comparison only".
    delete process.env.V1_8_SECURITY_ENFORCEMENT;
    {
      let dispatchCalled = false;
      const dispatcher: Wf6BatchDispatcher = { dispatch: async () => { dispatchCalled = true; } };
      const h2Task = seedTask({ id: 'h2-task', ruleOrCve: 'CVE-2022-45868', findingSnapshot: { component: 'com.h2database:h2', currentVersion: '2.1.212', fixedVersion: '2.2.220' } });
      const { service } = makeService([h2Task], dispatcher);
      const result = await service.launchBatchRemediation(PROJECT_ID, ['h2-task'], dev);
      assert.equal(result.status, 'DISPATCHING');
      assert.equal(dispatchCalled, true, 'SHADOW mode must dispatch exactly like today, even for a V1.8-BLOCKed finding');
    }
    console.log('1. SHADOW mode (default): dispatch proceeds unchanged even for a V1.8-BLOCKed finding: PASS');

    // 2. ENFORCED mode, SnakeYAML (real ALLOW): dispatch proceeds.
    process.env.V1_8_SECURITY_ENFORCEMENT = 'ENFORCED';
    {
      let dispatchCalled = false;
      const dispatcher: Wf6BatchDispatcher = { dispatch: async () => { dispatchCalled = true; } };
      const { service } = makeService([seedTask()], dispatcher);
      const result = await service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev);
      assert.equal(result.status, 'DISPATCHING');
      assert.equal(dispatchCalled, true, 'ENFORCED mode must ALLOW SnakeYAML, whose real evidence exactly matches this task context');
    }
    console.log('2. ENFORCED mode, SnakeYAML exact-match context -> real dispatch proceeds: PASS');

    // 3. ENFORCED mode, H2 (real NO_COMPATIBLE_CANDIDATE): dispatch refused,
    // BEFORE any state mutation or dispatcher call -- fail-closed.
    {
      let dispatchCalled = false;
      const dispatcher: Wf6BatchDispatcher = { dispatch: async () => { dispatchCalled = true; } };
      const h2Task = seedTask({ id: 'h2-task', ruleOrCve: 'CVE-2022-45868', remediationType: 'DEVELOPER_ACTION_REQUIRED', findingSnapshot: { component: 'com.h2database:h2', currentVersion: '2.1.212', fixedVersion: '2.2.220' } });
      const { service, rows } = makeService([h2Task], dispatcher);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['h2-task'], dev), /NO_COMPATIBLE_CANDIDATE/);
      assert.equal(dispatchCalled, false, 'a BLOCKed finding must never reach the dispatcher');
      assert.equal(rows[0].securityFindingRemediation, null, 'no DISPATCHING state may be written before the gate passes');
    }
    console.log('3. ENFORCED mode, H2 (real NO_COMPATIBLE_CANDIDATE) -> BLOCK, no dispatch, no state mutation: PASS');

    // 4. ENFORCED mode, "no fallback to old auto-fix" (Phase 5's own rule):
    // remediationType === AUTO_FIX_ELIGIBLE (the OLD classifier's own
    // green light) must NOT rescue a finding V1.8 evidence blocks.
    {
      let dispatchCalled = false;
      const dispatcher: Wf6BatchDispatcher = { dispatch: async () => { dispatchCalled = true; } };
      const h2Task = seedTask({ id: 'h2-task', ruleOrCve: 'CVE-2022-45868', remediationType: 'AUTO_FIX_ELIGIBLE', findingSnapshot: { component: 'com.h2database:h2', currentVersion: '2.1.212', fixedVersion: '2.2.220' } });
      const { service } = makeService([h2Task], dispatcher);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['h2-task'], dev), /NO_COMPATIBLE_CANDIDATE/);
      assert.equal(dispatchCalled, false, 'old classifier AUTO_FIX_ELIGIBLE must never be used as a fallback authorization once ENFORCED');
    }
    console.log('4. ENFORCED mode, old classifier says AUTO_FIX_ELIGIBLE but V1.8 BLOCKs -> BLOCK, no fallback: PASS');

    // 5. ENFORCED mode, stale evidence (installed version changed since validation) -> BLOCK.
    {
      let dispatchCalled = false;
      const dispatcher: Wf6BatchDispatcher = { dispatch: async () => { dispatchCalled = true; } };
      const staleTask = seedTask({ findingSnapshot: { component: 'org.yaml:snakeyaml', currentVersion: '1.30', fixedVersion: '1.31' } });
      const { service } = makeService([staleTask], dispatcher);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /V1_8_EVIDENCE_STALE/);
      assert.equal(dispatchCalled, false);
    }
    console.log('5. ENFORCED mode, installed version drifted from validated evidence -> V1_8_EVIDENCE_STALE, BLOCK: PASS');

    // 6. ENFORCED mode dispatch must PERSIST the validated plan onto the
    // task (v1_8Plan) -- this is the fix wiring security-finding-resolver.
    // service.ts reads back at evaluate-time so WF6 executes the ACTUAL
    // V1.8-validated plan instead of the pre-existing pure "lowest same-
    // major" policy independently recomputing (possibly agreeing by
    // coincidence, never by construction) its own target version.
    {
      const dispatcher: Wf6BatchDispatcher = { dispatch: async () => {} };
      const { service, rows } = makeService([seedTask()], dispatcher);
      await service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev);
      const plan = rows[0].securityFindingRemediation?.v1_8Plan;
      assert.ok(plan, 'ENFORCED dispatch must persist a v1_8Plan onto the task');
      assert.equal(plan.editType, 'DEPENDENCY_VERSION');
      assert.equal(plan.actualEditTarget, 'org.yaml:snakeyaml');
      assert.equal(plan.fromVersion, '1.29');
      assert.equal(plan.toVersion, '1.31');
    }
    console.log('6. ENFORCED mode dispatch persists the validated plan (v1_8Plan) onto the task: PASS');

    // 7. SHADOW mode dispatch must NEVER write a v1_8Plan (byte-for-byte
    // unchanged wire/state contract when enforcement is off).
    {
      delete process.env.V1_8_SECURITY_ENFORCEMENT;
      const dispatcher: Wf6BatchDispatcher = { dispatch: async () => {} };
      const h2Task = seedTask({ id: 'h2-task', ruleOrCve: 'CVE-2022-45868', findingSnapshot: { component: 'com.h2database:h2', currentVersion: '2.1.212', fixedVersion: '2.2.220' } });
      const { service, rows } = makeService([h2Task], dispatcher);
      await service.launchBatchRemediation(PROJECT_ID, ['h2-task'], dev);
      assert.equal(rows[0].securityFindingRemediation.v1_8Plan, null, 'SHADOW mode must never persist a v1_8Plan');
      process.env.V1_8_SECURITY_ENFORCEMENT = 'ENFORCED';
    }
    console.log('7. SHADOW mode dispatch -> v1_8Plan stays null, unchanged contract: PASS');
  } finally {
    if (originalEnv === undefined) delete process.env.V1_8_SECURITY_ENFORCEMENT; else process.env.V1_8_SECURITY_ENFORCEMENT = originalEnv;
  }
}

run().then(() => console.log('manual-remediation.service.v1-8-enforcement.spec.ts: ALL CHECKS PASS')).catch(error => { console.error(error); process.exitCode = 1; });
