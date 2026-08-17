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

  // Un credential (token/password) ne doit jamais repartir en clair vers le
  // front une fois enregistré — seule sa présence est utile côté UI (afficher
  // "configuré" plutôt que la valeur). Deny-list par construction, même
  // logique que sanitizeProject (voir common/sanitize-project.ts) : un champ
  // secret ajouté à Integration sans être ajouté ici fuiterait silencieusement.
  private sanitize(integration: Integration) {
    const { token, password, ...rest } = integration;
    return { ...rest, hasToken: !!token, hasPassword: !!password };
  }

  // Un champ token/password vide envoyé par le front lors d'un update ne veut
  // pas dire "efface le secret existant" — le front ne reçoit plus jamais la
  // vraie valeur (voir sanitize()), donc un champ laissé vide à l'écran est
  // par construction une valeur inchangée, pas une intention d'effacement.
  private dropBlankSecrets<T extends Record<string, any>>(dto: T): T {
    const clean: any = { ...dto };
    if (clean.token === '' || clean.token === null || clean.token === undefined) delete clean.token;
    if (clean.password === '' || clean.password === null || clean.password === undefined) delete clean.password;
    return clean;
  }

  async findAll() {
    const rows = await this.repo.find({ order: { toolType: 'ASC' } });
    return rows.map((r) => this.sanitize(r));
  }

  async findOne(id: string) {
    return this.sanitize(await this.findOneRaw(id));
  }

  // Réservé à l'usage interne (testConnection doit lire le vrai token/
  // password pour construire l'en-tête Authorization) — ne jamais renvoyer
  // ceci directement dans une réponse HTTP.
  private async findOneRaw(id: string) {
    const i = await this.repo.findOne({ where: { id } });
    if (!i) throw new NotFoundException('Integration not found');
    return i;
  }

  async upsert(dto: CreateIntegrationDto) {
    const existing = await this.repo.findOne({ where: { toolType: dto.toolType } });
    if (existing) {
      await this.repo.update(existing.id, this.dropBlankSecrets(dto) as any);
      const updated = await this.repo.findOne({ where: { id: existing.id } });
      return this.sanitize(updated!);
    }
    const integration = this.repo.create(dto as Integration);
    const saved = await this.repo.save(integration);
    return this.sanitize(saved);
  }

  async update(id: string, dto: UpdateIntegrationDto) {
    await this.findOne(id);
    await this.repo.update(id, this.dropBlankSecrets(dto) as any);
    return this.findOne(id);
  }

  async testConnection(id: string) {
    const integration = await this.findOneRaw(id);
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
