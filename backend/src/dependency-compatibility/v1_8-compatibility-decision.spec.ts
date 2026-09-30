// V1.8 Phase 4 ticket — Phase 5 (future eligibility rule) + Phase 11
// (known real cases) verification.
import { strict as assert } from 'assert';
import { V1_8CompatibilityDecisionService } from './v1_8-compatibility-decision.service';
import { isAutoFixAvailableV1_8, V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

const service = new V1_8CompatibilityDecisionService();

// ── Phase 11: known real cases ──────────────────────────────────────────

// A. SnakeYAML -> VALIDATED_RECOMMENDED (real, live sandbox this session).
{
  const d = service.lookup('OWASP', 'CVE-2022-25857', 'org.yaml:snakeyaml');
  assert.equal(d.state, 'VALIDATED_RECOMMENDED');
  assert.equal(d.recommendedVersion, '1.31');
  assert.equal(d.sandboxValidated, true);
  assert.equal(d.targetCveClosed, true);
  assert.equal(d.newHighCriticalCount, 0);
}
console.log('A. SnakeYAML -> VALIDATED_RECOMMENDED: PASS');

// B. H2 -> NO_COMPATIBLE_CANDIDATE (real target 2.2.220 unreachable by any same-major Spring Boot parent).
{
  const d = service.lookup('OWASP', 'CVE-2022-45868', 'com.h2database:h2');
  assert.equal(d.state, 'NO_COMPATIBLE_CANDIDATE');
  assert.equal(d.ownerType, 'PARENT');
  assert.equal(d.recommendedVersion, null);
}
console.log('B. H2 -> NO_COMPATIBLE_CANDIDATE: PASS');

// C. spring-web -> NO_COMPATIBLE_CANDIDATE (same-major parent never reaches 5.3.33/6.0.18/6.1.5).
{
  const d = service.lookup('TRIVY', 'CVE-2024-22259', 'org.springframework:spring-web');
  assert.equal(d.state, 'NO_COMPATIBLE_CANDIDATE');
  assert.equal(d.ownerType, 'PARENT');
}
console.log('C. spring-web -> NO_COMPATIBLE_CANDIDATE: PASS');

// D. Tomcat CVE-2024-24549 -> VALIDATION_FAILED (real rescan proved NOT closed, despite sibling CVEs on the SAME build closing).
{
  const d = service.lookup('OWASP', 'CVE-2024-24549', 'org.apache.tomcat.embed:tomcat-embed-core');
  assert.equal(d.state, 'VALIDATION_FAILED');
  assert.equal(d.sandboxValidated, true);
  assert.equal(d.targetCveClosed, false);
  // A sibling CVE on the exact same real build DID close -- proves independence.
  const sibling = service.lookup('OWASP', 'CVE-2022-42003', 'com.fasterxml.jackson.core:jackson-databind');
  assert.equal(sibling.state, 'VALIDATED_RECOMMENDED');
}
console.log('D. Tomcat CVE-2024-24549 -> VALIDATION_FAILED (sibling CVE on same build stays VALIDATED_RECOMMENDED): PASS');

// An unknown finding never fabricates a state.
{
  const d = service.lookup('OWASP', 'CVE-0000-00000', 'com.example:does-not-exist');
  assert.equal(d.state, 'NOT_YET_SANDBOXED');
  assert.equal(d.sandboxValidated, false);
}
console.log('E. Unknown finding -> honest NOT_YET_SANDBOXED, never fabricated: PASS');

console.log('entryCount:', service.entryCount, 'generatedAt:', service.generatedAt);
assert.equal(service.entryCount, 251);

// ── Phase 5: future eligibility rule (defined, not activated) ───────────

function base(overrides: Partial<V1_8CompatibilityDecision> = {}): V1_8CompatibilityDecision {
  return {
    evidenceId: 'test-evidence-id', schemaVersion: 2, repository: 'souhaiel11/pfe-app-test',
    validatedCommitSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99', findingSource: 'OWASP', cve: 'CVE-2022-25857',
    component: 'org.yaml:snakeyaml', installedVersion: '1.29', validationRunId: 'test-run', validatedAt: '2026-01-01T00:00:00.000Z',
    state: 'VALIDATED_RECOMMENDED', recommendedVersion: '1.31', actualEditTarget: 'org.yaml:snakeyaml',
    editType: 'DEPENDENCY_VERSION', fromVersion: '1.29', toVersion: '1.31', expectedResolvedDependency: '1.31',
    ownerType: null, ownerCoordinate: null,
    evidenceSummary: 'x', recommendationReason: 'x', sandboxValidated: true, targetCveClosed: true,
    newHighCriticalCount: 0, requiresDeveloperReview: false, ...overrides,
  };
}

// 1. Every clause satisfied -> eligible.
assert.equal(isAutoFixAvailableV1_8(base()), true);
console.log('1. All clauses satisfied -> isAutoFixAvailableV1_8=true: PASS');

// 2. Real SnakeYAML decision (from the store) satisfies the rule.
assert.equal(isAutoFixAvailableV1_8(service.lookup('OWASP', 'CVE-2022-25857', 'org.yaml:snakeyaml')), true);
console.log('2. Real SnakeYAML decision satisfies the future rule: PASS');

// 3. Real Tomcat CVE-2024-24549 decision (targetCveClosed=false) never satisfies the rule.
assert.equal(isAutoFixAvailableV1_8(service.lookup('OWASP', 'CVE-2024-24549', 'org.apache.tomcat.embed:tomcat-embed-core')), false);
console.log('3. Real Tomcat VALIDATION_FAILED decision never satisfies the future rule: PASS');

// 4. Real H2 decision (NO_COMPATIBLE_CANDIDATE) never satisfies the rule.
assert.equal(isAutoFixAvailableV1_8(service.lookup('OWASP', 'CVE-2022-45868', 'com.h2database:h2')), false);
console.log('4. Real H2 NO_COMPATIBLE_CANDIDATE decision never satisfies the future rule: PASS');

// 5. Each individual clause, tested in isolation, blocks eligibility.
assert.equal(isAutoFixAvailableV1_8(base({ state: 'VALIDATED_ALTERNATIVES' })), false, 'wrong state');
assert.equal(isAutoFixAvailableV1_8(base({ sandboxValidated: false })), false, 'not sandboxed');
assert.equal(isAutoFixAvailableV1_8(base({ targetCveClosed: false })), false, 'cve not closed');
assert.equal(isAutoFixAvailableV1_8(base({ targetCveClosed: null })), false, 'cve closure unknown');
assert.equal(isAutoFixAvailableV1_8(base({ newHighCriticalCount: 1 })), false, 'new regression');
assert.equal(isAutoFixAvailableV1_8(base({ newHighCriticalCount: null })), false, 'regression count unknown');
assert.equal(isAutoFixAvailableV1_8(base({ requiresDeveloperReview: true })), false, 'requires developer review');
assert.equal(isAutoFixAvailableV1_8(base({ recommendedVersion: null })), false, 'no recommended version');
assert.equal(isAutoFixAvailableV1_8(base({ actualEditTarget: null })), false, 'no edit target');
console.log('5. Every individual clause independently blocks eligibility when violated: PASS');

console.log('v1_8-compatibility-decision.spec.ts: ALL CHECKS PASS');
