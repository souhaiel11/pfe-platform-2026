// Increment 1 (sélection multiple CVE) -- offline contract tests for
// withFindingTaskIds(). No TypeORM, no database: the lookup is a plain
// function so this proves the PURE merge logic in isolation (the I/O half,
// batching the real DB query, is proven separately in
// manual-remediation.service.finding-task-ids.spec.ts).
//
// Run: npx ts-node backend/src/manual-remediation/finding-task-id-enrichment.spec.ts
import * as assert from 'node:assert/strict';
import { withFindingTaskIds } from './finding-task-id-enrichment';
import { findingFingerprint } from './finding-fingerprint';

async function main() {
  // 1. Additive: existing fields on a matched CVE are untouched, byte for
  // byte, only findingTaskId is added.
  {
    const cve = { id: 'CVE-2023-6378', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13', severity: 'HIGH' };
    const fp = findingFingerprint('TRIVY', cve);
    const out = withFindingTaskIds({ trivy: { cves: [cve] }, owasp: { cves: [] } }, f => (f === fp ? 'task-abc' : null));
    assert.deepEqual(out.trivy.cves[0], { ...cve, findingTaskId: 'task-abc' });
  }
  console.log('withFindingTaskIds) matched CVE gains findingTaskId, every existing field untouched: PASS');

  // 2. No matching ManualRemediationTask -> findingTaskId: null, never
  // undefined/omitted, never a thrown error.
  {
    const cve = { id: 'CVE-9999-0001', pkg: 'some:package', installedVersion: '1.0.0', fixedVersion: '1.0.1' };
    const out = withFindingTaskIds({ trivy: { cves: [cve] } }, () => null);
    assert.equal(out.trivy.cves[0].findingTaskId, null);
  }
  console.log('withFindingTaskIds) unmatched CVE -> findingTaskId null: PASS');

  // 3. Parité brut vs normalisé -- l'hypothèse documentée dans le header du
  // module : findingFingerprint() doit produire le MÊME hash pour la forme
  // native Trivy (VulnerabilityID/PkgName) et la forme déjà normalisée
  // (id/pkg) du même finding réel, sinon la correspondance server-side ne
  // matcherait jamais les ManualRemediationTask créées via normalizeReport().
  {
    const raw = { VulnerabilityID: 'CVE-2024-50379', PkgName: 'tomcat-embed-core', InstalledVersion: '9.0.63' };
    const normalized = { id: 'CVE-2024-50379', pkg: 'tomcat-embed-core', installedVersion: '9.0.63' };
    assert.equal(findingFingerprint('TRIVY', raw), findingFingerprint('TRIVY', normalized), 'raw Trivy shape and normalized shape must fingerprint identically');
  }
  console.log('findingFingerprint) raw Trivy shape vs normalized shape -- identical hash (join key is safe): PASS');

  // 4. enrichedData absent -> renvoyé tel quel (jamais une forme inventée).
  {
    assert.equal(withFindingTaskIds(null, () => 'x'), null);
    assert.equal(withFindingTaskIds(undefined, () => 'x'), undefined);
  }
  console.log('withFindingTaskIds) absent enrichedData -> passthrough, no crash: PASS');

  // 5. sonar/zap/tout autre champ du bloc enrichedData reste un objet
  // STRICTEMENT identique (même référence) -- seuls trivy/owasp sont
  // reconstruits.
  {
    const sonar = { issues: [{ rule: 'java:S1068' }] };
    const zap = { alerts_count: 2 };
    const out = withFindingTaskIds({ trivy: { cves: [] }, owasp: { cves: [] }, sonar, zap, note: 'x' }, () => null);
    assert.equal(out.sonar, sonar, 'sonar block must be the exact same reference, never rebuilt');
    assert.equal(out.zap, zap, 'zap block must be the exact same reference, never rebuilt');
    assert.equal(out.note, 'x');
  }
  console.log('withFindingTaskIds) sonar/zap/other fields untouched (same reference): PASS');

  // 6. Bloc trivy/owasp sans tableau `cves` (forme legacy/vide) -> renvoyé
  // tel quel, jamais une erreur.
  {
    const out = withFindingTaskIds({ trivy: { critical: 0 }, owasp: null }, () => 'x');
    assert.deepEqual(out.trivy, { critical: 0 });
    assert.equal(out.owasp, null);
  }
  console.log('withFindingTaskIds) missing/malformed cves array -> passthrough, no crash: PASS');

  console.log('finding-task-id-enrichment.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
