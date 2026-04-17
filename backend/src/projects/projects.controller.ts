import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get() findAll() { return this.service.findAll(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() create(@Body() dto: CreateProjectDto) { return this.service.create(dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateProjectDto) { return this.service.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }

  @Get(':id/sonar') getSonar(@Param('id') id: string) { return this.service.getSonarMetrics(id); }
  @Get(':id/jenkins') getJenkins(@Param('id') id: string) { return this.service.getJenkinsStatus(id); }
  @Get(':id/trivy') getTrivy(@Param('id') id: string) { return this.service.getTrivyReport(id); }
  @Get(':id/github') getGithub(@Param('id') id: string) { return this.service.getGithubStats(id); }
}
