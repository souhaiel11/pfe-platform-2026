// webhooks.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { RoutedBuild } from './routed-build.entity';
import { ProjectsModule } from '../projects/projects.module';
import { BugsModule } from '../bugs/bugs.module';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [
    HttpModule, ProjectsModule, BugsModule, IncidentsModule,
    TypeOrmModule.forFeature([RoutedBuild]),
    // Nécessaire UNIQUEMENT pour le routage auto vers WF5 (POST
    // /api/dockerfile/optimize, protégé par JwtAuthGuard — voir
    // dockerfile-optimizer.module.ts, non modifié). Même secret/config que
    // AuthModule, sans y toucher : un appel interne backend->backend n'a pas
    // de session à réutiliser, on signe un token de service à la volée.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'devsecops-secret-2024'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
