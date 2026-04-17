import { Injectable, NotFoundException } from '@nestjs/common';
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

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  create(dto: CreateProjectDto) {
    const p = this.repo.create(dto);
    return this.repo.save(p);
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findOne(id);
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    const p = await this.findOne(id);
    await this.repo.remove(p);
    return { message: 'Project deleted' };
  }

  async getSonarMetrics(id: string) {
    const project = await this.findOne(id);
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

  async getJenkinsStatus(id: string) {
    const project = await this.findOne(id);
    if (!project.jenkinsUrl || !project.jenkinsJobName) {
      return this.getMockJenkinsStatus();
    }
    try {
      const url = `${project.jenkinsUrl}/job/${project.jenkinsJobName}/lastBuild/api/json`;
      const headers = project.jenkinsToken
        ? { Authorization: `Basic ${Buffer.from(project.jenkinsToken).toString('base64')}` }
        : {};
      const { data } = await firstValueFrom(this.http.get(url, { headers }));
      return {
        result: data.result,
        duration: data.duration,
        timestamp: data.timestamp,
        url: data.url,
        building: data.building,
      };
    } catch {
      return this.getMockJenkinsStatus();
    }
  }

  async getTrivyReport(id: string) {
    const project = await this.findOne(id);
    return this.getMockTrivyReport(project.name);
  }

  async getGithubStats(id: string) {
    const project = await this.findOne(id);
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
          title: p.title,
          state: p.state,
          number: p.number,
          url: p.html_url,
          createdAt: p.created_at,
          mergedAt: p.merged_at,
        })),
      };
    } catch {
      return this.getMockGithubStats();
    }
  }

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
    return {
      bugs: Math.floor(Math.random() * 10),
      vulnerabilities: Math.floor(Math.random() * 5),
      codeSmells: Math.floor(Math.random() * 50),
      coverage: Math.floor(60 + Math.random() * 35),
      duplications: parseFloat((Math.random() * 5).toFixed(1)),
      securityRating: ['A', 'B', 'C'][Math.floor(Math.random() * 3)],
      reliabilityRating: ['A', 'B'][Math.floor(Math.random() * 2)],
      maintainabilityRating: 'A',
      linesOfCode: Math.floor(1000 + Math.random() * 50000),
    };
  }

  private getMockJenkinsStatus() {
    const results = ['SUCCESS', 'FAILURE', 'UNSTABLE', 'SUCCESS', 'SUCCESS'];
    return {
      result: results[Math.floor(Math.random() * results.length)],
      duration: Math.floor(30000 + Math.random() * 120000),
      timestamp: Date.now() - Math.floor(Math.random() * 3600000),
      url: '#',
      building: false,
    };
  }

  private getMockTrivyReport(name: string) {
    return {
      critical: Math.floor(Math.random() * 3),
      high: Math.floor(Math.random() * 8),
      medium: Math.floor(Math.random() * 20),
      low: Math.floor(Math.random() * 40),
      unknown: Math.floor(Math.random() * 5),
      vulnerabilities: Array.from({ length: 5 }, (_, i) => ({
        id: `CVE-2024-${10000 + i}`,
        severity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'][Math.floor(Math.random() * 4)],
        package: ['openssl', 'libssl', 'curl', 'zlib', 'glibc'][i],
        version: '1.0.' + i,
        fixedVersion: '1.0.' + (i + 1),
        title: `Vulnerability in package ${['openssl', 'libssl', 'curl', 'zlib', 'glibc'][i]}`,
      })),
    };
  }

  private getMockGithubStats() {
    return {
      openPRs: Math.floor(Math.random() * 8),
      mergedPRs: Math.floor(10 + Math.random() * 30),
      totalPRs: Math.floor(20 + Math.random() * 50),
      recentPRs: Array.from({ length: 3 }, (_, i) => ({
        title: `Fix: issue #${100 + i}`,
        state: i === 0 ? 'open' : 'closed',
        number: 100 + i,
        url: '#',
        createdAt: new Date(Date.now() - i * 86400000).toISOString(),
        mergedAt: i > 0 ? new Date(Date.now() - i * 43200000).toISOString() : null,
      })),
    };
  }
}
