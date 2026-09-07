import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { IntegrationFixturesController } from './integration-fixtures.controller';
import { IntegrationFixturesService } from './integration-fixtures.service';

@Module({
  imports: [TypeOrmModule.forFeature([Incident, Project])],
  controllers: [IntegrationFixturesController],
  providers: [IntegrationFixturesService],
})
export class IntegrationFixturesModule {}
