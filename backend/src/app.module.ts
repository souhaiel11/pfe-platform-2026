// Assemble les modules et la connexion à la base du backend.
import { SourceEvidenceModule } from './source-evidence/source-evidence.module';
import { ConfigCheckModule } from './config-check/config-check.module';
import { ProjectReadsModule } from './project-reads/project-reads.module';
import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FrenchFindingsInterceptor } from './common/fr-localization/french-findings.interceptor';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { IncidentsModule } from './incidents/incidents.module';
import { BugsModule } from './bugs/bugs.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ChatModule } from './chat/chat.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { JenkinsOptimizerModule } from './jenkins-optimizer/jenkins-optimizer.module';
import { DockerfileOptimizerModule } from './dockerfile-optimizer/dockerfile-optimizer.module';
import { AzureDeployModule } from './azure-deploy/azure-deploy.module';
import { ManualRemediationModule } from './manual-remediation/manual-remediation.module';
import { ContextModule } from './context/context.module';
import { CandidateVerificationModule } from './candidate-verification/candidate-verification.module';
import { IntegrationFixturesModule } from './integration-fixtures/integration-fixtures.module';
import { SecurityRemediationModule } from './security-remediation/security-remediation.module';
import { EffectiveConfigModule } from './effective-config/effective-config.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      /** Construit la configuration ou le service injecté par le module. */
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'postgres'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USER', 'devsecops'),
        password: config.get('DB_PASS', 'devsecops123'),
        database: config.get('DB_NAME', 'devsecops'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        // Runtime schema changes are applied explicitly through reviewed,
        // additive migrations. Never let application startup rewrite history.
        synchronize: config.get('DB_SYNCHRONIZE', 'false') === 'true',
      }),
      inject: [ConfigService],
    }),
    SourceEvidenceModule,
    ConfigCheckModule,
    ProjectReadsModule,
    AuthModule,
    ProjectsModule,
    IncidentsModule,
    BugsModule,
    ReportsModule,
    DashboardModule,
    WebhooksModule,
    ChatModule,
    IntegrationsModule,
    JenkinsOptimizerModule,
    DockerfileOptimizerModule,
    AzureDeployModule,
    ManualRemediationModule,
    ContextModule,
    CandidateVerificationModule,
    IntegrationFixturesModule,
    SecurityRemediationModule,
    EffectiveConfigModule,
  ],
  // Constats de scanners affichés en français dans l'interface (données stockées inchangées).
  providers: [{ provide: APP_INTERCEPTOR, useClass: FrenchFindingsInterceptor }],
})
export class AppModule {}
