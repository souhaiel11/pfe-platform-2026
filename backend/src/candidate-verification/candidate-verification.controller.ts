// R22-E — the one new HTTP surface this phase adds: lets WF2 (n8n) call the
// R22-C verification engine, the write guard, and the remote-head-drift
// check as plain HTTP requests, guarded the same way every other n8n->
// backend call in this codebase already is (InternalSecretGuard — see
// incidents.controller.ts's saveValidation/saveWorkflowStatus). n8n itself
// still performs the actual GitHub read/write calls (it already holds the
// GitHub credential); these endpoints only make the three R22-C/R22-E
// decisions reusable from n8n instead of being reimplemented as duplicate
// Code-node logic that could drift from the backend's own tested version.
import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { CandidateVerificationService } from './candidate-verification.service';
import { RepoCacheService } from './repo-cache.service';
import { assertCandidateStillValidForWrite } from './write-guard';
import { assertRemoteHeadMatchesCandidateBase } from './remote-head-drift';
import { CandidateManifest, CandidateVerification } from './candidate-verification.types';

@Controller('candidate-verification')
export class CandidateVerificationController {
  constructor(
    private readonly service: CandidateVerificationService,
    private readonly repoCache: RepoCacheService,
  ) {}

  @UseGuards(InternalSecretGuard)
  @Post('verify')
  verify(@Body() body: { manifest: CandidateManifest; allowedPaths?: string[] }) {
    if (!body?.manifest || !Array.isArray(body.manifest.files)) {
      throw new BadRequestException('A CandidateManifest with a files[] array is required.');
    }
    const repoPath = this.repoCache.ensureRepo(body.manifest.repository);
    return this.service.verify(body.manifest, { repoPath, allowedPaths: body.allowedPaths });
  }

  @UseGuards(InternalSecretGuard)
  @Post('write-guard')
  writeGuard(@Body() body: { verification: CandidateVerification; candidateManifest: CandidateManifest }) {
    if (!body?.verification || !body?.candidateManifest) {
      throw new BadRequestException('Both verification and candidateManifest are required.');
    }
    return assertCandidateStillValidForWrite(body.verification, body.candidateManifest);
  }

  @UseGuards(InternalSecretGuard)
  @Post('remote-head-drift')
  remoteHeadDrift(@Body() body: { remoteHeadSha: string | null; candidateBaseSha: string }) {
    if (!body?.candidateBaseSha) {
      throw new BadRequestException('candidateBaseSha is required.');
    }
    return assertRemoteHeadMatchesCandidateBase(body.remoteHeadSha ?? null, body.candidateBaseSha);
  }
}
