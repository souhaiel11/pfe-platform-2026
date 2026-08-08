import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Report } from './report.entity';
import { Project } from '../projects/project.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AzureDeployModule } from '../azure-deploy/azure-deploy.module';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [TypeOrmModule.forFeature([Report, Project]), HttpModule, AzureDeployModule, IncidentsModule],
  providers: [ReportsService],
  controllers: [ReportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
