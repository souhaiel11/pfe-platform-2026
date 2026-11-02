// Regroupe les traitements de v1 8 phase3 live run propriétaire.
import { DependencyCompatibilityValidationAdapter, ValidationContext } from './dependency-compatibility-validation-adapter';
import { RemediationPlan } from '../../backend/src/dependency-compatibility/remediation-plan';
import { SecurityCandidate } from '../../backend/src/dependency-compatibility/security-candidate-collector';
import { classifyCandidateVersionPolicy, isAutomationEligiblePolicy } from '../../backend/src/dependency-compatibility/candidate-version-policy';

/** Exige environnement. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`${name} env var is required.`); process.exit(1); }
  return v!;
}
const REAL_SHA = requireEnv('LIVE_PROOF_SHA');

const OWNER_COORDINATE = 'org.springframework.boot:spring-boot-starter-parent';
const OWNER_FROM = '2.7.0';
const OWNER_CANDIDATE_VERSION = '2.7.18';

interface Target { pkg: string; cve: string; source: 'OWASP' | 'TRIVY'; securityTargetVersion: string; resolvedVersion: string }
const TARGETS: Target[] = [
  { pkg: 'com.fasterxml.jackson.core:jackson-databind', cve: 'CVE-2022-42003', source: 'OWASP', securityTargetVersion: '2.12.7.1', resolvedVersion: '2.13.5' },
  { pkg: 'com.fasterxml.jackson.core:jackson-databind', cve: 'CVE-2022-42004', source: 'OWASP', securityTargetVersion: '2.12.7.1', resolvedVersion: '2.13.5' },
  { pkg: 'org.apache.tomcat.embed:tomcat-embed-core', cve: 'CVE-2022-42252', source: 'OWASP', securityTargetVersion: '8.5.83', resolvedVersion: '9.0.83' },
  { pkg: 'org.apache.tomcat.embed:tomcat-embed-core', cve: 'CVE-2022-45143', source: 'OWASP', securityTargetVersion: '8.5.84', resolvedVersion: '9.0.83' },
  { pkg: 'org.apache.tomcat.embed:tomcat-embed-core', cve: 'CVE-2024-24549', source: 'OWASP', securityTargetVersion: '8.5.99', resolvedVersion: '9.0.83' },
  { pkg: 'org.apache.tomcat.embed:tomcat-embed-core', cve: 'CVE-2023-41080', source: 'OWASP', securityTargetVersion: '8.5.93', resolvedVersion: '9.0.83' },
  { pkg: 'org.springframework.security:spring-security-config', cve: 'CVE-2023-34034', source: 'TRIVY', securityTargetVersion: '5.6.12', resolvedVersion: '5.7.11' },
];

const context: ValidationContext = {
  repository: 'souhaiel11/pfe-app-test', candidateBaseSha: REAL_SHA,
  requestId: 'v18p3-owner-' + Date.now(), batchId: 'v18-p3-shadow', candidateAttempt: 0,
  pomRelativePath: 'pom.xml', overallDeadlineMs: 15 * 60 * 1000,
};

const plans = TARGETS.map(t => {
  const candidate: SecurityCandidate = { version: t.securityTargetVersion, source: t.source, cve: t.cve, evidenceType: 'STRUCTURED_FIXED_VERSION', rawEvidence: t.securityTargetVersion };
  const policy = classifyCandidateVersionPolicy(OWNER_FROM, OWNER_CANDIDATE_VERSION);
  const plan: RemediationPlan = {
    vulnerableDependency: t.pkg, securityCandidate: candidate, editType: 'PARENT_VERSION',
    editCoordinate: OWNER_COORDINATE, editProperty: null, fromVersion: OWNER_FROM, toVersion: null,
    expectedResolvedDependencyVersion: null, requiresSandboxDiscovery: true, versionPolicy: policy,
    requiresMajorUpgrade: false, requiresDeveloperReview: !isAutomationEligiblePolicy(policy), automationEligible: isAutomationEligiblePolicy(policy),
    evidence: [`V1.8 Phase 3 live owner run: ${t.cve}/${t.pkg}, owner ${OWNER_COORDINATE} ${OWNER_FROM} -> ${OWNER_CANDIDATE_VERSION}, real cheap trial already proved resolution to ${t.resolvedVersion}.`],
  };
  return { plan, resolvedVulnerableVersion: t.resolvedVersion };
});

console.log('══════════════════════════════════════════════════');
console.log(`V1.8 Phase 3 — LIVE OWNER multi-CVE plan: ${OWNER_COORDINATE} ${OWNER_FROM} -> ${OWNER_CANDIDATE_VERSION} (${TARGETS.length} targets)`);
console.log('══════════════════════════════════════════════════');

const adapter = new DependencyCompatibilityValidationAdapter();
const started = Date.now();
const results = adapter.runFullOwnerValidationMulti(OWNER_CANDIDATE_VERSION, plans, context);

console.log('RESULT_JSON_START');
console.log(JSON.stringify(TARGETS.map((t, i) => ({ target: t, tested: results[i] })), null, 2));
console.log('RESULT_JSON_END');
console.log('durationMs:', Date.now() - started);
