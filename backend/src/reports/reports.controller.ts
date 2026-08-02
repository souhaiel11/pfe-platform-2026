import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query('projectId') projectId?: string, @Query('includeArchived') includeArchived?: string) {
    return this.service.findAll(projectId, includeArchived === 'true');
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: any) { return this.service.create(dto); }

  // Pas de guard : appelé par n8n (WF1, après le Judge), comme create().
  // Strictement limité à judgeDecision/judgeConfidence — voir service.
  @Put(':id')
  updateJudgeDecision(@Param('id') id: string, @Body() dto: any) {
    return this.service.updateJudgeDecision(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
