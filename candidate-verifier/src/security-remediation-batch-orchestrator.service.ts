// Increment 1 — multi-CVE remediation, ONE candidate/build/scan/PR for N
// findings. A DELIBERATELY SEPARATE service from
// SecurityRemediationOrchestratorService (security-remediation-orchestrator.
// service.ts), which stays byte-for-byte untouched — this increment's own
// non-regression requirement is that a 1-element batch must come from a NEW
// code path, never a modification of the proven single-CVE one (PR #37).
//
// Reuses every collaborator the singular orchestrator already reuses
// (decisionService/workspaceManager/repoCache/mavenAdapter/
// securityValidator) and every pure building block already proven there
// (writeSecurityPatch via writeSecurityPatchBatch's chaining,
// dependencyTreeResolvesTo, computeSecurityCandidateIdentity) — nothing
// here reimplements grounding, patch-writing, or Maven/Trivy execution.
//
// ★ Coordinated scope (MavenRemediationScope/deriveMavenRemediationScope —
// one CVE needing several synchronized edits in the SAME file, e.g. the
// REAL CVE-2023-6378/logback case this increment's own non-regression test
// replays) IS derived here, per finding, via the EXACT SAME control-
// experiment mechanism the singular orchestrator already uses — looped
// once per finding instead of once total. Each finding's scope is derived
// against the batch's ORIGINAL (pre-chain) content, exactly like the
// singular flow derives it against the sole content it ever sees.
//
// ★ Disclosed Increment-1 limitation: a coordinated finding is only safely
// batchable when it is the ONLY finding in the batch, or otherwise happens
// to be applied FIRST in writeSecurityPatchBatch()'s deterministic
// (cveId-sorted) chain order. A coordinated finding applied AFTER another
// finding has already touched the same file fails closed automatically
// (COORDINATED_SCOPE_INVALID, surfaced as a named PATCH_CONFLICT) — its own
// scopeEvidence.originalBlobSha no longer matches the by-then-already-
// patched content, exactly the same "never guess" discipline
// deriveMavenRemediationScope already enforces for the singular flow. No
// special-case code was added for this; it is a direct, correct consequence
// of scope being derived against pre-chain content and re-verified by
// writeSecurityPatch() itself at write time.
//
// ★ Also deliberately deferred: assertSecurityPatchSafeToWrite() per-finding
// guard re-validation (the singular flow's defense-in-depth re-derivation
// step). writeSecurityPatchBatch()'s own chaining already proves each
// finding's declaration exists, is unambiguous, and matches its grounded
// installedVersion; the post-patch dependency:tree resolution check and the
// Trivy closure intersection below are the two REAL safety nets this
// increment relies on. Re-adding the guard as a third, per-finding layer is
// a reasonable follow-up, not required to ship a safe Increment 1.
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { ArtifactRuntimeError, SecurityArtifactValidator, trackedSourceDigest, cveTargets } from './security-artifact-validator';
import { localMavenControls, applyMavenControls, deriveMavenRemediationScope, MavenScopeEvidence } from '../../backend/src/security-remediation/maven-remediation-scope';
import { RemoteBuilderArtifactValidator } from './remote-builder-artifact-validator';
import { SecurityFindingDecisionService } from './security-finding-decision.service';
import { WorkspaceManager, WorkspaceError } from './workspace-manager.service';
import { RepoCacheService } from './repo-cache.service';
import { MavenBuildAdapter } from './maven-build-adapter';
import { writeSecurityPatchBatch, SecurityPatchBatchItem, SecurityPatchBatchFindingOutcome } from '../../backend/src/security-remediation/maven-security-patch-writer-batch';
import { writeParentVersionPatch } from '../../backend/src/security-remediation/maven-parent-patch-writer';
import { assertParentVersionPatchSafeToWrite } from '../../backend/src/security-remediation/security-patch-guard';
import { computeSecurityBatchCandidateIdentity } from '../../backend/src/security-remediation/security-candidate-identity';
import { dependencyTreeResolvesTo } from '../../backend/src/security-remediation/maven-dependency-resolution-check';
import { computeCandidateDigest, computeContentSha256, computeGitBlobSha1 } from '../../backend/src/candidate-verification/candidate-digest';
import { allVulnerabilityIds, deriveBatchClosureVerdict } from '../../backend/src/security-remediation/security-remediation-batch-closure';
import {
  SecurityRemediationBatchOrchestrationInput, SecurityRemediationBatchCandidateResult, SecurityRemediationBatchFindingEvidence,
} from '../../backend/src/security-remediation/security-remediation-batch-orchestration.types';
import { ApplicationTestEvidence } from '../../backend/src/security-remediation/security-remediation-orchestration.types';
import { SecurityFindingDecision } from '../../backend/src/security-remediation/security-finding-decision.types';
import { CandidateManifest, CandidateFile } from '../../backend/src/candidate-verification/candidate-verification.types';
import { createWorkerDeadline, WorkerDeadline } from './worker-deadline';

