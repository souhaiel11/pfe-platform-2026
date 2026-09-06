// R22-C/R22-E/R22-E2C2 — additive. As of R22-E2C2, WorkspaceManager,
// CandidateMaterializer, RepoCacheService, and the build adapters moved to
// the candidate-verifier worker (see candidate-verifier/src/) -- the
// backend no longer needs repository filesystem access at all for candidate
// execution (R22-E2C1 Phase 9). This module now only wires the thin HTTP
// client and the pure control-plane guards behind the same
// InternalSecretGuard-protected controller as before.
import { Module } from '@nestjs/common';
import { CandidateVerificationService } from './candidate-verification.service';
import { CandidateVerificationController } from './candidate-verification.controller';

@Module({
  controllers: [CandidateVerificationController],
  providers: [CandidateVerificationService],
  exports: [CandidateVerificationService],
})
export class CandidateVerificationModule {}
