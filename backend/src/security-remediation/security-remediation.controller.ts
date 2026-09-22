// R-SEC-V1.4 §6 — internal endpoint only, same trust pattern already used
// by CandidateVerificationController (InternalSecretGuard, the n8n->backend
// pattern -- see incidents.controller.ts's saveValidation/saveWorkflowStatus
// too). NOT public, NOT wired into frontend routing this phase.
//
// The controller accepts ONLY {projectId, findingTaskId} (§2/§8's narrow
// DTO) -- it never reads any other field from the request body, so a
// caller cannot influence WHAT the orchestrator evaluates beyond WHICH
// finding, let alone HOW the patch is produced.
import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { SecurityFindingResolverService, TrustedFindingResolution } from './security-finding-resolver.service';
import { CandidateVerificationService } from '../candidate-verification/candidate-verification.service';
import { SecurityRemediationEvaluateDto } from './security-remediation-evaluate.dto';

// See maven-security-patch-writer.ts / security-finding-decision.service.ts
// for why Extract<> + a cast is used instead of relying on `if (!x.ok)`
// narrowing under this project's own strictNullChecks:false setting.
type ResolutionFailure = Extract<TrustedFindingResolution, { ok: false }>;

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

    // §3 — trusted resolution happens BEFORE the worker is ever called.
    // Everything past this point (finding/repository/candidateBaseSha) is
    // server-derived; body is never touched again.
    const resolution = await this.resolver.resolve(body.projectId, body.findingTaskId);
    if (resolution.ok !== true) {
      const failure = resolution as ResolutionFailure;
      return { status: 'REJECTED', reason: failure.reason, detail: failure.detail };
    }

    // requestId/batchId are workspace-naming identity only (matches
    // WorkspaceManager's identity segment pattern) -- never a business
    // decision input. Deterministically derived from the SAME trusted
    // findingTaskId every time (§9 idempotency: no random/timestamp value).
    return this.candidateVerification.evaluateSecurityRemediation({
      finding: resolution.finding,
      repository: resolution.repository,
      candidateBaseSha: resolution.candidateBaseSha,
      requestId: `sec-eval-${body.findingTaskId}`,
      batchId: 'internal-security-evaluate',
      candidateAttempt: 0,
    });
  }
}
