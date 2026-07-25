// incidents.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident, IncidentStatus } from './incident.entity';
import { IncidentsGateway } from './incidents.gateway';
import { Project } from '../projects/project.entity';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly repo: Repository<Incident>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly gateway: IncidentsGateway,
  ) {}

  /**
   * Retire les secrets du projet lie avant de renvoyer un incident.
   * Les incidents sont charges avec relations: ['project'], ce qui
   * exposerait sinon les tokens Jenkins/Sonar/GitHub dans l'API.
   */
  private sanitizeIncident(incident: any) {
    if (!incident?.project) return incident;
    const {
      jenkinsToken,
      sonarqubeToken,
      githubToken,
      slackToken,
      ...safeProject
    } = incident.project as any;
    return { ...incident, project: safeProject };
  }

  async findAll(projectId?: string, status?: string, size?: number) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    const validStatuses = ["pending","analyzing","analyzed","fix_generated","validating","approved","completed","failed","rejected"];
    const normalizedStatus = status?.toLowerCase();
    if (normalizedStatus && validStatuses.includes(normalizedStatus)) where.status = normalizedStatus;
    const incidents = await this.repo.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['project'],
      take: size || undefined,
    });
    return incidents.map(i => this.sanitizeIncident(i));
  }

  async findOne(id: string) {
    const i = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!i) throw new NotFoundException('Incident not found');
    return this.sanitizeIncident(i);
  }

  async create(dto: Partial<Incident> & { jenkinsJobName?: string; buildNumber?: number }) {
    // ── Liaison forte : résoudre le projet via jenkinsJobName ──
    if (!dto.projectId && dto.jenkinsJobName) {
      const project = await this.projectRepo.findOne({
        where: { jenkinsJobName: dto.jenkinsJobName },
      });
      if (!project) {
        throw new NotFoundException(
          `Aucun projet trouvé pour le job Jenkins "${dto.jenkinsJobName}". ` +
          `Vérifiez que le projet est bien créé dans la plateforme avec ce jenkinsJobName.`
        );
      }
      dto.projectId = project.id;
    }

    if (!dto.projectId) {
      throw new BadRequestException('projectId ou jenkinsJobName requis pour créer un incident.');
    }

    const incident = this.repo.create(dto);
    const saved = await this.repo.save(incident);
    this.gateway.emit('incident:created', saved);
    return saved;
  }

  async update(id: string, dto: Partial<Incident>) {
    await this.repo.update(id, dto);
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return updated;
  }

  async remove(id: string) {
    const i = await this.findOne(id);
    await this.repo.remove(i);
    return { message: 'Incident deleted' };
  }

  async saveValidation(id: string, validation: any) {
    const incident = await this.findOne(id);
    const currentMeta = (incident as any).metadata || {};

    const mergedMeta = {
      ...currentMeta,
      validation: {
        ...validation,
        validatedAt: new Date().toISOString(),
      },
    };

    const newStatus = validation.passed ? 'approved' : 'failed';

    await this.repo.update(id, {
      metadata: mergedMeta,
      status: newStatus as IncidentStatus,
    } as any);

    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return updated;
  }

  async approveFix(id: string) {
    const incident = await this.findOne(id);
    await this.repo.update(id, { status: 'approved' as IncidentStatus });
    const webhookUrl = process.env.N8N_WF2_WEBHOOK || 'http://172.31.172.61:5678/webhook/wf2-approve';
    try {
      await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incident }) });
    } catch (err: any) { console.error('WF2 webhook failed:', err?.message || err); }
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, status: 'approved', incidentId: id };
  }

  async rejectFix(id: string) {
    await this.repo.update(id, { status: 'rejected' as IncidentStatus });
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, status: 'rejected', incidentId: id };
  }


  async triggerBuild(projectId: string) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project || !project.jenkinsToken) {
      throw new BadRequestException('Jenkins non configuré pour ce projet');
    }
    const jenkinsUrl = project.jenkinsUrl || 'http://172.31.172.61:8082';
    const [user, token] = project.jenkinsToken.split(':');
    const authHeader = 'Basic ' + Buffer.from(user + ':' + token).toString('base64');
    try {
      const crumbRes = await fetch(jenkinsUrl + '/crumbIssuer/api/json', {
        headers: { 'Authorization': authHeader },
      });
      const crumbData: any = await crumbRes.json();
      const buildRes = await fetch(jenkinsUrl + '/job/' + project.jenkinsJobName + '/build', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          [crumbData.crumbRequestField]: crumbData.crumb,
        },
      });
      return { success: true, status: buildRes.status, job: project.jenkinsJobName };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Jenkins unreachable' };
    }
  }
}
