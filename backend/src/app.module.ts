import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'postgres'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USER', 'devsecops'),
        password: config.get('DB_PASS', 'devsecops123'),
        database: config.get('DB_NAME', 'devsecops'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    ProjectsModule,
    IncidentsModule,
    BugsModule,
    ReportsModule,
    DashboardModule,
    WebhooksModule,
    ChatModule,
  ],
})
export class AppModule {}
