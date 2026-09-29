// OWASP Increment 3 — integration test against REAL report #149 data (both
// scanner blocks: backend/src/common/fixtures/owasp-149-dependencies.json,
// 146 real findings, and fixtures/trivy-149-cves.json, 105 real findings,
// both pulled from this platform's own persisted incident
// a1cee307-dcca-49b4-a490-5d1fdfe55fb8, build 149, project
// 3aa1c9b9-e114-40e4-884b-ebc7aa32e002). Exercises ManualRemediationService.
// syncIncident() end-to-end (the actual write path WF6 will read from), not
// just the pure correlator. Covers §8 items 8/9/11/12 plus the real-data
// rerun requested by §9/§10 of the increment instructions.
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { ManualRemediationService } from './manual-remediation.service';
import { findingFingerprint } from './finding-fingerprint';

async function run() {
  const owaspFixture = JSON.parse(readFileSync(join(__dirname, '../common/fixtures/owasp-149-dependencies.json'), 'utf8'));
  const trivyFixture = JSON.parse(readFileSync(join(__dirname, '../common/fixtures/trivy-149-cves.json'), 'utf8'));
  const owaspFindings = owaspFixture.dependencies.flatMap((d: any) => d.vulnerabilities.map((v: any) => normalizeOwaspFinding(d, v)));
  const trivyFindings = trivyFixture.cves;
  assert.equal(owaspFindings.length, 146);
  assert.equal(trivyFindings.length, 105);

  const rows: any[] = [];
  const repo: any = {
    find: async ({ where }: any) => rows.filter(r => !where.source || r.source === where.source),
    create: (v: any) => ({ id: `task-${rows.length}`, ...v }),
    save: async (v: any) => { if (!rows.includes(v)) rows.push(v); return v; },
    update: async () => {},
  };
  const service = new ManualRemediationService(repo, {} as any, { dispatch: async () => { throw new Error('WF6 must never run in this offline replay'); } });
  const incident = {
    id: 'incident-149', projectId: 'project-149', buildNumber: 149,
    metadata: { enrichedData: {
      owasp: { status: 'COMPLETED', completed: true, resultAvailable: true, cves: owaspFindings },
      trivy: { status: 'COMPLETED', completed: true, resultAvailable: true, cves: trivyFindings },
      zap: { status: 'NOT_RUN', alerts: [] },
    } },
  } as any;

  await service.syncIncident(incident);

  const owaspTasks = rows.filter(r => r.source === 'OWASP');
  const trivyTasks = rows.filter(r => r.source === 'TRIVY');
  assert.equal(owaspTasks.length, 146);
  assert.equal(trivyTasks.length, 105);

  // Reproduce the increment's own report #9/#10 numbers from this replay.
  let enriched = 0, nativeNonEmpty = 0;
  const perDependency = new Map<string, { cveCount: number; exactMatch: number; uniqueTargets: Set<string>; ambiguous: number }>();
  for (const task of owaspTasks) {
    const snap = task.findingSnapshot;
    if (snap.fixedVersionSource === 'TRIVY_CORRELATED') enriched++;
    if (snap.fixedVersion && snap.fixedVersionSource !== 'TRIVY_CORRELATED') nativeNonEmpty++;
  }
  assert.equal(nativeNonEmpty, 0, 'OWASP native fixedVersion is unconditionally null in this real report (grounded fact)');
  assert.equal(enriched, 13, 'exactly 13/146 OWASP findings in report #149 have a single, unambiguous, exact-syntax Trivy target version');
  const selectable = owaspTasks.filter(t => t.findingSnapshot.fixedVersion && t.findingSnapshot.currentVersion && /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(String(t.findingSnapshot.component || ''))).length;
  assert.equal(selectable, 13);

  // 12. candidate payload contract: an enriched, selectable OWASP finding
  // carries everything WF6/SecurityFindingResolverService needs (pkg/purl/
  // installedVersion/fixedVersion/ruleOrCve) -- structurally, without
  // dispatching WF6.
  const enrichedTask = owaspTasks.find(t => t.findingSnapshot.fixedVersionSource === 'TRIVY_CORRELATED')!;
  assert.ok(enrichedTask, 'at least one enriched OWASP task must exist in this real replay');
  const s = enrichedTask.findingSnapshot;
  assert.ok(s.pkg && /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(s.pkg), 'pkg (groupId:artifactId) present');
  assert.ok(s.purl, 'purl present');
  assert.ok(s.currentVersion, 'installedVersion present');
  assert.ok(s.fixedVersion, 'fixedVersion present');
  assert.ok(enrichedTask.ruleOrCve, 'CVE present');
  assert.equal(s.fixedVersionEvidence.source, 'TRIVY');
  assert.equal(s.fixedVersionEvidence.match, 'CVE_MAVEN_INSTALLED_VERSION');
  // Exactly the same predicate launchBatchRemediation() itself uses to reject
  // an incomplete finding before ever dispatching WF6 (manual-remediation.
  // service.ts's own `incomplete` filter) -- replayed here, never dispatched.
  const incompleteForWf6 = (t: any) => !t.source || !t.ruleOrCve || !t.findingSnapshot?.component || !t.findingSnapshot?.currentVersion || !t.findingSnapshot?.fixedVersion;
  assert.equal(incompleteForWf6(enrichedTask), false, '12. an enriched OWASP finding now clears launchBatchRemediation\'s own completeness gate');
  const unenrichedOwasp = owaspTasks.find((t: any) => t.findingSnapshot.fixedVersionSource !== 'TRIVY_CORRELATED' && !t.findingSnapshot.fixedVersion);
  assert.ok(unenrichedOwasp);
  assert.equal(incompleteForWf6(unenrichedOwasp), true, 'an unenriched OWASP finding still fails closed, exactly as before this increment');
  console.log('12. OWASP_WF6_INPUT_CONTRACT structural check on an enriched finding: PASS');

  // A finding whose Trivy match is a comma-joined multi-candidate string
  // (real case: CVE-2024-22259 on org.springframework:spring-web@5.3.20 ->
  // Trivy FixedVersion "6.1.5, 6.0.18, 5.3.33") must stay unenriched, never
  // guessing "the first" version.
  const springWebMulti = owaspTasks.find((t: any) => t.ruleOrCve === 'CVE-2024-22259' && t.findingSnapshot.pkg === 'org.springframework:spring-web' && t.findingSnapshot.currentVersion === '5.3.20');
  assert.ok(springWebMulti, 'real report #149 must contain this exact-match, multi-candidate case');
  assert.notEqual(springWebMulti.findingSnapshot.fixedVersionSource, 'TRIVY_CORRELATED', 'multi-candidate Trivy evidence must never enrich, and never guesses "the first" (6.1.5)');
  assert.equal(springWebMulti.findingSnapshot.fixedVersion, null);
  console.log('UNSUPPORTED_FORMAT real-data case (CVE-2024-22259/spring-web, comma-joined Trivy targets) stays unenriched: PASS');

  // 9. findingTaskId identity survives correlation -- re-sync must NOT
  // create new rows nor change ids (same discipline as owasp-enrichment.spec.ts).
  const idsBefore = owaspTasks.map(t => t.id);
  const snapshotsBefore = owaspTasks.map(t => JSON.stringify(t.findingSnapshot));
  await service.syncIncident(incident);
  assert.equal(rows.filter(r => r.source === 'OWASP').length, 146, 'no duplicate OWASP tasks created on re-sync');
  assert.deepEqual(rows.filter(r => r.source === 'OWASP').map(t => t.id), idsBefore, '9. findingTaskId (task id) unchanged across a re-sync');
  assert.deepEqual(rows.filter(r => r.source === 'OWASP').map(t => JSON.stringify(t.findingSnapshot)), snapshotsBefore, 'a stable correlation result does not churn on re-sync');
  console.log('9. findingTaskId preserved across re-sync: PASS');

  // 8. OWASP and Trivy tasks remain fully distinct rows -- correlation only
  // shares evidence, never merges identity.
  const owaspFingerprints = new Set(rows.filter(r => r.source === 'OWASP').map(r => r.findingFingerprint));
  const trivyFingerprints = new Set(rows.filter(r => r.source === 'TRIVY').map(r => r.findingFingerprint));
  assert.equal([...owaspFingerprints].filter(fp => trivyFingerprints.has(fp)).length, 0, '8. OWASP and Trivy tasks never share a findingFingerprint / never get merged');
  assert.equal(rows.length, 146 + 105);
  console.log('8. OWASP and Trivy remain independent findings/tasks: PASS');

  // 11. Trivy's own snapshot resolution is completely untouched by this
  // increment: still exactly the native FixedVersion string, no
  // fixedVersionSource/evidence ever attached.
  for (const t of rows.filter(r => r.source === 'TRIVY')) {
    assert.equal(t.findingSnapshot.fixedVersionSource, null);
    assert.equal(t.findingSnapshot.fixedVersionEvidence, null);
  }
  const logback = trivyFindings.find((c: any) => c.id === 'CVE-2023-6378');
  const logbackTask = rows.find((t: any) => t.source === 'TRIVY' && t.findingFingerprint === findingFingerprint('TRIVY', logback));
  assert.equal(logbackTask.findingSnapshot.fixedVersion, '1.3.12, 1.4.12, 1.2.13', '11. Trivy behavior unchanged: raw multi-value string preserved verbatim');
  console.log('11. Trivy snapshot resolution unchanged (raw FixedVersion preserved, no provenance fields): PASS');

  console.log('owasp-trivy-fixed-version-correlation.integration.spec.ts: ALL CHECKS PASS (report #149 real data)');
}

run().catch(e => { console.error(e); process.exitCode = 1; });
