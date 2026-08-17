import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IncidentsService } from './incidents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtOrInternalSecretGuard } from '../auth/jwt-or-internal-secret.guard';
import { InternalSecretGuard } from '../auth/internal-secret.guard';

@ApiTags('Incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}
  // JwtOrInternalSecretGuard (pas JwtAuthGuard seul) : le node "Get Incidents"
  // de WF-Chat-V4 appelle cette route côté n8n sans session utilisateur —
  // même pattern que PUT :id (WF2/WF3). Élargit le blast radius de
  // N8N_INTERNAL_SECRET (encore un endpoint déverrouillé) — tracé comme
  // raison supplémentaire de rotation avant Azure (P1, cf. rapport soutenance).
  @UseGuards(JwtOrInternalSecretGuard)
  @Get() findAll(@Query('projectId') projectId?: string, @Query('status') status?: string, @Query('size') size?: number) { return this.service.findAll(projectId, status, size); }
  @UseGuards(JwtAuthGuard)
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @UseGuards(JwtAuthGuard)
  @Post() create(@Body() dto: any) { return this.service.create(dto); }
  @UseGuards(JwtOrInternalSecretGuard)
  @Put(':id') update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @UseGuards(InternalSecretGuard)
  @Post(':id/validation') saveValidation(@Param('id') id: string, @Body() validation: any) { return this.service.saveValidation(id, validation); }
  @UseGuards(JwtAuthGuard)
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }

  @UseGuards(JwtAuthGuard)
  @Post(':id/approve') approveFix(@Param('id') id: string) { return this.service.approveFix(id); }
  @UseGuards(JwtAuthGuard)
  @Post(':id/reject') rejectFix(@Param('id') id: string) { return this.service.rejectFix(id); }

  @UseGuards(JwtAuthGuard)
  @Post(':id/trigger-build') triggerBuild(@Param('id') id: string) { return this.service.triggerBuild(id); }
}
