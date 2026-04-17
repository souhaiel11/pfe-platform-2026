// dashboard.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ProjectsModule } from '../projects/projects.module';
import { BugsModule } from '../bugs/bugs.module';

@Module({
  imports: [HttpModule, ProjectsModule, BugsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
