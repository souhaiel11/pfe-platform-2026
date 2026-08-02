import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from './project.entity';
import { Incident, IncidentStatus } from '../incidents/incident.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { sanitizeProject } from '../common/sanitize-project';

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
  async getJenkinsStatus(id: string) {
    const project = await this.findOneInternal(id);
    if (!project.jenkinsUrl || !project.jenkinsJobName) {
      return this.getMockJenkinsStatus(project);
    }
    try {
      const [user, token] = (project.jenkinsToken || ':').split(':');
      const headers = project.jenkinsToken
        ? { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` }
        : {};
      // Chemin URL du job (multibranch : "<dossier>/job/<branche>") — distinct
      // de jenkinsJobName (identité du job, utilisée pour le lookup webhook).
      // Vide = fallback sur jenkinsJobName, comportement inchangé.
      const jobPath = project.jenkinsJobPath || project.jenkinsJobName;
      const lastUrl = `${project.jenkinsUrl}/job/${jobPath}/lastBuild/api/json`;
      const { data: last } = await firstValueFrom(this.http.get(lastUrl, { headers }));
      const histUrl = `${project.jenkinsUrl}/job/${jobPath}/api/json?tree=builds[number,result,duration,timestamp,url]{0,10}`;
      const { data: hist } = await firstValueFrom(this.http.get(histUrl, { headers }));
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
      };
    } catch {
      return this.getMockJenkinsStatus(project);
    }
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

  // Historique Jenkins simulé, déterministe par projet (même projectId => même historique
  // à chaque appel). La répartition succès/échec/aborted dépend du statut du projet, ce
  // qui reproduit la matrice de démo (healthy=9✓/1✗, warning=7✓/2✗/1 aborted, critical=4✓/6✗)
  // sans coder les noms de projets en dur.
  private static readonly JENKINS_MOCK_RATIOS: Record<string, { success: number; failure: number; aborted: number; lastResult: string }> = {
    [ProjectStatus.HEALTHY]:  { success: 9, failure: 1, aborted: 0, lastResult: 'SUCCESS' },
    [ProjectStatus.WARNING]:  { success: 7, failure: 2, aborted: 1, lastResult: 'SUCCESS' },
    [ProjectStatus.CRITICAL]: { success: 4, failure: 6, aborted: 0, lastResult: 'FAILURE' },
  };

  private hashSeed(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private getMockJenkinsStatus(project: Project) {
    const rng = this.mulberry32(this.hashSeed(project.id));
    const ratio = ProjectsService.JENKINS_MOCK_RATIOS[project.status] || ProjectsService.JENKINS_MOCK_RATIOS[ProjectStatus.HEALTHY];

    // Slot 0 (le plus récent) est forcé au résultat attendu ; le reste de la répartition
    // est mélangé de façon déterministe (Fisher-Yates seedé par projectId).
    const pool: string[] = [];
    const remaining = {
      SUCCESS: ratio.success - (ratio.lastResult === 'SUCCESS' ? 1 : 0),
      FAILURE: ratio.failure - (ratio.lastResult === 'FAILURE' ? 1 : 0),
      ABORTED: ratio.aborted - (ratio.lastResult === 'ABORTED' ? 1 : 0),
    };
    for (const [result, count] of Object.entries(remaining)) {
      for (let i = 0; i < count; i++) pool.push(result);
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const results = [ratio.lastResult, ...pool]; // 10 entrées, index 0 = plus récent

    const now = Date.now();
    const totalSpanMs = 21 * 24 * 60 * 60 * 1000; // ~3 semaines
    const baseGap = totalSpanMs / 10;
    const baseNumber = 50 + Math.floor(rng() * 400);
    let cumulativeGap = 0;

    const builds = results.map((result, i) => {
      if (i > 0) cumulativeGap += baseGap * (0.6 + rng() * 0.8); // espacement avec jitter déterministe
      const timestamp = Math.round(now - cumulativeGap - (i === 0 ? Math.floor(rng() * 3 * 60 * 60 * 1000) : 0));
      const isFast = result !== 'SUCCESS';
      const durationMs = isFast
        ? Math.round((90 + rng() * 150) * 1000)   // échecs/aborted plus courts : 90–240s
        : Math.round((180 + rng() * 420) * 1000); // succès : 180–600s
      return {
        number: baseNumber + (9 - i),
        result,
        durationMs,
        duration: Math.round(durationMs / 1000),
        timestamp,
        url: `http://jenkins.demo.local/job/${project.jenkinsJobName || project.name}/${baseNumber + (9 - i)}/`,
      };
    });

    const last = builds[0];
    return {
      result: last.result,
      duration: last.durationMs, // racine en ms, cohérent avec le format live (last.duration brut Jenkins)
      timestamp: last.timestamp,
      url: last.url,
      building: false,
      buildNumber: last.number,
      jobName: project.jenkinsJobName,
      builds: builds.map(({ durationMs, ...b }) => b), // builds[].duration en secondes, comme le format live
      source: 'demo',
    };
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
  async findByJobNameInternal(jenkinsJobName: string) {
    return this.repo.find({ where: { jenkinsJobName }, order: { createdAt: "DESC" } });
  }
}
