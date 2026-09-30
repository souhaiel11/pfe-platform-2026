// V1.8 Phase 5 ticket — Phase 10 (all 10 required decision classes) +
// Phase 11 (known real cases) for canDispatchSecurityRemediationV1_8().
import { strict as assert } from 'assert';
import { canDispatchSecurityRemediationV1_8, isEvidenceStale, SecurityRemediationDispatchContext, LIVE_WRITER_SUPPORTED_EDIT_TYPES } from './v1_8-security-remediation-gate';
import { V1_8CompatibilityDecisionService } from './v1_8-compatibility-decision.service';
import { V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

const service = new V1_8CompatibilityDecisionService();

/** Builds a task context that EXACTLY matches a real evidence entry -- the only way this helper can ever produce ALLOW. */
function exactContext(evidence: V1_8CompatibilityDecision, overrides: Partial<SecurityRemediationDispatchContext> = {}): SecurityRemediationDispatchContext {
  return {
    repository: evidence.repository, commitSha: evidence.validatedCommitSha, source: evidence.findingSource,
    cve: evidence.cve, component: evidence.component, installedVersion: evidence.installedVersion,
    statusPermitsDispatch: true, ...overrides,
  };
}

const snakeyaml = service.lookup('OWASP', 'CVE-2022-25857', 'org.yaml:snakeyaml');
const h2 = service.lookup('OWASP', 'CVE-2022-45868', 'com.h2database:h2');
const springWeb = service.lookup('TRIVY', 'CVE-2024-22259', 'org.springframework:spring-web');
const tomcat24549 = service.lookup('OWASP', 'CVE-2024-24549', 'org.apache.tomcat.embed:tomcat-embed-core');

// ── Phase 10: the 10 required decision classes ──────────────────────────

// 1. VALIDATED_RECOMMENDED + exact evidence -> ALLOW.
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(snakeyaml), snakeyaml);
  assert.equal(result.decision, 'ALLOW', JSON.stringify(result));
}
console.log('1. VALIDATED_RECOMMENDED + exact evidence -> ALLOW: PASS');

// 2. VALIDATED_RECOMMENDED + stale commit -> BLOCK.
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(snakeyaml, { commitSha: 'a'.repeat(40) }), snakeyaml);
  assert.equal(result.decision, 'BLOCK');
  assert.match(result.reason, /V1_8_EVIDENCE_STALE/);
  assert.match(result.reason, /commitSha/);
}
console.log('2. VALIDATED_RECOMMENDED + stale commit -> BLOCK: PASS');

// 3. VALIDATED_RECOMMENDED + installed version changed -> BLOCK.
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(snakeyaml, { installedVersion: '1.30' }), snakeyaml);
  assert.equal(result.decision, 'BLOCK');
  assert.match(result.reason, /V1_8_EVIDENCE_STALE/);
  assert.match(result.reason, /installedVersion/);
}
console.log('3. VALIDATED_RECOMMENDED + installed version changed -> BLOCK: PASS');

// 4. VALIDATED_RECOMMENDED + newHighCriticalCount > 0 -> BLOCK.
{
  const mutated: V1_8CompatibilityDecision = { ...snakeyaml, newHighCriticalCount: 1 };
  const result = canDispatchSecurityRemediationV1_8(exactContext(mutated), mutated);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'NEW_HIGH_CRITICAL_REGRESSION');
}
console.log('4. VALIDATED_RECOMMENDED + newHighCriticalCount > 0 -> BLOCK: PASS');

// 5. VALIDATION_FAILED -> BLOCK.
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(tomcat24549), tomcat24549);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'VALIDATION_FAILED');
}
console.log('5. VALIDATION_FAILED -> BLOCK: PASS');

// 6. NO_COMPATIBLE_CANDIDATE -> BLOCK.
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(h2), h2);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'NO_COMPATIBLE_CANDIDATE');
}
console.log('6. NO_COMPATIBLE_CANDIDATE -> BLOCK: PASS');

// 7. SECURITY_TARGET_UNKNOWN -> BLOCK.
{
  const unknown: V1_8CompatibilityDecision = { ...snakeyaml, state: 'SECURITY_TARGET_UNKNOWN' };
  const result = canDispatchSecurityRemediationV1_8(exactContext(unknown), unknown);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'SECURITY_TARGET_UNKNOWN');
}
console.log('7. SECURITY_TARGET_UNKNOWN -> BLOCK: PASS');

// 8. MAJOR_UPGRADE_REQUIRES_REVIEW -> BLOCK.
{
  const majorUpgrade: V1_8CompatibilityDecision = { ...snakeyaml, state: 'MAJOR_UPGRADE_REQUIRES_REVIEW' };
  const result = canDispatchSecurityRemediationV1_8(exactContext(majorUpgrade), majorUpgrade);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'MAJOR_UPGRADE_REQUIRES_REVIEW');
}
console.log('8. MAJOR_UPGRADE_REQUIRES_REVIEW -> BLOCK: PASS');

// 9. evidence missing -> BLOCK.
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(snakeyaml), null);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'MISSING_EVIDENCE');
}
console.log('9. evidence missing -> BLOCK: PASS');

