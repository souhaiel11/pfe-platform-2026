import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectsService } from '../projects/projects.service';
import { BugsService } from '../bugs/bugs.service';
import { BugSeverity, BugStatus } from '../bugs/bug.entity';
import { CicdTool } from '../projects/project.entity';
import { Report } from '../reports/report.entity';
import { normalizeReport } from '../common/report-normalizer';
import { computeRiskScore } from '../common/risk-score';
import { calculateSecurityScore } from '../common/security-score';
import { computeBuildSuccessRate } from '../common/build-success-rate';

const JENKINS_GLOBAL_TIMEOUT_MS = 5000;

@Injectable()
export class DashboardService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly bugsService: BugsService,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
  ) {}

  async getGlobalStats() {
    const projects = await this.projectsService.findAll();
    const bugs = await this.bugsService.findAll();

    const openBugs = bugs.filter(b => b.status === BugStatus.OPEN);
    const criticalBugs = bugs.filter(b => b.severity === BugSeverity.CRITICAL);
    const fixedBugs = bugs.filter(b => b.status === BugStatus.RESOLVED || b.status === BugStatus.PR_CREATED);

    const avgSecurityScore = projects.length
      ? projects.reduce((sum, p) => sum + (p.securityScore || 100), 0) / projects.length
      : 100;

    return {
      totalProjects: projects.length,
      healthyProjects: projects.filter(p => p.status === 'healthy').length,
      warningProjects: projects.filter(p => p.status === 'warning').length,
      criticalProjects: projects.filter(p => p.status === 'critical').length,
      totalBugs: bugs.length,
      openBugs: openBugs.length,
      criticalBugs: criticalBugs.length,
      fixedBugs: fixedBugs.length,
      avgSecurityScore: Math.round(avgSecurityScore),
      recentBugs: bugs.slice(0, 5),
      projects: projects.slice(0, 6),
      bugsByDay: this.getBugsByDay(bugs),
      bugsBySeverity: {
        critical: bugs.filter(b => b.severity === BugSeverity.CRITICAL).length,
        high: bugs.filter(b => b.severity === BugSeverity.HIGH).length,
        medium: bugs.filter(b => b.severity === BugSeverity.MEDIUM).length,
        low: bugs.filter(b => b.severity === BugSeverity.LOW).length,
      },
    };
  }

  // ── Vue globale Jenkins (tous projets) ───────────────────────
  async getJenkinsGlobal() {
    const projects = await this.projectsService.findAll();
    const jenkinsProjects = projects.filter(
      p => p.cicdTool === CicdTool.JENKINS && !!p.jenkinsJobName,
    );

    const settled = await Promise.allSettled(
      jenkinsProjects.map(p => this.getJenkinsStatusWithTimeout(p.id)),
    );

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    let totalBuildsCount = 0;
    let totalSuccessCount = 0;
    let failedBuilds24h = 0;
    let durationSum = 0;
    let durationCount = 0;

    const items = jenkinsProjects.map((project, i) => {
      const result = settled[i];

      // Timeout du Promise.race ou réponse vide : absence d'info, jamais un
      // échec confirmé => 'unknown', pas 'red' (même principe que _liveData).
      if (result.status !== 'fulfilled' || !result.value) {
        const error = result.status === 'rejected'
          ? (result.reason?.message || 'Jenkins injoignable')
          : 'Réponse Jenkins vide';
        return {
          projectId: project.id,
          projectName: project.name,
          jenkinsJobName: project.jenkinsJobName,
          status: 'unknown' as 'green' | 'red' | 'unknown',
          recentSuccessRate: null,
          lastBuild: null,
          error,
          _sortTimestamp: 0,
        };
      }

      const jenkins = result.value;
      // Taux de réussite, status et lastBuild : source unique avec
      // projects.service.ts::getJenkinsStatus (même helper, même _liveData).
      // !isLive (non configuré, erreur, timeout — getMockJenkinsStatus
      // supprimé) => rien de dérivé, jamais une valeur fictive ni comptée
      // dans l'agrégat plateforme.
      const isLive = jenkins._liveData === true;
      const builds: any[] = isLive && Array.isArray(jenkins.builds) ? jenkins.builds : [];
      const recentSuccessRate = isLive ? computeBuildSuccessRate(builds) : null;

      if (isLive) {
        totalBuildsCount += builds.length;
        totalSuccessCount += builds.filter((b: any) => b.result === 'SUCCESS').length;
        failedBuilds24h += builds.filter(
          (b: any) =>
            (b.result === 'FAILURE' || b.result === 'ABORTED') &&
            b.timestamp && b.timestamp >= oneDayAgo,
        ).length;
      }

      const durationSeconds = isLive ? Math.round((jenkins.duration || 0) / 1000) : 0;
      if (isLive) { durationSum += durationSeconds; durationCount += 1; }

      return {
        projectId: project.id,
        projectName: project.name,
        jenkinsJobName: project.jenkinsJobName,
        // !isLive => 'unknown' : jamais 'red', qui affirmerait à tort un
        // échec confirmé sur une simple absence de données.
        status: (!isLive ? 'unknown' : (jenkins.result === 'SUCCESS' ? 'green' : 'red')) as 'green' | 'red' | 'unknown',
        recentSuccessRate,
        lastBuild: isLive ? {
          number: jenkins.buildNumber ?? null,
          result: jenkins.result ?? null,
          durationSeconds,
          timestamp: jenkins.timestamp ? new Date(jenkins.timestamp).toISOString() : null,
          url: jenkins.url ?? null,
        } : null,
        error: isLive ? null : (jenkins.message || 'Données Jenkins indisponibles'),
        _sortTimestamp: isLive ? (jenkins.timestamp || 0) : 0,
      };
    });

    const projectsGreen = items.filter(it => it.status === 'green').length;
    const projectsRed = items.filter(it => it.status === 'red').length;
    const projectsUnknown = items.filter(it => it.status === 'unknown').length;

    // Tri : rouges confirmés d'abord, puis inconnus (à vérifier), puis verts ;
    // à l'intérieur de chaque groupe, plus récents d'abord.
    const STATUS_PRIORITY: Record<string, number> = { red: 0, unknown: 1, green: 2 };
    items.sort((a, b) => {
      if (a.status !== b.status) return STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      return b._sortTimestamp - a._sortTimestamp;
    });

    const responseProjects = items.map(({ _sortTimestamp, ...rest }) => rest);

    return {
      summary: {
        totalProjects: projects.length,
        projectsWithJenkins: jenkinsProjects.length,
        projectsGreen,
        projectsRed,
        projectsUnknown,
        // % de builds réussis cumulés sur l'historique live de chaque projet
        // (jusqu'à 20 builds/projet) — null si aucun projet n'a de données
        // live (jamais un 0% fabriqué).
        aggregateSuccessRate: totalBuildsCount
          ? Math.round((totalSuccessCount / totalBuildsCount) * 100)
          : null,
        aggregateSampleSize: totalBuildsCount,
        failedBuilds24h,
        avgDurationSeconds: durationCount ? Math.round(durationSum / durationCount) : 0,
      },
      projects: responseProjects,
      generatedAt: new Date().toISOString(),
    };
  }

  private getJenkinsStatusWithTimeout(projectId: string, timeoutMs = JENKINS_GLOBAL_TIMEOUT_MS): Promise<any> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      this.projectsService.getJenkinsStatus(projectId),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout Jenkins après ${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  async getProjectDashboard(projectId: string) {
    const [sonar, jenkins, trivy, github] = await Promise.all([
      this.projectsService.getSonarMetrics(projectId),
      this.projectsService.getJenkinsStatus(projectId),
      this.projectsService.getTrivyReport(projectId),
      this.projectsService.getGithubStats(projectId),
    ]);
    const bugs = await this.bugsService.findAll(projectId);
    return { sonar, jenkins, trivy, github, bugs };
  }

  // ── Vue globale sécurité (tous projets, dernier report de chacun) ────
  async getSecurityGlobal() {
    const projects = await this.projectsService.findAll();

    // Un seul report par projet : le plus récent par createdAt (jamais la
    // somme de tout l'historique).
    const latestReports: Array<{ projectId: string; rawData: any }> =
      await this.reportRepo.query(
        `SELECT DISTINCT ON ("projectId") "projectId", "rawData"
         FROM reports
         WHERE "archived" = false
         ORDER BY "projectId", "createdAt" DESC`,
      );
    const latestByProject = new Map<string, any>();
    for (const r of latestReports) latestByProject.set(r.projectId, r.rawData);

    const projectsWithoutData: string[] = [];
    let trivyCritical = 0, trivyHigh = 0;
    let owaspCritical = 0, owaspHigh = 0;
    let totalMediumCves = 0;
    let zapHighAlerts = 0, zapMediumAlerts = 0;
    let sonarBugs = 0, sonarVulnerabilities = 0, sonarCodeSmells = 0;
    let liveScoreSum = 0;

    const byProject = projects.map(project => {
      const rawData = latestByProject.get(project.id);
      // Normalise à la lecture — v2.1, legacy ou vide, un seul chemin pour tous.
      const normalized = normalizeReport(rawData);

      if (normalized._sourceFormat === 'empty') projectsWithoutData.push(project.name);

      // Score LIVE, recalculé depuis CE report normalisé — jamais
      // project.securityScore (copie figée qui peut se désynchroniser sans
      // alerte). Cohérent par construction avec criticalCves ci-dessous,
      // puisque calculés depuis le même `normalized`.
      const { score: liveScore, incomplete: scoreIncomplete, missingScanners } = calculateSecurityScore(normalized);
      liveScoreSum += liveScore;

      const trivy = normalized.trivy;
      const owasp = normalized.owasp;
      const zap = normalized.zap;
      const sonar = normalized.sonar;

      const tCrit = trivy.critical || 0;
      const tHigh = trivy.high || 0;
      const oCrit = owasp.critical || 0;
      const oHigh = owasp.high || 0;
      const zHigh = zap.alerts_high || 0;
      const zMedium = zap.alerts_medium || 0;

      // Medium = compteur cves_count (réel, pas jsonb_array_length) moins
      // critical/high ; jamais négatif ; 0 si l'info n'est pas disponible.
      const tMedium = Math.max(0, (trivy.cves_count || 0) - tCrit - tHigh);
      const oMedium = Math.max(0, (owasp.cves_count || 0) - oCrit - oHigh);

      trivyCritical += tCrit;
      trivyHigh += tHigh;
      owaspCritical += oCrit;
      owaspHigh += oHigh;
      totalMediumCves += tMedium + oMedium;
      zapHighAlerts += zHigh;
      zapMediumAlerts += zMedium;
      sonarBugs += sonar.bugs || 0;
      sonarVulnerabilities += sonar.vulnerabilities || 0;
      sonarCodeSmells += sonar.code_smells || 0;

      return {
        projectId: project.id,
        projectName: project.name,
        securityScore: liveScore,
        // Consommé par la page /security et l'onglet Sécurité projet pour
        // afficher un badge "scanner non exécuté" au lieu d'un faux "0 trouvé".
        incomplete: scoreIncomplete,
        missingScanners,
        criticalCves: tCrit + oCrit,
        highCves: tHigh + oHigh,
        trivy: { critical: tCrit, high: tHigh },
        owasp: { critical: oCrit, high: oHigh },
        zap: { high: zHigh, medium: zMedium },
        // Champ additif — consommé par la page "Indicateurs de risque" (règle
        // quality gate / coverage). Ne casse aucun consommateur existant.
        sonar: {
          qualityGate: sonar.quality_gate ?? null,
          coverage: typeof sonar.coverage === 'number' ? sonar.coverage : null,
        },
      };
    });

    byProject.sort((a, b) => b.criticalCves - a.criticalCves);

    // Moyenne des scores LIVE recalculés ci-dessus — pas des Project.securityScore figés.
    const avgSecurityScore = projects.length ? Math.round(liveScoreSum / projects.length) : 100;

    return {
      summary: {
        totalProjects: projects.length,
        totalCriticalCves: trivyCritical + owaspCritical,
        totalHighCves: trivyHigh + owaspHigh,
        totalMediumCves,
        trivyCritical,
        trivyHigh,
        owaspCritical,
        owaspHigh,
        zapHighAlerts,
        zapMediumAlerts,
        sonarBugs,
        sonarVulnerabilities,
        sonarCodeSmells,
        avgSecurityScore,
      },
      byProject,
      projectsWithoutData,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Indicateur de risque par projet — LIVE, jamais stocké ────────────
  async getRiskIndicators() {
    const [projects, security, jenkins] = await Promise.all([
      this.projectsService.findAll(),
      this.getSecurityGlobal(),
      this.getJenkinsGlobal(),
    ]);

    const secByProject = new Map<string, any>(security.byProject.map((p: any) => [p.projectId, p]));
    const buildByProject = new Map<string, any>(jenkins.projects.map((p: any) => [p.projectId, p]));

    const items = projects.map((project: any) => {
      const sec = secByProject.get(project.id);
      const build = buildByProject.get(project.id);

      const result = computeRiskScore({
        criticalCves: sec?.criticalCves ?? 0,
        buildFailed: build?.lastBuild?.result === 'FAILURE',
        openIncidents: project.openIncidents ?? 0,
        qualityGateError: sec?.sonar?.qualityGate === 'ERROR',
        coverage: sec?.sonar?.coverage ?? null,
      });

      return {
        projectId: project.id,
        projectName: project.name,
        risk: result.risk,
        level: result.level,
        levelClass: result.levelClass,
        rules: result.rules,
      };
    });

    items.sort((a, b) => b.risk - a.risk);

    return { projects: items, generatedAt: new Date().toISOString() };
  }

  private getBugsByDay(bugs: any[]) {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      days[key] = 0;
    }
    bugs.forEach(b => {
      const key = new Date(b.createdAt).toISOString().split('T')[0];
      if (days[key] !== undefined) days[key]++;
    });
    return Object.entries(days).map(([date, count]) => ({ date, count }));
  }
}
