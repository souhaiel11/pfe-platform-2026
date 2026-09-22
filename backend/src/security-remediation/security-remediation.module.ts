import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManualRemediationTask } from '../manual-remediation/manual-remediation.entity';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { CandidateVerificationModule } from '../candidate-verification/candidate-verification.module';
import { SecurityFindingResolverService } from './security-finding-resolver.service';
import { SecurityRemediationController } from './security-remediation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ManualRemediationTask, Incident, Project]), CandidateVerificationModule],
  controllers: [SecurityRemediationController],
  providers: [SecurityFindingResolverService],
  exports: [SecurityFindingResolverService],
})
export class SecurityRemediationModule {}
