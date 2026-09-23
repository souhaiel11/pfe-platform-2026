// R-SEC-V1.4/V1.5 — internal endpoint only, same trust pattern already used
// by CandidateVerificationController (InternalSecretGuard, the n8n->backend
// pattern -- see incidents.controller.ts's saveValidation/saveWorkflowStatus
// too). NOT public, NOT wired into frontend routing this phase.
//
// Both endpoints accept ONLY a narrow whitelist DTO -- neither ever reads
// any other field from the request body, so a caller cannot influence WHAT
// is evaluated/revalidated beyond WHICH finding, let alone HOW the patch
// is produced (§8 of V1.4).
import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { SecurityFindingResolverService, TrustedFindingResolution } from './security-finding-resolver.service';
import { CandidateVerificationService } from '../candidate-verification/candidate-verification.service';
import { SecurityRemediationEvaluateDto } from './security-remediation-evaluate.dto';
import { SecurityRemediationRevalidateDto } from './security-remediation-revalidate.dto';
import { SecurityRemediationOrchestrationInput, SecurityRemediationEvaluationResult } from './security-remediation-orchestration.types';
import { computeSecurityBranchName } from './security-branch-name';
import { computeSecurityCommitMessage, computeSecurityPrTitle, computeSecurityPrBody } from './security-remediation-git-metadata';

// See maven-security-patch-writer.ts / security-finding-decision.service.ts
// for why Extract<> + a cast is used instead of relying on `if (!x.ok)`
// narrowing under this project's own strictNullChecks:false setting.
type ResolutionFailure = Extract<TrustedFindingResolution, { ok: false }>;
type ResolutionSuccess = Extract<TrustedFindingResolution, { ok: true }>;

// `repository` is authoritative trusted OUTPUT (WF6 needs it to address the
// GitHub API) but is NEVER accepted back as caller INPUT on any endpoint --
// see the DTOs, which have no such field. cveId/title/source are purely
// cosmetic (never influence the decision at all).
interface ResponseMeta { cveId: string | null; title: string | null; source: string | null; repository: string | null }

