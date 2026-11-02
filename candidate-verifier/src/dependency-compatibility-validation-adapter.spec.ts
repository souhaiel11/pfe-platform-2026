// Teste le composant « dependency-compatibility-validation-adapter » et ses cas d’erreur.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DependencyCompatibilityValidationAdapter, ValidationContext } from './dependency-compatibility-validation-adapter';
import { WorkspaceManager } from './workspace-manager.service';
import { RemediationPlan } from '../../backend/src/dependency-compatibility/remediation-plan';
import { SecurityCandidate } from '../../backend/src/dependency-compatibility/security-candidate-collector';
import { classifyCandidateVersionPolicy, isAutomationEligiblePolicy } from '../../backend/src/dependency-compatibility/candidate-version-policy';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v18-p2-adapter-'));
const repo = path.join(root, 'repo');
const REAL_REPO = process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test';
execFileSync('git', ['clone', '--no-hardlinks', REAL_REPO, repo], { stdio: 'pipe' });
const REAL_SHA = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const wm = new WorkspaceManager(path.join(root, 'workspaces'));
const repoCacheFake: any = { 
/** Prépare le dépôt et la révision nécessaires. */
ensureRepo: () => repo };
let serial = 0;
/** Prépare les données nécessaires à ce scénario. */
const context = (): ValidationContext => ({
  repository: 'souhaiel11/pfe-app-test', candidateBaseSha: REAL_SHA, requestId: 'v18p2-' + ++serial,
  batchId: 'tests', candidateAttempt: 0, pomRelativePath: 'pom.xml', overallDeadlineMs: 120000,
});

/** Prépare les données nécessaires à ce scénario. */
function snakeyamlPlan(): RemediationPlan {
  const candidate: SecurityCandidate = { version: '1.31', source: 'TRIVY', cve: 'CVE-2022-25857', evidenceType: 'STRUCTURED_FIXED_VERSION', rawEvidence: '1.31' };
  const policy = classifyCandidateVersionPolicy('1.29', '1.31');
  return {
    vulnerableDependency: 'org.yaml:snakeyaml', securityCandidate: candidate, editType: 'DEPENDENCY_VERSION',
    editCoordinate: 'org.yaml:snakeyaml', editProperty: null, fromVersion: '1.29', toVersion: '1.31',
    expectedResolvedDependencyVersion: '1.31', requiresSandboxDiscovery: false, versionPolicy: policy,
    requiresMajorUpgrade: false, requiresDeveloperReview: !isAutomationEligiblePolicy(policy), automationEligible: isAutomationEligiblePolicy(policy),
    evidence: ['fixture'],
  };
}

/** Prépare les données nécessaires à ce scénario. */
function h2ParentPlan(): RemediationPlan {
  const candidate: SecurityCandidate = { version: '2.1.214', source: 'TRIVY', cve: 'CVE-2022-45868', evidenceType: 'STRUCTURED_FIXED_VERSION', rawEvidence: '2.1.214' };
  return {
    vulnerableDependency: 'com.h2database:h2', securityCandidate: candidate, editType: 'PARENT_VERSION',
    editCoordinate: 'org.springframework.boot:spring-boot-starter-parent', editProperty: null, fromVersion: '2.7.0', toVersion: null,
    expectedResolvedDependencyVersion: null, requiresSandboxDiscovery: true,
    versionPolicy: { state: 'UNKNOWN', currentVersion: '2.7.0', candidateVersion: '(undiscovered)', reason: 'owner target undiscovered' },
    requiresMajorUpgrade: false, requiresDeveloperReview: true, automationEligible: false, evidence: ['fixture'],
  };
}

