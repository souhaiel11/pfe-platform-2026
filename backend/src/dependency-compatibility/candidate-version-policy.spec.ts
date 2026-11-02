// Teste le composant « candidate-version-policy » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { classifyCandidateVersionPolicy, isAutomationEligiblePolicy } from './candidate-version-policy';
import { resolveDependencyControlProfile } from './dependency-control-profile-resolver';
import { collectSecurityCandidates, OwaspNativeFixedVersionProvider, TrivyCorrelationCandidateProvider } from './security-candidate-collector';
import { buildRemediationPlans } from './remediation-plan';
import { gateCandidate, rankValidatedCandidates, buildDependencyCompatibilityDecision, TestedCandidate } from './dependency-compatibility-decision';
import { classifySecurityAutoFixEligibility } from '../security-remediation/security-eligibility-classifier';
import { resolveMavenProvenance } from '../security-remediation/maven-provenance-resolver';

const SEC_FIXTURES = join(__dirname, '../security-remediation/fixtures');
const COMMON_FIXTURES = join(__dirname, '../common/fixtures');
const pomXmlText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.pom.xml'), 'utf8');
const dependencyTreeText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.dependency-tree.txt'), 'utf8');
const projectContext = { pomXmlText, dependencyTreeText, controllingFilePath: 'pom.xml', groundedSha: 'c0c21af'.padEnd(40, '0') };

// 1. 1.29 -> 1.31, same major, automation policy permits candidate.
{
  const policy = classifyCandidateVersionPolicy('1.29', '1.31');
  assert.equal(policy.state, 'SAFE_SAME_MAJOR');
  assert.equal(isAutomationEligiblePolicy(policy), true);
}
console.log('1. 1.29 -> 1.31 (same major) -> automation permitted: PASS');

// 2. 1.29 -> 2.0, cross major, automation blocked.
{
  const policy = classifyCandidateVersionPolicy('1.29', '2.0');
  assert.equal(policy.state, 'CROSS_MAJOR');
  assert.match(policy.reason, /CROSS_MAJOR_ONLY/);
  assert.equal(isAutomationEligiblePolicy(policy), false);
}
console.log('2. 1.29 -> 2.0 (cross major) -> automation blocked: PASS');

/** Vérifie ed dans ce scénario de test. */
function tested(version: string, fromVersion: string, dependencyGraphDelta: string[] = []): TestedCandidate {
  const policy = classifyCandidateVersionPolicy(fromVersion, version);
  const evidence = {
    candidateVersion: version, actualEditTarget: 'org.yaml:snakeyaml', existence: 'AVAILABLE' as const,
    resolvedVersion: version, dependencyResolution: 'PASS' as const, build: 'PASS' as const, tests: 'PASS' as const,
    securityRescan: 'PASS' as const, targetCveClosed: true, newHighCriticalCount: 0, dependencyGraphDelta,
    versionPolicy: policy, automationEligible: isAutomationEligiblePolicy(policy),
  };
  const gate = gateCandidate(evidence, version);
  return { ...evidence, ...gate };
}

// 3. candidates: 1.31 + 2.0 -> 1.31 preferred, 2.0 never wins even though both technically VALIDATED.
{
  const c131 = tested('1.31', '1.29');
  const c20 = tested('2.0', '1.29');
  assert.equal(c131.status, 'VALIDATED');
  assert.equal(c20.status, 'VALIDATED', 'a cross-major candidate can still be technically VALIDATED -- it is excluded at RANKING, never at the gate');
  const { recommended } = rankValidatedCandidates([c20, c131], '1.29');
  assert.equal(recommended?.candidateVersion, '1.31');

  const decision = buildDependencyCompatibilityDecision('org.yaml:snakeyaml', [{ fromVersion: '1.29' } as any], null, [c131, c20]);
  assert.equal(decision.state, 'VALIDATED_RECOMMENDED');
  assert.equal(decision.recommendedCandidate?.candidateVersion, '1.31');
  assert.match(decision.recommendationReason, /major-upgrade candidate/, 'the 2.0 candidate must be mentioned, never silently dropped');
}
console.log('3. candidates 1.31+2.0 -> 1.31 recommended, 2.0 kept as evidence, never silently dropped: PASS');

// 4. candidates: only 2.0 -> equivalent of CROSS_MAJOR_ONLY / NO_AUTO_COMPATIBLE_CANDIDATE + MAJOR_UPGRADE_AVAILABLE_FOR_REVIEW.
{
  const c20 = tested('2.0', '1.29');
  assert.equal(c20.status, 'VALIDATED');
  const decision = buildDependencyCompatibilityDecision('org.yaml:snakeyaml', [{ fromVersion: '1.29' } as any], null, [c20]);
  assert.equal(decision.state, 'NO_COMPATIBLE_CANDIDATE');
  assert.match(decision.recommendationReason, /NO_AUTO_COMPATIBLE_CANDIDATE/);
  assert.match(decision.recommendationReason, /MAJOR_UPGRADE_AVAILABLE_FOR_REVIEW/);
  assert.equal(decision.recommendedCandidate, null);
}
console.log('4. only-2.0-passes -> NO_COMPATIBLE_CANDIDATE / NO_AUTO_COMPATIBLE_CANDIDATE + MAJOR_UPGRADE_AVAILABLE_FOR_REVIEW: PASS');

// 5. 5.3.20 -> 5.3.33 (real spring-web candidate), permitted to continue to compatibility validation.
{
  const policy = classifyCandidateVersionPolicy('5.3.20', '5.3.33');
  assert.equal(policy.state, 'SAFE_SAME_LINE');
  assert.equal(isAutomationEligiblePolicy(policy), true);
}
console.log('5. 5.3.20 -> 5.3.33 (real spring-web same line) -> permitted to continue: PASS');

