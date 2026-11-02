// Regroupe les traitements de v1 8 phase3 live run direct.
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
const pkg = requireEnv('LIVE_PKG');
const fromVersion = requireEnv('LIVE_FROM');
const toVersion = requireEnv('LIVE_TO');
const cve = requireEnv('LIVE_CVE');
const source = requireEnv('LIVE_SOURCE') as 'OWASP' | 'TRIVY';
const additionalCveIds = (process.env.LIVE_ADDITIONAL_CVES || '').split(',').map(s => s.trim()).filter(Boolean);

const candidate: SecurityCandidate = { version: toVersion, source, cve, evidenceType: 'STRUCTURED_FIXED_VERSION', rawEvidence: toVersion };
const policy = classifyCandidateVersionPolicy(fromVersion, toVersion);
const plan: RemediationPlan = {
  vulnerableDependency: pkg, securityCandidate: candidate, editType: 'DEPENDENCY_VERSION',
  editCoordinate: pkg, editProperty: null, fromVersion, toVersion,
  expectedResolvedDependencyVersion: toVersion, requiresSandboxDiscovery: false, versionPolicy: policy,
  requiresMajorUpgrade: false, requiresDeveloperReview: !isAutomationEligiblePolicy(policy), automationEligible: isAutomationEligiblePolicy(policy),
  evidence: [`V1.8 Phase 3 live run: ${cve}/${pkg} ${fromVersion} -> ${toVersion}, via DependencyCompatibilityValidationAdapter (SHADOW MODE, no WF6/n8n/DB/PR).`],
};

const context: ValidationContext = {
  repository: 'souhaiel11/pfe-app-test', candidateBaseSha: REAL_SHA,
  requestId: 'v18p3-' + Date.now(), batchId: 'v18-p3-shadow', candidateAttempt: 0,
  pomRelativePath: 'pom.xml', overallDeadlineMs: 15 * 60 * 1000,
};

console.log('══════════════════════════════════════════════════');
console.log(`V1.8 Phase 3 — LIVE DIRECT plan: ${cve} / ${pkg} ${fromVersion} -> ${toVersion}`);
console.log('══════════════════════════════════════════════════');

console.log('additionalCveIds:', additionalCveIds);
const adapter = new DependencyCompatibilityValidationAdapter();
const started = Date.now();
const tested = adapter.validate(plan, context, additionalCveIds.length ? additionalCveIds : undefined);
console.log('PLAN_KEY:', `DIRECT:${pkg}:${fromVersion}->${toVersion}`);
console.log('RESULT_JSON_START');
console.log(JSON.stringify(tested, null, 2));
console.log('RESULT_JSON_END');
console.log('durationMs:', Date.now() - started);
