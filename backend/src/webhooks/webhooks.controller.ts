// Endpoints d'entrée brute pour SonarQube, Jenkins et Trivy — convertissent un payload d'outil externe
// en bug/incident via WebhooksService.
import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { ProjectsService } from '../projects/projects.service';

@ApiTags('Webhooks')
// Entrées machine-à-machine uniquement (WF1/n8n) : sans en-tête x-internal-secret valide, refus 403.
@UseGuards(InternalSecretGuard)
@Controller('webhooks')
export class WebhooksController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private readonly service: WebhooksService,
    private readonly projects: ProjectsService
  ) {}

  // Reçoit un webhook SonarQube pour un projet donné.
  @Post('sonarqube/:projectId')
  sonar(@Param('projectId') id: string, @Body() body: any) {
    return this.service.handleSonarqube(id, body);
  }

  // Reçoit un webhook Jenkins pour un projet donné (identifié par son id).
  @Post('jenkins/:projectId')
  jenkins(@Param('projectId') id: string, @Body() body: any) {
    return this.service.handleJenkins(id, body);
  }

  // Reçoit un webhook Jenkins identifié par le nom du job (gère les jobs multibranche "<job>/<branche>")
  // et résout le projet correspondant avant de le traiter.
  @Post('jenkins/by-job/:jobName(.*)')
  async jenkinsByJob(@Param('jobName') jobName: string, @Body() body: any) {
    const matches = await this.projects.resolveByJobName(jobName);
    const project = matches[0];
    if (!project) return { error: `No project found for job: ${jobName}` };
    return this.service.handleJenkins(project.id, body);
  }

  // Reçoit un webhook Trivy pour un projet donné.
  @Post('trivy/:projectId')
  trivy(@Param('projectId') id: string, @Body() body: any) {
    return this.service.handleTrivy(id, body);
  }
}
