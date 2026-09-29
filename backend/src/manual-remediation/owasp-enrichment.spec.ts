import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { ManualRemediationService } from './manual-remediation.service';
import { findingFingerprint } from './finding-fingerprint';

async function run() {
  const fixture = JSON.parse(readFileSync(join(__dirname, '../common/fixtures/owasp-149-dependencies.json'), 'utf8'));
  const findings = fixture.dependencies.flatMap((d: any) => d.vulnerabilities.map((v: any) => normalizeOwaspFinding(d, v)));
  const legacy = findings.map((f: any) => ({ ...f, pkg: f.legacyPackage, package: f.legacyPackage, packageType: null, purl: null, installedVersion: null }));
  const rows: any[] = legacy.map((f: any, i: number) => ({ id: `existing-${i}`, projectId: 'project', source: 'OWASP', findingFingerprint: findingFingerprint('OWASP', f), status: 'TODO', scannerStatus: 'DETECTED', events: [], findingSnapshot: { source: 'OWASP', component: f.pkg, ruleOrCve: f.id, fixedVersion: null, currentVersion: null }, securityFindingRemediation: i === 0 ? { status: 'CLOSED', prNumber: 41 } : null }));
  const initialIds = rows.map(r => r.id);
  const initialFingerprints = rows.map(r => r.findingFingerprint);
  const repo: any = {
    find: async ({ where }: any) => rows.filter(r => !where.source || r.source === where.source),
    create: (v: any) => ({ id: `new-${rows.length}`, ...v }),
    save: async (v: any) => { if (!rows.includes(v)) rows.push(v); return v; },
    update: async () => {},
  };
  const service = new ManualRemediationService(repo, {} as any, { dispatch: async () => { throw new Error('WF6 must never run'); } });
  const incident = (cves: any[]) => ({ id: 'incident', projectId: 'project', buildNumber: 149, metadata: { enrichedData: { owasp: { status: 'COMPLETED', completed: true, resultAvailable: true, cves }, trivy: { status: 'NOT_RUN', cves: [] }, zap: { status: 'NOT_RUN', alerts: [] } } } } as any);
  await service.syncIncident(incident(findings));
  await service.syncIncident(incident(findings));
  assert.equal(rows.length, 146);
  assert.deepEqual(rows.map(r => r.id), initialIds);
  assert.deepEqual(rows.map(r => r.findingFingerprint), initialFingerprints);
  assert.deepEqual(rows[0].securityFindingRemediation, { status: 'CLOSED', prNumber: 41 });
  assert.ok(rows.every(r => r.status === 'TODO'));
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i].findingSnapshot, f = findings[i];
    assert.equal(s.source, 'OWASP'); assert.equal(s.pkg, f.pkg);
    assert.equal(s.component, f.pkg); assert.equal(s.purl, f.purl);
    assert.equal(s.installedVersion, f.installedVersion); assert.equal(s.currentVersion, f.installedVersion);
    assert.equal(s.fixedVersion, null); assert.equal(s.ruleOrCve, f.id);
  }
  for (const forms of [findings, legacy]) {
    const tagged = await service.attachFindingTaskIds([incident(forms)]);
    assert.deepEqual(tagged[0].metadata.enrichedData.owasp.cves.map((f: any) => f.findingTaskId), initialIds);
  }
  // A new installed version still locates the same task through its canonical alias.
  const upgraded = findings.map((f: any) => ({ ...f, legacyPackage: f.legacyPackage.replace('.jar', '-next.jar'), installedVersion: '9.0', purl: f.purl.replace(/@[^@]+$/, '@9.0') }));
  await service.syncIncident(incident(upgraded));
  assert.equal(rows.length, 146); assert.deepEqual(rows.map(r => r.id), initialIds);
  // Two canonical packages competing for one legacy task must fail before writes.
  const before = JSON.stringify(rows);
  await assert.rejects(() => service.syncIncident(incident([findings[0], { ...findings[0], pkg: 'another:artifact' }])), /ambiguë/);
  assert.equal(JSON.stringify(rows), before);
  // Do not silently merge two historical version-specific tasks into one ID.
  const extra = { ...rows[0], id: 'another-historical-task', findingFingerprint: findingFingerprint('OWASP', { id: findings[0].id, pkg: 'old-other.jar' }), findingSnapshot: { source: 'OWASP', component: 'old-other.jar', ruleOrCve: findings[0].id } };
  rows.push(extra);
  await assert.rejects(() => service.syncIncident(incident([findings[0], { ...findings[0], legacyPackage: 'old-other.jar' }])), /ambiguë/);
  console.log('OWASP task snapshots: PASS (146 IDs/fingerprints retained, repeated sync, aliases, upgrade, ambiguity, WF6 status retained)');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
