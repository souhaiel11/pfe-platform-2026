import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding, resolveOwaspMavenIdentity } from './owasp-finding-normalizer';
import { findingFingerprint } from '../manual-remediation/finding-fingerprint';
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/owasp-149-dependencies.json'), 'utf8'));
const dep = fixture.dependencies[0];
const v = dep.vulnerabilities[0];
const n = normalizeOwaspFinding(dep, v);
assert.equal(n.pkg, 'com.h2database:h2');
assert.equal(n.installedVersion, '2.1.212');
assert.equal(n.purl, 'pkg:maven/com.h2database/h2@2.1.212');
assert.equal(n.packageType, 'maven');
assert.equal(n.ruleOrCve, 'CVE-2022-45868');
assert.equal(n.fixedVersion, null);
assert.equal(resolveOwaspMavenIdentity({ ...dep, version: '999', fileName: 'wrong-999.jar' })!.installedVersion, '2.1.212');
const entries = [{ id: 'pkg:npm/h2@9', confidence: 'HIGH' }, { id: 'pkg:maven/wrong/wrong@9', confidence: 'LOW' }, ...dep.packages];
assert.deepEqual(resolveOwaspMavenIdentity({ ...dep, packages: entries }), resolveOwaspMavenIdentity(dep));
assert.equal(resolveOwaspMavenIdentity({ ...dep, packages: [] }), null);
assert.equal(resolveOwaspMavenIdentity({ ...dep, packages: [...dep.packages, { id: 'pkg:maven/other/h2@2.1.212', confidence: 'HIGH' }] }), null);
for (const id of ['pkg:maven/group/artifact', 'pkg:maven/%ZZ/artifact@1', 'pkg:maven/group/artifact@', 'pkg:maven/group/artifact@[1,2)']) {
  assert.equal(resolveOwaspMavenIdentity({ packages: [{ id, confidence: 'HIGH' }] }), null);
}
const differentCve = normalizeOwaspFinding(dep, { ...v, name: 'CVE-OTHER' });
const differentArtifact = normalizeOwaspFinding({ ...dep, packages: [{ id: 'pkg:maven/com.example/other@2.1.212', confidence: 'HIGH' }] }, v);
assert.notEqual(findingFingerprint('OWASP', n), findingFingerprint('OWASP', differentCve));
assert.notEqual(findingFingerprint('OWASP', n), findingFingerprint('OWASP', differentArtifact));
const rows = fixture.dependencies.flatMap((d: any) => d.vulnerabilities.map((v: any) => normalizeOwaspFinding(d, v)));
assert.equal(rows.length, 146);
assert.equal(new Set(rows.map((r: any) => findingFingerprint('OWASP', r))).size, 146);
assert.ok(rows.every((r: any) => r.packageType === 'maven' && r.purl && r.installedVersion && r.fixedVersion === null));
// Explicitly ignore applicability ranges, free text and any untrusted suggestion.
assert.equal(normalizeOwaspFinding(dep, { ...v, fixedVersion: '999', recommendation: 'Upgrade to latest', vulnerableSoftware: [{ software: { versionEndExcluding: '3.0' } }] }).fixedVersion, null);
console.log('OWASP normalization: PASS (146 real findings, PURL priority, ambiguity fail-closed, CVE/artifact isolation, no invented fixes)');
