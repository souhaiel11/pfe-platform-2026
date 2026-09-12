import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Incident, IncidentStatus } from '../incidents/incident.entity';
import { Project, ProjectEnvironment, ProjectStatus } from '../projects/project.entity';

export type Wf2FixtureInput = {
  repository: { fullName: string; defaultBranch: string; buildType?: string };
  findings: Array<{ findingId: string; source: string; category: string; remediationDomain: string; file: string; line?: number; message?: string }>;
  buildNumber?: number;
};

@Injectable()
export class IntegrationFixturesService {
  constructor(
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly config: ConfigService,
  ) {}

  private authorize(user: any) {
    if (this.config.get('NODE_ENV', process.env.NODE_ENV) === 'production'
      || this.config.get('INTEGRATION_FIXTURES_ENABLED', process.env.INTEGRATION_FIXTURES_ENABLED) !== 'true') {
      throw new NotFoundException('Integration fixtures are unavailable.');
    }
    if (!user || String(user.role || '').toLowerCase() !== 'admin') {
      throw new ForbiddenException('Administrative integration-fixture authorization is required.');
    }
  }

  async provisionWf2Context(input: Wf2FixtureInput, user: any) {
    this.authorize(user);
    const repository = String(input?.repository?.fullName || '').trim();
    const defaultBranch = String(input?.repository?.defaultBranch || '').trim();
    const findings = Array.isArray(input?.findings) ? input.findings : [];
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !defaultBranch || !findings.length) {
      throw new BadRequestException('Generic repository metadata and at least one finding are required.');
    }
    const normalizedFindings = findings.map(finding => {
      const findingId = String(finding?.findingId || '').trim();
      const file = String(finding?.file || '').trim();
      const source = String(finding?.source || '').trim();
      const category = String(finding?.category || '').trim();
      const remediationDomain = String(finding?.remediationDomain || '').trim();
      if (!findingId || !file || !source || !category || !remediationDomain || file.startsWith('/') || file.split('/').some(part => part === '.' || part === '..')) {
        throw new BadRequestException('Each finding requires safe generic identity, source, category, domain and repository-relative file metadata.');
      }
      return { id: findingId, key: findingId, findingId, source, category, type: category, remediationDomain,
        stage: source.toLowerCase(), file, component: file, line: finding.line ?? null,
        message: String(finding.message || ''), remediationType: 'AUTO_FIX_ELIGIBLE' };
    });
    if (new Set(normalizedFindings.map(f => f.findingId)).size !== normalizedFindings.length) {
      throw new BadRequestException('Finding identities must be unique.');
    }

    const incidentId = randomUUID();
    const fixtureId = incidentId;
    const requestId = randomUUID();
    const findingIds = normalizedFindings.map(f => f.findingId).sort();
    const batchId = createHash('sha256').update(`${incidentId}\n${findingIds.join('\n')}`).digest('hex');
    const createdAt = new Date().toISOString();
    const marker = { classification: 'NON_PRODUCTION', purpose: 'INTEGRATION_TEST', fixtureId, ownerId: String(user.id), createdAt };

    return this.incidents.manager.transaction(async manager => {
      const projectRepo = manager.getRepository(Project);
      const incidentRepo = manager.getRepository(Incident);
      const project = projectRepo.create({
        name: `integration-fixture-${fixtureId}`, environment: ProjectEnvironment.DEV,
        status: ProjectStatus.HEALTHY, isActive: false, source: `integration-fixture:${fixtureId}`,
        githubRepo: repository,
      } as Partial<Project>);
      const savedProject = await projectRepo.save(project);
      const fixRequest = {
        requestId, batchId, batchKey: batchId, workflow: 'WF2', status: 'DISPATCHED',
        findingId: findingIds[0], findingIds, findings: normalizedFindings,
        attemptCount: 1, retryEligible: false, approvedBy: String(user.id), approvedAt: createdAt,
        dispatchedAt: createdAt, attempts: [{ attempt: 1, status: 'DISPATCHED', authorizedBy: String(user.id), authorizedAt: createdAt,
          dispatchedAt: createdAt, expectedWorkflowId: process.env.N8N_WF2_ID || '9adcV31eaIgJyMR0' }],
        fixture: marker,
      };
      const incident = incidentRepo.create({
        id: incidentId, projectId: savedProject.id, project: savedProject,
        title: 'Disposable WF2 integration lifecycle fixture', status: IncidentStatus.BLOCKED,
        source: 'INTEGRATION_TEST', buildNumber: Number(input.buildNumber ?? 1), prUrl: null,
        metadata: { integrationFixture: marker, defaultBranch, repositoryMetadata: { buildType: input.repository.buildType || null },
          enrichedData: { stages: { fixture: { findings: normalizedFindings } } }, fixRequest },
      } as Partial<Incident>);
      await incidentRepo.save(incident);
      return { fixtureId, incidentId, requestId, batchId, projectId: savedProject.id, attemptCount: 1 };
    });
  }

  async cleanup(fixtureId: string, user: any) {
    this.authorize(user);
    return this.incidents.manager.transaction(async manager => {
      const incidentRepo = manager.getRepository(Incident);
      const projectRepo = manager.getRepository(Project);
      const incident = await incidentRepo.findOne({ where: { id: fixtureId }, lock: { mode: 'pessimistic_write' } });
      const marker: any = incident?.metadata?.integrationFixture;
      if (!incident || marker?.fixtureId !== fixtureId || marker?.classification !== 'NON_PRODUCTION'
        || marker?.purpose !== 'INTEGRATION_TEST' || marker?.ownerId !== String(user.id)) {
        throw new NotFoundException('Owned integration fixture not found.');
      }
      const project = await projectRepo.findOne({ where: { id: incident.projectId }, lock: { mode: 'pessimistic_write' } });
      if (!project || project.source !== `integration-fixture:${fixtureId}`) throw new ForbiddenException('Fixture ownership boundary mismatch.');
      const projectIncidentCount = await incidentRepo.count({ where: { projectId: project.id } });
      if (projectIncidentCount !== 1) throw new ForbiddenException('Fixture project contains unrelated records.');
      await incidentRepo.remove(incident);
      await projectRepo.remove(project);
      return { fixtureId, deleted: true };
    });
  }
}
