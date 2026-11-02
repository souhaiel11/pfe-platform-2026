// Expose le test de connexion d'une configuration de projet (Jenkins, SonarQube, Git), avant même que ce projet n'existe en base. N'écrit rien.
import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../auth/user.entity';
import { CheckProjectConfigDto } from './config-check.dto';
import { ConfigCheckService } from './config-check.service';

@Controller('config-check')
export class ConfigCheckController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: ConfigCheckService) {}

  /** Refuse l'appel aux rôles autres qu'admin/développeur, puis délègue la vérification de la configuration au service. */
  @UseGuards(JwtAuthGuard)
  @Post('project')
  verifier(@Body() dto: CheckProjectConfigDto, @Req() req: any) {
    const role = req?.user?.role;
    if (role !== UserRole.ADMIN && role !== UserRole.DEVELOPER) {
      throw new ForbiddenException('Action réservée aux éditeurs de projet.');
    }
    return this.service.verifier(dto);
  }
}
