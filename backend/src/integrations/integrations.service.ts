import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration, IntegrationTool, IntegrationStatus } from './integration.entity';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as https from 'https';

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(Integration)
    private readonly repo: Repository<Integration>,
    private readonly http: HttpService,
  ) {}

  findAll() {
    return this.repo.find({ order: { toolType: 'ASC' } });
  }

  async findOne(id: string) {
    const i = await this.repo.findOne({ where: { id } });
    if (!i) throw new NotFoundException('Integration not found');
    return i;
  }

  async upsert(dto: CreateIntegrationDto) {
    const existing = await this.repo.findOne({ where: { toolType: dto.toolType } });
    if (existing) {
      await this.repo.update(existing.id, dto as any);
      return this.repo.findOne({ where: { id: existing.id } });
    }
    const integration = this.repo.create(dto as any);
    return this.repo.save(integration);
  }

  async update(id: string, dto: UpdateIntegrationDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as any);
    return this.findOne(id);
  }

  async testConnection(id: string) {
    const integration = await this.findOne(id);
    const now = new Date();
    try {
      const metadata = await this.doTest(integration);
      await this.repo.update(id, { status: IntegrationStatus.CONNECTED, lastChecked: now, metadata });
      return { success: true, status: IntegrationStatus.CONNECTED, metadata };
    } catch (e: any) {
      const error = e?.response?.data?.message || e?.message || 'Connection failed';
      await this.repo.update(id, {
        status: IntegrationStatus.ERROR,
        lastChecked: now,
        metadata: { error: String(error) } as any,
      });
      return { success: false, status: IntegrationStatus.ERROR, error: String(error) };
    }
  }

  private async doTest(integration: Integration): Promise<Record<string, any>> {
    const headers: Record<string, string> = {};
    if (integration.token) {
      headers['Authorization'] = `Bearer ${integration.token}`;
    } else if (integration.username && integration.password) {
      const b64 = Buffer.from(`${integration.username}:${integration.password}`).toString('base64');
      headers['Authorization'] = `Basic ${b64}`;
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const config = { headers, timeout: 5000, httpsAgent };

    switch (integration.toolType) {
      case IntegrationTool.GRAFANA: {
        const { data } = await firstValueFrom(
          this.http.get(`${integration.url}/api/health`, config),
        );
        return {
          version:  data.version  || 'unknown',
          database: data.database || 'ok',
          commit:   data.commit   || undefined,
        };
      }

      case IntegrationTool.PROMETHEUS: {
        const { data } = await firstValueFrom(
          this.http.get(`${integration.url}/-/healthy`, config),
        );
        return { status: typeof data === 'string' ? data.trim() : 'Prometheus is Healthy' };
      }

      case IntegrationTool.KUBERNETES: {
        const { data } = await firstValueFrom(
          this.http.get(`${integration.url}/readyz`, config),
        );
        return { status: typeof data === 'string' ? data.trim() : 'ok' };
      }

      case IntegrationTool.NEXUS: {
        const { data } = await firstValueFrom(
          this.http.get(`${integration.url}/service/rest/v1/status`, config),
        );
        return {
          edition: data.edition || 'OSS',
          version: data.version || 'unknown',
          status:  data.status  || 'ok',
        };
      }

      default:
        throw new Error(`Unknown tool type: ${integration.toolType}`);
    }
  }
}
