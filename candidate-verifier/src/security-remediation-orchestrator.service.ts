// R-SEC-V1.3 §4 — connects the already-implemented, already-committed
// deterministic pieces into one orchestration contract:
//
//   finding -> grounded decision (V1.1, SecurityFindingDecisionService)
//           -> eligibility (V1, classifySecurityAutoFixEligibility, called
//              internally by the decision service)
//           -> deterministic patch generation (V1.2, writeSecurityPatch)
//           -> security patch guard (V1.2, assertSecurityPatchSafeToWrite)
//           -> Maven resolution validation (new: a SECOND, independent
//              isolated worktree at the same exact SHA)
//           -> candidate result (new: SecurityRemediationCandidateResult)
//
// This file adds ONLY orchestration -- no new checkout/cleanup primitive,
// no new Maven goal, no new business rule. Every decision (what counts as
// eligible, what a valid patch looks like, what the guard rejects) is made
// by code already reviewed and committed; this class only sequences it and
// fails closed at every step, per §5.
//
// NEVER writes to GitHub, never creates a PR, never touches
// remediationWorkflowFor()/n8n -- this produces a candidate record only.
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
import { SecurityRemediationOrchestrationInput, SecurityRemediationCandidateResult } from '../../backend/src/security-remediation/security-remediation-orchestration.types';
import { CandidateManifest } from '../../backend/src/candidate-verification/candidate-verification.types';

// See maven-security-patch-writer.ts / security-finding-decision.service.ts
// for why Extract<> + a cast is used instead of relying on `if (!x.ok)`
// narrowing under this project's own strictNullChecks:false setting.
type WriteSuccess = { ok: true; candidate: SecurityPatchCandidate };

@Injectable()
export class SecurityRemediationOrchestratorService {
  constructor(
    @Optional() private readonly decisionService: SecurityFindingDecisionService = new SecurityFindingDecisionService(),
    @Optional() private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    @Optional() private readonly repoCache: RepoCacheService = new RepoCacheService(),
    @Optional() private readonly mavenAdapter: MavenBuildAdapter = new MavenBuildAdapter(),
  ) {}

  orchestrate(input: SecurityRemediationOrchestrationInput): SecurityRemediationCandidateResult {
    // §4 steps 2-6: grounded provenance + fixedVersions normalization +
    // eligibility classification + target selection, all already
    // implemented and committed -- reused verbatim, not re-implemented.
    const decision = this.decisionService.decide(input.finding, {
      repository: input.repository, candidateBaseSha: input.candidateBaseSha,
      requestId: input.requestId, batchId: input.batchId, candidateAttempt: input.candidateAttempt,
    });

    const notEligible = (status: SecurityRemediationCandidateResult['status'], reason: string): SecurityRemediationCandidateResult => ({
      status, reason, decision, candidateIdentity: null, candidateManifest: null, patchEvidence: null, guardResult: null, dependencyResolutionEvidence: null,
    });

    // §4 step 5 / §5: never proceed past a non-AUTO_FIX_ELIGIBLE decision --
    // this single check is what keeps TRANSITIVE/BOM_MANAGED/PLUGIN/
    // cross-major/missing-fixedVersion/ungrounded/OWASP-no-fixedVersion/
    // ZAP-unsupported all STOPPING here, cleanly, with the real reason the
    // decision service already computed (never re-derived, never guessed).
    if (decision.remediationType !== 'AUTO_FIX_ELIGIBLE' || !decision.selectedTargetVersion || !decision.provenance || !decision.evaluatedSha) {
      // decision.reason is 'GROUNDING_FAILED:<failureClass>' ONLY when a
      // real checkout/dependency-tree run was actually attempted and
      // failed (see SecurityFindingDecisionService.decide()) -- every other
      // non-eligible reason (SOURCE_NOT_SUPPORTED_V1, FIXED_VERSION_MISSING,
      // TRANSITIVE_NOT_AUTOFIXABLE_V1, BOM_MANAGED_NOT_AUTOFIXABLE_V1,
      // PROVENANCE_UNRESOLVED, CROSS_MAJOR_ONLY, ...) is a clean,
      // deterministic classification that never even needed (or
      // deliberately skipped) a real checkout. Distinguishing on the
      // reason string, not on evaluatedSha nullness, keeps "grounding was
      // never attempted because it wasn't needed" from being mislabeled as
      // a failure.
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
    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(input.repository);
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
        sourceContent,
      };

      const writeResult = writeSecurityPatch(request);
      if (writeResult.ok !== true) {
        return notEligible('PATCH_GENERATION_FAILED', (writeResult as any).reason);
      }
      const candidate = (writeResult as WriteSuccess).candidate as any;

      // §4 step 8: independent security guard re-validation.
      const guardResult = assertSecurityPatchSafeToWrite(decision, request, candidate);
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
      const treeResult = this.mavenAdapter.dependencyTree(workspacePath);
      if (treeResult.status !== 'SUCCESS' || treeResult.text === null) {
        return {
          status: 'MAVEN_RESOLUTION_FAILED', reason: treeResult.evidenceTail || 'mvn dependency:tree did not produce usable output.',
          decision, candidateIdentity: null, candidateManifest: null, patchEvidence: null, guardResult,
          dependencyResolutionEvidence: { checked: true, resolvedMatch: null, evaluatedAtSha: decision.evaluatedSha! },
        };
      }
      const resolvedMatch = dependencyTreeResolvesTo(treeResult.text, provenance.package, candidate.targetVersion);
      if (!resolvedMatch) {
        return {
          status: 'MAVEN_RESOLUTION_MISMATCH', reason: `Real dependency:tree after patching does not resolve ${provenance.package} to ${candidate.targetVersion}.`,
          decision, candidateIdentity: null, candidateManifest: null, patchEvidence: null, guardResult,
          dependencyResolutionEvidence: { checked: true, resolvedMatch: false, evaluatedAtSha: decision.evaluatedSha! },
        };
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
      });

      return {
        status: 'CANDIDATE_READY', reason: 'DETERMINISTIC_CANDIDATE_READY', decision, candidateIdentity, candidateManifest,
        patchEvidence: {
          provenanceKind: provenance.kind, oldVersion: candidate.oldVersion, targetVersion: candidate.targetVersion,
          controllingFile: provenance.controllingFile, controllingElement: provenance.controllingElement, controllingProperty: provenance.controllingProperty,
        },
        guardResult,
        dependencyResolutionEvidence: { checked: true, resolvedMatch: true, evaluatedAtSha: decision.evaluatedSha! },
      };
    } finally {
      this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
    }
  }
}
