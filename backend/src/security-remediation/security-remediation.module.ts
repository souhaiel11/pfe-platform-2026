// Assemble les contrôleurs et services de sécurité correction.
import { RetryE2EHarnessController, RetryE2EOperatorGuard } from './retry-e2e-harness.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManualRemediationTask } from '../manual-remediation/manual-remediation.entity';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { CandidateVerificationModule } from '../candidate-verification/candidate-verification.module';
import { ManualRemediationModule } from '../manual-remediation/manual-remediation.module';
import { SecurityFindingResolverService } from './security-finding-resolver.service';
import { SecurityRemediationController } from './security-remediation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ManualRemediationTask, Incident, Project]), CandidateVerificationModule, ManualRemediationModule],
  controllers: [SecurityRemediationController, RetryE2EHarnessController],
  providers: [SecurityFindingResolverService, RetryE2EOperatorGuard],
  exports: [SecurityFindingResolverService],
})
export class SecurityRemediationModule {}
