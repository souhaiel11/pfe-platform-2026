// ─────────────────────────────────────────────────────────────
//  Gardien "prêt à déployer" — le seul endroit qui décide si un projet
//  peut être déployé. FAIL-CLOSED de bout en bout : toute donnée absente,
//  vide ou de forme inattendue est traitée comme "pas prêt", jamais comme
//  "prêt par défaut". Trois critères, alignés normes DevOps :
//    1. Gouvernance — judgeDecision du Judge agent ≠ BLOCK
//    2. Sécurité    — 0 CVE critique (Trivy + OWASP)
//    3. Qualité     — quality gate SonarQube au vert
//  Utilisé à la fois par GET /ready/:projectId (pour le bouton front) et par
//  POST /deploy (vérification serveur, jamais contournable depuis le front).
// ─────────────────────────────────────────────────────────────
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportType } from '../reports/report.entity';
import { Project } from '../projects/project.entity';
import { normalizeReport } from '../common/report-normalizer';
import { Incident } from '../incidents/incident.entity';
import { evaluateReadiness, GovernedStage } from '../common/governance';

export interface DeployReadiness {
  ready: boolean;
  reasons: string[];
  status?: 'READY' | 'NOT_READY';
  blockingReasons?: string[];
  warnings?: string[];
  currentBuild?: number | null;
  validatedBuild?: number | null;
  unresolvedBlockingCount?: number;
  requiredStages?: GovernedStage[];
  correlationVerified?: boolean;
  reportId?: string;
  reportCreatedAt?: Date;
  deploymentConfigured?: boolean;
  deploymentTarget?: Record<string, string | undefined> | null;
}

// Seules valeurs qui prouvent positivement un quality gate au vert — une
// valeur absente ou inattendue (ex: "UNKNOWN") n'est JAMAIS assimilée à "OK"
// simplement parce qu'elle n'est pas explicitement ERROR/FAILED.
const OK_QUALITY_GATES = ['OK', 'PASSED'];
const BLOCKING_QUALITY_GATES = ['ERROR', 'FAILED'];

@Injectable()
export class AzureDeployReadinessService {
  constructor(
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(Incident) private readonly incidentRepo: Repository<Incident>,
  ) {}

  async isReadyToDeploy(projectId: string): Promise<DeployReadiness> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return { ready: false, status: 'NOT_READY', reasons: ['Projet introuvable'], blockingReasons: ['Projet introuvable'], deploymentConfigured: false };
    const deploymentConfigured = !!project.azureConfig;
    const deploymentTarget = project.azureConfig ? {
      provider: project.azureConfig.provider,
      resourceGroup: project.azureConfig.resourceGroup,
      targetName: project.azureConfig.targetName,
      registry: project.azureConfig.registry,
      imageRepository: project.azureConfig.imageRepository,
      region: project.azureConfig.region,
    } : null;
    const report = await this.reportRepo.findOne({
      where: { projectId, type: ReportType.COMBINED },
      order: { createdAt: 'DESC' },
    });

    if (!report) {
      return {
        ready: false,
        reasons: ['Aucun report combined pour ce projet — impossible de vérifier son état, refus par défaut.'], deploymentConfigured, deploymentTarget,
      };
    }

    if (!report.rawData || Object.keys(report.rawData).length === 0) {
      return {
        ready: false,
        reasons: ['Le dernier report combined a un rawData vide — impossible de vérifier son état, refus par défaut.'],
        reportId: report.id,
        reportCreatedAt: report.createdAt, deploymentConfigured, deploymentTarget,
      };
    }

    const normalized = normalizeReport(report.rawData);
    if (normalized._sourceFormat === 'empty') {
      return {
        ready: false,
        reasons: [
          "Le dernier report combined ne contient aucune donnée d'analyse exploitable (format non reconnu) — refus par défaut.",
        ],
        reportId: report.id,
        reportCreatedAt: report.createdAt, deploymentConfigured, deploymentTarget,
      };
    }