const GROUNDING_STAGE_CAP_MS = 5 * 60 * 1000;
const MAVEN_STAGE_CAP_MS = 5 * 60 * 1000;
const BUILD_STAGE_CAP_MS = 5 * 60 * 1000;

@Injectable()
export class SecurityRemediationBatchOrchestratorService {
  constructor(
    @Optional() private readonly decisionService: SecurityFindingDecisionService = new SecurityFindingDecisionService(),
    @Optional() private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    @Optional() private readonly repoCache: RepoCacheService = new RepoCacheService(),
    @Optional() private readonly mavenAdapter: MavenBuildAdapter = new MavenBuildAdapter(),
    @Optional() private readonly securityValidator: SecurityArtifactValidator = new RemoteBuilderArtifactValidator(),
  ) {}

  orchestrate(input: SecurityRemediationBatchOrchestrationInput): SecurityRemediationBatchCandidateResult {
    const started = performance.now(), timings: Record<string, number> = {};
    const deadline = createWorkerDeadline(input.overallDeadlineMs);
    const result = this.evaluate(input, timings, deadline);
    timings.TOTAL_WORKER_DURATION_MS = Math.round(performance.now() - started);
    return { ...result, executionTimings: timings };
  }

  private evaluate(input: SecurityRemediationBatchOrchestrationInput, timings: Record<string, number>, deadline: WorkerDeadline): SecurityRemediationBatchCandidateResult {
    const measure = <T>(key: string, operation: () => T): T => {
      const start = performance.now();
      try { return operation(); } finally { timings[key] = (timings[key] ?? 0) + Math.round(performance.now() - start); }
    };
    const deadlineExceeded = (stage: string) => new ArtifactRuntimeError('WORKER_DEADLINE_EXCEEDED', stage);
    const cveIds = input.findings.map(f => f.cveId);

    // §1 — ground EVERY finding independently. Each call is the EXACT same
    // decisionService.decide() the singular flow uses, unmodified; only the
    // loop is new.
    const decisions: SecurityFindingDecision[] = input.findings.map(finding =>
      measure('GROUNDING_DURATION_MS', () => this.decisionService.decide(finding, {
        repository: input.repository, candidateBaseSha: input.candidateBaseSha,
        requestId: input.requestId, batchId: input.batchId, candidateAttempt: input.candidateAttempt,
        timeoutMs: deadline.budgetFor(GROUNDING_STAGE_CAP_MS),
      })));

    const pendingEvidence = (upTo: number, exceptIndex?: number, exceptStatus?: SecurityRemediationBatchFindingEvidence['status'], exceptReason?: string): SecurityRemediationBatchFindingEvidence[] =>
      decisions.map((d, i) => ({
        findingIdentity: d.findingIdentity, cveId: cveIds[i],
        status: i === exceptIndex ? (exceptStatus ?? 'PENDING') : 'PENDING',
        reason: i === exceptIndex ? (exceptReason ?? 'BATCH_ABORTED') : 'BATCH_ABORTED_BY_SIBLING_FINDING',
        patchEvidence: null,
      })).slice(0, upTo);

    const notEligible = (status: SecurityRemediationBatchCandidateResult['status'], reason: string, findings: SecurityRemediationBatchFindingEvidence[]): SecurityRemediationBatchCandidateResult => ({
      status, reason, findings, decisions, candidateIdentity: null, candidateManifest: null, guardResult: null,
    });
    const runtimeFailure = (error: ArtifactRuntimeError, findings: SecurityRemediationBatchFindingEvidence[]): SecurityRemediationBatchCandidateResult => ({
      ...notEligible('TECHNICAL_FAILURE', error.message, findings),
      failureClass: (error.code === 'RUNTIME_OPERATION_TIMEOUT' || error.code === 'WORKER_DEADLINE_EXCEEDED') ? 'VERIFIER_TIMEOUT' : 'VERIFIER_UNAVAILABLE',
    });

    // §3 tout-ou-rien — ANY non-eligible finding aborts the WHOLE batch,
    // before any workspace/build cost is spent. The finding(s) that failed
    // are named with their own real reason; every sibling is reported
    // PENDING (never a fabricated CLOSED/eligible claim about work that
    // never ran).
    const ineligibleIndex = decisions.findIndex(d => d.remediationType !== 'AUTO_FIX_ELIGIBLE' || !d.selectedTargetVersion || !d.provenance || !d.evaluatedSha);
    if (ineligibleIndex !== -1) {
      const bad = decisions[ineligibleIndex];
      const groundingFailed = bad.reason.startsWith('GROUNDING_FAILED:');
      return notEligible(groundingFailed ? 'TECHNICAL_FAILURE' : 'NOT_ELIGIBLE', bad.reason,
        pendingEvidence(decisions.length, ineligibleIndex, groundingFailed ? 'GROUNDING_FAILED' : 'NOT_ELIGIBLE', bad.reason));
    }

    // Defensive — every finding was checked out against the SAME
    // candidateBaseSha (a single shared input), so every decision's own
    // evaluatedSha must agree. Never assumed transitively true.
    const evaluatedSha = decisions[0].evaluatedSha!;
    if (decisions.some(d => d.evaluatedSha!.toLowerCase() !== evaluatedSha.toLowerCase())) {
      return notEligible('TECHNICAL_FAILURE', 'INCONSISTENT_EVALUATED_SHA_ACROSS_FINDINGS', pendingEvidence(decisions.length));
    }
    const controllingFile = decisions[0].provenance!.controllingFile;
    if (!controllingFile || decisions.some(d => d.provenance!.controllingFile !== controllingFile)) {
      return notEligible('NOT_ELIGIBLE', 'CONTROLLING_FILE_MUST_BE_IDENTICAL_ACROSS_A_BATCH', pendingEvidence(decisions.length));
    }

    // V1.8 Phase 7B — a batch is either ENTIRELY PARENT_VERSION findings (one
    // shared owner plan, applied once, independent per-CVE closure below) or
    // ENTIRELY non-parent findings (the existing DEPENDENCY_VERSION/
    // PROPERTY_VERSION chained-write path, untouched) -- NEVER a mix. Mixing
    // would mean two structurally different patch-generation mechanisms
    // writing to the SAME file in one candidate, which neither path's own
    // conflict detection is built to reason about; fail closed rather than
    // guess an ordering.
    const isParentDecision = (d: SecurityFindingDecision) => d.editType === 'PARENT_VERSION';
    const allParent = decisions.every(isParentDecision);
    const anyParent = decisions.some(isParentDecision);
    if (anyParent && !allParent) {
      return notEligible('NOT_ELIGIBLE', 'MIXED_PARENT_AND_NON_PARENT_BATCH_UNSUPPORTED', pendingEvidence(decisions.length));
    }

    // §4 step 9 (singular flow) equivalent — ONE shared, independent,
    // isolated worktree at the SAME exact SHA for the whole batch.
    const workspaceId = this.workspaceManager.workspaceId(input.requestId, input.batchId, input.candidateAttempt, 1);
    if (deadline.expired()) return runtimeFailure(deadlineExceeded('PATCH_VALIDATION_WORKSPACE'), pendingEvidence(decisions.length));
    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(input.repository, deadline.budgetFor(GROUNDING_STAGE_CAP_MS));
    } catch (err: any) {
      return notEligible('WORKSPACE_FAILURE', `Repository materialization failed: ${err?.message || 'unknown error'}`, pendingEvidence(decisions.length));
    }

