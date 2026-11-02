// Enchaîne les contrôles d’une correction de sécurité unitaire.
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { computeGitBlobSha1 } from '../../backend/src/candidate-verification/candidate-digest';
import { localMavenControls, applyMavenControls, deriveMavenRemediationScope, graphClosesScope, MavenScopeEvidence } from '../../backend/src/security-remediation/maven-remediation-scope';
import { ArtifactRuntimeError, SecurityArtifactValidator, cveTargets, provesSecurityClosure, trackedSourceDigest, countHighCriticalVulnerabilities } from './security-artifact-validator';
import { RemoteBuilderArtifactValidator } from './remote-builder-artifact-validator';
import { Injectable, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SecurityFindingDecisionService } from './security-finding-decision.service';
import { WorkspaceManager, WorkspaceError } from './workspace-manager.service';
import { RepoCacheService } from './repo-cache.service';
import { MavenBuildAdapter } from './maven-build-adapter';
import { writeSecurityPatch } from '../../backend/src/security-remediation/maven-security-patch-writer';
import { assertSecurityPatchSafeToWrite } from '../../backend/src/security-remediation/security-patch-guard';
import { computeSecurityCandidateIdentity } from '../../backend/src/security-remediation/security-candidate-identity';
import { dependencyTreeResolvesTo } from '../../backend/src/security-remediation/maven-dependency-resolution-check';
import { computeCandidateDigest, computeContentSha256 } from '../../backend/src/candidate-verification/candidate-digest';
import { SecurityPatchRequest, SecurityPatchCandidate } from '../../backend/src/security-remediation/security-patch-request.types';
import { SecurityRemediationOrchestrationInput, SecurityRemediationCandidateResult, ApplicationTestEvidence } from '../../backend/src/security-remediation/security-remediation-orchestration.types';
import { CandidateManifest } from '../../backend/src/candidate-verification/candidate-verification.types';
import { createWorkerDeadline, WorkerDeadline } from './worker-deadline';

const GROUNDING_STAGE_CAP_MS = 5 * 60 * 1000;
const MAVEN_STAGE_CAP_MS = 5 * 60 * 1000;
const BUILD_STAGE_CAP_MS = 5 * 60 * 1000;

// See maven-security-patch-writer.ts / security-finding-decision.service.ts
// for why Extract<> + a cast is used instead of relying on `if (!x.ok)`
// narrowing under this project's own strictNullChecks:false setting.
type WriteSuccess = { ok: true; candidate: SecurityPatchCandidate };

