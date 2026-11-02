// Déclaration NestJS du module dashboard : branche le contrôleur/service sur Projects, Bugs et Report.
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ProjectsModule } from '../projects/projects.module';
import { BugsModule } from '../bugs/bugs.module';
import { Report } from '../reports/report.entity';

@Module({
  imports: [HttpModule, ProjectsModule, BugsModule, TypeOrmModule.forFeature([Report])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
