import { strict as assert } from 'assert';
import { ManualRemediationService } from './manual-remediation.service';
import { ManualRemediationStatus, ScannerFindingStatus } from './manual-remediation.entity';
import { findingFingerprint } from './finding-fingerprint';

async function run() {
  const rows: any[] = [];
  const repo: any = {
    count: async ({ where }: any) => rows.filter(r => r.projectId === where.projectId).length,
    find: async ({ where }: any) => rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)),
    findOne: async ({ where }: any) => rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null,
    create: (value: any) => ({ id: `task-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...value }),
    save: async (value: any) => { const index = rows.findIndex(r => r.id === value.id); if (index < 0) rows.push(value); else rows[index] = value; return value; },
    update: async (where: any, patch: any) => { rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)).forEach(r => Object.assign(r, patch)); },
  };
  const incidents: any = { find: async () => [], findOne: async () => null };
  const service = new ManualRemediationService(repo, incidents);
  const cve = { id: 'CVE-2026-0001', pkg: 'example-lib', severity: 'CRITICAL', title: 'Example', remediationType: 'DEVELOPER_ACTION_REQUIRED' };
  const incident = (build: number, findings: any[], status = 'COMPLETED', resultAvailable = true) => ({ id: `incident-${build}`, projectId: 'project-1', buildNumber: build, metadata: { enrichedData: { trivy: { status, completed: status === 'COMPLETED', resultAvailable, cves: findings, cves_count: findings.length, critical: findings.length, high: 0 }, owasp: { status: 'NOT_RUN', cves: [], cves_count: 0 }, zap: { status: 'NOT_RUN', alerts: [], alerts_count: 0 }, sonar: { status: 'NOT_RUN', issues: [] } } } } as any);

  assert.equal(findingFingerprint('TRIVY', cve), findingFingerprint('TRIVY', { ...cve, severity: 'HIGH', installedVersion: '9.9' }));
  await service.syncIncident(incident(137, [cve]));
  await service.syncIncident(incident(137, [cve]));
  assert.equal(rows.length, 1, 'duplicate page/report processing must not duplicate a task');
  await service.complete(rows[0].id, { id: 'dev-1', email: 'dev@example.test', role: 'developer' }, 'Dependency upgraded');
  assert.equal(rows[0].status, ManualRemediationStatus.DONE_BY_USER);
  assert.equal(rows[0].completionNote, 'Dependency upgraded');
  await service.syncIncident(incident(138, [cve]));
  assert.equal(rows[0].status, ManualRemediationStatus.DONE_BY_USER);
  assert.equal(rows[0].scannerStatus, ScannerFindingStatus.STILL_DETECTED);
  await service.syncIncident(incident(139, [], 'NOT_RUN', false));
  assert.equal(rows[0].status, ManualRemediationStatus.DONE_BY_USER, 'unavailable scanner must fail closed');
  assert.equal(rows[0].scannerStatus, ScannerFindingStatus.UNAVAILABLE);
  await service.syncIncident(incident(140, []));
  assert.equal(rows[0].status, ManualRemediationStatus.VERIFIED);
  assert.equal(rows[0].verifiedBuild, 140);
  await service.reopen(rows[0].id, { id: 'admin-1', role: 'admin' });
  assert.equal(rows[0].status, ManualRemediationStatus.REOPENED);
  await assert.rejects(() => service.complete(rows[0].id, { id: 'viewer-1', role: 'viewer' }), /Action non autorisée/);
  assert.ok(rows[0].events.length >= 4, 'audit events must retain every transition');
}

run().then(() => console.log('manual-remediation-service: PASS')).catch(error => { console.error(error); process.exitCode = 1; });
