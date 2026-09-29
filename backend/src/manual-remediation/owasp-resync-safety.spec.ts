// OWASP backend resync safety — makes a normal syncIncident()/reconcileSource()
// /snapshot() cycle preserve/build the correct normalized Maven identity
// (component/legacyPackage/purl/installedVersion/groupId/artifactId) instead
// of regressing it to the raw jar-filename shape on every sync, while never
// erasing WF6/human remediation state. See manual-remediation.service.ts's
// own resolveOwaspIdentity() header for why a resync can never independently
// RE-DERIVE a Maven identity (the raw finding reaching this method has
// already lost dependency.packages[] upstream) and must instead preserve an
// already-validated one.
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { ManualRemediationService } from './manual-remediation.service';
import { findingFingerprint } from './finding-fingerprint';

function makeService(rows: any[]) {
  const repo: any = {
    find: async ({ where }: any) => rows.filter(r => !where.source || r.source === where.source),
    create: (v: any) => { const t = { id: `new-${rows.length}-${Math.random().toString(36).slice(2, 8)}`, ...v }; return t; },
    save: async (v: any) => { if (!rows.includes(v)) rows.push(v); return v; },
    update: async () => {},
  };
  return new ManualRemediationService(repo, {} as any, { dispatch: async () => { throw new Error('WF6 must never run in this offline simulation'); } });
}
function incidentFor(owaspCves: any[], trivyCves: any[] = []) {
  return {
    id: 'incident-149', projectId: 'project-149', buildNumber: 149,
    metadata: { enrichedData: {
      owasp: { status: 'COMPLETED', completed: true, resultAvailable: true, cves: owaspCves },
      trivy: { status: 'COMPLETED', completed: true, resultAvailable: true, cves: trivyCves },
      zap: { status: 'NOT_RUN', alerts: [] },
    } },
  } as any;
}

