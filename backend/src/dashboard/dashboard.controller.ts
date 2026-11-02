// Endpoints HTTP du dashboard : agrégats globaux, vue Jenkins/sécurité, indicateurs de risque, vue par projet.
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: DashboardService) {}

  // Rapporte quelles fonctionnalités de la plateforme sont effectivement configurées/actives.
  @Get('capabilities') getCapabilities() { return this.service.getCapabilities(); }

  // Statistiques globales (projets, bugs, score de sécurité moyen).
  @Get('global') getGlobal() { return this.service.getGlobalStats(); }
  // Vue agrégée Jenkins sur tous les projets.
  @Get('jenkins-global') getJenkinsGlobal() { return this.service.getJenkinsGlobal(); }
  // Vue agrégée sécurité (CVE, alertes ZAP, Sonar) sur tous les projets.
  @Get('security-global') getSecurityGlobal() { return this.service.getSecurityGlobal(); }
  // Indicateur de risque calculé en direct pour chaque projet.
  @Get('risk-indicators') getRiskIndicators() { return this.service.getRiskIndicators(); }
  // Tableau de bord détaillé d'un projet (Sonar, Jenkins, Trivy, GitHub, bugs).
  @Get('project/:id') getProject(@Param('id') id: string) { return this.service.getProjectDashboard(id); }
}
