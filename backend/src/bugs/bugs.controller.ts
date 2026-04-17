// bugs.controller.ts
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
  constructor(private readonly service: BugsService) {}

  @Get() findAll(@Query('projectId') projectId?: string) {
    return this.service.findAll(projectId);
  }

  @Get(':id') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post() create(@Body() dto: any) {
    return this.service.create(dto);
  }

  @Post(':id/ai-fix') triggerFix(@Param('id') id: string) {
    return this.service.triggerAiFix(id);
  }

  @Put(':id/status') updateStatus(@Param('id') id: string, @Body() body: { status: BugStatus }) {
    return this.service.updateStatus(id, body.status);
  }

  @Put(':id/n8n-result') updateFromN8n(@Param('id') id: string, @Body() data: any) {
    return this.service.updateFromN8n(id, data);
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
