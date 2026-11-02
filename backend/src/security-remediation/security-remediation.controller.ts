// Expose l'évaluation et la revalidation des corrections de sécurité, seules ou par lot, puis reçoit les résultats WF6.
import { RetryE2EHarnessService } from './retry-e2e-harness.service';
import { Body, Controller, Post, UseGuards, BadRequestException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { SecurityFindingResolverService, TrustedFindingResolution } from './security-finding-resolver.service';
import { CandidateVerificationService } from '../candidate-verification/candidate-verification.service';
import { SecurityRemediationEvaluateDto } from './security-remediation-evaluate.dto';
import { SecurityRemediationEvaluateBatchDto } from './security-remediation-evaluate-batch.dto';
import { SecurityRemediationRevalidateDto } from './security-remediation-revalidate.dto';
import { SecurityRemediationRevalidateBatchDto } from './security-remediation-revalidate-batch.dto';
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

/** Prépare le résultat lié à avec Git Authoring Metadata. */
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
    const branchName = computeSecurityBranchName(value.decision.findingIdentity, value.candidateIdentity, value.decision.evaluatedSha);
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

/** Prépare le résultat lié à avec lot Git Authoring Metadata. */
function withBatchGitAuthoringMetadata<T extends { status: string; decisions?: any[]; candidateIdentity?: string | null }>(value: T, cosmetics: ResponseMeta[]) {
  const repository = cosmetics.find(c => c.repository)?.repository ?? null;
  const decision = Array.isArray(value.decisions) && value.decisions.length ? value.decisions[0] : null;
  const base = { ...value, repository, decision };
  // WRITE_AUTHORIZED (revalidate-batch's own success outcome, mirroring the
  // singular endpoint's withGitAuthoringMetadata()) must ALSO compute the
  // git-authoring fields -- only a genuinely non-ready/non-authorized
  // status nulls them out.
  if (value.status !== 'CANDIDATE_READY' && value.status !== 'WRITE_AUTHORIZED') {
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
  const decisions = value.decisions;
  if (!Array.isArray(decisions) || !decisions.length || decisions.length !== cosmetics.length || !value.candidateIdentity
    || decisions.some(d => !d?.findingIdentity || !d?.provenance)) {
    return { ...base, branchName: null, commitMessage: null, prTitle: null, prBody: null };
  }
  try {
    const findingsFingerprint = computeSecurityBatchFindingsFingerprint(decisions.map(d => d.findingIdentity));
    const branchName = computeSecurityBranchName(findingsFingerprint, value.candidateIdentity, new Set(decisions.map(d => d.evaluatedSha)).size === 1 ? decisions[0].evaluatedSha : null,
      typeof (value as any).batchId === 'string' && (value as any).batchId.startsWith('sec-batch-') ? (value as any).batchId : null);
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
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private readonly resolver: SecurityFindingResolverService,
    private readonly candidateVerification: CandidateVerificationService,
    private readonly manualRemediation: ManualRemediationService,
    @Optional() private readonly retryE2E?: RetryE2EHarnessService,
  ) {}

  /** Évalue les données et retourne la décision correspondante. */
  @UseGuards(InternalSecretGuard)
  @Post('evaluate')
  async evaluate(@Body() body: SecurityRemediationEvaluateDto) {
    if (!body?.projectId || !body?.findingTaskId) {
      throw new BadRequestException('projectId and findingTaskId are required.');
    }
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, [body.findingTaskId]);
    const outcome = await this.resolveAndEvaluate(body.projectId, body.findingTaskId);
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, [body.findingTaskId]);
    return withGitAuthoringMetadata(outcome.result, { cveId: outcome.cveId, title: outcome.title, source: outcome.source, repository: outcome.repository });
  }

  /** Évalue lot. */
  @UseGuards(InternalSecretGuard)
  @Post('evaluate-batch')
  async evaluateBatch(@Body() body: SecurityRemediationEvaluateBatchDto) {
    if (!body?.projectId || !Array.isArray(body?.findingTaskIds) || !body.findingTaskIds.length) {
      throw new BadRequestException('projectId and a non-empty findingTaskIds array are required.');
    }
    const correlated = body.batchId !== undefined || body.attempts !== undefined;
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, body.findingTaskIds, correlated);
    if (correlated) await this.manualRemediation.verifyWf6AttemptContext(body.projectId, body.findingTaskIds, body.batchId, body.attempts);
    if (this.retryE2E) await this.retryE2E.assertInitialScope(body.projectId, body.findingTaskIds, correlated);
    const outcome = await this.resolveAndEvaluateBatch(body.projectId, body.findingTaskIds, correlated ? { batchId: body.batchId, attempts: body.attempts } : undefined, true);
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, body.findingTaskIds, correlated);
    if (correlated) {
      await this.manualRemediation.verifyWf6AttemptContext(body.projectId, body.findingTaskIds, body.batchId, body.attempts);
      outcome.result = { ...outcome.result, batchId: body.batchId, attempts: body.attempts };
      if (body.findingTaskIds.length === 1 && this.retryE2E) {
        const identity = body.attempts[0];
        const action = await this.retryE2E.hook({ projectId: body.projectId, taskId: body.findingTaskIds[0],
          ...identity, batchId: body.batchId }, outcome.result.status === 'CANDIDATE_READY' ? 'CANDIDATE_READY' : 'EVALUATION_ABORTED');
        if (action === 'BARRIER' || action === 'BARRIER_REPLAY') return { status: 'OPERATOR_TEST_STOPPED', operatorTestBarrier: true,
          operatorTestEvaluationPassed: outcome.result.status === 'CANDIDATE_READY',
          batchId: body.batchId, attempts: body.attempts }; // no writable candidate or business callback
      }
    }
    return withBatchGitAuthoringMetadata(outcome.result, outcome.cosmetics);
  }

  /** Enregistre le résultat. */
  @UseGuards(InternalSecretGuard)
  @Post('result')
  async recordResult(@Body() body: Wf6RemediationResultDto) {
    return this.manualRemediation.recordWf6Result(body);
  }

  /** Enregistre lot résultat. */
  @UseGuards(InternalSecretGuard)
  @Post('batch-result')
  async recordBatchResult(@Body() body: Wf6BatchRemediationResultDto) {
    return this.manualRemediation.recordWf6BatchResult(body);
  }

  /** Contrôle à nouveau les preuves avant l’écriture. */
  @UseGuards(InternalSecretGuard)
  @Post('revalidate')
  async revalidate(@Body() body: SecurityRemediationRevalidateDto) {
    if (!body?.projectId || !body?.findingTaskId || !body?.expectedCandidateIdentity) {
      throw new BadRequestException('projectId, findingTaskId and expectedCandidateIdentity are required.');
    }
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, [body.findingTaskId]);
    const outcome = await this.resolveAndEvaluate(body.projectId, body.findingTaskId);
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, [body.findingTaskId]);
    const fresh: any = outcome.result;
    const cosmetic: ResponseMeta = { cveId: outcome.cveId, title: outcome.title, source: outcome.source, repository: outcome.repository };

    // Anything other than a fresh CANDIDATE_READY is passed straight
    // through, unchanged -- a REJECTED/NOT_ELIGIBLE/TECHNICAL_FAILURE/etc.
    // outcome here means the write must not proceed, for the SAME real
    // reason /evaluate would have reported it, never silently reclassified.
    if (fresh.status !== 'CANDIDATE_READY') {
      return withGitAuthoringMetadata(fresh, cosmetic);
    }

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

  /** Prépare le résultat lié à revalidate lot. */
  @UseGuards(InternalSecretGuard)
  @Post('revalidate-batch')
  async revalidateBatch(@Body() body: SecurityRemediationRevalidateBatchDto) {
    if (!body?.projectId || !Array.isArray(body?.findingTaskIds) || !body.findingTaskIds.length || !body?.expectedCandidateIdentity) {
      throw new BadRequestException('projectId, a non-empty findingTaskIds array, and expectedCandidateIdentity are required.');
    }
    const correlated = body.batchId !== undefined || body.attempts !== undefined;
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, body.findingTaskIds, correlated);
    if (correlated) await this.manualRemediation.verifyWf6AttemptContext(body.projectId, body.findingTaskIds, body.batchId, body.attempts);
    const outcome = await this.resolveAndEvaluateBatch(body.projectId, body.findingTaskIds, correlated ? { batchId: body.batchId, attempts: body.attempts } : undefined);
    await this.manualRemediation.verifyWf6TargetOwnership(body.projectId, body.findingTaskIds, correlated);
    if (correlated) {
      await this.manualRemediation.verifyWf6AttemptContext(body.projectId, body.findingTaskIds, body.batchId, body.attempts);
      outcome.result = { ...outcome.result, batchId: body.batchId, attempts: body.attempts };
    }
    const fresh: any = outcome.result;

    if (fresh.status !== 'CANDIDATE_READY') {
      return withBatchGitAuthoringMetadata(fresh, outcome.cosmetics);
    }
    if (fresh.candidateIdentity !== body.expectedCandidateIdentity) {
      return {
        status: 'CANDIDATE_DRIFTED',
        reason: 'Freshly recomputed batch candidateIdentity no longer matches the identity authorized at evaluation time -- trusted evidence changed between evaluate-batch and write.',
        expectedCandidateIdentity: body.expectedCandidateIdentity,
        freshCandidateIdentity: fresh.candidateIdentity,
      };
    }
    return withBatchGitAuthoringMetadata({ ...fresh, status: 'WRITE_AUTHORIZED' }, outcome.cosmetics);
  }

  /** Résout et évaluation. */
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

  /** Résout et évaluation lot. */
  private async resolveAndEvaluateBatch(projectId: string, findingTaskIds: string[], correlation?: { batchId: string; attempts: { findingTaskId: string; attemptId: string; attemptNumber: number }[] }, initialEvaluation = false): Promise<{ result: any; cosmetics: ResponseMeta[] }> {
    /** Refuse la demande et en précise la raison. */
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

    if (initialEvaluation && correlation && findingTaskIds.length === 1 && this.retryE2E) {
      const action = await this.retryE2E.hook({ projectId, taskId: findingTaskIds[0],
        ...correlation.attempts[0], batchId: correlation.batchId }, 'INITIAL');
      if (action === 'TIMEOUT' || action === 'TIMEOUT_REPLAY') return { result: { status: 'TECHNICAL_FAILURE', failureClass: 'VERIFIER_TIMEOUT',
        reason: 'VERIFIER_TIMEOUT' }, cosmetics: successes.map(s => ({ cveId: s.cveId, title: s.title,
        source: s.finding.source, repository: s.repository })) };
    }
    const findings: SecurityRemediationBatchFindingInput[] = successes.map(s => ({ ...s.finding, cveId: s.cveId! }));
    const input: SecurityRemediationBatchOrchestrationInput = {
      findings, repository, candidateBaseSha,
      // Deterministic, same convention as the singular endpoint's own
      // requestId -- no random/timestamp value, matches
      // ManualRemediationService.launchBatchRemediation()'s own batchId
      // derivation (sha256 of the sorted findingTaskIds).
      requestId: `sec-eval-batch-${createHash('sha256').update(correlation?.batchId || [...findingTaskIds].sort().join(',')).digest('hex').slice(0, 16)}`,
      batchId: correlation?.batchId || 'internal-security-evaluate-batch',
      candidateAttempt: correlation ? Math.max(...correlation.attempts.map(a => a.attemptNumber)) : 0,
    };
    const result = await this.candidateVerification.evaluateSecurityRemediationBatch(input);
    const cosmetics: ResponseMeta[] = successes.map(s => ({ cveId: s.cveId, title: s.title, source: s.finding.source, repository: s.repository }));
    return { result, cosmetics };
  }
}
