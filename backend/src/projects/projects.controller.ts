import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get('internal/by-job/:jobName')
  findByJobInternal(@Param('jobName') jobName: string) {
    return this.service.findByJobNameInternal(jobName);
  }

  @Get()
  findAll(@Query('jenkinsJobName') jenkinsJobName?: string) {
    return this.service.findAll(jenkinsJobName);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: CreateProjectDto) { return this.service.create(dto); }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }

  @Post(':id/validate')
  validate(@Param('id') id: string) { return this.service.validateProject(id); }

  @Get(':id/sonar-metrics')
  sonarMetrics(@Param('id') id: string) { return this.service.getSonarMetrics(id); }

  @Get(':id/jenkins-status')
  jenkinsStatus(@Param('id') id: string) { return this.service.getJenkinsStatus(id); }

  @Get(':id/trivy-report')
  trivyReport(@Param('id') id: string) { return this.service.getTrivyReport(id); }

  @Get(':id/github-stats')
  githubStats(@Param('id') id: string) { return this.service.getGithubStats(id); }
}
