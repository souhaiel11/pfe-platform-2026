import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportType } from './report.entity';
import { Project } from '../projects/project.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly repo: Repository<Report>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  findAll(projectId?: string) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, relations: ['project'] });
  }

  findOne(id: string) {
    return this.repo.findOne({ where: { id }, relations: ['project'] });
  }

  async create(dto: Partial<Report>) {
    const report = this.repo.create(dto);
    // Generate AI summary
    report.aiSummary = (dto as any).aiSummary || await this.generateAiSummary(dto.type, dto.rawData);
    report.securityScore = (dto as any).securityScore ?? this.calculateSecurityScore(dto.rawData, (dto as any).aiSummary);
    report.riskLevel = (dto as any).riskLevel || this.getRiskLevel(report.securityScore);
    const saved = await this.repo.save(report);

    // Garder seulement les 3 derniers rapports combined par projet
    if (dto.type === 'combined' && dto.projectId) {
      const allCombined = await this.repo.find({
        where: { projectId: dto.projectId, type: 'combined' as any },
        order: { createdAt: 'DESC' }
      });
      // Mettre à jour le score du projet
      await this.projectRepo.update(dto.projectId, {
        securityScore: report.securityScore,
        status: (report.securityScore >= 80 ? 'healthy' : report.securityScore >= 40 ? 'warning' : 'critical') as any,
      });
      if (allCombined.length > 3) {
        const toDelete = allCombined.slice(3);
        await this.repo.remove(toDelete);
      }
    }

    return saved;
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

  private calculateSecurityScore(data: any, aiSummary?: string): number {
    if (!data) return 100;

    // Lire depuis enrichedData (format n8n v2.1)
    const enriched = data.enrichedData || data;
    const trivy  = enriched.trivy  || {};
    const owasp  = enriched.owasp  || {};
    const zap    = enriched.zap    || {};
    const sonar  = enriched.sonar  || {};
    const tests  = enriched.tests  || {};
    const deploy = enriched.deploy || {};

    // ── Score technique (70%) ─────────────────────────────
    let techScore = 100;

    // Trivy CVEs
    const trivyCritical = trivy.cves?.filter((c: any) => c.severity === 'CRITICAL').length || trivy.critical || 0;
    const trivyHigh     = trivy.cves?.filter((c: any) => c.severity === 'HIGH').length     || trivy.high     || 0;
    const trivyMedium   = trivy.cves?.filter((c: any) => c.severity === 'MEDIUM').length   || 0;
    techScore -= trivyCritical * 15;
    techScore -= trivyHigh     * 5;
    techScore -= trivyMedium   * 2;

    // OWASP
    techScore -= (owasp.critical || 0) * 15;
    techScore -= (owasp.high     || 0) * 5;

    // ZAP
    techScore -= (zap.alerts_high   || 0) * 8;
    techScore -= (zap.alerts_medium || 0) * 3;

    // SonarQube
    techScore -= (sonar.vulnerabilities || 0) * 10;
    techScore -= (sonar.bugs            || 0) * 3;
    techScore -= Math.min(sonar.code_smells || 0, 10) * 1;
    if (sonar.quality_gate === 'ERROR' || sonar.quality_gate === 'FAILED') techScore -= 15;

    // Pipeline
    techScore -= (tests.failures || 0) * 5;
    if (deploy.status === 'FAILED') techScore -= 20;

    techScore = Math.max(0, Math.min(100, techScore));

    // ── Score IA (30%) ────────────────────────────────────
    let aiScore = techScore; // fallback si pas de Judge
    if (aiSummary) {
      try {
        const judge = JSON.parse(aiSummary);
        const decision  = judge.decision      || 'NOTIFY_ONLY';
        const confidence = judge.confidenceScore || 50;
        if      (decision === 'BLOCK')     aiScore = 0;
        else if (decision === 'AUTO_FIX')  aiScore = 50;
        else                               aiScore = confidence;
      } catch(e) {}
    }

    // ── Score final combiné ───────────────────────────────
    const finalScore = Math.round((techScore * 0.7) + (aiScore * 0.3));
    return Math.max(0, Math.min(100, finalScore));
  }

  private getRiskLevel(score: number): string {
    if (score >= 80) return 'LOW';
    if (score >= 60) return 'MEDIUM';
    if (score >= 40) return 'HIGH';
    return 'CRITICAL';
  }
}