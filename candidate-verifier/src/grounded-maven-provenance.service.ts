// R-SEC-V1.1 §1/§2 — grounds resolveMavenProvenance() (backend/src/
// security-remediation/maven-provenance-resolver.ts, pure) against a REAL
// exact-SHA worktree, reusing the SAME repository/workspace infrastructure
// CandidateVerificationExecutor already uses for candidate verification —
// no parallel git clone/worktree system is built here.
//
// Reused verbatim, unmodified:
//   - RepoCacheService.ensureRepo()        (repo-cache.service.ts)
//   - WorkspaceManager.createWorkspace()   (workspace-manager.service.ts) —
//     already does exact-SHA checkout + fail-closed SHA verification +
//     self-cleanup on mismatch (WorkspaceError('WORKSPACE_SHA_MISMATCH')).
//   - WorkspaceManager.cleanupWorkspace()  (teardown, unconditional, `finally`)
//   - MavenBuildAdapter.dependencyTree()   (new method, same file/class as
//     the existing compile()/runRegressionTests(), same runMaven() helper,
//     same safe-env/timeout/tail-capped-evidence discipline)
// This file adds ONLY the orchestration specific to provenance (reading
// pom.xml, calling the pure resolver) — no new checkout/cleanup logic.
import { Injectable, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager, WorkspaceError } from './workspace-manager.service';
import { RepoCacheService } from './repo-cache.service';
import { MavenBuildAdapter } from './maven-build-adapter';
import { resolveMavenProvenance } from '../../backend/src/security-remediation/maven-provenance-resolver';
import {
  GroundedMavenProvenanceRequest,
  GroundedMavenProvenanceResult,
  GroundedMavenProvenanceFailureClass,
  GroundedMavenProvenanceEvidence,
} from '../../backend/src/security-remediation/grounded-maven-provenance.types';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class GroundedMavenProvenanceService {
  constructor(
    @Optional() private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    @Optional() private readonly repoCache: RepoCacheService = new RepoCacheService(),
    @Optional() private readonly mavenAdapter: MavenBuildAdapter = new MavenBuildAdapter(),
  ) {}

  resolve(request: GroundedMavenProvenanceRequest): GroundedMavenProvenanceResult {
    const requestedSha = request.candidateBaseSha.toLowerCase();
    const evidence: GroundedMavenProvenanceEvidence = { requestedSha, checkoutSha: null, evaluatedSha: null };
    const fail = (failureClass: GroundedMavenProvenanceFailureClass, detail: string): GroundedMavenProvenanceResult =>
      ({ ok: false, failureClass, detail, evidence: { ...evidence } });

    // §1 — repository materialization, reused verbatim from
    // CandidateVerificationExecutor's own first step.
    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(request.repository);
    } catch (err: any) {
      return fail('WORKSPACE_INFRA_FAILURE', `Repository materialization failed: ${err?.message || 'unknown error'}`);
    }

    // §1/§3 — exact-SHA checkout + verification, reused verbatim.
    // WorkspaceManager.createWorkspace() already fails closed
    // (WorkspaceError('WORKSPACE_SHA_MISMATCH')) and self-cleans on
    // mismatch — this service never re-implements that check, only maps
    // the thrown error onto this service's own result shape. No fallback
    // to main/HEAD/latest-remote/another-branch exists anywhere in this
    // path — createWorkspace() either proves the exact SHA or throws.
    const workspaceId = this.workspaceManager.workspaceId(request.requestId, request.batchId, request.candidateAttempt);
    let workspacePath: string;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath, candidateBaseSha: requestedSha,
        requestId: request.requestId, batchId: request.batchId, candidateAttempt: request.candidateAttempt,
      });
      workspacePath = handle.path;
      evidence.checkoutSha = handle.checkoutSha;
      if (!handle.exactShaVerified || handle.checkoutSha.toLowerCase() !== requestedSha) {
        // Defensive: createWorkspace() should already have thrown in this
        // case, but PROVENANCE_EVALUATED_SHA must never be set from an
        // unverified checkout even if that invariant were ever weakened.
        this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
        return fail('WORKSPACE_SHA_MISMATCH', `checkoutSha (${handle.checkoutSha}) does not match requestedSha (${requestedSha}).`);
      }
      evidence.evaluatedSha = handle.checkoutSha;
    } catch (err: any) {
      const failureClass: GroundedMavenProvenanceFailureClass = err instanceof WorkspaceError ? err.failureClass : 'WORKSPACE_INFRA_FAILURE';
      return fail(failureClass, err?.message || 'Workspace creation failed.');
    }

    // From here on a workspace exists and MUST be cleaned up regardless of
    // outcome — identical discipline to CandidateVerificationExecutor's own
    // try/finally.
    try {
      const pomPath = path.join(workspacePath, 'pom.xml');
      let pomXmlText: string;
      try {
        pomXmlText = fs.readFileSync(pomPath, 'utf8');
      } catch {
        return fail('POM_NOT_FOUND', `No pom.xml at the root of the exact-SHA worktree (${evidence.evaluatedSha}).`);
      }

      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const treeResult = this.mavenAdapter.dependencyTree(workspacePath, timeoutMs);
      if (treeResult.status !== 'SUCCESS' || treeResult.text === null) {
        return fail(
          treeResult.timedOut ? 'DEPENDENCY_TREE_TIMEOUT' : 'DEPENDENCY_TREE_FAILED',
          treeResult.evidenceTail || 'mvn dependency:tree did not produce usable output.',
        );
      }

      const provenance = resolveMavenProvenance({
        package: request.package,
        installedVersion: request.expectedInstalledVersion,
        pomXmlText,
        dependencyTreeText: treeResult.text,
        controllingFilePath: 'pom.xml',
        groundedSha: evidence.evaluatedSha!,
      });

      return { ok: true, provenance, evidence: { ...evidence } };
    } finally {
      this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
    }
  }
}
