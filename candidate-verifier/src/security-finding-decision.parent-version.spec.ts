// V1.8 Phase 7B — contract tests for SecurityFindingDecisionService.decide()'s
// PARENT_VERSION branch. Fast/pure section uses a FAKE GroundedMavenProvenanceService
// (structural match, no real checkout) to isolate the decision-routing logic
// itself; the REAL end-to-end proof (real checkout, real writer, real guard)
// lives in this file's own final section, reusing the SAME real repository
// this project's other specs already use (security-finding-decision.spec.ts).
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SecurityFindingDecisionService } from './security-finding-decision.service';
import { GroundedMavenProvenanceService } from './grounded-maven-provenance.service';
import { WorkspaceManager } from './workspace-manager.service';
import { RepoCacheService } from './repo-cache.service';
import { MavenBuildAdapter } from './maven-build-adapter';
import { assertParentVersionPatchSafeToWrite } from '../../backend/src/security-remediation/security-patch-guard';
import { verifyParentUpgradeEffectiveVersions } from '../../backend/src/security-remediation/parent-version-effective-model-check';
import { GroundedMavenProvenanceResult } from '../../backend/src/security-remediation/grounded-maven-provenance.types';
import { SecurityFindingDecisionInput } from '../../backend/src/security-remediation/security-finding-decision.types';

const EVALUATED_SHA = 'a'.repeat(40);
const REAL_PARENT_POM = `<project>\n  <parent>\n    <groupId>org.springframework.boot</groupId>\n    <artifactId>spring-boot-starter-parent</artifactId>\n    <version>2.7.0</version>\n  </parent>\n  <dependencies>\n    <dependency>\n      <groupId>com.fasterxml.jackson.core</groupId>\n      <artifactId>jackson-databind</artifactId>\n    </dependency>\n  </dependencies>\n</project>`;

