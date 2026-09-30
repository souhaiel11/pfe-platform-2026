// V1.8 Phase 5 ticket — Phase 6/7 payload contract tests.
import { strict as assert } from 'assert';
import { buildWf6ValidatedFindingPayload } from './v1_8-remediation-plan-payload.types';
import { V1_8CompatibilityDecisionService } from './v1_8-compatibility-decision.service';

const service = new V1_8CompatibilityDecisionService();

// 1. DIRECT_EXPLICIT (SnakeYAML) -- full plan, never a bare fixedVersion.
{
  const evidence = service.lookup('OWASP', 'CVE-2022-25857', 'org.yaml:snakeyaml');
  const payload = buildWf6ValidatedFindingPayload('task-123', evidence);
  assert.equal(payload.findingTaskId, 'task-123');
  assert.equal(payload.source, 'OWASP');
  assert.equal(payload.cve, 'CVE-2022-25857');
  assert.equal(payload.installedVersion, '1.29');
  assert.equal(payload.compatibilityEvidenceId, evidence.evidenceId);
  assert.deepEqual(payload.remediationPlan, {
    editType: 'DEPENDENCY_VERSION', actualEditTarget: 'org.yaml:snakeyaml',
    fromVersion: '1.29', toVersion: '1.31', expectedResolvedDependency: '1.31',
  });
}
console.log('1. DIRECT_EXPLICIT (SnakeYAML) payload carries the full plan, never a bare fixedVersion: PASS');

// 2. PARENT-owned (jackson-databind via Spring Boot parent) -- the owner's
// OWN edit target/version, never the vulnerable dependency's own coordinate.
{
  const evidence = service.lookup('OWASP', 'CVE-2022-42003', 'com.fasterxml.jackson.core:jackson-databind');
  assert.equal(evidence.state, 'VALIDATED_RECOMMENDED');
  const payload = buildWf6ValidatedFindingPayload('task-456', evidence);
  assert.equal(payload.remediationPlan.editType, 'PARENT_VERSION');
  assert.equal(payload.remediationPlan.actualEditTarget, 'org.springframework.boot:spring-boot-starter-parent');
  assert.equal(payload.remediationPlan.fromVersion, '2.7.0');
  assert.equal(payload.remediationPlan.toVersion, '2.7.18');
  assert.equal(payload.remediationPlan.expectedResolvedDependency, '2.13.5', 'the ACTUAL jackson-databind version this owner bump resolves to, never the owner\'s own version mistaken for it');
}
console.log('2. PARENT-owned plan (jackson-databind) payload names the owner as edit target, never the dependency itself: PASS');

// 3. Refuses to build a payload from incomplete/non-validated evidence.
{
  const evidence = service.lookup('OWASP', 'CVE-2022-45868', 'com.h2database:h2'); // NO_COMPATIBLE_CANDIDATE
  assert.throws(() => buildWf6ValidatedFindingPayload('task-789', evidence), /not a validated, complete plan/);
}
console.log('3. Refuses to build a payload for a non-VALIDATED_RECOMMENDED decision: PASS');

console.log('v1_8-remediation-plan-payload.spec.ts: ALL CHECKS PASS');
