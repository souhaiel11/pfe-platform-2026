// Regroupe les traitements de dépendance compatibilité validation adaptateur.
import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { SecurityRemediationOrchestratorService } from './security-remediation-orchestrator.service';
import { WorkspaceManager } from './workspace-manager.service';
import { RepoCacheService } from './repo-cache.service';
import { MavenBuildAdapter } from './maven-build-adapter';
import { RemoteBuilderArtifactValidator } from './remote-builder-artifact-validator';
import { SecurityArtifactValidator, ArtifactRuntimeError, trackedSourceDigest, provesSecurityClosure, cveTargets, countHighCriticalVulnerabilities } from './security-artifact-validator';
import { RemediationPlan } from '../../backend/src/dependency-compatibility/remediation-plan';
import { TestedCandidate, gateCandidate, PassFail, TestOutcome } from '../../backend/src/dependency-compatibility/dependency-compatibility-decision';
import { discoverOwnerVersionCandidates } from '../../backend/src/dependency-compatibility/owner-version-discovery';
import { runOwnerDiscoveryTrial } from '../../backend/src/dependency-compatibility/owner-discovery-trial';
import { applyOwnerVersionEdit } from '../../backend/src/dependency-compatibility/owner-pom-edit';
import { compareMavenVersions } from '../../backend/src/dependency-compatibility/maven-qualifier-comparator';
import { isAutomationEligiblePolicy } from '../../backend/src/dependency-compatibility/candidate-version-policy';
import { SecurityFindingDecisionInput } from '../../backend/src/security-remediation/security-finding-decision.types';
import { SecurityRemediationCandidateResult } from '../../backend/src/security-remediation/security-remediation-orchestration.types';
import { MavenRemediationScope } from '../../backend/src/security-remediation/maven-remediation-scope';
import * as fs from 'fs';
import * as path from 'path';

export interface ValidationContext {
  repository: string;
  candidateBaseSha: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  overallDeadlineMs?: number;
  /** pom.xml path relative to the repo root -- named explicitly (never hardcoded 'pom.xml' inline) so a future multi-module project is never silently mis-patched. */
  pomRelativePath: string;
}

/** Construit un résultat indiquant que le candidat n’a pas été testé. */
function notTestedCandidate(plan: RemediationPlan, reason: string): TestedCandidate {
  return {
    candidateVersion: plan.toVersion ?? '(undiscovered)',
    actualEditTarget: plan.editCoordinate,
    existence: 'UNKNOWN_REPOSITORY_ACCESS',
    resolvedVersion: null,
    dependencyResolution: 'NOT_RUN' as any,
    build: 'NOT_RUN' as any,
    tests: 'NOT_RUN',
    securityRescan: 'NOT_RUN' as any,
    targetCveClosed: false,
    newHighCriticalCount: null,
    dependencyGraphDelta: [],
    versionPolicy: plan.versionPolicy,
    automationEligible: false,
    status: 'NOT_TESTED',
    reason,
  };
}

