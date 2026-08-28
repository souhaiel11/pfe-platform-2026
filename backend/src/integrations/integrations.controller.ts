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
  constructor(private readonly service: IntegrationsService) {}
  private assertEditor(req: any) {
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) throw new ForbiddenException('Action non autorisée');
  }

  @Get()
  findAll() { return this.service.findAll(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: CreateIntegrationDto, @Req() req: any) { this.assertEditor(req); return this.service.upsert(dto); }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @Req() req: any) {
    this.assertEditor(req);
    return this.service.update(id, dto);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Req() req: any) { this.assertEditor(req); return this.service.testConnection(id); }
}
