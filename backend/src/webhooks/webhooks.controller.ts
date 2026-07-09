import { Controller, Post, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { ProjectsService } from '../projects/projects.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly service: WebhooksService,
    private readonly projects: ProjectsService
  ) {}

  @Post('sonarqube/:projectId')
  sonar(@Param('projectId') id: string, @Body() body: any) {
    return this.service.handleSonarqube(id, body);
  }

  @Post('jenkins/:projectId')
  jenkins(@Param('projectId') id: string, @Body() body: any) {
    return this.service.handleJenkins(id, body);
  }

  @Post('jenkins/by-job/:jobName')
  async jenkinsByJob(@Param('jobName') jobName: string, @Body() body: any) {
    const all = await this.projects.findAll();
    const project = all.find((p: any) => p.jenkinsJobName === jobName);
    if (!project) return { error: `No project found for job: ${jobName}` };
    return this.service.handleJenkins(project.id, body);
  }

  @Post('trivy/:projectId')
  trivy(@Param('projectId') id: string, @Body() body: any) {
    return this.service.handleTrivy(id, body);
  }
}
