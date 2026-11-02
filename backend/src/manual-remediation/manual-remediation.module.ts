/** Déclare le module NestJS de remédiation manuelle : entités, contrôleurs et services, y compris la réconciliation legacy. */
import { LegacyReconciliationController } from './legacy-reconciliation.controller';
import { LegacyReconciliationService } from './legacy-reconciliation.service';
import { LegacyRemoteSettlement } from './legacy-remote-settlement';
import { RetryE2EHarnessService } from '../security-remediation/retry-e2e-harness.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { ManualRemediationController } from './manual-remediation.controller';
import { ManualRemediationTask } from './manual-remediation.entity';
import { ManualRemediationService } from './manual-remediation.service';

@Module({
  imports: [TypeOrmModule.forFeature([ManualRemediationTask, Incident, Project])],
  controllers: [ManualRemediationController, LegacyReconciliationController],
  providers: [ManualRemediationService, RetryE2EHarnessService, LegacyReconciliationService, LegacyRemoteSettlement],
  exports: [ManualRemediationService, RetryE2EHarnessService],
})
export class ManualRemediationModule {}
