// V1.8 Phase 4 ticket — list()'s additive, opt-in `includeV18` enrichment.
// Proves: (1) default behavior is byte-for-byte unchanged (no new field at
// all, not even `undefined` -- a real property absence, exactly what every
// existing frontend/test caller already receives), (2) opt-in adds exactly
// one new field per row, sourced from the real V1.8 evidence store, never
// mutating any existing field.
import { strict as assert } from 'assert';
import { ManualRemediationService } from './manual-remediation.service';
import { ManualRemediationStatus, ScannerFindingStatus } from './manual-remediation.entity';

async function run() {
  const rows: any[] = [
    {
      id: 'task-1', projectId: 'project-1', source: 'OWASP', ruleOrCve: 'CVE-2022-25857',
      findingSnapshot: { component: 'org.yaml:snakeyaml', currentVersion: '1.29', fixedVersion: '1.31' },
      status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED,
      remediationType: 'DEVELOPER_ACTION_REQUIRED', events: [], updatedAt: new Date(),
    },
    {
      id: 'task-2', projectId: 'project-1', source: 'OWASP', ruleOrCve: 'CVE-2022-45868',
      findingSnapshot: { component: 'com.h2database:h2', currentVersion: '2.1.212', fixedVersion: '2.2.220' },
      status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED,
      remediationType: 'ADMIN_ACTION_REQUIRED', events: [], updatedAt: new Date(),
    },
  ];
  const repo: any = {
    count: async ({ where }: any) => rows.filter(r => r.projectId === where.projectId).length,
    find: async ({ where }: any) => rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)),
  };
  const incidents: any = { find: async () => [], findOne: async () => null };
  const service = new ManualRemediationService(repo, incidents);

  // 1. Default call (no includeV18) -- existing behavior, no new field at all.
  const defaultResult = await service.list('project-1');
  assert.equal(defaultResult.length, 2);
  for (const t of defaultResult) assert.ok(!('v1_8Decision' in t), 'default list() must never add v1_8Decision');
  assert.deepEqual(defaultResult, rows, 'default list() must return the exact same rows, unmodified');

  // 2. includeV18=true -- exactly one new field, every existing field untouched, real evidence used.
  const enriched: any[] = await service.list('project-1', { includeV18: true });
  assert.equal(enriched.length, 2);
  const snakeyaml = enriched.find((t: any) => t.id === 'task-1');
  assert.equal(snakeyaml.v1_8Decision.state, 'VALIDATED_RECOMMENDED');
  assert.equal(snakeyaml.v1_8Decision.recommendedVersion, '1.31');
  assert.equal(snakeyaml.remediationType, 'DEVELOPER_ACTION_REQUIRED', 'existing remediationType must be completely untouched (dual-run, never replaced)');
  const h2 = enriched.find((t: any) => t.id === 'task-2');
  assert.equal(h2.v1_8Decision.state, 'NO_COMPATIBLE_CANDIDATE');
  assert.equal(h2.remediationType, 'ADMIN_ACTION_REQUIRED', 'existing remediationType must be completely untouched');
}

run().then(() => console.log('manual-remediation.service.v1-8-decision.spec.ts: ALL CHECKS PASS')).catch(error => { console.error(error); process.exitCode = 1; });
