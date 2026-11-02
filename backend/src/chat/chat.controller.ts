// ChatOps : expose l'endpoint HTTP que le widget de chat du frontend appelle, en relayant la question vers le workflow n8n chat-agent (qui interroge Claude et consulte les incidents).
import { Controller, Post, Body, UseGuards, HttpCode, BadGatewayException, BadRequestException } from '@nestjs/common';
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
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly http: HttpService, private readonly config: ConfigService) {}

  /** Prépare le résultat lié à ask. */
  @Post('ask')
  @HttpCode(200)
  async ask(@Body() body: { question: string; projectId?: string }) {
    if (typeof body?.question !== 'string' || !body.question.trim()) {
      throw new BadRequestException('Une question est requise.');
    }
    const n8nUrl = this.config.get('N8N_URL', 'http://n8n:5678');
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${n8nUrl}/webhook/chat-agent`, { question: body.question.trim(), ...(body.projectId ? { projectId: body.projectId } : {}) }),
      );
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true ||
          typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error('Invalid chat response');
      }
      return { ok: true, answer: data.answer.trim() };
    } catch {
      throw new BadGatewayException({
        ok: false,
        answer: null,
        error: {
          code: 'CHAT_UPSTREAM_FAILED',
          message: "Le service de discussion n'a pas pu répondre.",
        },
      });
    }
  }
}
