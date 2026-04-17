import { Controller, Post, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}
  @Post('sonarqube/:projectId') sonar(@Param('projectId') id: string, @Body() body: any) { return this.service.handleSonarqube(id, body); }
  @Post('jenkins/:projectId') jenkins(@Param('projectId') id: string, @Body() body: any) { return this.service.handleJenkins(id, body); }
  @Post('trivy/:projectId') trivy(@Param('projectId') id: string, @Body() body: any) { return this.service.handleTrivy(id, body); }
}
