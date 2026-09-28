import * as assert from 'node:assert/strict';
import { computeSecurityCandidateIdentity, computeSecurityBatchCandidateIdentity, computeSecurityBatchFindingsFingerprint } from './security-candidate-identity';

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

// Increment 1 (WF6 multi-CVE) — batch identity. ★ N=1 non-regression: a
// singleton batch MUST equal the plain singular identity exactly, since it
// feeds computeSecurityBranchName() downstream (this exact bug was caught
// during this increment's own contract review, before it ever shipped).
{
  const single = computeSecurityCandidateIdentity(base);
  const batchOfOne = computeSecurityBatchCandidateIdentity([base]);
  assert.equal(batchOfOne, single, 'a singleton batch must produce the EXACT same identity as the plain singular function');
}
console.log('security-candidate-identity) batch of 1 == plain singular identity (N=1 non-regression): PASS');

{
  const other = { ...base, findingIdentity: 'fp-2', package: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.13.3', targetVersion: '2.13.5' };
  const forward = computeSecurityBatchCandidateIdentity([base, other]);
  const reversed = computeSecurityBatchCandidateIdentity([other, base]);
  assert.equal(forward, reversed, 'batch identity is independent of caller array order (internally sorted)');
  assert.match(forward, /^[0-9a-f]{64}$/);
  assert.notEqual(forward, computeSecurityCandidateIdentity(base), 'a real 2-element batch must differ from either single finding\'s own identity');
}
console.log('security-candidate-identity) batch of 2 -> deterministic regardless of order, distinct from either single identity: PASS');

// computeSecurityBatchFindingsFingerprint() -- feeds computeSecurityBranchName()'s
// FIRST argument. Same N=1 non-regression rule.
{
  assert.equal(computeSecurityBatchFindingsFingerprint(['fp-only']), 'fp-only', 'N=1 passes through unchanged');
  const forward = computeSecurityBatchFindingsFingerprint(['fp-1', 'fp-2']);
  const reversed = computeSecurityBatchFindingsFingerprint(['fp-2', 'fp-1']);
  assert.equal(forward, reversed, 'order-independent');
  assert.match(forward, /^[0-9a-f]{64}$/);
}
console.log('security-candidate-identity) computeSecurityBatchFindingsFingerprint: N=1 passthrough, N>1 order-independent sha256: PASS');

console.log('security-candidate-identity.spec.ts: ALL CHECKS PASS');