// 1. DEPENDENCY_VERSION plan, fake orchestrator returns a real-shaped CANDIDATE_READY -> VALIDATED-gate-ready TestedCandidate.
{
  const fakeOrchestrator: any = {
    /** Enchaîne les contrôles de correction et rassemble les preuves. */
    orchestrate: () => ({
      status: 'CANDIDATE_READY', reason: 'DETERMINISTIC_CANDIDATE_READY', decision: {} as any,
      candidateIdentity: 'x', candidateManifest: {} as any,
      dependencyResolutionEvidence: { checked: true, resolvedMatch: true, evaluatedAtSha: REAL_SHA },
      applicationTests: { executed: true, passed: true, total: 3, failures: 0, errors: 0, skipped: 0, durationMs: 10, evidenceTail: '' },
      securityValidationEvidence: { status: 'TARGET_CVE_CLOSED', targetCve: 'CVE-2022-25857', mode: 'TRIVY_IMAGE_ARCHIVE', evaluatedSha: REAL_SHA, candidateContentSha256: 'a'.repeat(64), artifactDigest: 'b'.repeat(64), reportDigest: 'c'.repeat(64), scannerVersion: 'fixture', targetCveMatchCount: 0, buildPassed: true, tests: 'PASSED', newHighCriticalCount: 0 },
      patchEvidence: null, guardResult: null,
    }),
  };
  const adapter = new DependencyCompatibilityValidationAdapter(fakeOrchestrator, wm, repoCacheFake as any);
  const tested = adapter.validate(snakeyamlPlan(), context());
  assert.equal(tested.status, 'VALIDATED', tested.reason);
  assert.equal(tested.candidateVersion, '1.31');
  assert.equal(tested.resolvedVersion, '1.31');
  assert.equal(tested.targetCveClosed, true);
  assert.equal(tested.newHighCriticalCount, 0);
}
console.log('1. DEPENDENCY_VERSION plan + fake CANDIDATE_READY orchestrator result -> TestedCandidate VALIDATED: PASS');

// 2. Same plan, fake orchestrator returns a real-shaped APPLICATION_TESTS_FAILED -> REJECTED/TESTS_FAILED, never VALIDATED.
{
  const fakeOrchestrator: any = {
    /** Enchaîne les contrôles de correction et rassemble les preuves. */
    orchestrate: () => ({
      status: 'APPLICATION_TESTS_FAILED', reason: 'Application test suite failed: 1 failure(s), 0 error(s) of 3.', decision: {} as any,
      candidateIdentity: null, candidateManifest: null,
      dependencyResolutionEvidence: { checked: true, resolvedMatch: true, evaluatedAtSha: REAL_SHA },
      applicationTests: { executed: true, passed: false, total: 3, failures: 1, errors: 0, skipped: 0, durationMs: 10, evidenceTail: '' },
      patchEvidence: null, guardResult: null,
    }),
  };
  const adapter = new DependencyCompatibilityValidationAdapter(fakeOrchestrator, wm, repoCacheFake as any);
  const tested = adapter.validate(snakeyamlPlan(), context());
  assert.equal(tested.status, 'REJECTED');
  assert.equal(tested.reason.startsWith('TESTS_FAILED'), true, tested.reason);
  assert.equal(tested.build, 'PASS'); // packaging itself succeeded through the test phase
  assert.equal(tested.tests, 'FAIL');
}
console.log('2. APPLICATION_TESTS_FAILED orchestrator result -> REJECTED/TESTS_FAILED, build correctly distinguished from tests: PASS');

// 3. NOT_ELIGIBLE (e.g. grounding never even reached Maven resolution) -> NOT_TESTED, never a fabricated PASS/FAIL.
{
  const fakeOrchestrator: any = {
    /** Enchaîne les contrôles de correction et rassemble les preuves. */
    orchestrate: () => ({
      status: 'NOT_ELIGIBLE', reason: 'CROSS_MAJOR_ONLY', decision: {} as any,
      candidateIdentity: null, candidateManifest: null, dependencyResolutionEvidence: null, patchEvidence: null, guardResult: null,
    }),
  };
  const adapter = new DependencyCompatibilityValidationAdapter(fakeOrchestrator, wm, repoCacheFake as any);
  const tested = adapter.validate(snakeyamlPlan(), context());
  assert.equal(tested.existence, 'UNKNOWN_REPOSITORY_ACCESS');
  assert.equal(tested.dependencyResolution, 'NOT_RUN');
  assert.equal(tested.status, 'NOT_TESTED');
}
console.log('3. NOT_ELIGIBLE (grounding never reached Maven) -> honest NOT_TESTED, no fabricated evidence: PASS');

