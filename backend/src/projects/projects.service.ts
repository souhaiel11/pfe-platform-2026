import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
    private readonly http: HttpService,
  ) {}

  private sanitizeProject(project: Project) {
    const {
      jenkinsToken,
      sonarqubeToken,
      githubToken,
      slackToken,
      ...safeProject
    } = project as any;

    return safeProject;
  }

  async findAll(jenkinsJobName?: string) {
    const where = jenkinsJobName ? { jenkinsJobName } : {};
    const projects = await this.repo.find({ where, order: { createdAt: "DESC" } });
    return projects;
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
    return this.repo.save(p);
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findOneInternal(id);
    await this.repo.update(id, dto);
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
      return this.getMockJenkinsStatus();
    }
    try {
      const [user, token] = (project.jenkinsToken || ':').split(':');
      const headers = project.jenkinsToken
        ? { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` }
        : {};
      const lastUrl = `${project.jenkinsUrl}/job/${project.jenkinsJobName}/lastBuild/api/json`;
      const { data: last } = await firstValueFrom(this.http.get(lastUrl, { headers }));
      const histUrl = `${project.jenkinsUrl}/job/${project.jenkinsJobName}/api/json?tree=builds[number,result,duration,timestamp,url]{0,10}`;
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
      return this.getMockJenkinsStatus();
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

  private getMockJenkinsStatus() {
    return { result: 'SUCCESS', duration: 45000, timestamp: Date.now() - 3600000, url: '#', building: false };
  }

  private getMockTrivyReport(name: string) {
    return { critical: 0, high: 3, medium: 12, low: 24, unknown: 0, vulnerabilities: [] };
  }

  private getMockGithubStats() {
    return { openPRs: 2, mergedPRs: 18, totalPRs: 25, recentPRs: [] };
  }

  async findByJobNameInternal(jenkinsJobName: string) {
    return this.repo.find({ where: { jenkinsJobName }, order: { createdAt: "DESC" } });
  }
}
