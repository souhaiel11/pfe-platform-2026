// Teste le composant « dependency-compatibility-decision » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { gateCandidate, rankValidatedCandidates, buildDependencyCompatibilityDecision, TestedCandidate } from './dependency-compatibility-decision';
import { classifyCandidateVersionPolicy, isAutomationEligiblePolicy } from './candidate-version-policy';

/** Prépare les données nécessaires à ce scénario. */
function evidence(overrides: Partial<Omit<TestedCandidate, 'status' | 'reason'>> = {}): Omit<TestedCandidate, 'status' | 'reason'> {
  const fromVersion = '1.29';
  const candidateVersion = overrides.candidateVersion ?? '1.31';
  const versionPolicy = overrides.versionPolicy ?? classifyCandidateVersionPolicy(fromVersion, candidateVersion);
  return {
    candidateVersion: '1.31', actualEditTarget: 'org.yaml:snakeyaml',
    existence: 'AVAILABLE', resolvedVersion: '1.31', dependencyResolution: 'PASS',
    build: 'PASS', tests: 'PASS', securityRescan: 'PASS', targetCveClosed: true,
    versionPolicy, automationEligible: isAutomationEligiblePolicy(versionPolicy),
    newHighCriticalCount: 0, dependencyGraphDelta: ['org.yaml:snakeyaml: 1.29 -> 1.31'],
    ...overrides,
  };
}

// CASE 1 (regression proof) — the exact real SnakeYAML evidence: all gates PASS -> VALIDATED.
{
  const e = evidence();
  const result = gateCandidate(e, '1.31');
  assert.equal(result.status, 'VALIDATED');
}
console.log('CASE 1 evidence shape (all gates pass) -> VALIDATED: PASS');

// Existence gate: an unavailable candidate must never reach further gates.
{
  const result = gateCandidate(evidence({ existence: 'UNAVAILABLE', dependencyResolution: 'NOT_RUN', build: 'NOT_RUN', tests: 'NOT_RUN', securityRescan: 'NOT_RUN', targetCveClosed: false, newHighCriticalCount: null }), '1.31');
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'ARTIFACT_UNAVAILABLE');
}
console.log('Phase 5 gate: unavailable artifact never proceeds: PASS');

// CASE 5 — candidate closes the CVE evidence path but the BUILD fails -> rejected, never validated.
{
  const result = gateCandidate(evidence({ build: 'FAIL', tests: 'NOT_RUN', securityRescan: 'NOT_RUN', targetCveClosed: false, newHighCriticalCount: null }), '1.31');
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'BUILD_FAILED');
}
console.log('CASE 5 (build fails) -> candidate rejected: PASS');

// CASE 6 — build succeeds but tests fail -> rejected.
{
  const result = gateCandidate(evidence({ tests: 'FAIL', securityRescan: 'NOT_RUN', targetCveClosed: false, newHighCriticalCount: null }), '1.31');
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'TESTS_FAILED');
}
console.log('CASE 6 (build passes, tests fail) -> candidate rejected: PASS');

// Fail-closed: tests that never actually ran must never be silently treated as passed.
{
  const result = gateCandidate(evidence({ tests: 'NOT_EXECUTED', securityRescan: 'NOT_RUN', targetCveClosed: false, newHighCriticalCount: null }), '1.31');
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'TESTS_NOT_EXECUTED');
}
console.log('tests NOT_EXECUTED (e.g. zero test classes) -> rejected, never silently passed: PASS');

// CASE 7 — build/tests pass, target CVE closes, but a NEW HIGH/CRITICAL regression appears -> rejected.
{
  const result = gateCandidate(evidence({ newHighCriticalCount: 2, securityRescan: 'FAIL' }), '1.31');
  assert.equal(result.status, 'REJECTED');
  assert.match(result.reason, /NEW_SECURITY_REGRESSION/);
}
console.log('CASE 7 (new HIGH/CRITICAL regression) -> candidate rejected: PASS');

