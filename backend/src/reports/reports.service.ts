import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportType } from './report.entity';
import { Project } from '../projects/project.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { normalizeReport } from '../common/report-normalizer';
import { calculateSecurityScore, getRiskLevel } from '../common/security-score';
import { sanitizeEntityProject } from '../common/sanitize-project';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly repo: Repository<Report>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  // Toujours borné à 100 (les plus récents) — historique conservé en
  // intégralité en base, mais une seule requête ne doit jamais ramener une
  // table entière sans limite. includeArchived lève le filtre archived,
  // pas la limite.
  private static readonly MAX_RESULTS = 100;

  async findAll(projectId?: string, includeArchived?: boolean) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (!includeArchived) where.archived = false;
    const reports = await this.repo.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['project'],
      take: ReportsService.MAX_RESULTS,
    });
    return reports.map(r => sanitizeEntityProject(r));
  }

  async findOne(id: string) {
    const report = await this.repo.findOne({ where: { id }, relations: ['project'] });
    return sanitizeEntityProject(report);
  }

  async create(dto: Partial<Report>) {
    const report = this.repo.create(dto);
    // Generate AI summary
    report.aiSummary = (dto as any).aiSummary || await this.generateAiSummary(dto.type, dto.rawData);
    // Score de sécurité : TOUJOURS le calcul déterministe sur les findings
    // normalisés — jamais dto.securityScore/riskLevel (valeurs LLM ignorées).
    const normalized = normalizeReport(dto.rawData);
    report.securityScore = calculateSecurityScore(normalized);
    report.riskLevel = getRiskLevel(report.securityScore);
    // Décision Judge exposée séparément — n'influence jamais le score ci-dessus.
    report.judgeDecision = (dto as any).judgeDecision ?? null;
    report.judgeConfidence = (dto as any).judgeConfidence ?? null;
    const saved = await this.repo.save(report);

    // Mettre à jour le score du projet depuis ce dernier report combined —
    // l'historique complet est conservé (aucune suppression/archivage auto).
    if (dto.type === 'combined' && dto.projectId) {
      await this.projectRepo.update(dto.projectId, {
        securityScore: report.securityScore,
        status: (report.securityScore >= 80 ? 'healthy' : report.securityScore >= 40 ? 'warning' : 'critical') as any,
      });
    }

    return saved;
  }

  // Met à jour UNIQUEMENT judgeDecision/judgeConfidence — jamais
  // securityScore/riskLevel/rawData, jamais de recalcul. Le reste du body
  // est ignoré silencieusement (pas une source de vérité pour ces champs).
  private static readonly VALID_DECISIONS = ['BLOCK', 'AUTO_FIX', 'NOTIFY_ONLY'];

  async updateJudgeDecision(id: string, dto: any) {
    const update: { judgeDecision?: string; judgeConfidence?: number } = {};

    if (typeof dto?.judgeDecision === 'string' && ReportsService.VALID_DECISIONS.includes(dto.judgeDecision.toUpperCase())) {
      update.judgeDecision = dto.judgeDecision.toUpperCase();
    }
    if (typeof dto?.judgeConfidence === 'number' && dto.judgeConfidence >= 0 && dto.judgeConfidence <= 100) {
      update.judgeConfidence = dto.judgeConfidence;
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestException(
        `judgeDecision (${ReportsService.VALID_DECISIONS.join('|')}) et/ou judgeConfidence (0-100) requis et valide(s)`,
      );
    }

    await this.repo.update(id, update);
    return this.findOne(id);
  }

  async remove(id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (r) await this.repo.remove(r);
    return { message: 'Report deleted' };
  }

  private async generateAiSummary(type: ReportType, data: any): Promise<string> {
    const n8nUrl = this.config.get('N8N_URL', 'http://n8n:5678');
    try {
      const { data: result } = await firstValueFrom(
        this.http.post(`${n8nUrl}/webhook/report-summary`, { type, data }),
      );
      return result.summary || this.getDefaultSummary(type, data);
    } catch {
      return this.getDefaultSummary(type, data);
    }
  }

  private getDefaultSummary(type: ReportType, data: any): string {
    if (type === ReportType.SONARQUBE) {
      const bugs = data?.bugs || 0;
      const vulns = data?.vulnerabilities || 0;
      const coverage = data?.coverage || 0;
      return `Analyse SonarQube : ${bugs} bug(s) détecté(s), ${vulns} vulnérabilité(s) identifiée(s). La couverture de code est de ${coverage}%. ${
        vulns > 0 ? 'Des corrections de sécurité sont recommandées.' : 'Le code est globalement sain.'
      }`;
    }
    if (type === ReportType.TRIVY) {
      const critical = data?.critical || 0;
      const high = data?.high || 0;
      return `Scan Trivy : ${critical} vulnérabilité(s) critique(s) et ${high} haute(s) trouvée(s) dans les dépendances. ${
        critical > 0 ? 'Action immédiate requise.' : 'Aucune vulnérabilité critique détectée.'
      }`;
    }
    if (type === ReportType.JENKINS) {
      return `Pipeline Jenkins : statut ${data?.result || 'inconnu'}. Durée : ${Math.floor((data?.duration || 0) / 1000)}s.`;
    }
    return 'Rapport généré et analysé par le système DevSecOps.';
  }

}