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
import { createHash } from 'crypto';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { SecurityFindingResolverService, TrustedFindingResolution } from './security-finding-resolver.service';
import { CandidateVerificationService } from '../candidate-verification/candidate-verification.service';
import { SecurityRemediationEvaluateDto } from './security-remediation-evaluate.dto';
import { SecurityRemediationEvaluateBatchDto } from './security-remediation-evaluate-batch.dto';
import { SecurityRemediationRevalidateDto } from './security-remediation-revalidate.dto';
import { Wf6RemediationResultDto } from './wf6-remediation-result.dto';
import { Wf6BatchRemediationResultDto } from './wf6-batch-remediation-result.dto';
import { ManualRemediationService } from '../manual-remediation/manual-remediation.service';
import { SecurityRemediationOrchestrationInput, SecurityRemediationEvaluationResult } from './security-remediation-orchestration.types';
import { SecurityRemediationBatchOrchestrationInput, SecurityRemediationBatchFindingInput } from './security-remediation-batch-orchestration.types';
import { computeSecurityBranchName } from './security-branch-name';
import { computeSecurityCommitMessage, computeSecurityPrTitle, computeSecurityPrBody } from './security-remediation-git-metadata';
import { computeSecurityBatchCommitMessage, computeSecurityBatchPrTitle, computeSecurityBatchPrBody } from './security-remediation-batch-git-metadata';
import { computeSecurityBatchFindingsFingerprint } from './security-candidate-identity';

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

