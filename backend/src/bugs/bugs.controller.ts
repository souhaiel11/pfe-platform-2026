// Endpoints HTTP du module legacy "bugs" (CRUD + anciens déclencheurs IA, désormais désactivés côté service).
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BugsService } from './bugs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BugStatus } from './bug.entity';

@ApiTags('Bugs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bugs')
export class BugsController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: BugsService) {}

  // Liste les bugs, filtrables par projet.
  @Get() findAll(@Query('projectId') projectId?: string) {
    return this.service.findAll(projectId);
  }

  // Récupère un bug par son id.
  @Get(':id') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Crée un bug.
  @Post() create(@Body() dto: any) {
    return this.service.create(dto);
  }

  // Ancien déclencheur de correction IA — toujours refusé (module désactivé).
  @Post(':id/ai-fix') triggerFix(@Param('id') id: string) {
    return this.service.triggerAiFix(id);
  }

  // Ancien changement de statut manuel — toujours refusé (module désactivé).
  @Put(':id/status') updateStatus(@Param('id') id: string, @Body() body: { status: BugStatus }) {
    return this.service.updateStatus(id, body.status);
  }

  // Ancien callback n8n de résultat de correction — toujours refusé (module désactivé).
  @Put(':id/n8n-result') updateFromN8n(@Param('id') id: string, @Body() data: any) {
    return this.service.updateFromN8n(id, data);
  }

  // Supprime un bug.
  @Delete(':id') remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
