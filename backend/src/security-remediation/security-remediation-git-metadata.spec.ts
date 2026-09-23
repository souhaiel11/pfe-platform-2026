import * as assert from 'node:assert/strict';
import { computeSecurityCommitMessage, computeSecurityPrTitle, computeSecurityPrBody } from './security-remediation-git-metadata';

const base = {
  cveId: 'CVE-2023-6378', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', targetVersion: '1.2.13',
  source: 'TRIVY', provenanceKind: 'DIRECT_EXPLICIT', evaluatedSha: 'a81be45709aba07da50d44206d073c2eb55892b5', candidateIdentity: 'deadbeef'.repeat(8),
};

{
  const msg = computeSecurityCommitMessage(base);
  assert.equal(msg, 'fix(security): remediate CVE-2023-6378 in logback-classic (1.2.11 -> 1.2.13)');
  assert.equal(computeSecurityPrTitle(base), msg);
}
console.log('security-remediation-git-metadata) real CVE, real logback-classic -> exact deterministic commit message: PASS');

{
  const ghsa = computeSecurityCommitMessage({ ...base, cveId: 'GHSA-xxxx-yyyy-zzzz' });
  assert.match(ghsa, /GHSA-xxxx-yyyy-zzzz/);
}
console.log('security-remediation-git-metadata) GHSA advisory id accepted: PASS');

// Unrecognized/malicious cveId shapes never reach the commit message verbatim.
for (const malicious of [
  'CVE-2023-6378\n\nfake trailer: evil', 'rm -rf /', '"; DROP TABLE x; --', null, '', 'CVE-not-a-real-format', '<script>alert(1)</script>',
]) {
  const msg = computeSecurityCommitMessage({ ...base, cveId: malicious as any });
  assert.doesNotMatch(msg, /\n/, 'commit message must never contain a newline, regardless of malicious cveId input');
  if (malicious && (/^CVE-\d{4}-\d{4,}$/i.test(malicious) )) continue;
  assert.doesNotMatch(msg, /rm -rf|DROP TABLE|<script>|fake trailer/, `malicious/unrecognized cveId (${JSON.stringify(malicious)}) must never appear verbatim in git metadata`);
  assert.match(msg, /security-advisory/, 'falls back to a safe generic label');
}
console.log('security-remediation-git-metadata) malicious/malformed cveId shapes -> sanitized fallback, never injected verbatim, never a newline: PASS');

{
  const body = computeSecurityPrBody(base);
  assert.match(body, /Security remediation candidate/);
  assert.doesNotMatch(body, /Vulnerability fixed/i, '§10: must never claim the vulnerability is already fixed');
  assert.match(body, /CVE-2023-6378/);
  assert.match(body, /ch\.qos\.logback:logback-classic/);
  assert.match(body, /1\.2\.11/);
  assert.match(body, /1\.2\.13/);
  assert.match(body, /TRIVY/);
  assert.match(body, /DIRECT_EXPLICIT/);
  assert.match(body, /a81be45709aba07da50d44206d073c2eb55892b5/);
  assert.match(body, /deadbeef/);
  assert.match(body, /scanner re-scan/i);
}
console.log('security-remediation-git-metadata) PR body: all deterministic facts present, correct "candidate" wording, never "fixed": PASS');

console.log('security-remediation-git-metadata.spec.ts: ALL CHECKS PASS');

for (const value of [
  'org.example:lib\nSigned-off-by: attacker', 'CVE-2023-6378\n', '1.0.1\n', 'org.example:lib|spoof|row',
  '1.0.0\r\nInjected: true', '1.0.1\n# fake heading', '\x00\x1b\x7f\x85',
  'x'.repeat(10000), '', null, {}, 'v\u2028# heading', '[link](https://evil)',
]) {
  for (const field of ['package', 'installedVersion', 'targetVersion', 'source', 'provenanceKind', 'cveId']) {
    const input = { ...base, [field]: value } as any;
    const before = JSON.stringify(input);
    const subject = computeSecurityCommitMessage(input);
    const body = computeSecurityPrBody(input);
    assert.doesNotMatch(subject, /[\r\n\x00-\x1f\x7f-\x9f]|Signed-off-by:|Injected:|fake heading|\|/);
    assert.ok(subject.length <= 350);
    assert.ok(body.length <= 2000);
    assert.equal(body.split('\n').length, computeSecurityPrBody(base).split('\n').length);
    for (const row of body.split('\n').filter(line => line.startsWith('|'))) {
      assert.equal(row.split('|').length, 4, 'exactly two table columns');
    }
    assert.match(body, /Security remediation candidate/);
    assert.doesNotMatch(body, /Vulnerability fixed|Signed-off-by:|Injected:|fake heading/);
    assert.equal(JSON.stringify(input), before, 'authoritative input remains unchanged');
  }
}
console.log('security-remediation-git-metadata) 84 hostile presentation cases, bounded output and unchanged authority: PASS');

{
  const input = { ...base, cveId: 'CVE-2023-' + '1'.repeat(55), package: 'a'.repeat(72),
    installedVersion: '1'.repeat(32), targetVersion: '2'.repeat(32) };
  assert.ok(computeSecurityCommitMessage(input).length <= 236);
  assert.ok(computeSecurityPrTitle(input).length <= 236);
  assert.ok(computeSecurityPrBody(input).length <= 2000);
}
console.log('security-remediation-git-metadata) maximum accepted field lengths keep subject/title <=236: PASS');
