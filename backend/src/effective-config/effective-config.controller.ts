import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EffectiveConfigService } from './effective-config.service';

@ApiTags('Config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('config')
export class EffectiveConfigController {
  constructor(private readonly service: EffectiveConfigService) {}

  @Get('effective') getEffective() { return this.service.getEffectiveConfig(); }
}
