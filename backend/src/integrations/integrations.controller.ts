// Endpoints HTTP des intégrations d'outils externes (Grafana/Prometheus/Kubernetes/Nexus) : lecture
// libre, écriture réservée aux rôles admin/developer.
import { Controller, Get, Post, Put, Body, Param, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: IntegrationsService) {}

  // Refuse l'action si l'utilisateur n'a pas le rôle admin ou developer.
  private assertEditor(req: any) {
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) throw new ForbiddenException('Action non autorisée');
  }

  // Liste toutes les intégrations configurées.
  @Get()
  findAll() { return this.service.findAll(); }

  // Récupère une intégration par id.
  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  // Crée ou met à jour l'intégration pour un type d'outil donné (upsert par toolType).
  @Post()
  create(@Body() dto: CreateIntegrationDto, @Req() req: any) { this.assertEditor(req); return this.service.upsert(dto); }

  // Met à jour une intégration existante.
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @Req() req: any) {
    this.assertEditor(req);
    return this.service.update(id, dto);
  }

  // Teste la connexion réelle à l'outil (appel HTTP de santé) et met à jour son statut.
  @Post(':id/test')
  test(@Param('id') id: string, @Req() req: any) { this.assertEditor(req); return this.service.testConnection(id); }
}
