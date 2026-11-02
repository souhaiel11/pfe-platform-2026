// Gère les intégrations d'outils externes (Grafana/Prometheus/Kubernetes/Nexus) : lecture assainie
// (jamais de secret en clair vers le front), upsert par type d'outil, test de connexion réel.
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
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(Integration)
    private readonly repo: Repository<Integration>,
    private readonly http: HttpService,
  ) {}

  // Retire token/password/URL-avec-identifiants de l'objet renvoyé au front ; ne garde que des booléens
  // hasToken/hasPassword pour savoir si un secret est configuré, sans jamais le révéler.
  private sanitize(integration: Integration) {
    const { token, password, ...rest } = integration;
    let url = rest.url;
    try { const parsed = new URL(url); if (parsed.username || parsed.password || parsed.search || parsed.hash) url = null; } catch { url = null; }
    const metadata = rest.lastChecked ? { message: rest.status === IntegrationStatus.CONNECTED ? 'Connexion vérifiée.' : 'Échec de la vérification.' } : null;
    return { ...rest, url, metadata, hasToken: !!token, hasPassword: !!password };
  }

  // Retire d'un DTO entrant les champs token/password laissés vides, pour qu'un formulaire qui ne
  // réaffiche jamais le secret existant ne l'efface pas accidentellement à l'enregistrement.
  private dropBlankSecrets<T extends Record<string, any>>(dto: T): T {
    const clean: any = { ...dto };
    if (clean.token === '' || clean.token === null || clean.token === undefined) delete clean.token;
    if (clean.password === '' || clean.password === null || clean.password === undefined) delete clean.password;
    return clean;
  }

  // Liste toutes les intégrations, assainies, triées par type d'outil.
  async findAll() {
    const rows = await this.repo.find({ order: { toolType: 'ASC' } });
    return rows.map((r) => this.sanitize(r));
  }

  // Récupère une intégration assainie par id.
  async findOne(id: string) {
    return this.sanitize(await this.findOneRaw(id));
  }

  // Récupère l'intégration avec ses secrets en clair (usage interne uniquement, ex. testConnection) —
  // ne doit jamais être renvoyée directement dans une réponse HTTP.
  private async findOneRaw(id: string) {
    const i = await this.repo.findOne({ where: { id } });
    if (!i) throw new NotFoundException('Intégration introuvable.');
    return i;
  }

  // Crée l'intégration pour ce type d'outil si elle n'existe pas encore, sinon la met à jour.
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

  // Met à jour une intégration existante (en préservant les secrets non resoumis).
  async update(id: string, dto: UpdateIntegrationDto) {
    await this.findOne(id);
    await this.repo.update(id, this.dropBlankSecrets(dto) as any);
    return this.findOne(id);
  }

  // Teste réellement la connexion à l'outil et persiste le résultat (statut + horodatage + métadonnées).
  async testConnection(id: string) {
    const integration = await this.findOneRaw(id);
    const now = new Date();
    try {
      const metadata = await this.doTest(integration);
      await this.repo.update(id, { status: IntegrationStatus.CONNECTED, lastChecked: now, metadata });
      return { success: true, status: IntegrationStatus.CONNECTED, checkedAt: now, metadata: { message: 'Connexion vérifiée.' } };
    } catch (e: any) {
      const error = 'Échec de la vérification. Vérifiez l’URL et les autorisations du service.';
      await this.repo.update(id, {
        status: IntegrationStatus.ERROR,
        lastChecked: now,
        metadata: { error: String(error) } as any,
      });
      return { success: false, status: IntegrationStatus.ERROR, checkedAt: now, error: String(error) };
    }
  }

  // Appelle l'endpoint de santé propre à chaque outil (Grafana/Prometheus/Kubernetes/Nexus) avec
  // l'authentification appropriée, et normalise sa réponse.
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
