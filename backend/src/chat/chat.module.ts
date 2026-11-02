/**
 * Câblage NestJS du module ChatOps (contrôleur HTTP + passerelle Socket.IO).
 */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChatGateway } from './chat.gateway';
import { ChatController } from './chat.controller';

@Module({
  imports: [HttpModule],
  providers: [ChatGateway],
  controllers: [ChatController],
})
export class ChatModule {}