async function run() {
  const depFixture = JSON.parse(readFileSync(join(__dirname, '../common/fixtures/owasp-149-dependencies.json'), 'utf8'));
  const snakeDep = depFixture.dependencies.find((d: any) => d.fileName === 'snakeyaml-1.29.jar');
  const snakeVuln = snakeDep.vulnerabilities.find((v: any) => v.name === 'CVE-2022-25857');
  const freshFinding = normalizeOwaspFinding(snakeDep, snakeVuln);
  assert.equal(freshFinding.packageType, 'maven', 'fixture sanity: this finding must resolve a Maven identity');

  // 1-4. fresh OWASP finding -- normalized component/legacyPackage/purl/installedVersion
  {
    const rows: any[] = [];
    const service = makeService(rows);
    await service.syncIncident(incidentFor([freshFinding]));
    assert.equal(rows.length, 1);
    const s = rows[0].findingSnapshot;
    assert.equal(s.component, 'org.yaml:snakeyaml', '1. fresh finding creates normalized Maven component');
    assert.equal(s.legacyPackage, 'snakeyaml-1.29.jar', '2. fresh finding keeps raw legacyPackage');
    assert.equal(s.purl, 'pkg:maven/org.yaml/snakeyaml@1.29', '3. PURL stored');
    assert.equal(s.installedVersion, '1.29', '4. installedVersion stored');
    assert.equal(s.currentVersion, '1.29');
  }
  console.log('1-4. fresh OWASP finding -> normalized component/legacyPackage/purl/installedVersion: PASS');

  // 5. repeat sync is idempotent (same task id, no duplicate)
  {
    const rows: any[] = [];
    const service = makeService(rows);
    await service.syncIncident(incidentFor([freshFinding]));
    const idAfterFirst = rows[0].id;
    await service.syncIncident(incidentFor([freshFinding]));
    assert.equal(rows.length, 1, '5. repeat sync must not create a duplicate task');
    assert.equal(rows[0].id, idAfterFirst, '5. repeat sync must keep the same task id');
  }
  console.log('5. repeat sync is idempotent: PASS');

  // Real raw shape (matches incident.metadata.enrichedData.owasp.cves[]
  // exactly): jar-filename pkg, no .packages[], no packageType/purl. This --
  // never a self-declared-Maven finding -- is what EVERY real sync actually
  // sees, and it's what the task's own NATIVE findingFingerprint is always
  // built from in production (verified against the real persisted task for
  // CVE-2022-25857 in the prior live-data validation).
  const rawFlattened = { id: 'CVE-2022-25857', cve: 'CVE-2022-25857', pkg: 'snakeyaml-1.29.jar', package: 'snakeyaml-1.29.jar', dependency: 'snakeyaml-1.29.jar', file: 'snakeyaml-1.29.jar', fileName: 'snakeyaml-1.29.jar', installedVersion: null, fixedVersion: null, severity: 'HIGH', source: 'OWASP' };

  // 6-7. repeat sync with the REAL raw (flattened, jar-filename, no .packages[])
  // shape does not regress a Maven identity that was already validated for
  // this SAME finding by an earlier means (e.g. the one-off backfill this
  // real project actually went through) -- never re-derivable from this raw
  // shape alone, so it must be preserved, not regressed.
  {
    const rows: any[] = [];
    const service = makeService(rows);
    await service.syncIncident(incidentFor([rawFlattened]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].findingSnapshot.component, 'snakeyaml-1.29.jar', 'sanity: raw-only evidence alone never invents a Maven coordinate');
    // Simulate the already-validated enrichment this task really carries in
    // production (see manual-remediation.service.ts's resolveOwaspIdentity()
    // header for why the live pipeline can never reproduce this on its own).
    rows[0].findingSnapshot = { ...rows[0].findingSnapshot, component: 'org.yaml:snakeyaml', pkg: 'org.yaml:snakeyaml', purl: 'pkg:maven/org.yaml/snakeyaml@1.29', packageType: 'maven', groupId: 'org.yaml', artifactId: 'snakeyaml', installedVersion: '1.29', legacyPackage: 'snakeyaml-1.29.jar' };
    await service.syncIncident(incidentFor([rawFlattened]));
    assert.equal(rows.length, 1, 'still the same single task, matched via its own native (jar-filename) fingerprint');
    const s = rows[0].findingSnapshot;
    assert.equal(s.component, 'org.yaml:snakeyaml', '6. repeat sync with raw-only evidence does not regress an already-validated component');
    assert.equal(s.legacyPackage, 'snakeyaml-1.29.jar', '7. repeat sync does not clear legacyPackage');
    assert.equal(s.installedVersion, '1.29', 'installedVersion also preserved, not reset to null');
    assert.equal(s.purl, 'pkg:maven/org.yaml/snakeyaml@1.29', 'purl also preserved');
  }
  console.log('6-7. repeat sync with real raw (jar-filename, no packages[]) evidence does not regress an already-validated component/legacyPackage: PASS');

  // 8-10. existing CLOSED / PR / attempts survive a normal resync
  {
    const rows: any[] = [];
    const service = makeService(rows);
    await service.syncIncident(incidentFor([rawFlattened]));
    const task = rows[0];
    task.findingSnapshot = { ...task.findingSnapshot, component: 'org.yaml:snakeyaml', pkg: 'org.yaml:snakeyaml', purl: 'pkg:maven/org.yaml/snakeyaml@1.29', packageType: 'maven', groupId: 'org.yaml', artifactId: 'snakeyaml', installedVersion: '1.29', legacyPackage: 'snakeyaml-1.29.jar' };
    task.securityFindingRemediation = { status: 'CLOSED', reason: 'TARGET_CVE_CLOSED', prNumber: 40, prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/40', attempts: [{ attempt: 1, status: 'DISPATCHING' }, { attempt: 2, status: 'CLOSED', prNumber: 40 }] };
    await service.syncIncident(incidentFor([rawFlattened]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].securityFindingRemediation.status, 'CLOSED', '8. existing CLOSED state preserved');
    assert.equal(rows[0].securityFindingRemediation.prNumber, 40, '9. existing PR preserved');
    assert.equal(rows[0].securityFindingRemediation.prUrl, 'https://github.com/souhaiel11/pfe-app-test/pull/40');
    assert.equal(rows[0].securityFindingRemediation.attempts.length, 2, '10. existing attempts preserved');
    assert.equal(rows[0].findingSnapshot.component, 'org.yaml:snakeyaml', 'Maven identity also preserved alongside remediation state');
  }
  console.log('8-10. existing CLOSED state / PR / attempts survive a normal resync: PASS');

  // 14. Trivy path completely unchanged by this OWASP-only fix.
  {
    const rows: any[] = [];
    const service = makeService(rows);
    const trivyFinding = { id: 'CVE-2023-6378', VulnerabilityID: 'CVE-2023-6378', PkgName: 'ch.qos.logback:logback-classic', InstalledVersion: '1.2.11', FixedVersion: '1.2.13, 1.3.12, 1.4.12', source: 'TRIVY', severity: 'HIGH' };
    await service.syncIncident(incidentFor([], [trivyFinding]));
    const trivyTasks = rows.filter(r => r.source === 'TRIVY');
    assert.equal(trivyTasks.length, 1);
    assert.equal(trivyTasks[0].findingSnapshot.component, 'ch.qos.logback:logback-classic');
    assert.equal(trivyTasks[0].findingSnapshot.currentVersion, '1.2.11');
    assert.equal(trivyTasks[0].findingSnapshot.fixedVersion, '1.2.13, 1.3.12, 1.4.12');
    assert.equal(trivyTasks[0].findingSnapshot.fixedVersionSource, null, 'Trivy never gets an OWASP-only provenance field');
    assert.equal(trivyTasks[0].findingSnapshot.legacyPackage, undefined, 'legacyPackage is an OWASP-only concept');
  }
  console.log('14. Trivy path unchanged: PASS');

  // 11-13, 15-16. Full report #149 live-data simulation: real 146 raw OWASP
  // rows (jar-filename pkg, exactly incident.metadata.enrichedData.owasp.cves'
  // real shape, read read-only from Postgres) + real 155 existing tasks
  // (their real, currently-persisted rich snapshots) + real Trivy evidence.
  {
    const liveCves = JSON.parse(readFileSync(join(__dirname, '../common/fixtures/owasp-149-live-cves.json'), 'utf8')).cves;
    const liveTasks = JSON.parse(readFileSync(join(__dirname, '../common/fixtures/owasp-149-live-tasks.json'), 'utf8')).tasks;
    const trivyFixture = JSON.parse(readFileSync(join(__dirname, '../common/fixtures/trivy-149-cves.json'), 'utf8'));
    assert.equal(liveCves.length, 146);

    // Rehydrate the real rows into the shape reconcileSource() expects from
    // a TypeORM repo.find() result (id/source/findingFingerprint/status/
    // findingSnapshot/securityFindingRemediation -- exactly what's real).
    const rows: any[] = liveTasks.map((t: any) => ({
      id: t.id, projectId: t.projectId, incidentId: t.incidentId, source: t.source,
      findingFingerprint: t.findingFingerprint, ruleOrCve: t.ruleOrCve, status: t.status,
      scannerStatus: t.scannerStatus, findingSnapshot: t.findingSnapshot,
      securityFindingRemediation: t.securityFindingRemediation, events: [],
    }));
    const tasksBefore = rows.length;
    const closedBefore = rows.find((r: any) => r.findingSnapshot?.ruleOrCve === 'CVE-2022-25857');
    assert.equal(closedBefore.securityFindingRemediation.status, 'CLOSED', 'fixture sanity: snakeyaml task is really CLOSED before simulation');
    assert.equal(closedBefore.securityFindingRemediation.prNumber, 40);

    const service = makeService(rows);
    await service.syncIncident(incidentFor(liveCves, trivyFixture.cves));

    const owaspRows = rows.filter((r: any) => r.source === 'OWASP');
    const mavenIdentityResolved = owaspRows.filter((r: any) => /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(String(r.findingSnapshot?.component || ''))).length;
    const legacyPackagePreserved = owaspRows.filter((r: any) => !!r.findingSnapshot?.legacyPackage).length;
    const installedVersionResolved = owaspRows.filter((r: any) => !!r.findingSnapshot?.installedVersion).length;
    console.log('MAVEN_IDENTITY_RESOLVED:', mavenIdentityResolved, '/', owaspRows.length);
    console.log('LEGACY_PACKAGE_PRESERVED:', legacyPackagePreserved, '/', owaspRows.length);
    console.log('INSTALLED_VERSION_RESOLVED:', installedVersionResolved, '/', owaspRows.length);
    assert.equal(mavenIdentityResolved, 146, 'MAVEN_IDENTITY_RESOLVED must be 146/146');
    assert.equal(legacyPackagePreserved, 146, 'LEGACY_PACKAGE_PRESERVED must be 146/146');
    assert.equal(installedVersionResolved, 146, 'INSTALLED_VERSION_RESOLVED must be 146/146');

    const matched146 = owaspRows.filter((r: any) => liveCves.some((c: any) => c.cve === r.findingSnapshot?.ruleOrCve && c.pkg === r.findingSnapshot?.legacyPackage));
    assert.equal(matched146.length, 146, 'exactly the 146 real report #149 findings must be represented');

    const withTarget = matched146.filter((r: any) => r.findingSnapshot?.fixedVersion);
    const multipleCandidates = matched146.filter((r: any) => !r.findingSnapshot?.fixedVersion && r.findingSnapshot?.fixedVersionUnavailableReason === 'MULTIPLE_CANDIDATES');
    const noTrivyMatch = matched146.filter((r: any) => !r.findingSnapshot?.fixedVersion && r.findingSnapshot?.fixedVersionUnavailableReason === 'NO_TRIVY_MATCH');
    console.log('FIXED_VERSION_RESOLVED:', withTarget.length, '/ 146');
    console.log('MULTIPLE_CANDIDATES:', multipleCandidates.length);
    console.log('NO_TRIVY_MATCH:', noTrivyMatch.length);
    assert.equal(withTarget.length, 13, '13. target-bearing findings keep/get fixedVersion');
    assert.equal(multipleCandidates.length, 44, '11. 44 multiple targets get MULTIPLE_CANDIDATES');
    assert.equal(noTrivyMatch.length, 89, '12. 89 unmatched get NO_TRIVY_MATCH');
    assert.equal(withTarget.length + multipleCandidates.length + noTrivyMatch.length, 146, 'every OWASP finding classified exactly once');

    const closedAfter = rows.find((r: any) => r.findingSnapshot?.ruleOrCve === 'CVE-2022-25857');
    assert.equal(closedAfter.securityFindingRemediation.status, 'CLOSED', 'CLOSED preserved through the full 146-row simulation');
    assert.equal(closedAfter.securityFindingRemediation.prNumber, 40, 'PR #40 preserved through the full 146-row simulation');
    assert.equal(closedAfter.findingSnapshot.component, 'org.yaml:snakeyaml');
    assert.equal(closedAfter.findingSnapshot.fixedVersion, '1.31');
    assert.equal(closedAfter.findingSnapshot.fixedVersionSource, 'TRIVY_CORRELATED');

    // 15. no duplicate tasks: same task ids in the same OWASP-source rows.
    // (rows.length also grows by the fresh Trivy tasks this same sync
    // legitimately creates from trivyFixture.cves -- no Trivy tasks were
    // seeded, so that growth is correct and orthogonal to this OWASP check.)
    const owaspTasksAfterFirst = rows.filter((r: any) => r.source === 'OWASP').length;
    const idsAfter = rows.filter((r: any) => r.source === 'OWASP').map((r: any) => r.id).sort();
    const idsBefore = liveTasks.filter((t: any) => t.source === 'OWASP').map((t: any) => t.id).sort();
    assert.deepEqual(idsAfter, idsBefore, '15. no duplicate OWASP tasks created, same 155 task ids throughout');
    console.log('TASKS_BEFORE:', tasksBefore, 'TASKS_AFTER (OWASP):', owaspTasksAfterFirst, 'TASK_IDS_PRESERVED:', idsAfter.length + '/' + idsBefore.length, 'DUPLICATES_CREATED: 0');

    // Re-run once more: idempotent under the real 146/155-row shape too.
    const owaspSnapshotsBefore = rows.filter((r: any) => r.source === 'OWASP').map((r: any) => JSON.stringify(r.findingSnapshot));
    const totalRowsBeforeSecondSync = rows.length;
    await service.syncIncident(incidentFor(liveCves, trivyFixture.cves));
    assert.equal(rows.length, totalRowsBeforeSecondSync, '16. second simulated resync creates no duplicates (OWASP or Trivy)');
    assert.equal(rows.filter((r: any) => r.source === 'OWASP').length, owaspTasksAfterFirst, '16. OWASP task count stable across a second resync');
    const owaspSnapshotsAfter = rows.filter((r: any) => r.source === 'OWASP').map((r: any) => JSON.stringify(r.findingSnapshot));
    assert.deepEqual(owaspSnapshotsAfter, owaspSnapshotsBefore, '16. a stable resync does not churn OWASP snapshots');
  }
  console.log('11-13,15-16. report #149 full 146/146 live-data resync simulation: PASS');

  console.log('owasp-resync-safety.spec.ts: ALL CHECKS PASS');
}

run().catch(e => { console.error(e); process.exitCode = 1; });
