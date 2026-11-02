// Expose les routes /projects : création, lecture, modification, suppression, test de configuration et consultation Jenkins/Sonar/GitHub.
import { Controller, Get, Post, Put, Delete, Body, Param, Query, Headers, HttpException, HttpStatus, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateJenkinsCredentialsDto } from './dto/update-jenkins-credentials.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../auth/user.entity';

// Volontairement pas de valeur par défaut : sans cette variable d'env définie,
// la route rejette TOUJOURS (fail-closed) — même logique que N8N_CALLBACK_SECRET
// dans jenkins-optimizer.module.ts.
const N8N_INTERNAL_SECRET = process.env.N8N_INTERNAL_SECRET;

@Controller('projects')
export class ProjectsController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: ProjectsService) {}
  /** Refuse l’action si le rôle ne permet pas la modification. */
  private assertEditor(req: any) {
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) throw new ForbiddenException('Action non autorisée');
  }
  // Rotation de credential Jenkins — volontairement PLUS strict que
  // assertEditor (admin uniquement, pas developer) : un secret d'infra
  // partagé, pas une configuration de projet ordinaire.
  private assertAdmin(req: any) {
    if (String(req.user?.role || '').toLowerCase() !== UserRole.ADMIN) throw new ForbiddenException('Réservé aux administrateurs');
  }

  /** Appelé par n8n (node "Lookup Project" de WF1) pour résoudre un jobName Jenkins en config projet. */
  @Get('internal/by-job/:jobName(.*)')
  findByJobInternal(@Param('jobName') jobName: string, @Headers('x-internal-secret') secret?: string) {
    if (!N8N_INTERNAL_SECRET || secret !== N8N_INTERNAL_SECRET) {
      throw new HttpException('Accès interne non autorisé', HttpStatus.FORBIDDEN);
    }
    return this.service.findByJobNameInternal(jobName);
  }

  // Corrélation Sonar déterministe pour WF1 : l'identifiant CE vient du
  // report-task.txt du build concerné. Aucun lookup "latest par projet".
  @Get('internal/:id/sonar-correlation')
  sonarCorrelation(
    @Param('id') id: string,
    @Query('ceTaskId') ceTaskId: string,
    @Headers('x-internal-secret') secret?: string,
  ) {
    if (!N8N_INTERNAL_SECRET || secret !== N8N_INTERNAL_SECRET) {
      throw new HttpException('Accès interne non autorisé', HttpStatus.FORBIDDEN);
    }
    return this.service.resolveSonarCorrelation(id, ceTaskId);
  }

  /** Liste les éléments selon les filtres demandés. */
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Query('jenkinsJobName') jenkinsJobName?: string) {
    return this.service.findAll(jenkinsJobName);
  }

  /** Recherche l’élément correspondant à l’identifiant. */
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  /** Crée et enregistre un nouvel élément. */
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateProjectDto, @Req() req: any) { this.assertEditor(req); return this.service.create(dto); }

  /** Applique les modifications autorisées à l’élément. */
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Req() req: any) {
    this.assertEditor(req);
    return this.service.update(id, dto);
  }

  /** Rotation de credential Jenkins — endpoint dédié, ADMIN-ONLY, jamais exposé via l'update() général (jenkinsToken y est explicitement exclu). */
  @UseGuards(JwtAuthGuard)
  @Put(':id/jenkins-credentials')
  updateJenkinsCredentials(@Param('id') id: string, @Body() dto: UpdateJenkinsCredentialsDto, @Req() req: any) {
    this.assertAdmin(req);
    return this.service.updateJenkinsCredentials(id, dto);
  }

  /** Supprime l’élément ciblé et gère ses dépendances. */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) { this.assertEditor(req); return this.service.remove(id); }

  /** Vérifie les données et renvoie leur forme utilisable. */
  @UseGuards(JwtAuthGuard)
  @Post(':id/validate')
  validate(@Param('id') id: string, @Req() req: any) { this.assertEditor(req); return this.service.validateProject(id); }

  /** Lit les métriques SonarQube du projet. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/sonar-metrics')
  sonarMetrics(@Param('id') id: string) { return this.service.getSonarMetrics(id); }

  /** Lit l’état des builds Jenkins du projet. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/jenkins-status')
  jenkinsStatus(@Param('id') id: string) { return this.service.getJenkinsStatus(id); }

  /** Vue « Build » — le build lui-même, pas l'état du job. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/builds/:number/console')
  buildConsole(@Param('id') id: string, @Param('number') number: string, @Query('tail') tail?: string) {
    return this.service.getBuildConsole(id, number, tail);
  }

  /** Construit détail. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/builds/:number')
  buildDetail(@Param('id') id: string, @Param('number') number: string) {
    return this.service.getBuildDetail(id, number);
  }

  /** Lit le rapport Trivy associé au projet. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/trivy-report')
  trivyReport(@Param('id') id: string) { return this.service.getTrivyReport(id); }

  /** Lit les statistiques GitHub du dépôt. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/github-stats')
  githubStats(@Param('id') id: string) { return this.service.getGithubStats(id); }
}
