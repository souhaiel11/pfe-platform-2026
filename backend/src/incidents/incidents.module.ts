import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Incident } from './incident.entity';
import { IncidentsService } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsGateway } from './incidents.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Incident]), HttpModule],
  providers: [IncidentsService, IncidentsGateway],
  controllers: [IncidentsController],
  exports: [IncidentsService],
})
export class IncidentsModule {}
