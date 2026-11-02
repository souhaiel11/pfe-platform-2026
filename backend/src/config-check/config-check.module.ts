// Module autonome du test de connexion : ne dépend d'aucune entité et n'est requis par aucun autre module de la plateforme.
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigCheckController } from './config-check.controller';
import { ConfigCheckService } from './config-check.service';

@Module({
  imports: [HttpModule],
  controllers: [ConfigCheckController],
  providers: [ConfigCheckService],
})
export class ConfigCheckModule {}
