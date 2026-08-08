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

export interface DeployReadiness {
  ready: boolean;
  reasons: string[];
  reportId?: string;
  reportCreatedAt?: Date;
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
  ) {}

  async isReadyToDeploy(projectId: string): Promise<DeployReadiness> {
    const report = await this.reportRepo.findOne({
      where: { projectId, type: ReportType.COMBINED },
      order: { createdAt: 'DESC' },
    });

    if (!report) {
      return {
        ready: false,
        reasons: ['Aucun report combined pour ce projet — impossible de vérifier son état, refus par défaut.'],
      };
    }

    if (!report.rawData || Object.keys(report.rawData).length === 0) {
      return {
        ready: false,
        reasons: ['Le dernier report combined a un rawData vide — impossible de vérifier son état, refus par défaut.'],
        reportId: report.id,
        reportCreatedAt: report.createdAt,
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
        reportCreatedAt: report.createdAt,
      };
    }

    const reasons: string[] = [];

    // 1. Gouvernance — une valeur absente/inconnue n'est JAMAIS traitée comme
    // "différente de BLOCK" : elle doit être explicitement AUTO_FIX ou
    // NOTIFY_ONLY pour compter comme une décision de gouvernance confirmée.
    if (report.judgeDecision === 'BLOCK') {
      reasons.push('judgeDecision=BLOCK (le Judge agent a explicitement bloqué ce build)');
    } else if (report.judgeDecision !== 'AUTO_FIX' && report.judgeDecision !== 'NOTIFY_ONLY') {
      reasons.push(
        `judgeDecision absent ou indéterminé (valeur: ${report.judgeDecision ?? 'null'}) — aucune décision de gouvernance confirmée`,
      );
    }

    // 2. Sécurité
    const trivyCritical = normalized.trivy.critical || 0;
    const owaspCritical = normalized.owasp.critical || 0;
    if (trivyCritical > 0) reasons.push(`${trivyCritical} CVE critique(s) Trivy`);
    if (owaspCritical > 0) reasons.push(`${owaspCritical} CVE critique(s) OWASP`);

    // 3. Qualité — même logique fail-closed que pour judgeDecision : seule
    // une valeur positivement connue comme "verte" fait passer le critère.
    const gate = normalized.sonar.quality_gate;
    if (BLOCKING_QUALITY_GATES.includes(gate)) {
      reasons.push(`quality gate Sonar ${gate}`);
    } else if (!OK_QUALITY_GATES.includes(gate)) {
      reasons.push(`quality gate Sonar indéterminée (valeur: ${gate ?? 'null'}) — refus par défaut`);
    }

    return {
      ready: reasons.length === 0,
      reasons,
      reportId: report.id,
      reportCreatedAt: report.createdAt,
    };
  }

  // POST /deploy reçoit une clé projet ("devsecops-testbed", la même que
  // le registre fixe de l'agent hôte), pas un id — résolution en base ici,
  // jamais fournie/choisie par l'appelant.
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
