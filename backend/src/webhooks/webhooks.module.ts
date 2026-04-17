// webhooks.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { ProjectsModule } from '../projects/projects.module';
import { BugsModule } from '../bugs/bugs.module';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [HttpModule, ProjectsModule, BugsModule, IncidentsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
