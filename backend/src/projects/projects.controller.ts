import { Controller, Get, Post, Put, Delete, Body, Param, Query, Headers, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Volontairement pas de valeur par défaut : sans cette variable d'env définie,
// la route rejette TOUJOURS (fail-closed) — même logique que N8N_CALLBACK_SECRET
// dans jenkins-optimizer.module.ts.
const N8N_INTERNAL_SECRET = process.env.N8N_INTERNAL_SECRET;

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  // Appelé par n8n (node "Lookup Project" de WF1) pour résoudre un jobName Jenkins
  // en config projet. Pas de JwtAuthGuard (appelé depuis n8n, pas depuis le
  // navigateur) mais protégé par un secret partagé pour éviter la fuite de
  // credentials (githubToken, jenkinsUrl, etc.) à quiconque connaît un jobName.
  // (.*) plutôt que :jobName seul — un job Jenkins multibranche envoie
  // "<job>/<branche>" (ex: "vuln-testapp/main"), un slash brut que
  // path-to-regexp ne matche jamais sur un paramètre mono-segment (404
  // garanti sur tout projet multibranche). La résolution (match exact puis
  // repli forme courte) est factorisée dans ProjectsService.resolveByJobName
  // — source unique de vérité, partagée avec webhooks/jenkins/by-job.
  @Get('internal/by-job/:jobName(.*)')
  findByJobInternal(@Param('jobName') jobName: string, @Headers('x-internal-secret') secret?: string) {
    if (!N8N_INTERNAL_SECRET || secret !== N8N_INTERNAL_SECRET) {
      throw new HttpException('Accès interne non autorisé', HttpStatus.FORBIDDEN);
    }
    return this.service.findByJobNameInternal(jobName);
  }

  @Get()
  findAll(@Query('jenkinsJobName') jenkinsJobName?: string) {
    return this.service.findAll(jenkinsJobName);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateProjectDto) { return this.service.create(dto); }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }

  @UseGuards(JwtAuthGuard)
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
