// Expose les points d'entrée de vérification du candidat, de garde avant écriture et de détection d'un déplacement du HEAD distant.
import { Body, Controller, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { CandidateVerificationService } from './candidate-verification.service';
import { assertCandidateStillValidForWrite } from './write-guard';
import { assertRemoteHeadMatchesCandidateBase } from './remote-head-drift';
import { CandidateManifest, CandidateVerification, VerificationRequest, VerificationResult, assertHeadVerificationRequest, assertVerificationStep } from './candidate-verification.types';

@Controller('candidate-verification')
export class CandidateVerificationController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: CandidateVerificationService) {}

  // Lance soit une vérification HEAD seule (si `verifyHeadOnly`), soit une vérification
  // complète d'un manifeste candidat (compilation + tests), après avoir validé la forme de la requête.
  @UseGuards(InternalSecretGuard)
  @Post('verify')
  verify(@Body() body: VerificationRequest) {
    if (body?.verifyHeadOnly === true) {
      try { assertHeadVerificationRequest(body); } catch { throw new BadRequestException('INVALID_HEAD_VERIFICATION_REQUEST'); }
      return this.service.verifyHead(body);
    }
    if (!body?.manifest || !Array.isArray(body.manifest.files)) {
      throw new BadRequestException('A CandidateManifest with a files[] array is required.');
    }
    try { assertVerificationStep(body.verificationStep, body.options?.mode); }
    catch { throw new BadRequestException('INVALID_PROGRESSIVE_VERIFICATION_REQUEST'); }
    return this.service.verify(body.manifest, { allowedPaths: body.allowedPaths, timeoutMs: body.options?.timeoutMs,
      ...(body.options?.mode ? {mode: body.options.mode} : {}), ...(body.verificationStep ? {verificationStep: body.verificationStep} : {}) });
  }

  // Expose le dernier verrou avant écriture à n8n, pour que WF2 revérifie un
  // candidat juste avant de l'écrire sur GitHub.
  @UseGuards(InternalSecretGuard)
  @Post('write-guard')
  writeGuard(@Body() body: { verification: VerificationResult; candidateManifest: CandidateManifest }) {
    if (!body?.verification || !body?.candidateManifest) {
      throw new BadRequestException('Both verification and candidateManifest are required.');
    }
    return assertCandidateStillValidForWrite(body.verification, body.candidateManifest);
  }

  // Expose la détection de dérive de branche distante à n8n, pour que WF2
  // vérifie que la branche n'a pas bougé juste avant d'écrire.
  @UseGuards(InternalSecretGuard)
  @Post('remote-head-drift')
  remoteHeadDrift(@Body() body: { remoteHeadSha: string | null; candidateBaseSha: string }) {
    if (!body?.candidateBaseSha) {
      throw new BadRequestException('candidateBaseSha is required.');
    }
    return assertRemoteHeadMatchesCandidateBase(body.remoteHeadSha ?? null, body.candidateBaseSha);
  }
}
