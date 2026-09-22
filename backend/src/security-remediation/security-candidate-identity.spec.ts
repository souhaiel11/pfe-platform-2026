import * as assert from 'node:assert/strict';
import { computeSecurityCandidateIdentity } from './security-candidate-identity';

const base = {
  findingIdentity: 'fp-1', evaluatedSha: 'A'.repeat(40), package: 'ch.qos.logback:logback-classic',
  installedVersion: '1.2.11', targetVersion: '1.2.13', controllingFile: 'pom.xml',
};

// Same input -> same identity, deterministic (M).
{
  const a = computeSecurityCandidateIdentity(base);
  const b = computeSecurityCandidateIdentity({ ...base });
  assert.equal(a, b, 'identical input must produce identical identity');
  assert.match(a, /^[0-9a-f]{64}$/, 'identity is a sha256 hex digest');
}
console.log('security-candidate-identity) same input -> identical deterministic identity: PASS');

// evaluatedSha is case-insensitively folded (git SHAs are canonically lowercase).
{
  const lower = computeSecurityCandidateIdentity(base);
  const upper = computeSecurityCandidateIdentity({ ...base, evaluatedSha: base.evaluatedSha.toUpperCase() });
  assert.equal(lower, upper, 'SHA case must not change identity');
}
console.log('security-candidate-identity) SHA case-insensitivity: PASS');

// Any differing field -> different identity.
{
  const a = computeSecurityCandidateIdentity(base);
  for (const [key, value] of Object.entries({ findingIdentity: 'fp-2', evaluatedSha: 'b'.repeat(40), package: 'other:pkg', installedVersion: '1.2.12', targetVersion: '1.2.14', controllingFile: 'other/pom.xml' })) {
    const b = computeSecurityCandidateIdentity({ ...base, [key]: value });
    assert.notEqual(a, b, `changing ${key} must change identity`);
  }
}
console.log('security-candidate-identity) every field is identity-relevant: PASS');

console.log('security-candidate-identity.spec.ts: ALL CHECKS PASS');