// 4. DEPENDENCY_MANAGEMENT_VERSION plan -> honestly reported as having no real writer, never silently dropped or misrouted to the owner-discovery path.
{
  const candidate: SecurityCandidate = { version: '9.9.9', source: 'OWASP', cve: 'CVE-0000-0000', evidenceType: 'NATIVE_SCAN_VALUE' };
  const plan: RemediationPlan = {
    vulnerableDependency: 'g:a', securityCandidate: candidate, editType: 'DEPENDENCY_MANAGEMENT_VERSION',
    editCoordinate: 'g:a', editProperty: null, fromVersion: '1.0', toVersion: '9.9.9', expectedResolvedDependencyVersion: '9.9.9',
    requiresSandboxDiscovery: false, versionPolicy: { state: 'SAFE_SAME_MAJOR', currentVersion: '1.0', candidateVersion: '9.9.9', reason: 'x' },
    requiresMajorUpgrade: false, requiresDeveloperReview: false, automationEligible: true, evidence: [],
  };
  const adapter = new DependencyCompatibilityValidationAdapter({} as any, wm, repoCacheFake as any);
  const tested = adapter.validate(plan, context());
  assert.equal(tested.status, 'NOT_TESTED');
  assert.match(tested.reason, /DEPENDENCY_MANAGEMENT_VERSION_HAS_NO_REAL_WRITER/);
}
console.log('4. DEPENDENCY_MANAGEMENT_VERSION plan -> honest NOT_TESTED (no real writer for this edit shape), never misrouted: PASS');

// ── LIVE (real mvn, real scratch clone of pfe-app-test; cheap ops only) ──

// 5. PARENT_VERSION cheap trial: real owner discovery + real dependency:tree trial finds Spring Boot 2.7.18 resolves h2 to 2.1.214, matching the plan's own security target -- honest NOT_TESTED (Phase 6 only; Phase 8 not run).
{
  const adapter = new DependencyCompatibilityValidationAdapter({} as any, wm, repoCacheFake as any);
  const tested = adapter.validate(h2ParentPlan(), context());
  assert.equal(tested.status, 'NOT_TESTED', tested.reason);
  assert.equal(tested.candidateVersion, '2.7.18');
  assert.equal(tested.resolvedVersion, '2.1.214');
  assert.equal(tested.dependencyResolution, 'PASS');
  assert.match(tested.reason, /PHASE6_CHEAP_TRIAL_ONLY/);
  // pom.xml in the shared clone must be untouched after the trial (restored).
  const pomAfter = fs.readFileSync(path.join(repo, 'pom.xml'), 'utf8');
  assert.ok(pomAfter.includes('<version>2.7.0</version>'));
}
console.log('5. LIVE PARENT_VERSION cheap trial (real mvn): Spring Boot 2.7.0->2.7.18 resolves h2 to 2.1.214, matches security target -> NOT_TESTED/PHASE6_CHEAP_TRIAL_ONLY: PASS');

// 6. A PARENT_VERSION plan whose security target NO bounded same-major owner candidate can reach -> honest NO_SAME_MAJOR_OWNER_CANDIDATE_RESOLVES_TARGET.
{
  const impossiblePlan = h2ParentPlan();
  impossiblePlan.securityCandidate = { ...impossiblePlan.securityCandidate, version: '999.0.0' };
  const adapter = new DependencyCompatibilityValidationAdapter({} as any, wm, repoCacheFake as any);
  const tested = adapter.validate(impossiblePlan, context());
  assert.equal(tested.status, 'NOT_TESTED');
  assert.match(tested.reason, /NO_SAME_MAJOR_OWNER_CANDIDATE_RESOLVES_TARGET/);
}
console.log('6. LIVE PARENT_VERSION cheap trial, no candidate reaches an unreachable security target -> honest failure, never fabricated: PASS');

