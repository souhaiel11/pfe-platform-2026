// V1.8 Phase 7D — the ONE narrow exception to launchBatchRemediation()'s
// pre-existing "incomplete data" rejection: a scanner-level missing
// fixedVersion (OWASP's own, long-standing real-data characteristic) is
// excused ONLY in ENFORCED mode, ONLY when canDispatchSecurityRemediationV1_8
// already independently proves an authoritative, exact, currently-valid
// plan exists -- reusing that SAME gate, never a second rule. Same
// hand-rolled fake-repo convention as manual-remediation.service.v1-8-
// enforcement.spec.ts, extended with a SYNTHETIC evidence-store fixture
// (V1_8CompatibilityDecisionService accepts a custom path) so each BLOCK
// reason can be exercised precisely, deterministically, never depending on
// real evidence happening to carry the right shape.
import { strict as assert } from 'assert';
import { join } from 'path';
import { ManualRemediationService, Wf6BatchDispatchPayload, Wf6BatchDispatcher } from './manual-remediation.service';
import { ManualRemediationStatus, ScannerFindingStatus } from './manual-remediation.entity';
import { V1_8CompatibilityDecisionService } from '../dependency-compatibility/v1_8-compatibility-decision.service';

const REAL_REPOSITORY = 'souhaiel11/pfe-app-test';
const REAL_COMMIT_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
const PROJECT_ID = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
const FIXTURE_PATH = join(__dirname, 'fixtures', 'v1_8-fixedversion-override-fixture.json');

function makeService(seedTasks: any[], dispatcher: Wf6BatchDispatcher, v1_8Decisions?: V1_8CompatibilityDecisionService) {
  const rows: any[] = seedTasks.map(t => ({ ...t }));
  const repo: any = {
    count: async () => rows.length,
    find: async ({ where }: any) => rows.filter(r => (where.id?.value ?? [r.id]).includes(r.id)),
    findOne: async ({ where }: any) => rows.find(r => r.id === where.id) || null,
    save: async (value: any) => { for (const v of (Array.isArray(value) ? value : [value])) { const i = rows.findIndex(r => r.id === v.id); if (i < 0) rows.push(v); else rows[i] = v; } return value; },
  };
  const incidents: any = { findOne: async ({ where }: any) => (where.id === 'incident-1' ? { id: 'incident-1', projectId: PROJECT_ID, metadata: { sourceCommitSha: REAL_COMMIT_SHA } } : null), find: async () => [] };
  const projects: any = { findOne: async ({ where }: any) => (where.id === PROJECT_ID ? { id: PROJECT_ID, githubRepo: REAL_REPOSITORY } : null) };
  return { service: new ManualRemediationService(repo, incidents, dispatcher, v1_8Decisions, projects), rows };
}

