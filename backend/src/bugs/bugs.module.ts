// Déclaration NestJS du module legacy "bugs" : entité, service, contrôleur et passerelle websocket.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bug } from './bug.entity';
import { BugsService } from './bugs.service';
import { BugsController } from './bugs.controller';
import { BugsGateway } from './bugs.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Bug])],
  providers: [BugsService, BugsGateway],
  controllers: [BugsController],
  exports: [BugsService],
})
export class BugsModule {}