// 7. runFullOwnerValidation (Phase 8) wiring, fully injected fakes: edit applied, package+scan called with the edited content, gate computed correctly on a clean pass.
{
  const scratch = fs.mkdtempSync(path.join(root, 'full-owner-'));
  fs.mkdirSync(scratch, { recursive: true });
  const scratchRepoPath = path.join(scratch, 'repo');
  execFileSync('git', ['clone', '--no-hardlinks', repo, scratchRepoPath], { stdio: 'pipe' });
  const localWm = new WorkspaceManager(path.join(scratch, 'workspaces'));
  const localRepoCache: any = { 
  /** Prépare le dépôt et la révision nécessaires. */
  ensureRepo: () => scratchRepoPath };
  let seenPomContent = '';
  const fakeMavenAdapter: any = {
    /** Prépare les données nécessaires à ce scénario. */
    packageCandidateWithTests: (w: string) => {
      seenPomContent = fs.readFileSync(path.join(w, 'pom.xml'), 'utf8');
      return { status: 'SUCCESS', exitCode: 0, durationMs: 1, timedOut: false, evidenceTail: '', testsExecuted: true, testsPassed: true, testsTotal: 1, testsFailures: 0, testsErrors: 0, testsSkipped: 0 };
    },
  };
  let scanCall = 0;
  const fakeScanner: any = {
    /** Inspecte les données ou l’artefact pour en tirer des preuves. */
    inspect: (w: string) => {
      scanCall++;
      const { execFileSync: ex } = require('child_process');
      const digest = require('./security-artifact-validator').trackedSourceDigest(w);
      const report = scanCall === 1
        ? { SchemaVersion: 2, ArtifactType: 'container_image', Results: [{ Target: 'x', Type: 'jar', Packages: [{ Name: 'com.h2database:h2', Version: '2.1.212' }], Vulnerabilities: [{ VulnerabilityID: 'CVE-2022-45868', PkgName: 'com.h2database:h2', InstalledVersion: '2.1.212', Severity: 'CRITICAL' }] }] }
        : { SchemaVersion: 2, ArtifactType: 'container_image', Results: [{ Target: 'x', Type: 'jar', Packages: [{ Name: 'com.h2database:h2', Version: '2.1.214' }], Vulnerabilities: [] }] };
      return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: digest, artifactDigest: 'd'.repeat(64), reportDigest: 'e'.repeat(64), scannerVersion: 'fixture', report, buildPassed: true };
    },
  };
  const adapter = new DependencyCompatibilityValidationAdapter({} as any, localWm, localRepoCache, fakeMavenAdapter, fakeScanner);
  const plan = h2ParentPlan();
  const ctx = context();
  const tested = adapter.runFullOwnerValidation(plan, '2.7.18', '2.1.214', ctx);
  assert.ok(seenPomContent.includes('<version>2.7.18</version>'), 'packageCandidateWithTests must see the edited pom (owner version bumped)');
  assert.equal(scanCall, 2, 'baseline scan + candidate scan, exactly two real inspect() calls');
  assert.equal(tested.status, 'VALIDATED', tested.reason);
  assert.equal(tested.targetCveClosed, true);
  assert.equal(tested.newHighCriticalCount, 0);
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('7. runFullOwnerValidation (Phase 8, injected fakes): pom edit applied persistently, package+baseline+candidate scan called in order, gate VALIDATED on a clean pass: PASS');

