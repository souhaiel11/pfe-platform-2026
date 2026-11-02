// Regroupe les traitements de v1 8 phase2 live preuve snakeyaml.
import { DependencyCompatibilityValidationAdapter, ValidationContext } from './dependency-compatibility-validation-adapter';
import { RemediationPlan } from '../../backend/src/dependency-compatibility/remediation-plan';
import { SecurityCandidate } from '../../backend/src/dependency-compatibility/security-candidate-collector';
import { classifyCandidateVersionPolicy, isAutomationEligiblePolicy } from '../../backend/src/dependency-compatibility/candidate-version-policy';

const REAL_SHA = process.env.LIVE_PROOF_SHA;
if (!REAL_SHA) {
  console.error('LIVE_PROOF_SHA env var is required (the exact real, current remote HEAD sha of souhaiel11/pfe-app-test) -- never guessed/hardcoded here.');
  process.exit(1);
}

const candidate: SecurityCandidate = { version: '1.31', source: 'TRIVY', cve: 'CVE-2022-25857', evidenceType: 'STRUCTURED_FIXED_VERSION', rawEvidence: '1.31' };
const policy = classifyCandidateVersionPolicy('1.29', '1.31');
const plan: RemediationPlan = {
  vulnerableDependency: 'org.yaml:snakeyaml', securityCandidate: candidate, editType: 'DEPENDENCY_VERSION',
  editCoordinate: 'org.yaml:snakeyaml', editProperty: null, fromVersion: '1.29', toVersion: '1.31',
  expectedResolvedDependencyVersion: '1.31', requiresSandboxDiscovery: false, versionPolicy: policy,
  requiresMajorUpgrade: false, requiresDeveloperReview: !isAutomationEligiblePolicy(policy), automationEligible: isAutomationEligiblePolicy(policy),
  evidence: [`V1.8 Phase 2 live proof: CVE-2022-25857/org.yaml:snakeyaml 1.29 -> 1.31, DIRECT_EXPLICIT, via the new DependencyCompatibilityValidationAdapter (SHADOW MODE, no WF6/n8n/DB/PR).`],
};

const context: ValidationContext = {
  repository: 'souhaiel11/pfe-app-test',
  candidateBaseSha: REAL_SHA,
  requestId: 'v18-p2-live-proof-' + Date.now(),
  batchId: 'v18-p2-shadow',
  candidateAttempt: 0,
  pomRelativePath: 'pom.xml',
  overallDeadlineMs: 15 * 60 * 1000,
};

console.log('══════════════════════════════════════════════════');
console.log('V1.8 Phase 2 — LIVE SnakeYAML control case (real orchestrator, real builder-scanner)');
console.log('══════════════════════════════════════════════════');
console.log('plan:', JSON.stringify(plan, null, 2));
console.log('context:', JSON.stringify(context, null, 2));

const adapter = new DependencyCompatibilityValidationAdapter();
const started = Date.now();
const tested = adapter.validate(plan, context);
const durationMs = Date.now() - started;

console.log('\n── RESULT ──');
console.log(JSON.stringify(tested, null, 2));
console.log(`\ndurationMs: ${durationMs}`);
console.log(`SNAKEYAML_REAL_VALIDATION: ${tested.status === 'VALIDATED' ? 'PASS' : tested.status === 'REJECTED' ? 'FAIL' : 'NOT_RUN'} (TestedCandidate.status=${tested.status}, reason=${tested.reason})`);