// Resolved-version mismatch (the "wrong plan" scenario the ticket itself
// warns about, e.g. a BOM bump that didn't actually resolve the vulnerable
// dependency to the expected version) -> rejected, never silently accepted.
{
  const result = gateCandidate(evidence({ resolvedVersion: '1.29' }), '1.31');
  assert.equal(result.status, 'REJECTED');
  assert.match(result.reason, /RESOLVED_VERSION_MISMATCH/);
}
console.log('resolved version mismatch (edit did not actually take effect) -> rejected: PASS');

// CASE 8 — two candidates both pass every gate -> deterministic MINIMAL-CHANGE
// recommendation (closest safe step above installed), never "latest"/"first".
{
  const candidateA: TestedCandidate = { ...evidence({ candidateVersion: '1.31' }), status: 'VALIDATED', reason: 'ALL_GATES_PASSED' };
  const candidateB: TestedCandidate = { ...evidence({ candidateVersion: '1.33' }), status: 'VALIDATED', reason: 'ALL_GATES_PASSED' };
  const { recommended, ambiguous } = rankValidatedCandidates([candidateB, candidateA], '1.29'); // deliberately out of order
  assert.equal(ambiguous, false);
  assert.equal(recommended?.candidateVersion, '1.31', 'must pick the SMALLEST safe step, never the larger/"latest" one, regardless of input order');
}
console.log('CASE 8 (two validated candidates) -> deterministic minimal-change pick (1.31 over 1.33), order-independent: PASS');

// Ranking never crashes/guesses on an INCOMPARABLE qualifier pair -- surfaces as an alternative instead.
{
  const candidateA: TestedCandidate = { ...evidence({ candidateVersion: '1.31-foo' }), status: 'VALIDATED', reason: 'ALL_GATES_PASSED' };
  const candidateB: TestedCandidate = { ...evidence({ candidateVersion: '1.31-bar' }), status: 'VALIDATED', reason: 'ALL_GATES_PASSED' };
  const { ambiguous } = rankValidatedCandidates([candidateA, candidateB], '1.29');
  assert.equal(ambiguous, true, 'an INCOMPARABLE qualifier pair must never be silently resolved into a forced winner');
}
console.log('ranking with an INCOMPARABLE qualifier pair -> flagged ambiguous, never forced: PASS');

// Full decision assembly: VALIDATED_RECOMMENDED, NO_COMPATIBLE_CANDIDATE, SECURITY_TARGET_UNKNOWN.
{
  const plan: any = { fromVersion: '1.29' };
  const validatedOnly: TestedCandidate = { ...evidence(), status: 'VALIDATED', reason: 'ALL_GATES_PASSED' };
  const decision = buildDependencyCompatibilityDecision('org.yaml:snakeyaml', [plan], null, [validatedOnly]);
  assert.equal(decision.state, 'VALIDATED_RECOMMENDED');
  assert.equal(decision.recommendedCandidate?.candidateVersion, '1.31');
}
console.log('decision assembly: single validated candidate -> VALIDATED_RECOMMENDED: PASS');

{
  const plan: any = { fromVersion: '5.3.20' };
  const rejectedOnly: TestedCandidate = { ...evidence({ build: 'FAIL' }), status: 'REJECTED', reason: 'BUILD_FAILED' };
  const decision = buildDependencyCompatibilityDecision('org.springframework:spring-web', [plan], null, [rejectedOnly]);
  assert.equal(decision.state, 'NO_COMPATIBLE_CANDIDATE');
  assert.equal(decision.recommendedCandidate, null);
}
console.log('decision assembly: only rejected candidates -> NO_COMPATIBLE_CANDIDATE: PASS');

{
  const decision = buildDependencyCompatibilityDecision('com.fasterxml.jackson.core:jackson-databind', [], 'NO_SECURITY_CANDIDATE', []);
  assert.equal(decision.state, 'SECURITY_TARGET_UNKNOWN');
}
console.log('decision assembly: no security candidate at all (NO_TRIVY_MATCH case) -> SECURITY_TARGET_UNKNOWN: PASS');

console.log('dependency-compatibility-decision.spec.ts: ALL CHECKS PASS');