    let workspacePath: string;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath, candidateBaseSha: input.candidateBaseSha, requestId: input.requestId, batchId: input.batchId,
        candidateAttempt: input.candidateAttempt, verificationStep: 1,
      });
      workspacePath = handle.path;
      if (!handle.exactShaVerified || handle.checkoutSha.toLowerCase() !== input.candidateBaseSha.toLowerCase()
        || handle.checkoutSha.toLowerCase() !== evaluatedSha.toLowerCase()) {
        this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
        return notEligible('WORKSPACE_FAILURE', `Batch checkout (${handle.checkoutSha}) does not match candidateBaseSha/evaluatedSha.`, pendingEvidence(decisions.length));
      }
    } catch (err: any) {
      return notEligible('WORKSPACE_FAILURE', err instanceof WorkspaceError ? `${err.failureClass}: ${err.message}` : (err?.message || 'Workspace creation failed.'), pendingEvidence(decisions.length));
    }

    try {
      const controllingPath = path.join(workspacePath, controllingFile);
      let sourceContent: string;
      try {
        sourceContent = fs.readFileSync(controllingPath, 'utf8');
      } catch {
        return notEligible('WORKSPACE_FAILURE', `Controlling file "${controllingFile}" not found in the exact-SHA batch worktree.`, pendingEvidence(decisions.length));
      }

      // Baseline scan — BEFORE any patch, shared by every finding. Doubles
      // as (a) the "was this CVE ever really there" proof, (b) the closure
      // verdict's baseline CVE-id set (security-remediation-batch-
      // closure.ts), and (c) each finding's own scope-evidence cveTargets
      // (below) — exactly the scan the singular flow's own scope derivation
      // reuses, never a second one.
      const originalDigest = trackedSourceDigest(workspacePath);
      let baselineCveIds: Set<string>;
      let baseScan: ReturnType<SecurityArtifactValidator['inspect']>;
      try {
        if (deadline.expired()) throw deadlineExceeded('BASE_SCAN');
        baseScan = measure('ARTIFACT_VALIDATION_DURATION_MS', () => this.securityValidator.inspect(workspacePath, deadline.remainingMs()));
        if (baseScan.sourceDigest !== originalDigest || trackedSourceDigest(workspacePath) !== originalDigest) throw new Error('BASE_SCAN_SOURCE_BINDING_FAILED');
        baselineCveIds = allVulnerabilityIds(baseScan);
      } catch (err: any) {
        if (err instanceof ArtifactRuntimeError) return runtimeFailure(err, pendingEvidence(decisions.length));
        return notEligible('CANDIDATE_SECURITY_VALIDATION_FAILED', String(err?.message || 'Baseline security scan unavailable.'), pendingEvidence(decisions.length));
      }

      // ★ Per-finding scope derivation — the EXACT SAME control-experiment
      // mechanism the singular orchestrator uses (localMavenControls ->
      // apply one control at a time -> real dependency:tree/effectivePom ->
      // restore), looped once per finding, always against the SAME pristine
      // `sourceContent` (never an intermediate chained value — see this
      // file's own header for why that is the correct, fail-closed choice).
      // A finding whose grounded decision does not actually need
      // coordination (the common case) still goes through this — its own
      // localMavenControls() simply returns a single candidate, and
      // deriveMavenRemediationScope() naturally settles on 'SINGLE_CONTROL'.
      //
      // V1.8 Phase 7B — NEVER entered for an all-PARENT_VERSION batch:
      // localMavenControls() only knows how to bind a DIRECT/PROPERTY-
      // managed dependency declaration (decision.provenance.package) that is
      // actually present in <dependencies> -- exactly the shape a parent-
      // managed package structurally is NOT (that is the whole reason it
      // needed a parent fix). Running it anyway would fail closed
      // (TARGET_NOT_LOCALLY_CONTROLLED), which is safe but wrong: the parent
      // batch has its own, separate write-generation branch below.
      const scopeEvidenceByCve = new Map<string, MavenScopeEvidence>();
      if (!allParent) {
        for (let i = 0; i < decisions.length; i++) {
          const decision = decisions[i], cveId = cveIds[i];
          try {
            if (deadline.expired()) throw deadlineExceeded('BASE_MAVEN_MODEL');
            const baseTree = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.dependencyTree(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
            const baseEffective = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.effectivePom(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
            if (baseTree.status !== 'SUCCESS' || baseEffective.status !== 'SUCCESS' || !baseTree.text || !baseEffective.text) throw new Error('BASE_MAVEN_MODEL_UNAVAILABLE');
            const scopeEvidence: MavenScopeEvidence = {
              targetCve: cveId, evaluatedSha, originalBlobSha: computeGitBlobSha1(sourceContent),
              baselineTree: baseTree.text, baselineEffectivePom: baseEffective.text,
              cveTargets: cveTargets(baseScan, cveId), experiments: [],
            };
            for (const control of localMavenControls(sourceContent, decision.provenance!.package, decision.selectedTargetVersion!)) {
              if (deadline.expired()) throw deadlineExceeded('CONTROL_EXPERIMENT');
              const content = applyMavenControls(sourceContent, [control]);
              try {
                fs.writeFileSync(controllingPath, content);
                const tree = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.dependencyTree(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
                const model = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.effectivePom(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
                if (tree.status !== 'SUCCESS' || model.status !== 'SUCCESS' || !tree.text || !model.text) throw new Error('CONTROL_EXPERIMENT_FAILED');
                scopeEvidence.experiments.push({ control, sourceSha256: createHash('sha256').update(content).digest('hex'), dependencyTree: tree.text, effectivePom: model.text });
              } finally { fs.writeFileSync(controllingPath, sourceContent); }
            }
            if (trackedSourceDigest(workspacePath) !== originalDigest) throw new Error('MAVEN_MUTATED_SOURCE');
            decision.remediationScope = deriveMavenRemediationScope(sourceContent, decision.provenance!.package, decision.selectedTargetVersion!, decision.provenance!.controllingFile, scopeEvidence);
            scopeEvidenceByCve.set(cveId, scopeEvidence);
          } catch (err: any) {
            if (err instanceof ArtifactRuntimeError) return runtimeFailure(err, pendingEvidence(decisions.length, i, 'GROUNDING_FAILED', String(err.message)));
            return notEligible('NOT_ELIGIBLE', `REMEDIATION_SCOPE_UNPROVEN:${String(err?.message || 'Scope evidence unavailable.')}`,
              pendingEvidence(decisions.length, i, 'GROUNDING_FAILED', String(err?.message || 'Scope evidence unavailable.')));
          }
        }
      }

      let writeResult: { ok: true; file: CandidateFile; perFinding: SecurityPatchBatchFindingOutcome[] };

      if (allParent) {
        // V1.8 Phase 7B — ONE shared owner/parent plan, applied ONCE against
        // this batch's own shared `sourceContent` (never the 11 separately-
        // grounded candidates decide() already produced during grounding
        // above -- those only PROVE feasibility per-finding; the candidate
        // that is actually scanned/built is always constructed fresh here,
        // exactly like the non-parent path already does with
        // decision.provenance!.package/selectedTargetVersion, never by
        // reusing a whole pre-built candidate file). Every decision's own
        // plan must agree byte-for-byte -- a batch that somehow carries two
        // different parent plans is never silently collapsed to one.
        const plan = decisions[0].parentRemediationPlan!;
        const inconsistent = decisions.find(d => !d.parentRemediationPlan
          || d.parentRemediationPlan.actualEditTarget !== plan.actualEditTarget
          || d.parentRemediationPlan.fromVersion !== plan.fromVersion
          || d.parentRemediationPlan.toVersion !== plan.toVersion);
        if (inconsistent) {
          return notEligible('NOT_ELIGIBLE', 'INCONSISTENT_PARENT_PLAN_ACROSS_BATCH', pendingEvidence(decisions.length));
        }
        // §9/§10 — the per-CVE effective-dependency assertion needs each
        // finding's OWN expectedResolvedDependency (the vulnerable
        // component's expected version, e.g. jackson-databind -> 2.13.5) --
        // never the parent's own toVersion (2.7.18), never inferred.
        const missingExpected = decisions.find(d => !d.parentRemediationPlan!.expectedResolvedDependency);
        if (missingExpected) {
          return notEligible('NOT_ELIGIBLE', 'EXPECTED_RESOLVED_DEPENDENCY_MISSING', pendingEvidence(decisions.length));
        }

        const parentRequest = {
          findingIdentity: `batch-${input.batchId}`, evaluatedSha, ecosystem: 'MAVEN' as const, editType: 'PARENT_VERSION' as const,
          actualEditTarget: plan.actualEditTarget, fromVersion: plan.fromVersion, toVersion: plan.toVersion,
          controllingFile, sourceContent,
        };
        const parentWrite: any = measure('PATCH_GENERATION_DURATION_MS', () => writeParentVersionPatch(parentRequest));
        if (parentWrite.ok !== true) {
          return notEligible('PATCH_CONFLICT', `PARENT_WRITE_FAILED:${parentWrite.reason}`, pendingEvidence(decisions.length));
        }
        // §6/§7 — independent guard re-derivation, no fallback: a batch this
        // size skips the singular per-finding guard for the non-parent path
        // (see this file's own header) but a PARENT_VERSION batch is new
        // enough, and edits a single shared node broad enough in blast
        // radius, that re-proving it here is cheap and worthwhile.
        const parentDecisionForGuard: SecurityFindingDecision = {
          ...decisions[0], remediationType: 'AUTO_FIX_ELIGIBLE', editType: 'PARENT_VERSION',
          selectedTargetVersion: plan.toVersion, parentRemediationPlan: plan,
        };
        const parentGuard = assertParentVersionPatchSafeToWrite(parentDecisionForGuard, parentRequest, parentWrite.candidate);
        if (parentGuard.ok !== true) {
          return notEligible('PATCH_CONFLICT', `PARENT_GUARD_FAILED:${(parentGuard as any).reason}`, pendingEvidence(decisions.length));
        }
        writeResult = {
          ok: true, file: parentWrite.candidate.file,
          perFinding: decisions.map((d, i) => ({
            cveId: cveIds[i], findingIdentity: d.findingIdentity, package: d.provenance!.package,
            provenanceKind: 'PARENT_MANAGED', oldVersion: d.provenance!.installedVersion,
            targetVersion: d.parentRemediationPlan!.expectedResolvedDependency!,
            controllingFile, controllingElement: null, controllingProperty: null,
          })),
        };
      } else {
        // §2/★ — chain N single-CVE patch requests into ONE candidate file.
        // Conflict detection is writeSecurityPatchBatch()'s own chaining
        // (see that file's header) — nothing extra to do here.
        // writeSecurityPatch()'s coordinated-scope branch re-derives and
        // requires `computeGitBlobSha1(source) === scopeEvidence.
        // originalBlobSha` -- true only against the PRISTINE, pre-chain
        // content. For the common SINGLE_CONTROL case that requirement is
        // unnecessary machinery (the plain provenanceKind-based write already
        // proves everything needed) AND actively incompatible with chaining
        // (a SINGLE_CONTROL finding applied anywhere but first would falsely
        // "conflict" against its own already-satisfied scope). Only a
        // genuinely COORDINATED_SAME_FILE finding needs remediationScope/
        // scopeEvidence carried through to the write step at all -- see this
        // file's own header for the disclosed ordering limitation that
        // still applies to that case.
        const items: SecurityPatchBatchItem[] = decisions.map((d, i) => {
          const coordinated = d.remediationScope?.kind === 'COORDINATED_SAME_FILE';
          return {
            cveId: cveIds[i],
            request: {
              findingIdentity: d.findingIdentity, evaluatedSha: evaluatedSha, ecosystem: 'MAVEN',
              provenanceKind: d.provenance!.kind, package: d.provenance!.package, installedVersion: d.provenance!.installedVersion,
              targetVersion: d.selectedTargetVersion!, controllingFile: d.provenance!.controllingFile,
              controllingElement: d.provenance!.controllingElement, controllingProperty: d.provenance!.controllingProperty,
              sourceContent,
              ...(coordinated ? { remediationScope: d.remediationScope, scopeEvidence: scopeEvidenceByCve.get(cveIds[i]) } : {}),
            },
          };
        });
        const chainedWrite = measure('PATCH_GENERATION_DURATION_MS', () => writeSecurityPatchBatch(items));
        if (chainedWrite.ok !== true) {
          const conflictByCve = new Map(chainedWrite.conflicts.map(c => [c.cveId, c]));
          return notEligible('PATCH_CONFLICT', `${chainedWrite.conflicts.length} conflicting CVE(s): ${chainedWrite.conflicts.map(c => c.cveId).join(', ')}`,
            decisions.map((d, i) => {
              const conflict = conflictByCve.get(cveIds[i]);
              return conflict
                ? { findingIdentity: d.findingIdentity, cveId: cveIds[i], status: 'PATCH_CONFLICT', reason: `${conflict.reason}: ${conflict.detail}`, patchEvidence: null }
                : { findingIdentity: d.findingIdentity, cveId: cveIds[i], status: 'PENDING', reason: 'BATCH_ABORTED_BY_SIBLING_CONFLICT', patchEvidence: null };
            }));
        }
        writeResult = chainedWrite;
      }
      const perFindingByCve = new Map(writeResult.perFinding.map(f => [f.cveId, f]));

      // §4 steps 10-11 (singular flow) equivalent, applied ONCE to the
      // fully-chained candidate.
      fs.writeFileSync(controllingPath, writeResult.file.content, 'utf8');
      const candidateSourceDigest = trackedSourceDigest(workspacePath);
      if (deadline.expired()) return runtimeFailure(deadlineExceeded('CANDIDATE_DEPENDENCY_TREE'), pendingEvidence(decisions.length));
      const treeResult = measure('MAVEN_RESOLUTION_DURATION_MS', () => this.mavenAdapter.dependencyTree(workspacePath, deadline.budgetFor(MAVEN_STAGE_CAP_MS)));
      if (trackedSourceDigest(workspacePath) !== candidateSourceDigest) {
        return notEligible('CANDIDATE_SECURITY_VALIDATION_FAILED', 'MAVEN_MUTATED_CANDIDATE_SOURCE', pendingEvidence(decisions.length));
      }
      if (treeResult.status !== 'SUCCESS' || treeResult.text === null) {
        return notEligible('MAVEN_RESOLUTION_FAILED', treeResult.evidenceTail || 'mvn dependency:tree did not produce usable output.', pendingEvidence(decisions.length));
      }
      const unresolved = writeResult.perFinding.filter(f => !dependencyTreeResolvesTo(treeResult.text!, f.package, f.targetVersion));
      if (unresolved.length) {
        return notEligible('MAVEN_RESOLUTION_MISMATCH', `Real dependency:tree after patching does not resolve: ${unresolved.map(f => `${f.package}@${f.targetVersion} (${f.cveId})`).join(', ')}`,
          decisions.map((d, i) => ({ findingIdentity: d.findingIdentity, cveId: cveIds[i], status: 'PENDING', reason: 'MAVEN_RESOLUTION_MISMATCH', patchEvidence: null })));
      }

      // V1.8 — ONE combined build+test for the whole batch (see the
      // singular orchestrator's identical rationale). A test failure is not
      // attributable to any single CVE either, same discipline as a build
      // failure below.
      const expectedDigest = candidateSourceDigest;
      let packageResult: ReturnType<MavenBuildAdapter['packageCandidateWithTests']>;
      try {
        if (deadline.expired()) throw deadlineExceeded('CANDIDATE_BUILD_AND_TESTS');
        packageResult = measure('BUILD_AND_TEST_DURATION_MS', () => this.mavenAdapter.packageCandidateWithTests(workspacePath, deadline.budgetFor(BUILD_STAGE_CAP_MS)));
      } catch (err: any) {
        if (err instanceof ArtifactRuntimeError) return runtimeFailure(err, pendingEvidence(decisions.length));
        throw err;
      }
      const applicationTests: ApplicationTestEvidence = {
        executed: packageResult.testsExecuted, passed: packageResult.testsPassed,
        total: packageResult.testsTotal, failures: packageResult.testsFailures,
        errors: packageResult.testsErrors, skipped: packageResult.testsSkipped,
        durationMs: packageResult.durationMs, evidenceTail: packageResult.evidenceTail,
      };
      if (packageResult.timedOut) {
        return { ...runtimeFailure(new ArtifactRuntimeError('RUNTIME_OPERATION_TIMEOUT', 'CANDIDATE_BUILD_AND_TESTS'), pendingEvidence(decisions.length)), applicationTests };
      }
      if (packageResult.status !== 'SUCCESS') {
        const testsCausedFailure = packageResult.testsExecuted && packageResult.testsPassed === false;
        return {
          status: testsCausedFailure ? 'APPLICATION_TESTS_FAILED' : 'CANDIDATE_BUILD_FAILED',
          reason: testsCausedFailure
            ? `Application test suite failed for the combined N-CVE patch: ${packageResult.testsFailures} failure(s), ${packageResult.testsErrors} error(s) of ${packageResult.testsTotal}.`
            : 'Candidate package build failed for the combined N-CVE patch.',
          buildOutput: packageResult.evidenceTail, applicationTests,
          findings: decisions.map((d, i) => ({ findingIdentity: d.findingIdentity, cveId: cveIds[i], status: 'PENDING', reason: testsCausedFailure ? 'BATCH_TESTS_FAILED_NOT_ATTRIBUTED' : 'BATCH_BUILD_FAILED_NOT_ATTRIBUTED', patchEvidence: null })),
          decisions, candidateIdentity: null, candidateManifest: null, guardResult: null,
        };
      }
      if (!packageResult.testsExecuted) {
        return {
          status: 'APPLICATION_TESTS_NOT_EXECUTED', reason: 'Candidate package build succeeded for the combined N-CVE patch, but no application tests were proven to run (no Surefire report found).',
          buildOutput: packageResult.evidenceTail, applicationTests,
          findings: decisions.map((d, i) => ({ findingIdentity: d.findingIdentity, cveId: cveIds[i], status: 'PENDING', reason: 'BATCH_TESTS_NOT_EXECUTED', patchEvidence: null })),
          decisions, candidateIdentity: null, candidateManifest: null, guardResult: null,
        };
      }

      let closureScan;
      try {
        if (trackedSourceDigest(workspacePath) !== expectedDigest) throw new Error('BUILD_MUTATED_SOURCE');
        if (deadline.expired()) throw deadlineExceeded('CANDIDATE_SECURITY_VALIDATION');
        closureScan = measure('ARTIFACT_VALIDATION_DURATION_MS', () => this.securityValidator.inspect(workspacePath, deadline.remainingMs()));
        if (closureScan.sourceDigest !== expectedDigest || trackedSourceDigest(workspacePath) !== expectedDigest) throw new Error('CANDIDATE_SCAN_SOURCE_BINDING_FAILED');
      } catch (err: any) {
        if (err instanceof ArtifactRuntimeError) return { ...runtimeFailure(err, pendingEvidence(decisions.length)), applicationTests };
        return { ...notEligible('CANDIDATE_SECURITY_VALIDATION_FAILED', String(err?.message || 'Candidate-wide security validation failed.'), pendingEvidence(decisions.length)), applicationTests };
      }

      // §4/§6 — per-CVE closure via baseline/candidate CVE-id intersection.
      const candidateCveIds = allVulnerabilityIds(closureScan);
      const verdict = deriveBatchClosureVerdict(cveIds, baselineCveIds, candidateCveIds);
      const reasonFor = (status: string) => status === 'CLOSED' ? 'TARGET_CVE_CLOSED'
        : status === 'STILL_OPEN' ? 'TARGET_CVE_STILL_OPEN_AFTER_PATCH' : 'TARGET_CVE_NEVER_OBSERVED_IN_BASELINE';
      const verdictByCve = new Map(verdict.perCve.map(v => [v.cveId, v.status]));
      const findingsEvidence: SecurityRemediationBatchFindingEvidence[] = decisions.map((d, i) => {
        const cveId = cveIds[i], status = verdictByCve.get(cveId)!, f = perFindingByCve.get(cveId)!;
        return {
          findingIdentity: d.findingIdentity, cveId, status, reason: reasonFor(status),
          patchEvidence: { provenanceKind: f.provenanceKind, oldVersion: f.oldVersion, targetVersion: f.targetVersion, controllingFile: f.controllingFile, controllingElement: f.controllingElement, controllingProperty: f.controllingProperty },
        };
      });

      // §3 — global tout-ou-rien: ONE non-CLOSED CVE fails the WHOLE batch,
      // no PR, no candidate written -- but the per-CVE detail (which one,
      // and which ones DID close) is always returned.
      if (!verdict.allClosed) {
        return {
          status: 'CANDIDATE_SECURITY_VALIDATION_FAILED',
          reason: `Not every target CVE closed: ${verdict.perCve.filter(v => v.status !== 'CLOSED').map(v => `${v.cveId}:${v.status}`).join(', ')}`,
          findings: findingsEvidence, decisions, candidateIdentity: null, candidateManifest: null, guardResult: null, applicationTests,
        };
      }

      const candidateFile = { ...writeResult.file, contentSha256: writeResult.file.contentSha256 ?? computeContentSha256(writeResult.file.content) };
      const candidateManifest: CandidateManifest = {
        candidateId: `sec-batch-${input.batchId}`, requestId: input.requestId, batchId: input.batchId,
        candidateAttempt: input.candidateAttempt, repository: input.repository, candidateBaseSha: input.candidateBaseSha,
        files: [candidateFile],
      };
      candidateManifest.candidateDigest = computeCandidateDigest(candidateManifest);

      // Batch identity — the ONE shared function (security-candidate-
      // identity.ts's own computeSecurityBatchCandidateIdentity()), also
      // used by the backend's batch verification client to independently
      // recompute and cross-check this same value. Never a second, locally
      // duplicated copy of this logic (a duplicate is exactly what caused
      // this increment's own N=1 non-regression bug, now fixed there).
      const candidateIdentity = computeSecurityBatchCandidateIdentity(decisions.map(d => ({
        findingIdentity: d.findingIdentity, evaluatedSha, package: d.provenance!.package,
        installedVersion: d.provenance!.installedVersion, targetVersion: d.selectedTargetVersion!, controllingFile: d.provenance!.controllingFile,
        remediationScope: d.remediationScope,
      })));

      return {
        status: 'CANDIDATE_READY', reason: 'DETERMINISTIC_BATCH_CANDIDATE_READY',
        findings: findingsEvidence, decisions, candidateIdentity, candidateManifest, guardResult: null, applicationTests,
      };
    } finally {
      measure('CLEANUP_DURATION_MS', () => this.workspaceManager.cleanupWorkspace(workspaceId, repoPath));
      if (fs.existsSync(workspacePath)) throw new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'WORKSPACE_CLEANUP');
    }
  }
}