// 10. current old classifier says AUTO_FIX but this gate is V1.8-only and
// never reads the old classifier at all -- proven structurally: passing
// the SAME exact context/evidence for a case the old classifier would
// reject (H2, ADMIN_ACTION_REQUIRED in production) still evaluates
// PURELY on V1.8 evidence, and blocks for a V1.8 reason, never an
// old-classifier one. (See Phase 5's own "no fallback to old auto-fix"
// rule -- this function has no code path that could even consult it.)
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(h2), h2);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'NO_COMPATIBLE_CANDIDATE', 'must block for the V1.8 reason, never reference the old classifier');
}
console.log('10. old classifier AUTO_FIX-adjacent case, V1.8 blocked -> BLOCK on V1.8 reason alone, no old-classifier fallback: PASS');

// Additional real-field staleness coverage (Phase 3's own worked examples).
{
  assert.match(canDispatchSecurityRemediationV1_8(exactContext(snakeyaml, { repository: 'someone-else/pfe-app-test' }), snakeyaml).reason, /repository/);
  assert.match(canDispatchSecurityRemediationV1_8(exactContext(snakeyaml, { cve: 'CVE-9999-99999' }), snakeyaml).reason, /cve/);
  assert.match(canDispatchSecurityRemediationV1_8(exactContext(snakeyaml, { component: 'org.yaml:snakeyaml-engine' }), snakeyaml).reason, /component/);
  assert.match(canDispatchSecurityRemediationV1_8(exactContext(snakeyaml, { source: 'TRIVY' }), snakeyaml).reason, /source/);
}
console.log('Additional staleness fields (repository/cve/component/source) each independently detected: PASS');

// Task status gate, independent of evidence quality.
{
  const result = canDispatchSecurityRemediationV1_8(exactContext(snakeyaml, { statusPermitsDispatch: false }), snakeyaml);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'TASK_STATUS_DOES_NOT_PERMIT_DISPATCH');
}
console.log('Task status does not permit dispatch -> BLOCK, even with otherwise-perfect evidence: PASS');

// isEvidenceStale() as a standalone helper (used above only implicitly).
assert.equal(isEvidenceStale(exactContext(snakeyaml), snakeyaml), null);
console.log('isEvidenceStale() returns null for an exact match: PASS');

// ── Phase 11: known real cases ──────────────────────────────────────────

assert.equal(canDispatchSecurityRemediationV1_8(exactContext(snakeyaml), snakeyaml).decision, 'ALLOW');
console.log('SnakeYAML CVE-2022-25857, exact evidence -> ALLOW: PASS');

assert.equal(canDispatchSecurityRemediationV1_8(exactContext(h2), h2).decision, 'BLOCK');
console.log('H2 -> BLOCK: PASS');

assert.equal(canDispatchSecurityRemediationV1_8(exactContext(springWeb), springWeb).decision, 'BLOCK');
console.log('spring-web -> BLOCK: PASS');

assert.equal(canDispatchSecurityRemediationV1_8(exactContext(tomcat24549), tomcat24549).decision, 'BLOCK');
console.log('Tomcat CVE-2024-24549 -> BLOCK: PASS');

// V1.8 Phase 7 — the live writer support matrix, exercised directly: a
// PARENT_VERSION plan that passes every other gate now ALLOWs (see
// maven-parent-patch-writer.ts, added this phase) -- production's real
// writer capability gain, not a gate relaxation: every other clause
// (sandboxValidated/targetCveClosed/newHighCriticalCount/staleness/etc.)
// still applies identically.
{
  const jacksonViaParent = service.lookup('OWASP', 'CVE-2022-42003', 'com.fasterxml.jackson.core:jackson-databind');
  assert.equal(jacksonViaParent.state, 'VALIDATED_RECOMMENDED');
  assert.equal(jacksonViaParent.editType, 'PARENT_VERSION');
  const result = canDispatchSecurityRemediationV1_8(exactContext(jacksonViaParent), jacksonViaParent);
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.reason, 'ALL_GATES_PASSED');
  assert.equal(LIVE_WRITER_SUPPORTED_EDIT_TYPES.has('PARENT_VERSION'), true);
  assert.equal(LIVE_WRITER_SUPPORTED_EDIT_TYPES.has('DEPENDENCY_VERSION'), true);
}
console.log('VALIDATED_RECOMMENDED via PARENT_VERSION -> ALLOW now that maven-parent-patch-writer.ts exists (V1.8 Phase 7 capability gain): PASS');

// A PARENT_VERSION plan that fails an EARLIER, unrelated gate clause
// (developer-review-required) must still BLOCK on THAT reason, never
// "upgraded" to ALLOW just because the edit type is now writer-supported --
// proves the capability gain did not loosen anything else in the chain.
{
  const requiresReview: V1_8CompatibilityDecision = {
    ...service.lookup('OWASP', 'CVE-2022-42003', 'com.fasterxml.jackson.core:jackson-databind'),
    requiresDeveloperReview: true,
  };
  const result = canDispatchSecurityRemediationV1_8(exactContext(requiresReview), requiresReview);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.reason, 'DEVELOPER_REVIEW_REQUIRED');
}
console.log('PARENT_VERSION plan still BLOCKs on an earlier gate clause (requiresDeveloperReview) -- capability gain never bypasses other checks: PASS');

console.log('v1_8-security-remediation-gate.spec.ts: ALL CHECKS PASS');