function fakeProvenanceService(pomXmlText: string | null = REAL_PARENT_POM, ok = true): any {
  return {
    resolve: (): GroundedMavenProvenanceResult => ok
      ? { ok: true, provenance: { ecosystem: 'MAVEN', kind: 'TRANSITIVE', package: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.13.3', controllingFile: null, controllingElement: null, controllingProperty: null, groundedSha: EVALUATED_SHA, evidence: 'fake' }, evidence: { requestedSha: EVALUATED_SHA, checkoutSha: EVALUATED_SHA, evaluatedSha: EVALUATED_SHA, pomXmlText } }
      : { ok: false, failureClass: 'WORKSPACE_INFRA_FAILURE', detail: 'fake failure', evidence: { requestedSha: EVALUATED_SHA, checkoutSha: null, evaluatedSha: null, pomXmlText: null } },
  };
}

function baseFinding(overrides: Partial<SecurityFindingDecisionInput> = {}): SecurityFindingDecisionInput {
  return {
    findingIdentity: 'fp-parent-1', source: 'OWASP',
    package: 'com.fasterxml.jackson.core:jackson-databind', expectedInstalledVersion: '2.13.3',
    fixedVersion: null, // deliberately null/irrelevant -- the parent path must not depend on it (test B below)
    parentRemediationPlan: { actualEditTarget: 'org.springframework.boot:spring-boot-starter-parent', fromVersion: '2.7.0', toVersion: '2.7.18' },
    ...overrides,
  };
}
const workspace = { repository: 'souhaiel11/pfe-app-test', candidateBaseSha: EVALUATED_SHA, requestId: 'req-1', batchId: 'batch-1', candidateAttempt: 0 };

// ============================================================================
// A. V1.8 PARENT_VERSION plan -> writeParentVersionPatch invoked (proven via
// its actual output: parentPatchCandidate present, editType set, targetVersion
// == plan.toVersion).
// ============================================================================
{
  const service = new SecurityFindingDecisionService(fakeProvenanceService());
  const decision = service.decide(baseFinding(), workspace);
  assert.equal(decision.editType, 'PARENT_VERSION', `A: ${JSON.stringify(decision)}`);
  assert.equal(decision.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.equal(decision.selectedTargetVersion, '2.7.18');
  assert.ok(decision.parentPatchCandidate, 'A: writer actually produced a candidate');
  assert.match(decision.parentPatchCandidate!.file.content, /<version>2\.7\.18<\/version>/);
  assert.equal(decision.provenance?.kind, 'PARENT_MANAGED');
}
console.log('security-finding-decision (parent) A) V1.8 PARENT_VERSION plan -> writeParentVersionPatch invoked: PASS');

// ============================================================================
// B. finding package != actualEditTarget -> supported correctly, never a
// false mismatch (this IS the normal/expected shape for every real
// PARENT_VERSION finding -- jackson-databind's own package never equals the
// Spring Boot parent coordinate). Also proves fixedVersion (null here) is
// never consulted on this path.
// ============================================================================
{
  const finding = baseFinding();
  assert.notEqual(finding.package, finding.parentRemediationPlan!.actualEditTarget, 'B: sanity -- package genuinely differs from actualEditTarget');
  const service = new SecurityFindingDecisionService(fakeProvenanceService());
  const decision = service.decide(finding, workspace);
  assert.equal(decision.remediationType, 'AUTO_FIX_ELIGIBLE', `B: package!=actualEditTarget must not be treated as a mismatch: ${JSON.stringify(decision)}`);
}
console.log('security-finding-decision (parent) B) finding package != actualEditTarget -> supported, no false mismatch: PASS');

// ============================================================================
// C. parent target mismatch (real pom has a DIFFERENT parent artifactId than
// the plan claims) -> BLOCK, named reason, never guesses/falls back.
// ============================================================================
{
  const service = new SecurityFindingDecisionService(fakeProvenanceService());
  const decision = service.decide(baseFinding({ parentRemediationPlan: { actualEditTarget: 'org.springframework.boot:WRONG-artifact', fromVersion: '2.7.0', toVersion: '2.7.18' } }), workspace);
  assert.equal(decision.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.match(decision.reason, /^PARENT_WRITE_FAILED:PARENT_ARTIFACT_MISMATCH/);
  assert.equal(decision.parentPatchCandidate, null);
}
console.log('security-finding-decision (parent) C) parent target mismatch -> BLOCK: PASS');

// ============================================================================
// D. fromVersion mismatch (plan claims a version the real pom does not have)
// -> BLOCK, named reason.
// ============================================================================
{
  const service = new SecurityFindingDecisionService(fakeProvenanceService());
  const decision = service.decide(baseFinding({ parentRemediationPlan: { actualEditTarget: 'org.springframework.boot:spring-boot-starter-parent', fromVersion: '2.6.9', toVersion: '2.7.18' } }), workspace);
  assert.equal(decision.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.match(decision.reason, /^PARENT_WRITE_FAILED:PARENT_VERSION_MISMATCH/);
}
console.log('security-finding-decision (parent) D) fromVersion mismatch -> BLOCK: PASS');

// ============================================================================
// E. missing parent plan (task dispatched with no v1_8Plan at all, e.g. a
// non-ENFORCED/legacy task) -> decide() takes the NORMAL path, never
// synthesizes a parent edit out of nothing. Uses the REAL classifier path
// (fixedVersion genuinely missing here) -> DEVELOPER_ACTION_REQUIRED,
// exactly like any ordinary non-eligible finding -- never AUTO_FIX_ELIGIBLE.
// ============================================================================
{
  const service = new SecurityFindingDecisionService(fakeProvenanceService());
  const decision = service.decide(baseFinding({ parentRemediationPlan: undefined, fixedVersion: null }), workspace);
  assert.equal(decision.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(decision.editType, undefined, 'E: no parentRemediationPlan -> editType must never be set to PARENT_VERSION');
  assert.equal(decision.reason, 'FIXED_VERSION_MISSING');
}
console.log('security-finding-decision (parent) E) missing parent plan -> normal path, never a synthesized parent edit: PASS');

// ============================================================================
// Grounding failure on the parent path -> BLOCK, named, evaluatedSha null
// (never fabricated).
// ============================================================================
{
  const service = new SecurityFindingDecisionService(fakeProvenanceService(null, false));
  const decision = service.decide(baseFinding(), workspace);
  assert.equal(decision.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.match(decision.reason, /^GROUNDING_FAILED:/);
  assert.equal(decision.evaluatedSha, null);
}
console.log('security-finding-decision (parent) grounding failure -> BLOCK, never fabricated: PASS');

// ============================================================================
// J / §12 causal-difference test — proves the writer's target came from the
// V1.8 PLAN, not from any re-derivation/selection downstream. `fixedVersion`
// is set here to a synthetic scanner string that, if a legacy
// selectEligibleTargetVersion()-style policy were EVER consulted on this
// path, would pick a DIFFERENT ("lowest same-major") version than the
// plan's own toVersion -- proving decide() never reaches that policy at all
// for a PARENT_VERSION finding (structurally impossible: this branch
// returns before fixedVersions/classifySecurityAutoFixEligibility is ever
// touched -- see decide()'s own early-return ordering).
// ============================================================================
{
  const service = new SecurityFindingDecisionService(fakeProvenanceService());
  const decision = service.decide(baseFinding({ fixedVersion: '2.7.1, 2.7.18, 2.7.99' }), workspace);
  assert.equal(decision.selectedTargetVersion, '2.7.18', 'J: must be exactly the PLAN toVersion, never "2.7.1" (a legacy lowest-same-major policy would have picked that instead)');
  assert.equal(decision.parentPatchCandidate!.file.content.includes('<version>2.7.1</version>'), false, 'J: the rejected legacy-style version never appears in the produced patch');
}
console.log('security-finding-decision (parent) J/§12) causal-difference: writer target is the V1.8 plan, never a legacy re-selection: PASS');

// ============================================================================
// §13 — REAL, offline, end-to-end proof through the SAME live decision
// pipeline code (resolver's own shape -> decide() -> guard -> writer ->
// resulting pom), using the exact validated commit, real checkout, real
// Maven -- NEVER by directly invoking writeParentVersionPatch() as a
// shortcut. No GitHub mutation, no branch push (everything happens in a
// throwaway local worktree this test creates and tears down itself).
// ============================================================================
{
  const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
  const VALIDATED_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-parent-e2e-workspace-'));
  const repoCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-parent-e2e-repocache-'));
  fs.symlinkSync(REPO_PATH, path.join(repoCacheRoot, 'souhaiel11__pfe-app-test'));
  const workspaceManager = new WorkspaceManager(scratchRoot);
  const repoCache = new RepoCacheService(repoCacheRoot);
  const mavenAdapter = new MavenBuildAdapter();
  const realProvenanceService = new GroundedMavenProvenanceService(workspaceManager, repoCache, mavenAdapter);
  const realDecisionService = new SecurityFindingDecisionService(realProvenanceService);

  // This IS what SecurityFindingResolverService.resolve() would have
  // produced for the real OWASP CVE-2022-42003 jackson-databind finding,
  // given its real persisted v1_8Plan -- reconstructed here by hand only
  // because this test has no real ManualRemediationTask row to read from,
  // never a shortcut around decide()'s own contract.
  const finding: SecurityFindingDecisionInput = {
    findingIdentity: 'real-e2e-parent-jackson', source: 'OWASP',
    package: 'com.fasterxml.jackson.core:jackson-databind', expectedInstalledVersion: '2.13.3',
    fixedVersion: null,
    parentRemediationPlan: { actualEditTarget: 'org.springframework.boot:spring-boot-starter-parent', fromVersion: '2.7.0', toVersion: '2.7.18' },
  };
  const workspaceReq = { repository: 'souhaiel11/pfe-app-test', candidateBaseSha: VALIDATED_SHA, requestId: 'real-e2e-parent-req', batchId: 'real-e2e-parent-batch', candidateAttempt: 0 };

  let decision;
  try {
    console.log('  [real E2E] calling the REAL decide() (real checkout + real writer)...');
    decision = realDecisionService.decide(finding, workspaceReq);
    assert.equal(decision.remediationType, 'AUTO_FIX_ELIGIBLE', `real E2E decide(): ${JSON.stringify(decision)}`);
    assert.equal(decision.editType, 'PARENT_VERSION');
    assert.equal(decision.selectedTargetVersion, '2.7.18');
    assert.ok(decision.parentPatchCandidate, 'real E2E: writer produced a candidate through the real pipeline');
    console.log('  [real E2E] decide() PASS -- real candidate produced via the live pipeline code.');

    // Guard: independently reproduce from the SAME trusted plan/request.
    const request = {
      findingIdentity: finding.findingIdentity, evaluatedSha: decision.evaluatedSha!, ecosystem: 'MAVEN' as const, editType: 'PARENT_VERSION' as const,
      actualEditTarget: finding.parentRemediationPlan!.actualEditTarget, fromVersion: finding.parentRemediationPlan!.fromVersion, toVersion: finding.parentRemediationPlan!.toVersion,
      controllingFile: 'pom.xml', sourceContent: decision.parentPatchCandidate!.file.sourceContent,
    };
    const guardResult = assertParentVersionPatchSafeToWrite(decision, request, decision.parentPatchCandidate!);
    assert.equal(guardResult.ok, true, `real E2E guard: ${JSON.stringify(guardResult)}`);
    console.log('  [real E2E] assertParentVersionPatchSafeToWrite() PASS.');

    // Write the resulting pom into a throwaway worktree (NOT the real repo,
    // NOT a branch, NOT pushed anywhere) and run REAL Maven against it.
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-parent-e2e-worktree-'));
    execFileSync('git', ['-C', REPO_PATH, 'worktree', 'add', '--detach', worktree, VALIDATED_SHA], { stdio: 'pipe' });
    try {
      fs.writeFileSync(path.join(worktree, 'pom.xml'), decision.parentPatchCandidate!.file.content, 'utf8');

      const treeFile = path.join(worktree, '.phase7b-dependency-tree.txt');
      execFileSync('mvn', ['dependency:tree', '-B', `-DoutputFile=${treeFile}`, '-DoutputType=text'], { cwd: worktree, timeout: 300000, stdio: 'pipe' });
      const tree = fs.readFileSync(treeFile, 'utf8');
      console.log('  [real E2E] real `mvn dependency:tree` produced', tree.split('\n').length, 'lines.');

      const effectiveCheck = verifyParentUpgradeEffectiveVersions(tree, [
        { package: 'com.fasterxml.jackson.core:jackson-databind', expectedVersion: '2.13.5' },
        { package: 'org.apache.tomcat.embed:tomcat-embed-core', expectedVersion: '9.0.83' },
        { package: 'org.springframework.security:spring-security-config', expectedVersion: '5.7.11' },
      ]);
      assert.equal(effectiveCheck.ok, true, `real E2E effective-model check: ${JSON.stringify(effectiveCheck)}`);
      console.log('  [real E2E] verifyParentUpgradeEffectiveVersions() PASS -- real resolved versions match V1.8 expectations.');

      const effectiveParentVersion = execFileSync('mvn', ['help:evaluate', '-Dexpression=project.parent.version', '-q', '-DforceStdout'], { cwd: worktree, timeout: 60000 }).toString().trim();
      assert.equal(effectiveParentVersion, '2.7.18', `real E2E: effective parent version must equal toVersion, got "${effectiveParentVersion}"`);
      console.log('  [real E2E] real `mvn help:evaluate` confirms effective project.parent.version = 2.7.18.');

      execFileSync('mvn', ['test', '-B', '-q'], { cwd: worktree, timeout: 280000, stdio: 'pipe' });
      console.log('  [real E2E] real `mvn test` PASS against the patched pom.');
    } finally {
      execFileSync('git', ['-C', REPO_PATH, 'worktree', 'remove', '--force', worktree], { stdio: 'pipe' });
    }
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    fs.rmSync(repoCacheRoot, { recursive: true, force: true });
  }
}
console.log('security-finding-decision (parent) §13) REAL offline end-to-end via the live decision pipeline (resolver-shape -> decide() -> guard -> writer -> real mvn): PASS');

console.log('security-finding-decision.parent-version.spec.ts: ALL CHECKS PASS');