// R-SEC-V1.5 §6/§9/§10 -- WF6 needs ZERO text-authoring/naming logic of its
// own: branchName/commitMessage/prTitle/prBody are all computed HERE,
// server-side, deterministically, from already-trusted fields, and
// returned directly on every CANDIDATE_READY/WRITE_AUTHORIZED response.
// Absent (null) for every other status -- there is nothing safe to name/
// write about a non-eligible or failed evaluation.
function withGitAuthoringMetadata<T extends { status: string; decision?: any; candidateIdentity?: string | null }>(value: T, cosmetic: ResponseMeta) {
  const base = { ...value, ...cosmetic };
  if (value.status !== 'CANDIDATE_READY' && value.status !== 'WRITE_AUTHORIZED') {
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
  const provenance = value.decision?.provenance;
  if (!value.decision?.findingIdentity || !value.candidateIdentity || !provenance) {
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
  try {
    const branchName = computeSecurityBranchName(value.decision.findingIdentity, value.candidateIdentity);
    const gitMetaInput = {
      cveId: cosmetic.cveId, package: provenance.package, installedVersion: provenance.installedVersion,
      targetVersion: value.decision.selectedTargetVersion, source: cosmetic.source || 'UNKNOWN',
      provenanceKind: provenance.kind, evaluatedSha: value.decision.evaluatedSha, candidateIdentity: value.candidateIdentity,
    };
    return {
      ...base, branchName,
      commitMessage: computeSecurityCommitMessage(gitMetaInput),
      prTitle: computeSecurityPrTitle(gitMetaInput),
      prBody: computeSecurityPrBody(gitMetaInput),
    };
  } catch {
    // Fail-closed pure computations (malformed hash shape, etc.) can never
    // legitimately throw here in production (every input is already-
    // trusted, well-formed by construction) -- never let an internal
    // invariant break surface as an unhandled 500: degrade to nulls, the
    // rest of the response (the real decision/candidate) is still valid.
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
}

@Controller('internal/security-remediation')
export class SecurityRemediationController {
  constructor(
    private readonly resolver: SecurityFindingResolverService,
    private readonly candidateVerification: CandidateVerificationService,
  ) {}

  @UseGuards(InternalSecretGuard)
  @Post('evaluate')
  async evaluate(@Body() body: SecurityRemediationEvaluateDto) {
    if (!body?.projectId || !body?.findingTaskId) {
      throw new BadRequestException('projectId and findingTaskId are required.');
    }
    const outcome = await this.resolveAndEvaluate(body.projectId, body.findingTaskId);
    return withGitAuthoringMetadata(outcome.result, { cveId: outcome.cveId, title: outcome.title, source: outcome.source, repository: outcome.repository });
  }

  // R-SEC-V1.5 §4 — write-time revalidation. WF6 must call this
  // IMMEDIATELY before a GitHub write, passing back ONLY the
  // candidateIdentity it received from an earlier /evaluate call (never
  // candidate bytes -- see the DTO's own header comment). This method
  // re-resolves the trusted finding and re-runs the FULL deterministic
  // pipeline (grounding -> classification -> patch -> guard) completely
  // FRESH -- exactly the same call /evaluate makes, proven deterministic
  // and side-effect-free across repeated invocations (V1.3/V1.4's own
  // idempotency tests). It NEVER trusts the caller's own copy of the
  // candidate for the write itself: on a match, it returns its OWN
  // freshly-recomputed candidateManifest as the thing to actually write --
  // a caller cannot substitute different bytes even if it tried, because
  // the response WF6 must act on is never built from caller input.
  @UseGuards(InternalSecretGuard)
  @Post('revalidate')
  async revalidate(@Body() body: SecurityRemediationRevalidateDto) {
    if (!body?.projectId || !body?.findingTaskId || !body?.expectedCandidateIdentity) {
      throw new BadRequestException('projectId, findingTaskId and expectedCandidateIdentity are required.');
    }
    const outcome = await this.resolveAndEvaluate(body.projectId, body.findingTaskId);
    const fresh: any = outcome.result;
    const cosmetic: ResponseMeta = { cveId: outcome.cveId, title: outcome.title, source: outcome.source, repository: outcome.repository };

    // Anything other than a fresh CANDIDATE_READY is passed straight
    // through, unchanged -- a REJECTED/NOT_ELIGIBLE/TECHNICAL_FAILURE/etc.
    // outcome here means the write must not proceed, for the SAME real
    // reason /evaluate would have reported it, never silently reclassified.
    if (fresh.status !== 'CANDIDATE_READY') {
      return withGitAuthoringMetadata(fresh, cosmetic);
    }

    // §4's core invariant: "current write candidate == deterministically
    // authorized candidate". Comparing the STABLE identity (sha256 of
    // findingIdentity+evaluatedSha+package+installedVersion+targetVersion+
    // controllingFile) is sufficient and safer than comparing raw file
    // bytes supplied by the caller: identity mismatch can only mean the
    // underlying trusted evidence (repository state, persisted finding
    // snapshot) has genuinely changed since the earlier /evaluate call.
    if (fresh.candidateIdentity !== body.expectedCandidateIdentity) {
      return {
        status: 'CANDIDATE_DRIFTED',
        reason: 'Freshly recomputed candidateIdentity no longer matches the identity authorized at evaluation time -- trusted evidence changed between evaluate and write.',
        expectedCandidateIdentity: body.expectedCandidateIdentity,
        freshCandidateIdentity: fresh.candidateIdentity,
      };
    }

    return withGitAuthoringMetadata({ ...fresh, status: 'WRITE_AUTHORIZED' }, cosmetic);
  }

  private async resolveAndEvaluate(projectId: string, findingTaskId: string): Promise<{ result: SecurityRemediationEvaluationResult | { status: 'REJECTED'; reason: string; detail: string }; cveId: string | null; title: string | null; source: string | null; repository: string | null }> {
    // §3 — trusted resolution happens BEFORE the worker is ever called.
    // Everything past this point (finding/repository/candidateBaseSha) is
    // server-derived; body is never touched again.
    const resolution = await this.resolver.resolve(projectId, findingTaskId);
    if (resolution.ok !== true) {
      const failure = resolution as ResolutionFailure;
      return { result: { status: 'REJECTED', reason: failure.reason, detail: failure.detail }, cveId: null, title: null, source: null, repository: null };
    }
    const success = resolution as ResolutionSuccess;

    // requestId/batchId are workspace-naming identity only (matches
    // WorkspaceManager's identity segment pattern) -- never a business
    // decision input. Deterministically derived from the SAME trusted
    // findingTaskId every time (§9/V1.4 idempotency: no random/timestamp value).
    const input: SecurityRemediationOrchestrationInput = {
      finding: success.finding,
      repository: success.repository,
      candidateBaseSha: success.candidateBaseSha,
      requestId: `sec-eval-${findingTaskId}`,
      batchId: 'internal-security-evaluate',
      candidateAttempt: 0,
    };
    return {
      result: await this.candidateVerification.evaluateSecurityRemediation(input),
      cveId: success.cveId, title: success.title, source: success.finding.source, repository: success.repository,
    };
  }
}
