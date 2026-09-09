import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Incident } from './incident.entity';
import { Project } from '../projects/project.entity';
import { IncidentsService } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsGateway } from './incidents.gateway';
import { ManualRemediationModule } from '../manual-remediation/manual-remediation.module';
import { CandidateVerificationModule } from '../candidate-verification/candidate-verification.module';

@Module({
  imports: [TypeOrmModule.forFeature([Incident, Project]), HttpModule, ManualRemediationModule, CandidateVerificationModule],
  providers: [IncidentsService, IncidentsGateway],
  controllers: [IncidentsController],
  exports: [IncidentsService],
})
export class IncidentsModule {}
