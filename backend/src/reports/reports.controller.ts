// Endpoints HTTP des rapports de scan : lecture, création (par les scanners/n8n), mise à jour de la
// décision du Judge, suppression.
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: ReportsService) {}

  // Liste les rapports (filtrables par projet, inclut les archivés si demandé).
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query('projectId') projectId?: string, @Query('includeArchived') includeArchived?: string) {
    return this.service.findAll(projectId, includeArchived === 'true');
  }

  // Récupère un rapport par id.
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  // Crée un rapport (appelé par les scanners/n8n, pas de guard JWT).
  @Post()
  create(@Body() dto: any) { return this.service.create(dto); }

  // Met à jour la décision du Judge Agent sur un rapport existant (appelé par n8n WF1 après le Judge).
  @Put(':id')
  updateJudgeDecision(@Param('id') id: string, @Body() dto: any) {
    return this.service.updateJudgeDecision(id, dto);
  }

  // Supprime un rapport.
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
