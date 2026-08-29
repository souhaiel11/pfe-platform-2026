import { Controller, Post, Body, UseGuards, BadGatewayException, BadRequestException } from '@nestjs/common';
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
  async ask(@Body() body: { question: string; projectId?: string }) {
    if (!body?.question?.trim()) throw new BadRequestException('Une question est requise.');
    const n8nUrl = this.config.get('N8N_URL', 'http://n8n:5678');
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${n8nUrl}/webhook/chat-agent`, { question: body.question.trim(), ...(body.projectId ? { projectId: body.projectId } : {}) }),
      );
      return data;
    } catch {
      throw new BadGatewayException('Assistant workflow unavailable');
    }
  }
}
