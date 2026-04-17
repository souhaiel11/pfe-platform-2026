import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly http: HttpService, private readonly config: ConfigService) {}

  @Post('ask')
  async ask(@Body() body: { message: string; context?: any }) {
    const n8nUrl = this.config.get('N8N_URL', 'http://n8n:5678');
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${n8nUrl}/webhook/chatops`, body),
      );
      return data;
    } catch {
      return {
        reply: `Je suis l'assistant DevSecOps. Vous avez demandé: "${body.message}". Connectez n8n pour des réponses AI complètes.`,
      };
    }
  }
}