    const incident = await this.incidentRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });
    if (!incident) return { ready: false, status: 'NOT_READY', reasons: ['Aucun incident corrélé n’est disponible'], blockingReasons: ['Aucun incident corrélé n’est disponible'] };
    const metadata: any = incident.metadata || {};
    const validation: any = metadata.validation || {};
    const raw: any = report.rawData || {};
    const currentBuild = Number(raw?.enrichedData?.build?.number ?? raw?.build?.number ?? raw?.buildNumber ?? incident.buildNumber) || null;
    const stages: GovernedStage[] = Object.values(normalized.stages || {}).map((s: any) => ({
      stage: s.stage || s.source || 'unknown', status: s.status, blocking: !!s.blocking,
      required: s.required !== false, message: s.message, source: s.source,
      findingCount: Array.isArray(s.findings) ? s.findings.length : Number(s.findingCount || 0),
    }));
    const stageFindings = Object.values(normalized.stages || {}).flatMap((s: any) => Array.isArray(s.findings) ? s.findings : []);
    const unresolvedBlockingCount = stageFindings.filter((f: any) => f?.blocking === true && f?.resolved !== true).length;
    const gate = normalized.sonar.quality_gate;
    const result = evaluateReadiness({
      currentBuild,
      validatedBuild: Number(validation.buildNumber) || null,
      validationPassed: validation.validationStatus === 'VALIDATED' && validation.passed === true,
      correlationVerified: validation.correlationVerified === true && validation.projectId === projectId && validation.incidentId === incident.id,
      sonarRequired: true,
      sonarCorrelationVerified: validation.sonarCorrelationVerified === true,
      sonarStatus: validation.sonarStatus || gate || null,
      unresolvedBlockingCount,
      fixRequestStatus: metadata.fixRequest?.status,
      stages,
    });

    const reasons: string[] = [...result.blockingReasons];
    if (!deploymentConfigured) reasons.push('Le déploiement Azure n’est pas configuré pour ce projet');

    // 1. Gouvernance — une valeur absente/inconnue n'est JAMAIS traitée comme
    // "différente de BLOCK" : elle doit être explicitement AUTO_FIX ou
    // NOTIFY_ONLY pour compter comme une décision de gouvernance confirmée.
    if (report.judgeDecision === 'BLOCK') {
      reasons.push('La décision de gouvernance bloque explicitement ce build');
    }

    // 2. Sécurité
    const trivyCritical = normalized.trivy.critical || 0;
    const owaspCritical = normalized.owasp.critical || 0;
    if (trivyCritical > 0) reasons.push(`${trivyCritical} ${trivyCritical === 1 ? 'CVE critique' : 'CVE critiques'} Trivy`);
    if (owaspCritical > 0) reasons.push(`${owaspCritical} ${owaspCritical === 1 ? 'CVE critique' : 'CVE critiques'} OWASP Dependency-Check`);

    // 3. Qualité — même logique fail-closed que pour judgeDecision : seule
    // une valeur positivement connue comme "verte" fait passer le critère.
    if (BLOCKING_QUALITY_GATES.includes(gate)) {
      reasons.push(`Le Quality Gate SonarQube est en échec (${gate})`);
    } else if (!OK_QUALITY_GATES.includes(gate)) {
      reasons.push(`Le Quality Gate SonarQube est indéterminé (${gate ?? 'valeur indisponible'}) — refus par défaut`);
    }

    return {
      ...result,
      ready: reasons.length === 0,
      status: reasons.length === 0 ? 'READY' : 'NOT_READY',
      reasons: [...new Set(reasons)],
      blockingReasons: [...new Set(reasons)],
      reportId: report.id,
      reportCreatedAt: report.createdAt,
      deploymentConfigured,
      deploymentTarget,
    };
  }

  // Compatibilité lecture seule pour les anciens consommateurs par nom.
  async isReadyToDeployByProjectName(name: string): Promise<DeployReadiness> {
    const project = await this.projectRepo.findOne({ where: { name } });
    if (!project) {
      return {
        ready: false,
        reasons: [`Projet '${name}' introuvable en base — impossible de vérifier son état, refus par défaut.`],
      };
    }
    return this.isReadyToDeploy(project.id);
  }
}
