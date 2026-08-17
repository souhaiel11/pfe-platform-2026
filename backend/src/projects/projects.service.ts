import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { Incident, IncidentStatus } from '../incidents/incident.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { sanitizeProject } from '../common/sanitize-project';
import { computeBuildSuccessRate } from '../common/build-success-rate';

const OPEN_STATUSES = [IncidentStatus.PENDING, IncidentStatus.BLOCKED, IncidentStatus.FAILED];
const ANALYZING_STATUSES = [IncidentStatus.ANALYZING, IncidentStatus.ANALYZED, IncidentStatus.FIX_GENERATED, IncidentStatus.VALIDATING];
const RESOLVED_STATUSES = [IncidentStatus.APPROVED, IncidentStatus.COMPLETED];

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
    @InjectRepository(Incident)
    private readonly incidentRepo: Repository<Incident>,
    private readonly http: HttpService,
  ) {}

  private sanitizeProject(project: Project) {
    return sanitizeProject(project);
  }

  async findAll(jenkinsJobName?: string) {
    const where = jenkinsJobName ? { jenkinsJobName } : {};
    const projects = await this.repo.find({ where, order: { createdAt: "DESC" } });
    const counts = await this.getIncidentCountsByProject(projects.map(p => p.id));
    return projects.map(p => ({
      ...this.sanitizeProject(p),
      ...(counts.get(p.id) ?? { openIncidents: 0, analyzingIncidents: 0, resolvedIncidents: 0 }),
    }));
  }

  private async getIncidentCountsByProject(projectIds: string[]) {
    const counts = new Map<string, { openIncidents: number; analyzingIncidents: number; resolvedIncidents: number }>();
    if (projectIds.length === 0) return counts;

    const rows = await this.incidentRepo
      .createQueryBuilder('incident')
      .select('incident.projectId', 'projectId')
      .addSelect('incident.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('incident.projectId IN (:...projectIds)', { projectIds })
      .groupBy('incident.projectId')
      .addGroupBy('incident.status')
      .getRawMany<{ projectId: string; status: IncidentStatus; count: string }>();

    for (const row of rows) {
      const entry = counts.get(row.projectId) ?? { openIncidents: 0, analyzingIncidents: 0, resolvedIncidents: 0 };
      const n = parseInt(row.count, 10);
      if (OPEN_STATUSES.includes(row.status)) entry.openIncidents += n;
      else if (ANALYZING_STATUSES.includes(row.status)) entry.analyzingIncidents += n;
      else if (RESOLVED_STATUSES.includes(row.status)) entry.resolvedIncidents += n;
      counts.set(row.projectId, entry);
    }
    return counts;
  }

  async findOne(id: string) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    return this.sanitizeProject(p);
  }

  private async findOneInternal(id: string) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  async create(dto: CreateProjectDto) {
    if (dto.jenkinsJobName) {
      const existing = await this.repo.findOne({ where: { jenkinsJobName: dto.jenkinsJobName } });
      if (existing) throw new ConflictException(`Un projet avec le job Jenkins "${dto.jenkinsJobName}" existe déjà`);
    }
    const p = this.repo.create(dto);
    const saved = await this.repo.save(p);
    return this.sanitizeProject(saved);
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findOneInternal(id);

    // Un champ token vide signifie "ne pas modifier", pas "effacer".
    // Le frontend ne recoit jamais les tokens en clair : il enverrait
    // sinon des chaines vides qui ecraseraient les vraies valeurs.
    const payload: any = { ...dto };
    for (const field of ['jenkinsToken', 'sonarqubeToken', 'githubToken', 'slackToken']) {
      if (payload[field] === '' || payload[field] === null || payload[field] === undefined) {
        delete payload[field];
      }
    }

    await this.repo.update(id, payload);
    return this.findOne(id);
  }

  async remove(id: string) {
    const p = await this.findOneInternal(id);
    await this.repo.remove(p);
    return { message: 'Project deleted' };
  }

  // ── Validation Jenkins + SonarQube ────────────────────────
  async validateProject(id: string) {
    const project = await this.findOneInternal(id);
    const results: any = {};
    const now = new Date().toISOString();

    // Validation SonarQube
    if (project.sonarqubeUrl && project.sonarqubeToken) {
      try {
        const headers = {
          Authorization: `Basic ${Buffer.from(project.sonarqubeToken + ':').toString('base64')}`
        };
        await firstValueFrom(
          this.http.get(`${project.sonarqubeUrl}/api/authentication/validate`, { headers, timeout: 5000 })
        );
        await firstValueFrom(
          this.http.get(`${project.sonarqubeUrl}/api/projects/search?projects=${project.sonarqubeKey}`, { headers, timeout: 5000 })
        );
        results.sonarqube = { valid: true, message: 'SonarQube connecté — projet trouvé', checkedAt: now };
      } catch (e) {
        results.sonarqube = { valid: false, message: `SonarQube inaccessible: ${e.message}`, checkedAt: now };
      }
    }

    // Validation Jenkins
    if (project.jenkinsUrl && project.jenkinsToken) {
      try {
        const [user, token] = project.jenkinsToken.split(':');
        const headers = {
          Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`
        };
        await firstValueFrom(
          this.http.get(`${project.jenkinsUrl}/job/${project.jenkinsJobName}/api/json`, { headers, timeout: 5000 })
        );
        results.jenkins = { valid: true, message: 'Jenkins connecté — job trouvé', checkedAt: now };
      } catch (e) {
        results.jenkins = { valid: false, message: `Jenkins inaccessible: ${e.message}`, checkedAt: now };
      }
    }

    await this.repo.update(id, { validationStatus: results });

    const allValid = Object.values(results).every((r: any) => r.valid);
    return {
      projectId: id,
      projectName: project.name,
      overallValid: allValid,
      results,
      checkedAt: now,
    };
  }

  // ── Métriques SonarQube ───────────────────────────────────
  async getSonarMetrics(id: string) {
    const project = await this.findOneInternal(id);
    if (!project.sonarqubeUrl || !project.sonarqubeKey) {
      return this.getMockSonarMetrics(project.name);
    }
    try {
      const url = `${project.sonarqubeUrl}/api/measures/component`;
      const params = {
        component: project.sonarqubeKey,
        metricKeys: 'bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,security_rating,reliability_rating,sqale_rating,ncloc',
      };
      const headers = project.sonarqubeToken
        ? { Authorization: `Basic ${Buffer.from(project.sonarqubeToken + ':').toString('base64')}` }
        : {};
      const { data } = await firstValueFrom(this.http.get(url, { params, headers }));
      return this.parseSonarMetrics(data);
    } catch {
      return this.getMockSonarMetrics(project.name);
    }
  }

  // ── Status Jenkins ────────────────────────────────────────
  // JENKINS_STATUS_TIMEOUT_MS : borne les deux appels HTTP directs (hors
  // dashboard, qui a déjà son propre timeout via getJenkinsStatusWithTimeout)
  // pour qu'un Jenkins lent (pas juste injoignable) ne fasse jamais attendre
  // l'onglet Jenkins indéfiniment.
  private static readonly JENKINS_STATUS_TIMEOUT_MS = 5000;

  async getJenkinsStatus(id: string) {
    const project = await this.findOneInternal(id);
    if (!project.jenkinsUrl || !project.jenkinsJobName) {
      return this.emptyJenkinsStatus(project, 'Jenkins non configuré pour ce projet');
    }
    try {
      const [user, token] = (project.jenkinsToken || ':').split(':');
      const headers = project.jenkinsToken
        ? { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` }
        : {};
      const timeout = ProjectsService.JENKINS_STATUS_TIMEOUT_MS;
      // Chemin URL du job (multibranch : "<dossier>/job/<branche>") — distinct
      // de jenkinsJobName (identité du job, utilisée pour le lookup webhook).
      // Vide = fallback sur jenkinsJobName, comportement inchangé.
      const jobPath = project.jenkinsJobPath || project.jenkinsJobName;
      const lastUrl = `${project.jenkinsUrl}/job/${jobPath}/lastBuild/api/json`;
      const { data: last } = await firstValueFrom(this.http.get(lastUrl, { headers, timeout }));
      // {0,20} : capture tout l'historique dispo aujourd'hui (15 builds/projet
      // vérifiés en réel) avec marge, plutôt qu'une fenêtre calendaire qui
      // risquerait un échantillon vide sur un historique ancien.
      const histUrl = `${project.jenkinsUrl}/job/${jobPath}/api/json?tree=builds[number,result,duration,timestamp,url]{0,20}`;
      const { data: hist } = await firstValueFrom(this.http.get(histUrl, { headers, timeout }));
      const builds = (hist.builds || []).map((b: any) => ({
        number: b.number, result: b.result,
        duration: Math.round((b.duration || 0) / 1000),
        timestamp: b.timestamp, url: b.url,
      }));
      return {
        result: last.result, duration: last.duration,
        timestamp: last.timestamp, url: last.url,
        building: last.building, buildNumber: last.number,
        jobName: project.jenkinsJobName, builds,
        buildSuccessRate: computeBuildSuccessRate(builds),
        sampleSize: builds.length,
        _liveData: true,
      };
    } catch {
      return this.emptyJenkinsStatus(project, 'Données Jenkins temporairement indisponibles');
    }
  }

  // État dégradé honnête — jamais un build fabriqué. message distingue les 2
  // causes possibles (non configuré vs injoignable/timeout/erreur), pour que
  // l'utilisateur sache quoi faire plutôt qu'un "Non disponible" générique.
  private emptyJenkinsStatus(project: Project, message: string) {
    return {
      result: null, duration: null, timestamp: null, url: null,
      building: false, buildNumber: null,
      jobName: project.jenkinsJobName || null,
      builds: [] as any[],
      buildSuccessRate: null,
      sampleSize: 0,
      _liveData: false,
      message,
    };
  }

  async getTrivyReport(id: string) {
    const project = await this.findOneInternal(id);
    return this.getMockTrivyReport(project.name);
  }

  async getGithubStats(id: string) {
    const project = await this.findOneInternal(id);
    if (!project.githubRepo) return this.getMockGithubStats();
    try {
      const [owner, repo] = project.githubRepo.replace('https://github.com/', '').split('/');
      const headers: any = { 'User-Agent': 'DevSecOps-Platform' };
      if (project.githubToken) headers['Authorization'] = `token ${project.githubToken}`;
      const { data: prs } = await firstValueFrom(
        this.http.get(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=20`, { headers }),
      );
      return {
        openPRs: prs.filter((p: any) => p.state === 'open').length,
        mergedPRs: prs.filter((p: any) => p.merged_at).length,
        totalPRs: prs.length,
        recentPRs: prs.slice(0, 5).map((p: any) => ({
          title: p.title, state: p.state, number: p.number,
          url: p.html_url, createdAt: p.created_at, mergedAt: p.merged_at,
        })),
      };
    } catch {
      return this.getMockGithubStats();
    }
  }

  // ── Helpers privés ────────────────────────────────────────
  private parseSonarMetrics(data: any) {
    const measures: any = {};
    data?.component?.measures?.forEach((m: any) => { measures[m.metric] = m.value; });
    return {
      bugs: parseInt(measures.bugs || '0'),
      vulnerabilities: parseInt(measures.vulnerabilities || '0'),
      codeSmells: parseInt(measures.code_smells || '0'),
      coverage: parseFloat(measures.coverage || '0'),
      duplications: parseFloat(measures.duplicated_lines_density || '0'),
      securityRating: measures.security_rating || 'A',
      reliabilityRating: measures.reliability_rating || 'A',
      maintainabilityRating: measures.sqale_rating || 'A',
      linesOfCode: parseInt(measures.ncloc || '0'),
    };
  }

  private getMockSonarMetrics(name: string) {
    return { bugs: 0, vulnerabilities: 0, codeSmells: 12, coverage: 85, duplications: 0.5, securityRating: 'A', reliabilityRating: 'A', maintainabilityRating: 'A', linesOfCode: 1500 };
  }

  private getMockTrivyReport(name: string) {
    return { critical: 0, high: 3, medium: 12, low: 24, unknown: 0, vulnerabilities: [] };
  }

  private getMockGithubStats() {
    return { openPRs: 2, mergedPRs: 18, totalPRs: 25, recentPRs: [] };
  }

  /**
   * Usage INTERNE uniquement (n8n via /api/projects/internal/by-job/:jobName).
   * Retourne volontairement les tokens : la plateforme doit s'authentifier
   * aupres de Jenkins/Sonar/GitHub au nom du projet.
   * Cette route ne doit jamais etre exposee publiquement.
   */
  /**
   * Résolution partagée jobName Jenkins -> projet(s), source unique de
   * vérité utilisée par TOUS les points d'entrée internes (GET
   * internal/by-job, POST webhooks/jenkins/by-job — voir leurs contrôleurs
   * respectifs). Deux niveaux, jamais plus :
   *   1. Match EXACT sur jenkinsJobName tel quel (couvre un jenkinsJobName
   *      qui contiendrait déjà la forme complète, cas rare mais possible).
   *   2. Repli sur la forme COURTE (premier segment) — Jenkins envoie le
   *      JOB_NAME complet pour un pipeline multibranche ("<job>/<branche>"),
   *      jamais stocké tel quel en base (jenkinsJobName y est toujours la
   *      forme courte, voir le commentaire sur l'entité).
   * Aucun appelant n'a besoin de connaître ce format — WF1 comme le webhook
   * direct passent le jobName brut de Jenkins, point.
   */
  async resolveByJobName(jenkinsJobName: string) {
    const exact = await this.repo.find({ where: { jenkinsJobName }, order: { createdAt: "DESC" } });
    if (exact.length > 0) return exact;

    const shortName = jenkinsJobName.split('/')[0];
    if (shortName === jenkinsJobName) return [];
    return this.repo.find({ where: { jenkinsJobName: shortName }, order: { createdAt: "DESC" } });
  }

  async findByJobNameInternal(jenkinsJobName: string) {
    return this.resolveByJobName(jenkinsJobName);
  }
}
