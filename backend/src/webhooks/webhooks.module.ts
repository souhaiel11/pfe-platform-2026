// Déclaration NestJS du module webhooks : branche le contrôleur d'entrée brute sur Projects, Bugs,
// Incidents, et fournit un JWT de service pour les appels internes backend->backend (routage WF5).
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
    JwtModule.registerAsync({
      imports: [ConfigModule],
      /** Construit la configuration ou le service injecté par le module. */
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
