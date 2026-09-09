// R22-E2C2 — execution-plane orchestrator. Moved verbatim in logic from
// backend/src/candidate-verification/candidate-verification.service.ts
// (R22-C), which becomes a thin HTTP client after this move (see
// backend/src/candidate-verification/candidate-verification.service.ts).
// The only semantic change: repoPath is no longer supplied by the caller --
// this class now owns repository materialization itself via RepoCacheService
// (also moved here, per R22-E2C1 Phase 8/9: "backend must no longer need
// repository filesystem access for candidate execution").
//
// Never touches GitHub write APIs, never resolves a scanner finding, never
// decides a business retry -- identical invariants to the code this was
// moved from.
import { Injectable, Optional } from '@nestjs/common';
import { CandidateManifest, CandidateVerification, FailureClass, HeadVerificationRequest, HeadVerification, VerificationResult, assertHeadVerificationRequest } from '../../backend/src/candidate-verification/candidate-verification.types';
import { computeCandidateDigest } from '../../backend/src/candidate-verification/candidate-digest';
import { WorkspaceManager, WorkspaceError } from './workspace-manager.service';
import { CandidateMaterializer, MaterializationError } from './candidate-materializer.service';
import { BuildAdapter } from './build-adapter';
import { MavenBuildAdapter } from './maven-build-adapter';
import { GradleBuildAdapter } from './gradle-build-adapter';
import { NpmBuildAdapter } from './npm-build-adapter';
import { PythonBuildAdapter } from './python-build-adapter';
import { RepoCacheService } from './repo-cache.service';

export interface ExecuteVerifyOptions {
  allowedPaths?: string[];
  timeoutMs?: number;
}

function validateManifest(manifest: CandidateManifest): string[] {
  const errors: string[] = [];
  if (!manifest.files.length) errors.push('Candidate manifest has zero files.');
  const seenPaths = new Set<string>();
  for (const file of manifest.files) {
    if (!file.path || file.path.trim() === '') errors.push('A candidate file has an empty path.');
    if (seenPaths.has(file.path)) errors.push(`Duplicate path in manifest: ${file.path}`);
    seenPaths.add(file.path);
    if (!['MODIFY', 'CREATE'].includes(file.operation)) errors.push(`Unsupported operation '${file.operation}' for ${file.path}`);
    if (!/^[0-9a-f]{64}$/i.test(file.contentSha256 || '')) errors.push(`Invalid contentSha256 for ${file.path}`);
  }
  return errors;
}

@Injectable()
export class CandidateVerificationExecutor {
  private readonly buildAdapters: BuildAdapter[];

  constructor(
    @Optional() private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    @Optional() private readonly materializer: CandidateMaterializer = new CandidateMaterializer(),
    @Optional() private readonly repoCache: RepoCacheService = new RepoCacheService(),
    @Optional() buildAdapters?: BuildAdapter[],
  ) {
    this.buildAdapters = buildAdapters ?? [new MavenBuildAdapter(), new GradleBuildAdapter(), new NpmBuildAdapter(), new PythonBuildAdapter()];
  }

  execute(manifest: CandidateManifest, options: ExecuteVerifyOptions = {}): CandidateVerification {
    return this.run(manifest, options) as CandidateVerification;
  }

  executeHead(request: HeadVerificationRequest): HeadVerification {
    assertHeadVerificationRequest(request);
    return this.run(null, { timeoutMs: request.options?.timeoutMs }, request) as HeadVerification;
  }

