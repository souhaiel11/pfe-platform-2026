// R22-C — P3 Candidate Verification engine. Orchestrates workspace
// creation, materialization, build detection, compile, and regression
// tests against an exact-SHA, immutable candidate. Never touches GitHub;
// never resolves a scanner finding (WF3 remains authoritative — see R22-A).
//
// verificationLevel is hardcoded to COMPILE_TEST_VERIFIED everywhere in
// this file on purpose: FULL_PREFLIGHT_VERIFIED is a real value in the type
// system (for a later phase once a static-analysis adapter exists) but is
// never reachable from this service's code — see
// candidate-verification.service.spec.ts's explicit assertion that no code
// path here can produce it.
import { Injectable, Optional } from '@nestjs/common';
import { CandidateManifest, CandidateVerification, FailureClass } from './candidate-verification.types';
import { computeCandidateDigest } from './candidate-digest';
import { WorkspaceManager, WorkspaceError } from './workspace-manager.service';
import { CandidateMaterializer, MaterializationError } from './candidate-materializer.service';
import { BuildAdapter } from './build-adapter';
import { MavenBuildAdapter } from './maven-build-adapter';

export interface VerifyOptions {
  repoPath: string;
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
export class CandidateVerificationService {
  private readonly buildAdapters: BuildAdapter[];

  constructor(
    @Optional() private readonly workspaceManager: WorkspaceManager = new WorkspaceManager(),
    @Optional() private readonly materializer: CandidateMaterializer = new CandidateMaterializer(),
    @Optional() buildAdapters?: BuildAdapter[],
  ) {
    this.buildAdapters = buildAdapters ?? [new MavenBuildAdapter()];
  }

  verify(manifest: CandidateManifest, options: VerifyOptions): CandidateVerification {
    const candidateDigest = manifest.candidateDigest ?? computeCandidateDigest(manifest);
    const workspaceId = this.workspaceManager.workspaceId(manifest.requestId, manifest.batchId, manifest.candidateAttempt);
    const identity = {
      candidateId: manifest.candidateId, requestId: manifest.requestId, batchId: manifest.batchId,
      candidateAttempt: manifest.candidateAttempt, candidateBaseSha: manifest.candidateBaseSha, candidateDigest,
    };
    const targeted = { status: 'NOT_RUN' as const, reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' as const };
    const staticAnalysis = { status: 'NOT_RUN' as const, reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED' as const, newIssues: [] as unknown[], evidenceRef: null };

    const base = (overrides: Partial<CandidateVerification>): CandidateVerification => ({
      identity,
      workspace: { workspaceId, exactShaVerified: false, created: false, cleaned: false },
      manifestValidation: { status: 'FAIL', errors: [] },
      compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
      tests: { targeted, regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
      staticAnalysis,
      overall: 'FAIL',
      verificationLevel: 'COMPILE_TEST_VERIFIED',
      failureClass: null,
      ...overrides,
    });

    const manifestErrors = validateManifest(manifest);
    if (manifestErrors.length > 0) {
      return base({ manifestValidation: { status: 'FAIL', errors: manifestErrors }, overall: 'FAIL', failureClass: 'CANDIDATE_MANIFEST_INVALID' });
    }

    let workspacePath: string | null = null;
    let workspaceCreated = false;
    let exactShaVerified = false;
    try {
      const handle = this.workspaceManager.createWorkspace({
        repoPath: options.repoPath, candidateBaseSha: manifest.candidateBaseSha,
        requestId: manifest.requestId, batchId: manifest.batchId, candidateAttempt: manifest.candidateAttempt,
      });
      workspacePath = handle.path;
      workspaceCreated = true;
      exactShaVerified = handle.exactShaVerified;
    } catch (err: any) {
      const failureClass: FailureClass = err instanceof WorkspaceError ? err.failureClass : 'WORKSPACE_INFRA_FAILURE';
      // Nothing was created (or WorkspaceManager already force-cleaned a
      // SHA-mismatched worktree itself) — no cleanup step needed here.
      return base({
        manifestValidation: { status: 'PASS', errors: [] },
        workspace: { workspaceId, exactShaVerified: false, created: false, cleaned: false },
        overall: 'FAIL', failureClass,
      });
    }

    // From here on a workspace exists and MUST be cleaned up no matter how
    // this function exits (return, thrown error) — captured in `result` and
    // patched with cleaned:true right before returning, in `finally`.
    let result!: CandidateVerification;
    try {
      try {
        this.materializer.materialize(workspacePath, manifest, options.allowedPaths);
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
      const testsUnknown = regression.status === 'UNKNOWN';
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
      this.workspaceManager.cleanupWorkspace(workspaceId, options.repoPath);
      if (result) result.workspace.cleaned = true;
    }
  }
}
