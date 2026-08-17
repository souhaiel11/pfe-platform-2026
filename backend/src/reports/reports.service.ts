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
import { AzureDeployReadinessService, DeployReadiness } from '../azure-deploy/azure-deploy-readiness.service';
import { IncidentsService } from '../incidents/incidents.service';
import { IncidentStatus } from '../incidents/incident.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly repo: Repository<Report>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly readiness: AzureDeployReadinessService,
    private readonly incidents: IncidentsService,
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
    const { score, incomplete } = calculateSecurityScore(normalized);
    report.securityScore = score;
    report.riskLevel = getRiskLevel(score, incomplete);
    // Décision Judge exposée séparément — n'influence jamais le score ci-dessus.
    report.judgeDecision = (dto as any).judgeDecision ?? null;
    report.judgeConfidence = (dto as any).judgeConfidence ?? null;

    const saved = await this.repo.save(report);

    // Mettre à jour le score du projet depuis ce dernier report combined —
    // l'historique complet est conservé (aucune suppression/archivage auto).
    if (dto.type === 'combined' && dto.projectId) {
      // incomplete → jamais 'healthy' (ProjectStatus n'a pas de 4e valeur
      // "indéterminé" ; 'warning' est le palier existant le plus honnête en
      // attendant une éventuelle extension de l'enum, décision produit à part).
      const projectStatus = incomplete
        ? 'warning'
        : (report.securityScore >= 80 ? 'healthy' : report.securityScore >= 40 ? 'warning' : 'critical');
      await this.projectRepo.update(dto.projectId, {
        securityScore: report.securityScore,
        status: projectStatus as any,
      });
      const after = await this.readiness.isReadyToDeploy(dto.projectId);
      await this.syncDeployReadyNotification(dto.projectId, after);
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

    // Le report qui peut faire basculer isReadyToDeploy est toujours le
    // dernier report combined du projet — inutile de vérifier ici s'il l'est
    // encore après l'update, syncDeployReadyNotification relit l'état réel.
    const report = await this.repo.findOne({ where: { id } });

    await this.repo.update(id, update);
    const updated = await this.findOne(id);

    if (report?.type === ReportType.COMBINED) {
      const after = await this.readiness.isReadyToDeploy(report.projectId);
      await this.syncDeployReadyNotification(report.projectId, after);
    }

    return updated;
  }

  // Notification "prêt à déployer" — greffée sur le système d'incidents
  // existant (pas d'entité Notification dédiée, voir diagnostic). Idempotence
  // via le flag persisté Project.deployReadyNotified (Option A), pas via un
  // snapshot avant/après : plus robuste (survit à un redémarrage backend
  // entre deux écritures) et permet la re-notification après régression.
  private async syncDeployReadyNotification(projectId: string, after: DeployReadiness) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return;

    if (after.ready && !project.deployReadyNotified) {
      await this.incidents.create({
        projectId,
        title: `${project.name} prêt à déployer`,
        description:
          `Le projet "${project.name}" vient de passer à l'état "prêt à déployer" ` +
          `(gouvernance, CVE critiques et quality gate au vert). Page projet : /projects/${projectId}`,
        status: IncidentStatus.COMPLETED,
        source: 'DEPLOY_READY',
        metadata: { link: `/projects/${projectId}`, reportId: after.reportId },
      } as any);
      await this.projectRepo.update(projectId, { deployReadyNotified: true });
    } else if (!after.ready && project.deployReadyNotified) {
      // Régression : le projet redevient non-prêt, on réarme le flag pour
      // qu'un futur retour au vert redéclenche une notification.
      await this.projectRepo.update(projectId, { deployReadyNotified: false });
    }
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