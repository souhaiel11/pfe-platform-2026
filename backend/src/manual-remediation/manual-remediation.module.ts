import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from '../incidents/incident.entity';
import { ManualRemediationController } from './manual-remediation.controller';
import { ManualRemediationTask } from './manual-remediation.entity';
import { ManualRemediationService } from './manual-remediation.service';

@Module({
  imports: [TypeOrmModule.forFeature([ManualRemediationTask, Incident])],
  controllers: [ManualRemediationController],
  providers: [ManualRemediationService],
  exports: [ManualRemediationService],
})
export class ManualRemediationModule {}