// 8. runFullOwnerValidationMulti (Phase 3): TWO findings (h2 + a second,
// synthetic jackson-databind-like target) sharing the SAME owner edit ->
// exactly ONE build + ONE baseline scan + ONE candidate scan (never one per
// target), but each target's OWN CVE is independently checked against that
// single real scan -- one closes, the other does not, proving they are
// never conflated.
{
  const scratch = fs.mkdtempSync(path.join(root, 'full-owner-multi-'));
  fs.mkdirSync(scratch, { recursive: true });
  const scratchRepoPath = path.join(scratch, 'repo');
  execFileSync('git', ['clone', '--no-hardlinks', repo, scratchRepoPath], { stdio: 'pipe' });
  const localWm = new WorkspaceManager(path.join(scratch, 'workspaces'));
  const localRepoCache: any = { 
  /** Prépare le dépôt et la révision nécessaires. */
  ensureRepo: () => scratchRepoPath };
  let packageCallCount = 0;
  const fakeMavenAdapter: any = {
    /** Prépare les données nécessaires à ce scénario. */
    packageCandidateWithTests: () => {
      packageCallCount++;
      return { status: 'SUCCESS', exitCode: 0, durationMs: 1, timedOut: false, evidenceTail: '', testsExecuted: true, testsPassed: true, testsTotal: 1, testsFailures: 0, testsErrors: 0, testsSkipped: 0 };
    },
  };
  let scanCall = 0;
  const fakeScanner: any = {
    /** Inspecte les données ou l’artefact pour en tirer des preuves. */
    inspect: (w: string) => {
      scanCall++;
      const digest = require('./security-artifact-validator').trackedSourceDigest(w);
      // Baseline (scanCall 1): both CVEs present. Candidate (scanCall 2):
      // h2's CVE-2022-45868 is gone; the OTHER target's CVE-9999-00001 is
      // deliberately left present (its real fix genuinely wasn't reached by
      // this owner bump) -- proves independence, never a shared verdict.
      const report = scanCall === 1
        ? { SchemaVersion: 2, ArtifactType: 'container_image', Results: [{ Target: 'x', Type: 'jar', Packages: [{ Name: 'com.h2database:h2', Version: '2.1.212' }, { Name: 'com.example:other', Version: '1.0.0' }], Vulnerabilities: [
            { VulnerabilityID: 'CVE-2022-45868', PkgName: 'com.h2database:h2', InstalledVersion: '2.1.212', Severity: 'CRITICAL' },
            { VulnerabilityID: 'CVE-9999-00001', PkgName: 'com.example:other', InstalledVersion: '1.0.0', Severity: 'HIGH' },
          ] }] }
        : { SchemaVersion: 2, ArtifactType: 'container_image', Results: [{ Target: 'x', Type: 'jar', Packages: [{ Name: 'com.h2database:h2', Version: '2.1.214' }, { Name: 'com.example:other', Version: '1.0.0' }], Vulnerabilities: [
            { VulnerabilityID: 'CVE-9999-00001', PkgName: 'com.example:other', InstalledVersion: '1.0.0', Severity: 'HIGH' },
          ] }] };
      return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: digest, artifactDigest: 'd'.repeat(64), reportDigest: 'e'.repeat(64), scannerVersion: 'fixture', report, buildPassed: true };
    },
  };
  const adapter = new DependencyCompatibilityValidationAdapter({} as any, localWm, localRepoCache, fakeMavenAdapter, fakeScanner);
  const h2Plan = h2ParentPlan();
  const otherPlan = h2ParentPlan();
  otherPlan.vulnerableDependency = 'com.example:other';
  otherPlan.securityCandidate = { ...otherPlan.securityCandidate, cve: 'CVE-9999-00001', version: '1.0.0' };
  const ctx = context();
  const results = adapter.runFullOwnerValidationMulti('2.7.18', [
    { plan: h2Plan, resolvedVulnerableVersion: '2.1.214' },
    { plan: otherPlan, resolvedVulnerableVersion: '1.0.0' },
  ], ctx);
  assert.equal(packageCallCount, 1, 'exactly one real build for two findings sharing the same owner edit');
  assert.equal(scanCall, 2, 'exactly one baseline + one candidate scan, never two per finding');
  assert.equal(results.length, 2);
  assert.equal(results[0].status, 'VALIDATED', results[0].reason);
  assert.equal(results[0].targetCveClosed, true);
  assert.notEqual(results[1].status, 'VALIDATED');
  assert.equal(results[1].targetCveClosed, false, 'the second target\'s own CVE was never actually closed by this owner bump -- must not inherit the first target\'s VALIDATED verdict');
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('8. runFullOwnerValidationMulti (Phase 3): one real build+scan shared by two findings, each independently gated on its own CVE: PASS');

console.log('dependency-compatibility-validation-adapter.spec.ts: ALL CHECKS PASS');