function seedTask(overrides: any = {}) {
  return {
    id: overrides.id || 'task-1', projectId: PROJECT_ID, incidentId: 'incident-1', findingId: 'x',
    findingFingerprint: overrides.id || 'fp-1', source: 'OWASP', ruleOrCve: 'CVE-2022-42003',
    title: 'jackson-databind parent-managed', severity: 'HIGH', remediationType: 'DEVELOPER_ACTION_REQUIRED',
    findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: null },
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
    const noop: Wf6BatchDispatcher = { dispatch: async () => {} };

    // 1. OWASP fixedVersion=null + complete, real VALIDATED_RECOMMENDED
    // PARENT_VERSION plan (real evidence store, real jackson-databind
    // CVE-2022-42003) -> ALLOW, dispatch proceeds.
    process.env.V1_8_SECURITY_ENFORCEMENT = 'ENFORCED';
    {
      const { service } = makeService([seedTask()], noop);
      const result = await service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev);
      assert.equal(result.status, 'DISPATCHING');
    }
    console.log('1. OWASP fixedVersion=null + complete VALIDATED_RECOMMENDED V1.8 plan -> ALLOW: PASS');

    // 2. OWASP fixedVersion=null + NO V1.8 evidence at all (unknown finding,
    // real service, a CVE that is genuinely not in the evidence store) ->
    // BLOCK (falls back to the original "incomplete data" rejection).
    {
      const { service } = makeService([seedTask({ ruleOrCve: 'CVE-9999-8888', findingSnapshot: { component: 'com.example:never-evaluated', currentVersion: '1.0.0', fixedVersion: null } })], noop);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /Donnée insuffisante/);
    }
    console.log('2. OWASP fixedVersion=null + no V1.8 evidence -> BLOCK (incomplete data): PASS');

    const fixtureDecisions = new V1_8CompatibilityDecisionService(FIXTURE_PATH);

    // 3. OWASP fixedVersion=null + SECURITY_TARGET_UNKNOWN -> BLOCK.
    {
      const task = seedTask({ ruleOrCve: 'CVE-9001-0001', findingSnapshot: { component: 'com.example:target-unknown', currentVersion: '1.0.0', fixedVersion: null } });
      const { service } = makeService([task], noop, fixtureDecisions);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /Donnée insuffisante/);
    }
    console.log('3. OWASP fixedVersion=null + SECURITY_TARGET_UNKNOWN -> BLOCK: PASS');

    // 4. OWASP fixedVersion=null + VALIDATION_FAILED -> BLOCK.
    {
      const task = seedTask({ ruleOrCve: 'CVE-9001-0002', findingSnapshot: { component: 'com.example:validation-failed', currentVersion: '1.0.0', fixedVersion: null } });
      const { service } = makeService([task], noop, fixtureDecisions);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /Donnée insuffisante/);
    }
    console.log('4. OWASP fixedVersion=null + VALIDATION_FAILED -> BLOCK: PASS');

    // 5. OWASP fixedVersion=null + STALE evidence (validated against a
    // DIFFERENT commit than the live task's own trusted sourceCommitSha)
    // -> BLOCK (the gate's own V1_8_EVIDENCE_STALE, never excused).
    {
      const task = seedTask({ ruleOrCve: 'CVE-9001-0005', findingSnapshot: { component: 'com.example:stale-commit', currentVersion: '1.0.0', fixedVersion: null } });
      const { service } = makeService([task], noop, fixtureDecisions);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /Donnée insuffisante/);
    }
    console.log('5. OWASP fixedVersion=null + stale evidence (commit mismatch) -> BLOCK: PASS');

    // 6. OWASP fixedVersion=null + VALIDATED_RECOMMENDED but plan.toVersion
    // missing -> BLOCK (gate's own RECOMMENDED_VERSION_MISSING/incomplete
    // plan, never excused, never guesses a target).
    {
      const task = seedTask({ ruleOrCve: 'CVE-9001-0003', findingSnapshot: { component: 'com.example:missing-toversion', currentVersion: '1.0.0', fixedVersion: null } });
      const { service } = makeService([task], noop, fixtureDecisions);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /Donnée insuffisante/);
    }
    console.log('6. OWASP fixedVersion=null + plan missing toVersion -> BLOCK: PASS');

    // 7. OWASP fixedVersion=null + VALIDATED_RECOMMENDED but editType is
    // NOT writer-supported (BOM_VERSION) -> BLOCK (gate's own
    // UNSUPPORTED_EDIT_TYPE, never excused).
    {
      const task = seedTask({ ruleOrCve: 'CVE-9001-0004', findingSnapshot: { component: 'com.example:unsupported-edittype', currentVersion: '1.0.0', fixedVersion: null } });
      const { service } = makeService([task], noop, fixtureDecisions);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /Donnée insuffisante/);
    }
    console.log('7. OWASP fixedVersion=null + unsupported edit type (BOM_VERSION) -> BLOCK: PASS');

    // 8. TRIVY existing valid flow (real fixedVersion present) -> entirely
    // unchanged: v1_8CompleteOverride is never even consulted because the
    // `continue` short-circuit fires on the very first check.
    {
      const task = seedTask({ source: 'TRIVY', ruleOrCve: 'CVE-2022-42003', findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: '2.13.5' } });
      const { service } = makeService([task], noop);
      const result = await service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev);
      assert.equal(result.status, 'DISPATCHING');
    }
    console.log('8. TRIVY existing valid flow (real fixedVersion present) -> unchanged: PASS');

    // 9. OWASP WITH scanner fixedVersion present -> existing supported
    // behavior unchanged (never routed through the override at all).
    {
      const task = seedTask({ findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: '2.13.5, 2.12.7.1' } });
      const { service } = makeService([task], noop);
      const result = await service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev);
      assert.equal(result.status, 'DISPATCHING');
    }
    console.log('9. OWASP with scanner fixedVersion present -> existing supported behavior unchanged: PASS');

    // 10. SHADOW mode -> legacy "incomplete data" behavior completely
    // unchanged, even for the exact same real VALIDATED_RECOMMENDED finding
    // that ALLOWs in test 1 -- the override is computed ONLY in ENFORCED
    // mode (v1_8CompleteOverride stays an empty Set).
    delete process.env.V1_8_SECURITY_ENFORCEMENT;
    {
      const { service } = makeService([seedTask()], noop);
      await assert.rejects(() => service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev), /Donnée insuffisante/,
        'SHADOW mode must reject exactly like before this phase, even though ENFORCED would ALLOW the identical finding');
    }
    console.log('10. SHADOW mode -> legacy incomplete-data rejection unchanged: PASS');

    // 11. ENFORCED mode -> the V1.8 target wins (dispatch proceeds and the
    // persisted plan is exactly the real validated parent plan, not a
    // guess) -- re-proven explicitly here, plus its own persisted-plan
    // content check (distinct from test 1's mere status check).
    process.env.V1_8_SECURITY_ENFORCEMENT = 'ENFORCED';
    {
      const { service, rows } = makeService([seedTask()], noop);
      await service.launchBatchRemediation(PROJECT_ID, ['task-1'], dev);
      const plan = rows[0].securityFindingRemediation?.v1_8Plan;
      assert.ok(plan, 'ENFORCED dispatch must persist the V1.8 plan');
      assert.equal(plan.editType, 'PARENT_VERSION');
      assert.equal(plan.actualEditTarget, 'org.springframework.boot:spring-boot-starter-parent');
      assert.equal(plan.fromVersion, '2.7.0');
      assert.equal(plan.toVersion, '2.7.18');
    }
    console.log('11. ENFORCED mode -> V1.8 target wins, persisted plan is the exact real parent plan: PASS');
  } finally {
    if (originalEnv === undefined) delete process.env.V1_8_SECURITY_ENFORCEMENT; else process.env.V1_8_SECURITY_ENFORCEMENT = originalEnv;
  }
}

run().then(() => console.log('manual-remediation.service.v1-8-fixedversion-override.spec.ts: ALL CHECKS PASS')).catch(error => { console.error(error); process.exitCode = 1; });
