import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportType } from './report.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly repo: Repository<Report>,
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
    report.aiSummary = await this.generateAiSummary(dto.type, dto.rawData);
    report.securityScore = this.calculateSecurityScore(dto.rawData);
    report.riskLevel = this.getRiskLevel(report.securityScore);
    return this.repo.save(report);
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

  private calculateSecurityScore(data: any): number {
    if (!data) return 50;
    let score = 100;
    score -= (data.critical || 0) * 15;
    score -= (data.high || 0) * 8;
    score -= (data.vulnerabilities || 0) * 5;
    score -= (data.bugs || 0) * 2;
    score -= (data.medium || 0) * 3;
    return Math.max(0, Math.min(100, score));
  }

  private getRiskLevel(score: number): string {
    if (score >= 80) return 'LOW';
    if (score >= 60) return 'MEDIUM';
    if (score >= 40) return 'HIGH';
    return 'CRITICAL';
  }
}