// 6. 5.3.20 -> 6.0.18 (real spring-web candidate), requires developer review.
{
  const policy = classifyCandidateVersionPolicy('5.3.20', '6.0.18');
  assert.equal(policy.state, 'CROSS_MAJOR');
  assert.equal(isAutomationEligiblePolicy(policy), false);
}
console.log('6. 5.3.20 -> 6.0.18 (real spring-web cross major) -> requires developer review: PASS');

{
  const policy = classifyCandidateVersionPolicy('release-train-2024', '2.0');
  assert.equal(policy.state, 'INCOMPARABLE', 'a version with no leading digit is unparseable by production\'s own parseVersion(), same as INSTALLED_VERSION_UNPARSEABLE');
  assert.equal(isAutomationEligiblePolicy(policy), false);

  const bothUnparseable = classifyCandidateVersionPolicy('release-train-2024', 'also-not-a-version');
  assert.equal(bothUnparseable.state, 'INCOMPARABLE');
}
console.log('7. unparseable version (no leading digit) -> INCOMPARABLE, fail-closed, same rule as production: PASS');

// 8. parent/BOM edit: same-major owner upgrade may proceed to sandbox validation.
{
  const policy = classifyCandidateVersionPolicy('2.7.0', '2.7.18'); // spring-boot-starter-parent, same major line
  assert.equal(policy.state, 'SAFE_SAME_LINE');
  assert.equal(isAutomationEligiblePolicy(policy), true);
}
console.log('8. parent/BOM same-major owner upgrade (2.7.0 -> 2.7.18) -> may proceed: PASS');

// 9. parent/BOM edit: owner MAJOR upgrade requires developer review.
{
  const policy = classifyCandidateVersionPolicy('2.7.0', '3.0.0'); // spring-boot-starter-parent 2.x -> 3.x
  assert.equal(policy.state, 'CROSS_MAJOR');
  assert.equal(isAutomationEligiblePolicy(policy), false);
}
console.log('9. parent/BOM owner MAJOR upgrade (2.7.0 -> 3.0.0) -> requires developer review: PASS');

// Also prove today's ACTUAL RemediationPlan for a BOM/PARENT-owned finding
// is never automationEligible while the owner target is undiscovered
// (Phase 6's "does not automatically authorize" rule, conservative default).
{
  const profile = resolveDependencyControlProfile({ package: 'org.springframework.boot:spring-boot-starter-web', installedVersion: '2.7.0', ...projectContext });
  assert.equal(profile.versionControl, 'PARENT');
  const { plans } = buildRemediationPlans(profile, [{ version: '2.7.24', source: 'TRIVY', cve: 'CVE-TEST', evidenceType: 'STRUCTURED_FIXED_VERSION' }]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].automationEligible, false, 'a PARENT/BOM plan with no discovered owner target must never be automationEligible by default');
  assert.equal(plans[0].requiresDeveloperReview, true);
}
console.log('PARENT plan with undiscovered owner target -> conservatively not automationEligible: PASS');

// 10. real CVE-2022-1471/snakeyaml divergence: shadow must now match production's own CROSS_MAJOR_ONLY safety behavior.
{
  const owaspFixture = JSON.parse(readFileSync(join(COMMON_FIXTURES, 'owasp-149-dependencies.json'), 'utf8'));
  const trivyFixture = JSON.parse(readFileSync(join(COMMON_FIXTURES, 'trivy-149-cves.json'), 'utf8'));
  const owaspFindings = owaspFixture.dependencies.flatMap((d: any) => d.vulnerabilities.map((v: any) => normalizeOwaspFinding(d, v)));
  const finding = owaspFindings.find((f: any) => f.id === 'CVE-2022-1471' && f.pkg === 'org.yaml:snakeyaml');
  assert.ok(finding, 'real report #149 must contain this exact finding');

  const trivyProvider = new TrivyCorrelationCandidateProvider(trivyFixture.cves);
  const candidates = collectSecurityCandidates({ cve: finding.id, pkg: finding.pkg, installedVersion: finding.installedVersion }, [new OwaspNativeFixedVersionProvider(null), trivyProvider]);
  assert.ok(candidates.some(c => c.version === '2.0'), 'sanity: the real candidate for this CVE is 2.0');

  const profile = resolveDependencyControlProfile({ package: finding.pkg, installedVersion: finding.installedVersion, ...projectContext });
  const { plans } = buildRemediationPlans(profile, candidates);
  const shadowAutomationEligible = plans.some(p => p.automationEligible);

  const provenance = resolveMavenProvenance({ package: finding.pkg, installedVersion: finding.installedVersion, ...projectContext });
  const currentDecision = classifySecurityAutoFixEligibility(
    { source: 'OWASP', ecosystem: 'MAVEN', pkg: finding.pkg, installedVersion: finding.installedVersion, fixedVersions: candidates.map(c => c.version) },
    provenance,
  );
  const currentAutomationEligible = currentDecision.remediationType === 'AUTO_FIX_ELIGIBLE';

  assert.equal(currentDecision.reason, 'CROSS_MAJOR_ONLY', 'sanity: production really does block this on CROSS_MAJOR_ONLY today');
  assert.equal(shadowAutomationEligible, currentAutomationEligible, 'shadow and current must now AGREE (both false) -- the divergence from the prior phase is resolved');
  assert.equal(shadowAutomationEligible, false);
}
console.log('10. real CVE-2022-1471/snakeyaml: shadow now matches production CROSS_MAJOR_ONLY safety behavior: PASS');

console.log('candidate-version-policy.spec.ts: ALL CHECKS PASS');