@Injectable()
export class SecurityRemediationOrchestratorService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @Optional() private readonly decisionService: SecurityFindingDecisionService = new SecurityFindingDecisionService(),
    @Optional() private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    @Optional() private readonly repoCache: RepoCacheService = new RepoCacheService(),
    @Optional() private readonly mavenAdapter: MavenBuildAdapter = new MavenBuildAdapter(),
    @Optional() private readonly securityValidator: SecurityArtifactValidator = new RemoteBuilderArtifactValidator(),
  ) {}

  /** Enchaîne les contrôles de correction et rassemble les preuves. */
  orchestrate(input: SecurityRemediationOrchestrationInput): SecurityRemediationCandidateResult {
    const started = performance.now(), timings: Record<string, number> = {};
    // V1.7 Blocker B: one monotonic deadline for the whole synchronous
    // evaluation, created before any I/O. `input.overallDeadlineMs` is the
    // backend's own already-existing worker-call timeout, forwarded
    // unchanged (see candidate-verification.service.ts.evaluateSecurityRemediation);
    // absent falls back to createWorkerDeadline()'s own default.
    const deadline = createWorkerDeadline(input.overallDeadlineMs);
    const result = this.evaluate(input, timings, deadline);
    timings.TOTAL_WORKER_DURATION_MS = Math.round(performance.now() - started);
    // Named phase aliases (total/generation/runtime/scanner/cleanup) asked
    // for by the V1.7 runtime-integration audit, computed from the SAME
    // underlying per-stage timings already recorded below -- never a second,
    // independently-measured clock.
    timings.GENERATION_DURATION_MS = timings.PATCH_GENERATION_DURATION_MS ?? 0;
    return { ...result, executionTimings: timings };
  }

  /** Évalue les données et retourne la décision correspondante. */
  private evaluate(input: SecurityRemediationOrchestrationInput, timings: Record<string, number>, deadline: WorkerDeadline): SecurityRemediationCandidateResult {
    /** Mesure la durée de l’étape exécutée. */
    const measure = <T>(key: string, operation: () => T): T => {
      const started = performance.now();
      try { return operation(); }
      finally { timings[key] = (timings[key] ?? 0) + Math.round(performance.now() - started); }
    };
    /** Classe le résultat dans la catégorie correspondante. */
    const bucket = (scanTimings: Record<string, number> | undefined, keys: string[], target: string) => {
      for (const k of keys) if (scanTimings?.[k] !== undefined) timings[target] = (timings[target] ?? 0) + scanTimings[k];
    };
    /** Inspecte les données ou l’artefact pour en tirer des preuves. */
    const inspect = (workspace: string, targetCves?: string[]) => {
      const scan = measure('ARTIFACT_VALIDATION_DURATION_MS', () => this.securityValidator.inspect(workspace, deadline.remainingMs(), targetCves));
      // V1.7 runtime stabilization phase, Phase A — PODMAN_BASE_IMAGE_PULL
      // is now its own distinct bucket (registry-contact time), separated
      // from IMAGE_BUILD_DURATION_MS (pure build-execution time, now that
      // the build itself runs with --pull=never) -- both still roll up
      // into the same overall RUNTIME_DURATION_MS as before.
      bucket(scan.timings, ['IMAGE_BUILD'], 'IMAGE_BUILD_DURATION_MS');
      bucket(scan.timings, ['PODMAN_BASE_IMAGE_PULL'], 'PODMAN_BASE_IMAGE_PULL_DURATION_MS');
      bucket(scan.timings, ['TRIVY_SCAN'], 'TRIVY_SCAN_DURATION_MS');
      bucket(scan.timings, ['PODMAN_PREFLIGHT', 'PODMAN_BASE_IMAGE_PULL', 'IMAGE_BUILD', 'IMAGE_SAVE'], 'RUNTIME_DURATION_MS');
      bucket(scan.timings, ['TRIVY_PREFLIGHT', 'TRIVY_SCAN'], 'SCANNER_DURATION_MS');
      bucket(scan.timings, ['IMAGE_EXISTS', 'IMAGE_CLEANUP'], 'CLEANUP_DURATION_MS');
      return scan;
    };
    /** Construit un résultat indiquant que le délai est dépassé. */
    const deadlineExceeded = (stage: string) => new ArtifactRuntimeError('WORKER_DEADLINE_EXCEEDED', stage);
    // §4 steps 2-6: grounded provenance + fixedVersions normalization +
    // eligibility classification + target selection, all already
    // implemented and committed -- reused verbatim, not re-implemented.
    const decision = measure('GROUNDING_DURATION_MS', () => this.decisionService.decide(input.finding, {
      repository: input.repository, candidateBaseSha: input.candidateBaseSha,
      requestId: input.requestId, batchId: input.batchId, candidateAttempt: input.candidateAttempt,
      timeoutMs: deadline.budgetFor(GROUNDING_STAGE_CAP_MS),
    }));

    /** Construit le résultat d’inéligibilité à la correction automatique. */
    const notEligible = (status: SecurityRemediationCandidateResult['status'], reason: string): SecurityRemediationCandidateResult => ({
      status, reason, decision, candidateIdentity: null, candidateManifest: null, patchEvidence: null, guardResult: null, dependencyResolutionEvidence: null,
    });
    /** Construit le résultat exécution échec. */
    const runtimeFailure = (error: ArtifactRuntimeError): SecurityRemediationCandidateResult => ({
      ...notEligible('TECHNICAL_FAILURE', error.message),
      failureClass: (error.code === 'RUNTIME_OPERATION_TIMEOUT' || error.code === 'WORKER_DEADLINE_EXCEEDED') ? 'VERIFIER_TIMEOUT' : 'VERIFIER_UNAVAILABLE',
    });

    // §4 step 5 / §5: never proceed past a non-AUTO_FIX_ELIGIBLE decision --
    // this single check is what keeps TRANSITIVE/BOM_MANAGED/PLUGIN/
    // cross-major/missing-fixedVersion/ungrounded/OWASP-no-fixedVersion/
    // ZAP-unsupported all STOPPING here, cleanly, with the real reason the
    // decision service already computed (never re-derived, never guessed).
    if (decision.remediationType !== 'AUTO_FIX_ELIGIBLE' || !decision.selectedTargetVersion || !decision.provenance || !decision.evaluatedSha) {
      const groundingFailed = decision.reason.startsWith('GROUNDING_FAILED:');
      return notEligible(groundingFailed ? 'GROUNDING_FAILED' : 'NOT_ELIGIBLE', decision.reason);
    }

    const provenance = decision.provenance;
    if (!provenance.controllingFile) {
      // Defensive: DIRECT_EXPLICIT/PROPERTY_MANAGED always carry a
      // controllingFile by construction (resolveMavenProvenance never
      // returns otherwise for those kinds) -- fail closed if that
      // invariant were ever violated rather than passing `null` onward.
      return notEligible('NOT_ELIGIBLE', 'CONTROLLING_FILE_MISSING_FOR_ELIGIBLE_PROVENANCE');
    }

    // §4 step 9: materialize a SECOND, independent, isolated worktree at
    // the SAME exact SHA -- never the same worktree the grounding checkout
    // used (that one was already torn down by decisionService.decide()).
    // verificationStep distinguishes this identity from the grounding
    // workspace's own (undefined-verificationStep) identity, so the two
    // never collide even though they share requestId/batchId/candidateAttempt.
    const workspaceId = this.workspaceManager.workspaceId(input.requestId, input.batchId, input.candidateAttempt, 1);
    if (deadline.expired()) return runtimeFailure(deadlineExceeded('PATCH_VALIDATION_WORKSPACE'));
    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(input.repository, deadline.budgetFor(GROUNDING_STAGE_CAP_MS));
    } catch (err: any) {
      return notEligible('WORKSPACE_FAILURE', `Repository materialization failed: ${err?.message || 'unknown error'}`);
    }

    let workspacePath: string;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath, candidateBaseSha: input.candidateBaseSha, requestId: input.requestId, batchId: input.batchId,
        candidateAttempt: input.candidateAttempt, verificationStep: 1,
      });
      workspacePath = handle.path;
      // Belt-and-suspenders, same discipline as GroundedMavenProvenanceService:
      // never proceed on an unverified/mismatched checkout.
      if (!handle.exactShaVerified || handle.checkoutSha.toLowerCase() !== input.candidateBaseSha.toLowerCase()) {
        this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
        return notEligible('WORKSPACE_FAILURE', `Patch-validation checkout (${handle.checkoutSha}) does not match candidateBaseSha (${input.candidateBaseSha}).`);
      }
      // The evaluated SHA this second worktree just proved must be the SAME
      // one the grounded decision was computed against -- §5's "requested
      // SHA != evaluated SHA" fail-closed rule, re-checked independently
      // rather than assumed transitively true.
      if (handle.checkoutSha.toLowerCase() !== decision.evaluatedSha!.toLowerCase()) {
        this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
        return notEligible('WORKSPACE_FAILURE', `Patch-validation checkoutSha (${handle.checkoutSha}) does not match decision.evaluatedSha (${decision.evaluatedSha}).`);
      }
    } catch (err: any) {
      return notEligible('WORKSPACE_FAILURE', err instanceof WorkspaceError ? `${err.failureClass}: ${err.message}` : (err?.message || 'Workspace creation failed.'));
    }

    try {
      const controllingPath = path.join(workspacePath, provenance.controllingFile);
      let sourceContent: string;
      try {
        sourceContent = fs.readFileSync(controllingPath, 'utf8');
      } catch {
        return notEligible('WORKSPACE_FAILURE', `Controlling file "${provenance.controllingFile}" not found in the exact-SHA patch-validation worktree.`);
      }

      // V1.7: independently observed scanner targets and controlled Maven
      // experiments determine scope. Nothing here is accepted from WF6.
      let scopeEvidence: MavenScopeEvidence;
      // V1.8 Phase 2 ticket — captured purely for the additive
      // newHighCriticalCount evidence field below; never read by any
      // existing control-flow decision in this function.
      let baselineScanReport: any = null;
      try {
        const cve = input.finding.cveId;
        if (!cve || !/^CVE-\d{4}-\d{4,}$/.test(cve)) throw new Error('TRUSTED_TARGET_CVE_REQUIRED');
        if (deadline.expired()) throw deadlineExceeded('BASE_SCAN');
        const originalDigest = trackedSourceDigest(workspacePath);
        const scan = inspect(workspacePath);
        baselineScanReport = scan.report;
        if (scan.sourceDigest !== originalDigest || trackedSourceDigest(workspacePath) !== originalDigest)
          throw new Error('BASE_SCAN_SOURCE_BINDING_FAILED');
        if (deadline.expired()) throw deadlineExceeded('BASE_MAVEN_MODEL');
        const baseTree = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.dependencyTree(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
        const effective = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.effectivePom(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
        if (baseTree.status !== 'SUCCESS' || effective.status !== 'SUCCESS' || !baseTree.text || !effective.text)
          throw new Error('BASE_MAVEN_MODEL_UNAVAILABLE');
        scopeEvidence = { targetCve: cve, evaluatedSha: decision.evaluatedSha,
          originalBlobSha: computeGitBlobSha1(sourceContent), baselineTree: baseTree.text,
          baselineEffectivePom: effective.text, cveTargets: cveTargets(scan, cve), experiments: [] };
        for (const control of localMavenControls(sourceContent, provenance.package, decision.selectedTargetVersion)) {
          if (deadline.expired()) throw deadlineExceeded('CONTROL_EXPERIMENT');
          const content = applyMavenControls(sourceContent, [control]);
          try {
            fs.writeFileSync(controllingPath, content);
            const tree = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.dependencyTree(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
            const model = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.effectivePom(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
            if (tree.status !== 'SUCCESS' || model.status !== 'SUCCESS' || !tree.text || !model.text)
              throw new Error('CONTROL_EXPERIMENT_FAILED');
            scopeEvidence.experiments.push({ control, sourceSha256: createHash('sha256').update(content).digest('hex'),
              dependencyTree: tree.text, effectivePom: model.text });
          } finally { fs.writeFileSync(controllingPath, sourceContent); }
        }
        if (trackedSourceDigest(workspacePath) !== originalDigest) throw new Error('MAVEN_MUTATED_SOURCE');
        decision.remediationScope = deriveMavenRemediationScope(sourceContent, provenance.package,
          decision.selectedTargetVersion, provenance.controllingFile, scopeEvidence);
      } catch (err: any) {
        if (err instanceof ArtifactRuntimeError) return runtimeFailure(err);
        return notEligible('REMEDIATION_SCOPE_UNPROVEN', String(err?.message || 'Scope evidence unavailable.'));
      }

      // §4 step 7: deterministic patch generation. `sourceContent` here is
      // freshly read from a worktree that JUST proved it is at the exact
      // evaluatedSha (git's content-addressing guarantees it is
      // byte-identical to whatever the grounding worktree read for the
      // SAME sha) -- no second, less-trusted source of truth is introduced.
      const request: SecurityPatchRequest = {
        findingIdentity: decision.findingIdentity, evaluatedSha: decision.evaluatedSha!, ecosystem: 'MAVEN',
        provenanceKind: provenance.kind, package: provenance.package, installedVersion: provenance.installedVersion,
        targetVersion: decision.selectedTargetVersion!, controllingFile: provenance.controllingFile,
        controllingElement: provenance.controllingElement, controllingProperty: provenance.controllingProperty,
        sourceContent, remediationScope: decision.remediationScope, scopeEvidence,
      };

      const writeResult = measure('PATCH_GENERATION_DURATION_MS', () => writeSecurityPatch(request));
      if (writeResult.ok !== true) {
        return notEligible('PATCH_GENERATION_FAILED', (writeResult as any).reason);
      }
      const candidate = (writeResult as WriteSuccess).candidate as any;

      // §4 step 8: independent security guard re-validation.
      const guardResult = measure('PATCH_GENERATION_DURATION_MS', () => assertSecurityPatchSafeToWrite(decision, request, candidate));
      if (guardResult.ok !== true) {
        return {
          status: 'GUARD_REJECTED', reason: (guardResult as any).reason, decision, candidateIdentity: null,
          candidateManifest: null, patchEvidence: null, guardResult, dependencyResolutionEvidence: null,
        };
      }

      // §4 steps 10-11: apply the patch INSIDE this isolated worktree and
      // re-run real `mvn dependency:tree` -- proves actual Maven dependency
      // resolution, not merely that the XML text looks right.
      fs.writeFileSync(controllingPath, candidate.file.content, 'utf8');
      const candidateSourceDigest = trackedSourceDigest(workspacePath);
      // V1.7 Blocker B requirement #5: this is a plain (non-try/catch)
      // section of `evaluate()` -- returning a result directly (never
      // throwing) is what keeps the outer `finally` cleanup running without
      // an uncaught exception escaping orchestrate().
      if (deadline.expired()) return runtimeFailure(deadlineExceeded('CANDIDATE_DEPENDENCY_TREE'));
      const treeResult = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.dependencyTree(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
      if (trackedSourceDigest(workspacePath) !== candidateSourceDigest) {
        return notEligible('CANDIDATE_SECURITY_VALIDATION_FAILED', 'MAVEN_MUTATED_CANDIDATE_SOURCE');
      }
      if (treeResult.status !== 'SUCCESS' || treeResult.text === null) {
        return {
          status: 'MAVEN_RESOLUTION_FAILED', reason: treeResult.evidenceTail || 'mvn dependency:tree did not produce usable output.',
          decision, candidateIdentity: null, candidateManifest: null, patchEvidence: null, guardResult,
          dependencyResolutionEvidence: { checked: true, resolvedMatch: null, evaluatedAtSha: decision.evaluatedSha! },
        };
      }
      const resolvedMatch = dependencyTreeResolvesTo(treeResult.text, provenance.package, candidate.targetVersion)
        && graphClosesScope(scopeEvidence.baselineTree, treeResult.text, decision.remediationScope);
      if (!resolvedMatch) {
        return {
          status: 'MAVEN_RESOLUTION_MISMATCH', reason: `Real dependency:tree after patching does not resolve ${provenance.package} to ${candidate.targetVersion}.`,
          decision, candidateIdentity: null, candidateManifest: null, patchEvidence: null, guardResult,
          dependencyResolutionEvidence: { checked: true, resolvedMatch: false, evaluatedAtSha: decision.evaluatedSha! },
        };
      }

      const expectedDigest = candidateSourceDigest;
      let packageResult: ReturnType<MavenBuildAdapter['packageCandidateWithTests']>;
      try {
        if (deadline.expired()) throw deadlineExceeded('CANDIDATE_BUILD_AND_TESTS');
        packageResult = measure('BUILD_AND_TEST_DURATION_MS', () => this.mavenAdapter.packageCandidateWithTests(workspacePath, deadline.budgetFor(BUILD_STAGE_CAP_MS)));
      } catch (err: any) {
        if (err instanceof ArtifactRuntimeError) return runtimeFailure(err);
        throw err;
      }
      const applicationTests: ApplicationTestEvidence = {
        executed: packageResult.testsExecuted, passed: packageResult.testsPassed,
        total: packageResult.testsTotal, failures: packageResult.testsFailures,
        errors: packageResult.testsErrors, skipped: packageResult.testsSkipped,
        durationMs: packageResult.durationMs, evidenceTail: packageResult.evidenceTail,
      };
      // A real subprocess timeout during build/tests is infrastructure
      // evidence (VERIFIER_TIMEOUT), same vocabulary as every other timed-out
      // stage -- never conflated with a genuine test FAILURE.
      if (packageResult.timedOut) return { ...runtimeFailure(new ArtifactRuntimeError('RUNTIME_OPERATION_TIMEOUT', 'CANDIDATE_BUILD_AND_TESTS')), applicationTests };
      if (packageResult.status !== 'SUCCESS') {
        // Maven's own lifecycle binding means `package` cannot succeed while
        // `test` has real failures -- so a non-zero exit with executed tests
        // that failed IS the test failure; any other non-zero exit is a
        // genuine compile/packaging problem, never mislabeled as a test result.
        if (packageResult.testsExecuted && packageResult.testsPassed === false) {
          return { ...notEligible('APPLICATION_TESTS_FAILED', `Application test suite failed: ${packageResult.testsFailures} failure(s), ${packageResult.testsErrors} error(s) of ${packageResult.testsTotal}.`), applicationTests };
        }
        return { ...notEligible('CANDIDATE_BUILD_FAILED', 'Candidate package build failed.'), applicationTests };
      }
      // Package succeeded but genuinely zero tests were proven to run (no
      // Surefire reports at all) -- fail closed rather than silently
      // treating "never executed" as "passed" (this phase's own explicit rule).
      if (!packageResult.testsExecuted) {
        return { ...notEligible('APPLICATION_TESTS_NOT_EXECUTED', 'Candidate package build succeeded, but no application tests were proven to run (no Surefire report found).'), applicationTests };
      }

      let closureScan: ReturnType<SecurityArtifactValidator['inspect']>;
      try {
        if (trackedSourceDigest(workspacePath) !== expectedDigest) throw new Error('BUILD_MUTATED_SOURCE');
        if (deadline.expired()) throw deadlineExceeded('CANDIDATE_SECURITY_VALIDATION');
        closureScan = inspect(workspacePath, [decision.remediationScope.targetCve]);
        if (closureScan.sourceDigest !== expectedDigest || trackedSourceDigest(workspacePath) !== expectedDigest)
          throw new Error('CANDIDATE_SCAN_SOURCE_BINDING_FAILED');
        if (!provesSecurityClosure(closureScan, decision.remediationScope)) throw new Error('TARGET_CVE_NOT_CLOSED_OR_SCAN_INCOMPLETE');
      } catch (err: any) {
        if (err instanceof ArtifactRuntimeError) return { ...runtimeFailure(err), applicationTests };
        return { ...notEligible('CANDIDATE_SECURITY_VALIDATION_FAILED', String(err?.message || 'Candidate-wide security validation failed.')), applicationTests };
      }

      // §4 step 12: candidate/evidence. Reuses the EXISTING CandidateManifest
      // shape (a single-file manifest) so this can flow, unmodified, into
      // the existing write-guard/candidate-verification pipeline in a
      // future phase -- no second, incompatible candidate model (§3).
      const candidateFile = { ...candidate.file, contentSha256: candidate.file.contentSha256 ?? computeContentSha256(candidate.file.content) };
      const candidateManifest: CandidateManifest = {
        candidateId: `sec-${decision.findingIdentity}`, requestId: input.requestId, batchId: input.batchId,
        candidateAttempt: input.candidateAttempt, repository: input.repository, candidateBaseSha: input.candidateBaseSha,
        files: [candidateFile],
      };
      candidateManifest.candidateDigest = computeCandidateDigest(candidateManifest);

      const candidateIdentity = computeSecurityCandidateIdentity({
        findingIdentity: decision.findingIdentity, evaluatedSha: decision.evaluatedSha!, package: provenance.package,
        installedVersion: provenance.installedVersion, targetVersion: decision.selectedTargetVersion!, controllingFile: provenance.controllingFile,
        remediationScope: decision.remediationScope,
      });

      // V1.8 Phase 3 ticket — each additional CVE ID is checked against this
      // SAME real closureScan via the existing cveTargets(), never assumed
      // closed just because the primary target closed. Malformed IDs are
      // silently skipped here (same format guard the primary target above
      // already enforces) rather than failing the whole otherwise-successful
      // candidate over an ancillary, caller-supplied extra check.
      const additionalCveClosure = (input.additionalCveIds ?? [])
        .filter(id => /^CVE-\d{4}-\d{4,}$/.test(id) || /^GHSA-/.test(id))
        .map(id => ({ cve: id, closed: cveTargets(closureScan, id).length === 0 }));

      return {
        ...{ scannerEvidence: { TRIVY: closureScan, OWASP: (closureScan as any).owasp } },
        status: 'CANDIDATE_READY', reason: 'DETERMINISTIC_CANDIDATE_READY', decision, candidateIdentity, candidateManifest,
        securityValidationEvidence: { status: 'TARGET_CVE_CLOSED', targetCve: scopeEvidence.targetCve, mode: 'TRIVY_IMAGE_ARCHIVE',
          evaluatedSha: decision.evaluatedSha, candidateContentSha256: computeContentSha256(candidate.file.content),
          artifactDigest: closureScan.artifactDigest, reportDigest: closureScan.reportDigest, scannerVersion: closureScan.scannerVersion,
          targetCveMatchCount: 0, buildPassed: true, tests: 'PASSED',
          newHighCriticalCount: baselineScanReport ? Math.max(0, countHighCriticalVulnerabilities(closureScan.report) - countHighCriticalVulnerabilities(baselineScanReport)) : null,
          additionalCveClosure: additionalCveClosure.length ? additionalCveClosure : undefined },
        applicationTests,
        patchEvidence: {
          provenanceKind: provenance.kind, oldVersion: candidate.oldVersion, targetVersion: candidate.targetVersion,
          controllingFile: provenance.controllingFile, controllingElement: provenance.controllingElement, controllingProperty: provenance.controllingProperty,
        },
        guardResult,
        dependencyResolutionEvidence: { checked: true, resolvedMatch: true, evaluatedAtSha: decision.evaluatedSha! },
      };
    } finally {
      measure('CLEANUP_DURATION_MS', () => this.workspaceManager.cleanupWorkspace(workspaceId, repoPath));
      if (fs.existsSync(workspacePath)) throw new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'WORKSPACE_CLEANUP');
    }
  }
}
