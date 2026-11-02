// Déclare le module de vérification de candidat.
import { Module } from '@nestjs/common';
import { CandidateVerificationService } from './candidate-verification.service';
import { CandidateVerificationController } from './candidate-verification.controller';

@Module({
  controllers: [CandidateVerificationController],
  providers: [CandidateVerificationService],
  exports: [CandidateVerificationService],
})
export class CandidateVerificationModule {}