// Increment 1 (WF6 multi-CVE wiring) — the batch counterpart of
// withGitAuthoringMetadata() above. Deliberately NOT a modification of
// that function (it stays untouched, still used unmodified by /evaluate
// and /revalidate) — a separate function so a mono-CVE run keeps going
// through the EXACT code path proven by PR #37, never through a
// generalized-for-N branch of it. `cosmetics` is aligned by index with
// `value.decisions`.
//
// ★ Caught by field-by-field contract review against WF6's OWN unchanged
// nodes (before writing a single line of graph diff): the "Trusted
// Candidate" node -- one of the ~45 git/build/scan nodes this increment
// must NOT touch -- reads `body.repository` (top-level, not nested under
// candidateManifest) and `body.decision.evaluatedSha` (SINGULAR `decision`,
// not the plural `decisions` array this type actually carries). Both are
// added here as compatibility fields so that unchanged node keeps working
// unmodified: `repository` is genuinely singular for a whole batch
// (enforced identical across findings upstream), and `decision` is simply
// `decisions[0]` -- correct for ANY N, not just N=1, because
// evaluatedSha is verified identical across every finding in the batch.
function withBatchGitAuthoringMetadata<T extends { status: string; decisions?: any[]; candidateIdentity?: string | null }>(value: T, cosmetics: ResponseMeta[]) {
  const repository = cosmetics.find(c => c.repository)?.repository ?? null;
  const decision = Array.isArray(value.decisions) && value.decisions.length ? value.decisions[0] : null;
  const base = { ...value, repository, decision };
  if (value.status !== 'CANDIDATE_READY') {
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
  const decisions = value.decisions;
  if (!Array.isArray(decisions) || !decisions.length || decisions.length !== cosmetics.length || !value.candidateIdentity
    || decisions.some(d => !d?.findingIdentity || !d?.provenance)) {
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
  try {
    const findingsFingerprint = computeSecurityBatchFindingsFingerprint(decisions.map(d => d.findingIdentity));
    const branchName = computeSecurityBranchName(findingsFingerprint, value.candidateIdentity);
    const gitMetaInputs = decisions.map((d, i) => ({
      cveId: cosmetics[i].cveId, package: d.provenance.package, installedVersion: d.provenance.installedVersion,
      targetVersion: d.selectedTargetVersion, source: cosmetics[i].source || 'UNKNOWN',
      provenanceKind: d.provenance.kind, evaluatedSha: d.evaluatedSha, candidateIdentity: value.candidateIdentity!,
    }));
    return {
      ...base, branchName,
      commitMessage: computeSecurityBatchCommitMessage(gitMetaInputs),
      prTitle: computeSecurityBatchPrTitle(gitMetaInputs),
      prBody: computeSecurityBatchPrBody(gitMetaInputs, value.candidateIdentity),
    };
  } catch {
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
}

@Controller('internal/security-remediation')
export class SecurityRemediationController {
  constructor(
    private readonly resolver: SecurityFindingResolverService,
    private readonly candidateVerification: CandidateVerificationService,
    private readonly manualRemediation: ManualRemediationService,
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

  // Increment 1 (WF6 multi-CVE wiring) — the batch counterpart of
  // /evaluate. Every findingTaskId is resolved through the SAME trusted
  // SecurityFindingResolverService.resolve(), one call per id, never a new
  // resolution path -- then cross-checked that they all agree on
  // repository/candidateBaseSha (they must: findings selected together in
  // one project necessarily share both) before ever reaching the worker.
  @UseGuards(InternalSecretGuard)
  @Post('evaluate-batch')
  async evaluateBatch(@Body() body: SecurityRemediationEvaluateBatchDto) {
    if (!body?.projectId || !Array.isArray(body?.findingTaskIds) || !body.findingTaskIds.length) {
      throw new BadRequestException('projectId and a non-empty findingTaskIds array are required.');
    }
    const outcome = await this.resolveAndEvaluateBatch(body.projectId, body.findingTaskIds);
    return withBatchGitAuthoringMetadata(outcome.result, outcome.cosmetics);
  }

  // Execution-2060 follow-up — persistence layer only (see
  // ManualRemediationService.recordWf6Result's own header comment). WF6's
  // own n8n workflow graph is NOT the caller of this endpoint and is not
  // modified to become one -- this is deliberately reachable only by
  // whatever ALREADY calls the WF6 webhook and already has its response
  // (or n8n's own execution record) in hand, exactly the same
  // InternalSecretGuard/n8n-only trust boundary as /evaluate and
  // /revalidate above.
  @UseGuards(InternalSecretGuard)
  @Post('result')
  async recordResult(@Body() body: Wf6RemediationResultDto) {
    return this.manualRemediation.recordWf6Result(body);
  }

  // Increment 1 — multi-CVE remediation callback. Same trust boundary and
  // "caller persists WF6's response" design as /result above; WF6's own
  // n8n workflow is not modified to become internally aware of this
  // endpoint's existence as part of this increment (see the design
  // cadrage's "least invasive" recommendation).
  @UseGuards(InternalSecretGuard)
  @Post('batch-result')
  async recordBatchResult(@Body() body: Wf6BatchRemediationResultDto) {
    return this.manualRemediation.recordWf6BatchResult(body);
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

  // Increment 1 (WF6 multi-CVE wiring) — batch counterpart of
  // resolveAndEvaluate() above. Each findingTaskId goes through the EXACT
  // same trusted resolve() call, one at a time, in the caller's own order
  // (so a caller can rely on `outcome.cosmetics[i]` lining up with its own
  // findingTaskIds[i]) — no new resolution logic. §3's "resolution before
  // the worker is ever called" holds for every finding in the batch, not
  // just the first.
  private async resolveAndEvaluateBatch(projectId: string, findingTaskIds: string[]): Promise<{ result: any; cosmetics: ResponseMeta[] }> {
    const reject = (reason: string, detail: string) => ({ result: { status: 'REJECTED', reason, detail }, cosmetics: findingTaskIds.map(() => ({ cveId: null, title: null, source: null, repository: null })) });

    const resolutions = await Promise.all(findingTaskIds.map(id => this.resolver.resolve(projectId, id)));
    const firstFailureIndex = resolutions.findIndex(r => r.ok !== true);
    if (firstFailureIndex !== -1) {
      const failure = resolutions[firstFailureIndex] as ResolutionFailure;
      return reject(failure.reason, `findingTaskId "${findingTaskIds[firstFailureIndex]}": ${failure.detail}`);
    }
    const successes = resolutions as ResolutionSuccess[];

    // Every finding in one batch must share the SAME repository/
    // candidateBaseSha -- true by construction for findings selected
    // together in one project (see security-finding-resolver.service.ts),
    // re-checked here rather than assumed, same "never trust a single
    // source" discipline used throughout this codebase.
    const repository = successes[0].repository, candidateBaseSha = successes[0].candidateBaseSha;
    const mismatchIndex = successes.findIndex(s => s.repository !== repository || s.candidateBaseSha !== candidateBaseSha);
    if (mismatchIndex !== -1) {
      return reject('INCONSISTENT_BATCH_CONTEXT', `findingTaskId "${findingTaskIds[mismatchIndex]}" resolves to a different repository/candidateBaseSha than the rest of the batch.`);
    }

    // §8's own discipline extended to a batch: cveId is REQUIRED for every
    // finding here (unlike the singular /evaluate, where it is cosmetic-
    // only) -- a batch cannot be named/reported on per-CVE without it. A
    // finding with no advisory id is rejected here, by name, rather than
    // silently reaching the orchestrator with a synthetic placeholder.
    const missingCveIndex = successes.findIndex(s => !s.cveId);
    if (missingCveIndex !== -1) {
      return reject('MISSING_CVE_IDENTITY', `findingTaskId "${findingTaskIds[missingCveIndex]}" has no advisory id -- cannot be named individually in a batch.`);
    }

    const findings: SecurityRemediationBatchFindingInput[] = successes.map(s => ({ ...s.finding, cveId: s.cveId! }));
    const input: SecurityRemediationBatchOrchestrationInput = {
      findings, repository, candidateBaseSha,
      // Deterministic, same convention as the singular endpoint's own
      // requestId -- no random/timestamp value, matches
      // ManualRemediationService.launchBatchRemediation()'s own batchId
      // derivation (sha256 of the sorted findingTaskIds).
      requestId: `sec-eval-batch-${createHash('sha256').update([...findingTaskIds].sort().join(',')).digest('hex').slice(0, 16)}`,
      batchId: 'internal-security-evaluate-batch',
      candidateAttempt: 0,
    };
    const result = await this.candidateVerification.evaluateSecurityRemediationBatch(input);
    const cosmetics: ResponseMeta[] = successes.map(s => ({ cveId: s.cveId, title: s.title, source: s.finding.source, repository: s.repository }));
    return { result, cosmetics };
  }
}