@Injectable()
export class DependencyCompatibilityValidationAdapter {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @Optional() private readonly orchestrator: SecurityRemediationOrchestratorService = new SecurityRemediationOrchestratorService(),
    @Optional() private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    @Optional() private readonly repoCache: RepoCacheService = new RepoCacheService(),
    @Optional() private readonly mavenAdapter: MavenBuildAdapter = new MavenBuildAdapter(),
    @Optional() private readonly securityValidator: SecurityArtifactValidator = new RemoteBuilderArtifactValidator(),
  ) {}

  /** Vérifie les données et renvoie leur forme utilisable. */
  validate(plan: RemediationPlan, context: ValidationContext, additionalCveIds?: string[]): TestedCandidate {
    if (plan.editType === 'DEPENDENCY_VERSION' || plan.editType === 'PROPERTY_VERSION') {
      return this.validateDirectOrPropertyPlan(plan, context, additionalCveIds);
    }
    if (plan.editType === 'PARENT_VERSION' || plan.editType === 'BOM_VERSION') {
      return this.validateOwnerPlanCheapTrialOnly(plan, context);
    }
    return notTestedCandidate(plan, 'DEPENDENCY_MANAGEMENT_VERSION_HAS_NO_REAL_WRITER: not DIRECT_EXPLICIT/PROPERTY_MANAGED (production writer scope) and has no separate owner artifact (this adapter\'s owner-discovery scope) -- neither real path applies.');
  }

  /** Valide direct ou propriété plan. */

  private validateDirectOrPropertyPlan(plan: RemediationPlan, context: ValidationContext, additionalCveIds?: string[]): TestedCandidate {
    const findingIdentity = createHash('sha256')
      .update(`${context.repository}:${context.candidateBaseSha}:${plan.securityCandidate.cve}:${plan.vulnerableDependency}:${plan.toVersion}`)
      .digest('hex');
    const finding: SecurityFindingDecisionInput = {
      cveId: plan.securityCandidate.cve,
      findingIdentity,
      source: plan.securityCandidate.source,
      package: plan.vulnerableDependency,
      expectedInstalledVersion: plan.fromVersion,
      fixedVersion: plan.toVersion,
    };
    const result = this.orchestrator.orchestrate({
      finding, repository: context.repository, candidateBaseSha: context.candidateBaseSha,
      requestId: context.requestId, batchId: context.batchId, candidateAttempt: context.candidateAttempt,
      overallDeadlineMs: context.overallDeadlineMs, additionalCveIds,
    });
    return this.mapOrchestratorResult(plan, result);
  }

  /** Convertit Orchestrator résultat. */
  private mapOrchestratorResult(plan: RemediationPlan, result: SecurityRemediationCandidateResult): TestedCandidate {
    const toVersion = plan.toVersion!;
    const dependencyResolution: PassFail = result.dependencyResolutionEvidence === null ? 'NOT_RUN'
      : result.dependencyResolutionEvidence.resolvedMatch === true ? 'PASS'
      : result.dependencyResolutionEvidence.resolvedMatch === false ? 'FAIL' : 'NOT_RUN';
    // Reaching real Maven dependency-resolution evidence at all (whether it
    // matched or not) already proves the candidate artifact itself exists
    // in a repository this project can reach -- a real `mvn dependency:tree`
    // cannot report a resolution mismatch for an artifact that was never
    // fetchable in the first place (it would instead fail as
    // MAVEN_RESOLUTION_FAILED, which also implies dependencyResolutionEvidence.checked=true here).
    const existence = result.dependencyResolutionEvidence !== null ? 'AVAILABLE' as const : 'UNKNOWN_REPOSITORY_ACCESS' as const;
    const resolvedVersion = dependencyResolution === 'PASS' ? toVersion : null;

    let build: PassFail = 'NOT_RUN';
    let tests: TestOutcome = 'NOT_RUN';
    if (result.applicationTests) {
      const buildTimedOut = result.status === 'TECHNICAL_FAILURE' && !result.applicationTests.executed;
      build = (result.status === 'CANDIDATE_BUILD_FAILED' || buildTimedOut) ? 'FAIL' : 'PASS';
      tests = !result.applicationTests.executed
        ? (result.status === 'APPLICATION_TESTS_NOT_EXECUTED' ? 'NOT_EXECUTED' : 'NOT_RUN')
        : (result.applicationTests.passed ? 'PASS' : 'FAIL');
    }

    const securityRescan: PassFail = result.securityValidationEvidence?.status === 'TARGET_CVE_CLOSED' ? 'PASS'
      : (result.status === 'CANDIDATE_SECURITY_VALIDATION_FAILED' ? 'FAIL' : 'NOT_RUN');
    const targetCveClosed = result.securityValidationEvidence?.status === 'TARGET_CVE_CLOSED';
    const newHighCriticalCount = result.securityValidationEvidence?.newHighCriticalCount ?? null;

    const evidence: Omit<TestedCandidate, 'status' | 'reason'> = {
      candidateVersion: toVersion, actualEditTarget: plan.editCoordinate, existence, resolvedVersion,
      dependencyResolution, build, tests, securityRescan, targetCveClosed, newHighCriticalCount,
      dependencyGraphDelta: [], versionPolicy: plan.versionPolicy, automationEligible: plan.automationEligible,
    };
    const gate = gateCandidate(evidence, toVersion);
    const additionalCveNote = result.securityValidationEvidence?.additionalCveClosure?.length
      ? ` additionalCveClosure=${JSON.stringify(result.securityValidationEvidence.additionalCveClosure)}` : '';
    return { ...evidence, ...gate, reason: `${gate.reason} (real orchestrator status: ${result.status}/${result.reason})${additionalCveNote}` };
  }

  /** Valide propriétaire plan Cheap Trial seul. */

  private validateOwnerPlanCheapTrialOnly(plan: RemediationPlan, context: ValidationContext): TestedCandidate {
    const [ownerGroupId, ownerArtifactId] = plan.editCoordinate.split(':');
    if (!ownerGroupId || !ownerArtifactId) return notTestedCandidate(plan, `INVALID_EDIT_COORDINATE:${plan.editCoordinate}`);

    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(context.repository, context.overallDeadlineMs);
    } catch (err: any) {
      return notTestedCandidate(plan, `WORKSPACE_FAILURE: repository materialization failed: ${err?.message || 'unknown error'}`);
    }

    const workspaceId = this.workspaceManager.workspaceId(context.requestId, context.batchId, context.candidateAttempt, 1);
    let workspacePath: string;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath, candidateBaseSha: context.candidateBaseSha, requestId: context.requestId,
        batchId: context.batchId, candidateAttempt: context.candidateAttempt, verificationStep: 1,
      });
      workspacePath = handle.path;
      if (!handle.exactShaVerified || handle.checkoutSha.toLowerCase() !== context.candidateBaseSha.toLowerCase()) {
        this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
        return notTestedCandidate(plan, `WORKSPACE_FAILURE: checkout (${handle.checkoutSha}) does not match candidateBaseSha (${context.candidateBaseSha}).`);
      }
    } catch (err: any) {
      return notTestedCandidate(plan, `WORKSPACE_FAILURE: ${err?.message || 'workspace creation failed'}`);
    }

    try {
      const discovery = discoverOwnerVersionCandidates({
        groupId: ownerGroupId, artifactId: ownerArtifactId, currentVersion: plan.fromVersion, cwd: workspacePath,
      });
      if (discovery.status !== 'DISCOVERED' || !discovery.sameMajorCandidates.length) {
        return notTestedCandidate(plan, discovery.status === 'DISCOVERED' ? 'NO_SAME_MAJOR_OWNER_CANDIDATE_FOUND' : discovery.status);
      }

      for (const ownerCandidate of discovery.sameMajorCandidates) {
        const trial = runOwnerDiscoveryTrial({ workspacePath, pomRelativePath: context.pomRelativePath, plan, ownerCandidateVersion: ownerCandidate.version });
        if (trial.status !== 'RESOLVED' || !trial.resolvedVulnerableVersion) continue;
        const cmp = compareMavenVersions(trial.resolvedVulnerableVersion, plan.securityCandidate.version);
        const plausiblyAddressesTarget = cmp === 0 || cmp === 1;
        if (!plausiblyAddressesTarget) continue; // real evidence: this owner candidate resolves the dependency, but not far enough (Phase 7's own point) -- try the next.
        return {
          candidateVersion: ownerCandidate.version, actualEditTarget: plan.editCoordinate,
          existence: 'AVAILABLE', resolvedVersion: trial.resolvedVulnerableVersion,
          dependencyResolution: 'PASS', build: 'NOT_RUN', tests: 'NOT_RUN', securityRescan: 'NOT_RUN',
          targetCveClosed: false, newHighCriticalCount: null, dependencyGraphDelta: [],
          versionPolicy: ownerCandidate.policy, automationEligible: isAutomationEligiblePolicy(ownerCandidate.policy),
          status: 'NOT_TESTED',
          reason: `PHASE6_CHEAP_TRIAL_ONLY: real mvn dependency:tree after bumping ${plan.editCoordinate} ${plan.fromVersion} -> ${ownerCandidate.version} resolves ${plan.vulnerableDependency} to ${trial.resolvedVulnerableVersion} (>= security target ${plan.securityCandidate.version}). Resolution proven; full build/tests/security-rescan (Phase 8, runFullOwnerValidation()) not yet run for this candidate -- resolution alone never proves CVE closure.`,
        };
      }
      return notTestedCandidate(plan, `NO_SAME_MAJOR_OWNER_CANDIDATE_RESOLVES_TARGET: none of the ${discovery.sameMajorCandidates.length} bounded same-major owner candidate(s) tried (${discovery.sameMajorCandidates.map(c => c.version).join(', ')}) resolve ${plan.vulnerableDependency} to >= the security target ${plan.securityCandidate.version}.`);
    } finally {
      this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
    }
  }

  /** Exécute complet propriétaire validation. */
  runFullOwnerValidation(plan: RemediationPlan, ownerCandidateVersion: string, resolvedVulnerableVersion: string, context: ValidationContext): TestedCandidate {
    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(context.repository, context.overallDeadlineMs);
    } catch (err: any) {
      return notTestedCandidate(plan, `WORKSPACE_FAILURE: repository materialization failed: ${err?.message || 'unknown error'}`);
    }
    const workspaceId = this.workspaceManager.workspaceId(context.requestId, context.batchId, context.candidateAttempt, 2);
    let workspacePath: string;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath, candidateBaseSha: context.candidateBaseSha, requestId: context.requestId,
        batchId: context.batchId, candidateAttempt: context.candidateAttempt, verificationStep: 2,
      });
      workspacePath = handle.path;
      if (!handle.exactShaVerified || handle.checkoutSha.toLowerCase() !== context.candidateBaseSha.toLowerCase()) {
        this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
        return notTestedCandidate(plan, `WORKSPACE_FAILURE: checkout (${handle.checkoutSha}) does not match candidateBaseSha.`);
      }
    } catch (err: any) {
      return notTestedCandidate(plan, `WORKSPACE_FAILURE: ${err?.message || 'workspace creation failed'}`);
    }

    try {
      const pomPath = path.join(workspacePath, context.pomRelativePath);
      const originalContent = fs.readFileSync(pomPath, 'utf8');
      const baselineDigest = trackedSourceDigest(workspacePath);
      let baselineScan;
      try {
        baselineScan = this.securityValidator.inspect(workspacePath, context.overallDeadlineMs);
      } catch (err: any) {
        return notTestedCandidate(plan, err instanceof ArtifactRuntimeError ? `${err.code}:${err.stage}` : String(err?.message || 'baseline scan failed'));
      }
      if (baselineScan.sourceDigest !== baselineDigest) return notTestedCandidate(plan, 'BASE_SCAN_SOURCE_BINDING_FAILED');

      const edit = applyOwnerVersionEdit(originalContent, plan, ownerCandidateVersion);
      if (!edit.ok) return notTestedCandidate(plan, `POM_EDIT_FAILED:${edit.reason}`);
      fs.writeFileSync(pomPath, edit.content!, 'utf8');

      let packageResult;
      try {
        packageResult = this.mavenAdapter.packageCandidateWithTests(workspacePath, context.overallDeadlineMs);
      } catch (err: any) {
        return notTestedCandidate(plan, err instanceof ArtifactRuntimeError ? `${err.code}:${err.stage}` : String(err?.message || 'build failed'));
      }
      const dependencyResolution: PassFail = 'PASS'; // proven by the Phase 6 cheap trial that selected this exact candidate; not re-derived from packageResult, which does not itself report a dependency:tree.
      // Maven's own lifecycle binding means `package` cannot succeed while
      // `test` has real failures (see MavenBuildAdapter.packageCandidateWithTests's
      // own header comment) -- so packageResult.status alone already
      // distinguishes a genuine compile/packaging failure from a test
      // failure; testsExecuted/testsPassed then distinguish "tests failed"
      // from "no tests ran at all" for the `tests` outcome specifically.
      let build: PassFail = 'NOT_RUN';
      let tests: TestOutcome = 'NOT_RUN';
      if (packageResult.timedOut) {
        build = 'FAIL';
      } else {
        build = packageResult.status === 'SUCCESS' ? 'PASS' : (packageResult.testsExecuted ? 'PASS' : 'FAIL');
        tests = !packageResult.testsExecuted ? 'NOT_EXECUTED' : (packageResult.testsPassed ? 'PASS' : 'FAIL');
      }
      if (build !== 'PASS') {
        return {
          candidateVersion: ownerCandidateVersion, actualEditTarget: plan.editCoordinate, existence: 'AVAILABLE',
          resolvedVersion: resolvedVulnerableVersion, dependencyResolution, build, tests, securityRescan: 'NOT_RUN',
          targetCveClosed: false, newHighCriticalCount: null, dependencyGraphDelta: [],
          versionPolicy: plan.versionPolicy, automationEligible: plan.automationEligible,
          status: 'REJECTED', reason: tests === 'FAIL' ? 'TESTS_FAILED' : 'BUILD_FAILED',
        };
      }

      const candidateDigest = trackedSourceDigest(workspacePath);
      let candidateScan;
      try {
        candidateScan = this.securityValidator.inspect(workspacePath, context.overallDeadlineMs);
      } catch (err: any) {
        return notTestedCandidate(plan, err instanceof ArtifactRuntimeError ? `${err.code}:${err.stage}` : String(err?.message || 'candidate scan failed'));
      }
      if (candidateScan.sourceDigest !== candidateDigest) return notTestedCandidate(plan, 'CANDIDATE_SCAN_SOURCE_BINDING_FAILED');

      const scope: MavenRemediationScope = {
        kind: 'SINGLE_CONTROL', targetCve: plan.securityCandidate.cve, evaluatedSha: context.candidateBaseSha,
        controllingFile: context.pomRelativePath, originalBlobSha: '', controls: [],
        affectedPackages: [{ package: plan.vulnerableDependency, installedVersion: plan.fromVersion, targetVersion: resolvedVulnerableVersion }],
      };
      const closed = provesSecurityClosure(candidateScan, scope);
      const newHighCriticalCount = Math.max(0, countHighCriticalVulnerabilities(candidateScan.report) - countHighCriticalVulnerabilities(baselineScan.report));

      const evidence: Omit<TestedCandidate, 'status' | 'reason'> = {
        candidateVersion: ownerCandidateVersion, actualEditTarget: plan.editCoordinate, existence: 'AVAILABLE',
        resolvedVersion: resolvedVulnerableVersion, dependencyResolution, build, tests,
        securityRescan: 'PASS', targetCveClosed: closed, newHighCriticalCount, dependencyGraphDelta: [],
        versionPolicy: plan.versionPolicy, automationEligible: plan.automationEligible,
      };
      const gate = gateCandidate(evidence, resolvedVulnerableVersion);
      return { ...evidence, ...gate };
    } finally {
      this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
    }
  }

  /** Exécute complet propriétaire validation Multi. */
  runFullOwnerValidationMulti(
    ownerCandidateVersion: string,
    targets: { plan: RemediationPlan; resolvedVulnerableVersion: string }[],
    context: ValidationContext,
  ): TestedCandidate[] {
    if (!targets.length) return [];
    const [first, ...rest] = targets;
    for (const t of rest) {
      if (t.plan.editType !== first.plan.editType || t.plan.editCoordinate !== first.plan.editCoordinate || t.plan.fromVersion !== first.plan.fromVersion) {
        throw new Error('runFullOwnerValidationMulti: all targets must share the identical owner edit (editType/editCoordinate/fromVersion).');
      }
    }
    const ownerPlan = first.plan;

    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(context.repository, context.overallDeadlineMs);
    } catch (err: any) {
      return targets.map(t => notTestedCandidate(t.plan, `WORKSPACE_FAILURE: repository materialization failed: ${err?.message || 'unknown error'}`));
    }
    const workspaceId = this.workspaceManager.workspaceId(context.requestId, context.batchId, context.candidateAttempt, 2);
    let workspacePath: string;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath, candidateBaseSha: context.candidateBaseSha, requestId: context.requestId,
        batchId: context.batchId, candidateAttempt: context.candidateAttempt, verificationStep: 2,
      });
      workspacePath = handle.path;
      if (!handle.exactShaVerified || handle.checkoutSha.toLowerCase() !== context.candidateBaseSha.toLowerCase()) {
        this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
        return targets.map(t => notTestedCandidate(t.plan, `WORKSPACE_FAILURE: checkout (${handle.checkoutSha}) does not match candidateBaseSha.`));
      }
    } catch (err: any) {
      return targets.map(t => notTestedCandidate(t.plan, `WORKSPACE_FAILURE: ${err?.message || 'workspace creation failed'}`));
    }

    try {
      const pomPath = path.join(workspacePath, context.pomRelativePath);
      const originalContent = fs.readFileSync(pomPath, 'utf8');
      const baselineDigest = trackedSourceDigest(workspacePath);
      let baselineScan;
      try {
        baselineScan = this.securityValidator.inspect(workspacePath, context.overallDeadlineMs);
      } catch (err: any) {
        return targets.map(t => notTestedCandidate(t.plan, err instanceof ArtifactRuntimeError ? `${err.code}:${err.stage}` : String(err?.message || 'baseline scan failed')));
      }
      if (baselineScan.sourceDigest !== baselineDigest) return targets.map(t => notTestedCandidate(t.plan, 'BASE_SCAN_SOURCE_BINDING_FAILED'));

      const edit = applyOwnerVersionEdit(originalContent, ownerPlan, ownerCandidateVersion);
      if (!edit.ok) return targets.map(t => notTestedCandidate(t.plan, `POM_EDIT_FAILED:${edit.reason}`));
      fs.writeFileSync(pomPath, edit.content!, 'utf8');

      let packageResult;
      try {
        packageResult = this.mavenAdapter.packageCandidateWithTests(workspacePath, context.overallDeadlineMs);
      } catch (err: any) {
        return targets.map(t => notTestedCandidate(t.plan, err instanceof ArtifactRuntimeError ? `${err.code}:${err.stage}` : String(err?.message || 'build failed')));
      }
      const dependencyResolution: PassFail = 'PASS';
      let build: PassFail = 'NOT_RUN';
      let tests: TestOutcome = 'NOT_RUN';
      if (packageResult.timedOut) {
        build = 'FAIL';
      } else {
        build = packageResult.status === 'SUCCESS' ? 'PASS' : (packageResult.testsExecuted ? 'PASS' : 'FAIL');
        tests = !packageResult.testsExecuted ? 'NOT_EXECUTED' : (packageResult.testsPassed ? 'PASS' : 'FAIL');
      }
      if (build !== 'PASS') {
        return targets.map(t => ({
          candidateVersion: ownerCandidateVersion, actualEditTarget: t.plan.editCoordinate, existence: 'AVAILABLE',
          resolvedVersion: t.resolvedVulnerableVersion, dependencyResolution, build, tests, securityRescan: 'NOT_RUN',
          targetCveClosed: false, newHighCriticalCount: null, dependencyGraphDelta: [],
          versionPolicy: t.plan.versionPolicy, automationEligible: t.plan.automationEligible,
          status: 'REJECTED', reason: tests === 'FAIL' ? 'TESTS_FAILED' : 'BUILD_FAILED',
        }));
      }

      const candidateDigest = trackedSourceDigest(workspacePath);
      let candidateScan;
      try {
        candidateScan = this.securityValidator.inspect(workspacePath, context.overallDeadlineMs);
      } catch (err: any) {
        return targets.map(t => notTestedCandidate(t.plan, err instanceof ArtifactRuntimeError ? `${err.code}:${err.stage}` : String(err?.message || 'candidate scan failed')));
      }
      if (candidateScan.sourceDigest !== candidateDigest) return targets.map(t => notTestedCandidate(t.plan, 'CANDIDATE_SCAN_SOURCE_BINDING_FAILED'));

      const newHighCriticalCount = Math.max(0, countHighCriticalVulnerabilities(candidateScan.report) - countHighCriticalVulnerabilities(baselineScan.report));

      return targets.map(t => {
        const scope: MavenRemediationScope = {
          kind: 'COORDINATED_SAME_FILE', targetCve: t.plan.securityCandidate.cve, evaluatedSha: context.candidateBaseSha,
          controllingFile: context.pomRelativePath, originalBlobSha: '', controls: [],
          affectedPackages: [{ package: t.plan.vulnerableDependency, installedVersion: t.plan.fromVersion, targetVersion: t.resolvedVulnerableVersion }],
        };
        const closed = provesSecurityClosure(candidateScan, scope);
        const evidence: Omit<TestedCandidate, 'status' | 'reason'> = {
          candidateVersion: ownerCandidateVersion, actualEditTarget: t.plan.editCoordinate,
          resolvedVersion: t.resolvedVulnerableVersion, dependencyResolution, build, tests, existence: 'AVAILABLE',
          securityRescan: 'PASS', targetCveClosed: closed, newHighCriticalCount, dependencyGraphDelta: [],
          versionPolicy: t.plan.versionPolicy, automationEligible: t.plan.automationEligible,
        };
        const gate = gateCandidate(evidence, t.resolvedVulnerableVersion);
        return { ...evidence, ...gate, reason: `${gate.reason} (real coordinated multi-CVE owner build; shared with ${targets.length - 1} other target(s) under the same owner edit)` };
      });
    } finally {
      this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
    }
  }
}
