// Expose en lecture l'état effectif de configuration de la plateforme (quelles options sont réellement actives côté serveur).
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EffectiveConfigService } from './effective-config.service';

@ApiTags('Config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('config')
export class EffectiveConfigController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: EffectiveConfigService) {}

  /** Renvoie l'état effectif de configuration courant de la plateforme. */
  @Get('effective') getEffective() { return this.service.getEffectiveConfig(); }
}
