import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { ManualRemediationController } from './manual-remediation.controller';
import { ManualRemediationTask } from './manual-remediation.entity';
import { ManualRemediationService } from './manual-remediation.service';

@Module({
  // V1.8 Phase 5 ticket — Project added so launchBatchRemediation() can
  // resolve the SAME repository/trusted-commit context
  // SecurityFindingResolverService already resolves, WITHOUT importing
  // SecurityRemediationModule here (that module already imports THIS one
  // -- a circular module import this codebase has never used anywhere
  // else). A plain TypeORM entity injection has no such risk.
  imports: [TypeOrmModule.forFeature([ManualRemediationTask, Incident, Project])],
  controllers: [ManualRemediationController],
  providers: [ManualRemediationService],
  exports: [ManualRemediationService],
})
export class ManualRemediationModule {}