  private run(manifest: CandidateManifest | null, options: ExecuteVerifyOptions, head?: HeadVerificationRequest): VerificationResult {
    const context = head || manifest;
    const targetSha = head ? head.targetSha.toLowerCase() : manifest.candidateBaseSha;
    let checkoutSha: string | null = null;
    const candidateDigest = head ? undefined : (manifest.candidateDigest ?? computeCandidateDigest(manifest));
    const workspaceId = this.workspaceManager.workspaceId(context.requestId, context.batchId, context.candidateAttempt);
    const identity = head ? { repository: head.repository, targetSha, validationRequestId: head.validationRequestId,
      requestId: head.requestId, batchId: head.batchId, candidateAttempt: head.candidateAttempt } : {
      candidateId: manifest.candidateId, requestId: manifest.requestId, batchId: manifest.batchId,
      candidateAttempt: manifest.candidateAttempt, candidateBaseSha: manifest.candidateBaseSha, candidateDigest,
    };
    const targeted = { status: 'NOT_RUN' as const, reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' as const };
    const staticAnalysis = { status: 'NOT_RUN' as const, reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED' as const, newIssues: [] as unknown[], evidenceRef: null };

    const base = (overrides: Partial<CandidateVerification>): VerificationResult => {
      const result: CandidateVerification = {
        identity: identity as CandidateVerification['identity'],
        workspace: { workspaceId, exactShaVerified: false, created: false, cleaned: false },
        manifestValidation: { status: 'FAIL', errors: [] },
        compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
        tests: { targeted, regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
        staticAnalysis,
        overall: 'FAIL',
        verificationLevel: 'COMPILE_TEST_VERIFIED',
        failureClass: null,
        ...overrides,
      };
      if (!head) return result;
      const { manifestValidation, ...common } = result;
      return { ...common, mode: 'HEAD_ONLY', identity: identity as HeadVerification['identity'],
        workspace: { ...result.workspace, checkoutSha } };
    };

    const manifestErrors = head ? [] : validateManifest(manifest);
    if (manifestErrors.length > 0) {
      return base({ manifestValidation: { status: 'FAIL', errors: manifestErrors }, overall: 'FAIL', failureClass: 'CANDIDATE_MANIFEST_INVALID' });
    }

    let repoPath: string;
    try {
      repoPath = this.repoCache.ensureRepo(context.repository);
    } catch (err: any) {
      return base({
        manifestValidation: { status: 'PASS', errors: [] },
        overall: head ? 'INCONCLUSIVE' : 'FAIL', failureClass: 'WORKSPACE_INFRA_FAILURE',
      });
    }

    let workspacePath: string | null = null;
    let workspaceCreated = false;
    let exactShaVerified = false;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath, candidateBaseSha: targetSha,
        requestId: context.requestId, batchId: context.batchId, candidateAttempt: context.candidateAttempt,
      });
      workspacePath = handle.path;
      workspaceCreated = true;
      exactShaVerified = handle.exactShaVerified;
      if (head) {
        checkoutSha = handle.checkoutSha || null;
        if (!exactShaVerified || checkoutSha?.toLowerCase() !== targetSha) {
          this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
          const failure = base({ overall: 'INCONCLUSIVE', workspace: { workspaceId, exactShaVerified: false, created: true, cleaned: true } }) as HeadVerification;
          return { ...failure, failureClass: 'SHA_UNAVAILABLE' };
        }
      }
    } catch (err: any) {
      const failureClass: FailureClass = err instanceof WorkspaceError ? err.failureClass : 'WORKSPACE_INFRA_FAILURE';
      // Nothing was created (or WorkspaceManager already force-cleaned a
      // SHA-mismatched worktree itself) — no cleanup step needed here.
      const failure = base({
        manifestValidation: { status: 'PASS', errors: [] },
        workspace: { workspaceId, exactShaVerified: false, created: false, cleaned: false },
        overall: head ? 'INCONCLUSIVE' : 'FAIL', failureClass,
      });
      return head ? { ...failure, failureClass: 'SHA_UNAVAILABLE' } as HeadVerification : failure;
    }

    // From here on a workspace exists and MUST be cleaned up no matter how
    // this function exits (return, thrown error) — captured in `result` and
    // patched with cleaned:true right before returning, in `finally`.
    let result!: VerificationResult;
    try {
      try {
        if (!head) this.materializer.materialize(workspacePath, manifest, options.allowedPaths);
      } catch (err: any) {
        const failureClass: FailureClass = err instanceof MaterializationError ? err.failureClass : 'CANDIDATE_MATERIALIZATION_FAILED';
        result = base({
          manifestValidation: failureClass === 'CANDIDATE_MANIFEST_INVALID' ? { status: 'FAIL', errors: [err.message] } : { status: 'PASS', errors: [] },
          workspace: { workspaceId, exactShaVerified, created: workspaceCreated, cleaned: false },
          overall: 'FAIL', failureClass,
        });
        return result;
      }

      const adapter = this.buildAdapters.find(a => a.supports(workspacePath!));
      if (!adapter) {
        result = base({
          manifestValidation: { status: 'PASS', errors: [] },
          workspace: { workspaceId, exactShaVerified, created: workspaceCreated, cleaned: false },
          overall: 'INCONCLUSIVE', failureClass: 'BUILD_TYPE_UNSUPPORTED',
        });
        return result;
      }

      const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
      const compileResult = adapter.compile(workspacePath, timeoutMs);
      if (compileResult.status !== 'SUCCESS') {
        result = base({
          manifestValidation: { status: 'PASS', errors: [] },
          workspace: { workspaceId, exactShaVerified, created: workspaceCreated, cleaned: false },
          compile: { status: 'FAILED', exitCode: compileResult.exitCode, durationMs: compileResult.durationMs, evidenceRef: compileResult.evidenceTail },
          overall: 'FAIL',
          failureClass: compileResult.evidenceTail.includes('WORKSPACE_TIMEOUT') ? 'WORKSPACE_TIMEOUT' : 'CANDIDATE_COMPILE_FAILURE',
        });
        return result;
      }

      const regression = adapter.runRegressionTests(workspacePath, timeoutMs);
      const testsFailed = regression.status === 'FAILED';
      const testsUnknown = regression.status === 'UNKNOWN' || (!!head && regression.status !== 'SUCCESS' && !testsFailed);
      const overall = testsFailed ? 'FAIL' : testsUnknown ? 'INCONCLUSIVE' : 'PASS';
      const failureClass: FailureClass | null = testsFailed ? 'CANDIDATE_TEST_REGRESSION' : testsUnknown ? 'UNKNOWN' : null;

      result = base({
        manifestValidation: { status: 'PASS', errors: [] },
        workspace: { workspaceId, exactShaVerified, created: workspaceCreated, cleaned: false },
        compile: { status: 'SUCCESS', exitCode: compileResult.exitCode, durationMs: compileResult.durationMs, evidenceRef: compileResult.evidenceTail },
        tests: { targeted, regression },
        overall,
        failureClass,
      });
      return result;
    } finally {
      // CLEANUP: unconditional, covers PASS/FAIL/INCONCLUSIVE/exception —
      // the `finally` here is literal, not just a naming convention.
      this.workspaceManager.cleanupWorkspace(workspaceId, repoPath);
      if (result) result.workspace.cleaned = true;
    }
  }
}
