// incidents.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, ServiceUnavailableException, BadGatewayException, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident, IncidentStatus } from './incident.entity';
import { IncidentsGateway } from './incidents.gateway';
import { Project } from '../projects/project.entity';
import { sanitizeEntityProject } from '../common/sanitize-project';
import { writeErrorToEntity } from '../common/workflow-error';
import { randomUUID } from 'crypto';
import { buildConvergenceCycles } from '../common/governance';

export function classifyJenkinsTriggerStatus(status: number): { accepted: boolean; code?: string } {
  if (status === 201) return { accepted: true };
  if (status >= 200 && status < 300) return { accepted: false, code: 'JENKINS_TRIGGER_NOT_ACCEPTED' };
  if (status === 401 || status === 403) return { accepted: false, code: 'JENKINS_AUTH_FAILED' };
  if (status === 404) return { accepted: false, code: 'JENKINS_JOB_NOT_FOUND' };
  if (status === 409) return { accepted: false, code: 'JENKINS_TRIGGER_CONFLICT' };
  if (status >= 500) return { accepted: false, code: 'JENKINS_UNAVAILABLE' };
  return { accepted: false, code: 'JENKINS_TRIGGER_FAILED' };
}

export function resolveJenkinsJobPath(configuredPath: string): string {
  const value = String(configuredPath || '').trim();
  if (!value || value.includes('://') || /[?#\\\x00-\x1f]/.test(value)) {
    throw new Error('Invalid Jenkins job path');
  }
  const names = value.split('/job/');
  if (names.some(name => !name || name === '.' || name === '..' || name.includes('/'))) {
    throw new Error('Invalid Jenkins job path');
  }
  return '/job/' + names.map(name => encodeURIComponent(name)).join('/job/');
}

export function isConcreteJenkinsBuildJob(metadata: any): boolean {
  return metadata?.buildable === true
    && metadata?._class === 'org.jenkinsci.plugins.workflow.job.WorkflowJob';
}

export function isAcceptedJenkinsBuildResponse(status: number, queueUrl: string | null): boolean {
  return status === 201 && !!queueUrl && /\/queue\/item\/\d+\/?$/.test(queueUrl);
}

type JenkinsParameterDefinition = {
  name?: string;
  type?: string;
  _class?: string;
  defaultParameterValue?: { value?: unknown } | null;
};

export function getJenkinsParameterDefinitions(metadata: any): JenkinsParameterDefinition[] {
  const property = (metadata?.property || []).find((item: any) =>
    item?._class === 'hudson.model.ParametersDefinitionProperty'
  );
  return Array.isArray(property?.parameterDefinitions) ? property.parameterDefinitions : [];
}

export function resolveJenkinsParameters(
  definitions: JenkinsParameterDefinition[],
  trustedOverrides: Record<string, unknown> = {},
): { body: URLSearchParams; audit: Array<{ name: string; source: string; sensitive: boolean }> } {
  const names = definitions.map(def => String(def?.name || ''));
  if (names.some(name => !name) || new Set(names).size !== names.length) {
    throw new Error('Invalid or duplicate Jenkins parameter definition');
  }
  for (const name of Object.keys(trustedOverrides)) {
    if (!names.includes(name)) throw new Error('Unknown Jenkins parameter override');
  }
  const body = new URLSearchParams();
  const audit: Array<{ name: string; source: string; sensitive: boolean }> = [];
  for (const definition of definitions) {
    const name = String(definition.name);
    const type = String(definition.type || definition._class || '');
    const sensitive = /password|credential|secret/i.test(type);
    const overridden = Object.prototype.hasOwnProperty.call(trustedOverrides, name);
    const hasDefault = definition.defaultParameterValue != null
      && Object.prototype.hasOwnProperty.call(definition.defaultParameterValue, 'value');
    if (!overridden && !hasDefault) throw new Error('Required Jenkins parameter has no trusted value');
    const value = overridden ? trustedOverrides[name] : definition.defaultParameterValue!.value;
    if (value === undefined || value === null) throw new Error('Required Jenkins parameter has no trusted value');
    // A sensitive Jenkins default remains inside Jenkins. Omitting it from the
    // request applies that default without copying it into backend logs/memory.
    if (!sensitive) body.append(name, typeof value === 'boolean' ? String(value) : String(value));
    audit.push({ name, source: overridden ? 'PROJECT_ALLOWED_OVERRIDE' : 'JENKINS_DEFAULT', sensitive });
  }
  return { body, audit };
}

export function selectJenkinsTriggerEndpoint(parameterized: boolean): 'build' | 'buildWithParameters' {
  return parameterized ? 'buildWithParameters' : 'build';
}

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
    return sanitizeEntityProject(incident);
  }

  async findAll(projectId?: string, status?: string, size?: number) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    const validStatuses = ["pending","analyzing","analyzed","fix_generated","validating","approved","completed","blocked","failed","rejected"];
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

  async convergence(projectId: string) {
    const incidents = await this.repo.find({ where: { projectId }, order: { createdAt: 'ASC' } });
    return { projectId, cycles: buildConvergenceCycles(incidents) };
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
    // Seul le PUT qui reporte explicitement une errorReason passe par le
    // helper (normalise errorDetail/errorStep à null si absents) — un
    // update normal (statut, prUrl, metadata...) sans errorReason n'est pas
    // touché, comportement identique à avant.
    const payload = (dto as any).errorReason
      ? {
          ...dto,
          ...writeErrorToEntity({
            reason: (dto as any).errorReason,
            detail: (dto as any).errorDetail,
            step: (dto as any).errorStep,
          }),
        }
      : dto;
    await this.repo.update(id, payload);
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
    const incident = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!incident) throw new NotFoundException('Incident not found');
    const currentMeta = (incident as any).metadata || {};
    const fixRequest = currentMeta.fixRequest || {};
    const canonicalRepo = (value: string) => String(value || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').toLowerCase();
    const repository = canonicalRepo(validation.repository);
    const projectRepository = canonicalRepo(incident.project?.githubRepo);
    if (!validation.projectId || validation.projectId !== incident.projectId) throw new BadRequestException('Validation project correlation mismatch');
    if (!validation.fixRequestId || validation.fixRequestId !== fixRequest.requestId) throw new ConflictException('Validation fix request correlation mismatch');
    if (!repository || repository !== projectRepository) throw new ConflictException('Validation repository correlation mismatch');
    const prNumber = Number(validation.prNumber);
    if (!Number.isInteger(prNumber) || prNumber <= 0 || !String(incident.prUrl || '').toLowerCase().includes(`${repository}/pull/${prNumber}`)) {
      throw new ConflictException('Validation PR correlation mismatch');
    }
    const buildNumber = Number(validation.buildNumber ?? validation.build?.buildNumber);
    if (!Number.isInteger(buildNumber) || buildNumber <= Number(incident.buildNumber || 0)) throw new ConflictException('Validation build is not newer than the incident build');
    if (validation.jenkinsJob !== incident.jenkinsJobName) throw new ConflictException('Validation Jenkins job correlation mismatch');
    const jenkinsStatus = String(validation.jenkinsStatus ?? validation.build?.status ?? '').toUpperCase();
    const sonarStatus = String(validation.sonarStatus ?? validation.sonarQualityGate?.status ?? '').toUpperCase();
    const badStage = (validation.requiredStages || []).find((s: any) => s.required !== false && s.status !== 'PASSED' && !(s.status === 'WARNING' && !s.blocking));
    const correlationVerified = validation.correlationVerified === true && validation.sonarCorrelationVerified === true;
    const passed = jenkinsStatus === 'SUCCESS' && sonarStatus === 'OK' && correlationVerified && !badStage;
    const validationRecord = {
      ...validation, passed, validationStatus: passed ? 'VALIDATED' : 'FAILED', projectId: incident.projectId,
      incidentId: incident.id, fixRequestId: fixRequest.requestId, repository, prNumber, buildNumber,
      jenkinsStatus, sonarStatus, correlationVerified, validatedAt: new Date().toISOString(),
      failureReasons: [jenkinsStatus !== 'SUCCESS' ? `Jenkins=${jenkinsStatus || 'MISSING'}` : null,
        sonarStatus !== 'OK' ? `Sonar=${sonarStatus || 'MISSING'}` : null,
        !correlationVerified ? 'Sonar/build correlation unverified' : null,
        badStage ? `${badStage.stage}=${badStage.status}` : null].filter(Boolean),
    };
    const previousCycles = Array.isArray(currentMeta.cycles) ? currentMeta.cycles : [];
    const cycles = [...previousCycles, {
      cycle: previousCycles.length + 1, sourceBuildNumber: incident.buildNumber, validationBuildNumber: buildNumber,
      incidentId: incident.id, findingId: fixRequest.findingId || null, fixRequestId: fixRequest.requestId,
      repository, prNumber, prUrl: incident.prUrl, status: passed ? 'PASSED' : 'FAILED',
      blockingCount: validation.unresolvedBlockingCount ?? null, startedAt: fixRequest.approvedAt || incident.createdAt,
      completedAt: validationRecord.validatedAt,
    }];
    const mergedMeta = {
      ...currentMeta,
      validation: validationRecord,
      cycles,
      fixRequest: { ...fixRequest, status: passed ? 'VALIDATED' : 'FIX_FAILED', validationBuildNumber: buildNumber },
    };

    const newStatus = passed ? 'completed' : 'failed';

    await this.repo.update(id, {
      metadata: mergedMeta,
      status: newStatus as IncidentStatus,
    } as any);

    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { ...updated, validation: validationRecord };
  }

  private assertCanApprove(user: any) {
    if (!user || !['admin', 'developer'].includes(String(user.role || '').toLowerCase())) {
      throw new ForbiddenException('User is not authorized to approve fixes for this project');
    }
  }

  private collectFindings(incident: any): any[] {
    const enriched = incident?.metadata?.enrichedData || {};
    const stageFindings = Object.values(enriched.stages || {}).flatMap((stage: any) =>
      Array.isArray(stage?.findings) ? stage.findings : []
    );
    const scannerFindings = [
      ...(enriched.sonar?.issues || []), ...(enriched.trivy?.cves || []),
      ...(enriched.owasp?.cves || []), ...(enriched.zap?.alerts || []),
    ];
    let guide: any = {};
    try { guide = typeof incident.aiAnalysis === 'string' ? JSON.parse(incident.aiAnalysis) : (incident.aiAnalysis || {}); } catch {}
    return [...stageFindings, ...scannerFindings, ...(guide?.developerGuide?.issues || [])];
  }

  private resolveApprovalContext(incident: any, findingId?: string) {
    const findings = this.collectFindings(incident);
    const selected = findingId
      ? findings.find((f: any) => String(f.id || f.key) === String(findingId))
      : findings.find((f: any) => f.remediationType === 'AUTO_FIX_ELIGIBLE' || f.resolution === 'AUTO');
    if (!selected) throw new BadRequestException('No AUTO_FIX_ELIGIBLE remediation finding is available');
    const remediationType = selected.remediationType || (selected.resolution === 'AUTO' ? 'AUTO_FIX_ELIGIBLE' : null);
    if (remediationType !== 'AUTO_FIX_ELIGIBLE') throw new BadRequestException('Finding requires developer action and cannot start an automatic workflow');
    const source = String(selected.source || '').toUpperCase();
    const stage = String(selected.stage || '').toLowerCase();
    const workflow = source === 'SONARQUBE' || stage === 'sonar' || stage === 'code' ? 'WF2'
      : source === 'JENKINS' || stage === 'jenkins' || stage === 'jenkinsfile' ? 'WF4'
      : source === 'DOCKER' || stage === 'docker' || stage === 'dockerfile' ? 'WF5' : null;
    if (!workflow) throw new BadRequestException('No specialized workflow is defined for this finding source');
    return { finding: selected, workflow };
  }

  private workflowUrl(workflow: string): string {
    const base = process.env.N8N_URL || 'http://n8n:5678';
    const paths: Record<string, string> = {
      WF2: process.env.N8N_WF2_WEBHOOK || `${base}/webhook/wf2-approve`,
      WF4: process.env.N8N_WF4_APPLY_WEBHOOK || `${base}/webhook/jenkinsfile-apply`,
      WF5: process.env.N8N_WF5_APPLY_WEBHOOK || `${base}/webhook/dockerfile-apply`,
    };
    return paths[workflow];
  }

  private async githubContext(project: Project, filePath: string) {
    const repoPath = String(project.githubRepo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    const [owner, repo] = repoPath.split('/').filter(Boolean);
    if (!owner || !repo) throw new Error('Project repository is not configured');
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'DevSecOps-Platform' };
    if (project.githubToken) headers.Authorization = `Bearer ${project.githubToken}`;
    const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!meta.ok) throw new Error(`Repository metadata unavailable (HTTP ${meta.status})`);
    const defaultBranch = String((await meta.json() as any).default_branch || '');
    if (!defaultBranch) throw new Error('Repository default branch is unavailable');
    const file = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(defaultBranch)}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!file.ok) throw new Error(`${filePath} unavailable (HTTP ${file.status})`);
    const raw: any = await file.json();
    const content = Buffer.from(String(raw.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
    if (!content.trim()) throw new Error(`${filePath} is empty`);
    return { owner, repo, defaultBranch, content };
  }

  async approveFix(id: string, user: any, body: { findingId?: string } = {}) {
    this.assertCanApprove(user);
    const claim = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, relations: ['project'], lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident not found');
      if (!incident.project) throw new BadRequestException('Incident project not found');
      if (incident.prUrl) throw new ConflictException('A Pull Request already exists for this incident');
      if ([IncidentStatus.COMPLETED, IncidentStatus.APPROVED, IncidentStatus.VALIDATING].includes(incident.status)) {
        throw new ConflictException(`Incident status ${incident.status} does not allow a new fix request`);
      }
      const current = (incident.metadata as any)?.fixRequest;
      if (current && ['APPROVAL_REQUESTED', 'FIX_STARTING', 'PR_CREATED'].includes(current.status)) {
        throw new ConflictException('A fix request is already in progress');
      }
      const { finding, workflow } = this.resolveApprovalContext(incident, body.findingId);
      const requestId = randomUUID();
      const metadata = { ...(incident.metadata || {}), fixRequest: {
        requestId, status: 'FIX_STARTING', workflow, findingId: finding.id || finding.key || null,
        approvedBy: user.id, approvedAt: new Date().toISOString(), lastError: null,
      }, cycles: Array.isArray((incident.metadata as any)?.cycles) ? (incident.metadata as any).cycles : [] };
      await repo.update(id, { metadata } as any);
      return { incident, finding, workflow, requestId, metadata };
    });

    const project = claim.incident.project as Project;
    const payload: any = {
      incidentId: id, projectId: project.id, findingId: claim.finding.id || claim.finding.key || null,
      stage: claim.finding.stage || null, source: claim.finding.source || null,
      remediationType: 'AUTO_FIX_ELIGIBLE', requestId: claim.requestId,
      approvedBy: { id: user.id, role: user.role },
      finding: claim.finding,
      repository: project.githubRepo,
      defaultBranch: (claim.incident.metadata as any)?.defaultBranch || null,
    };
    try {
      if (claim.workflow === 'WF4') {
        const ctx = await this.githubContext(project, 'Jenkinsfile');
        Object.assign(payload, { owner: ctx.owner, repo: ctx.repo, baseBranch: ctx.defaultBranch, filePath: 'Jenkinsfile', originalJenkinsfile: ctx.content,
          retained: [{ ref: payload.findingId, title: claim.finding.title || claim.finding.message || payload.findingId, recommendation: claim.finding.recommendation || '' }], excluded: [] });
      } else if (claim.workflow === 'WF5') {
        const ctx = await this.githubContext(project, 'Dockerfile');
        Object.assign(payload, { owner: ctx.owner, repo: ctx.repo, baseBranch: ctx.defaultBranch, filePath: 'Dockerfile', dockerfile: ctx.content, findings: [claim.finding], context: {} });
      }
      const response = await fetch(this.workflowUrl(claim.workflow), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
    } catch (err: any) {
      const metadata = { ...claim.metadata, fixRequest: { ...claim.metadata.fixRequest, status: 'FIX_FAILED', lastError: err?.message || 'Workflow unavailable', failedAt: new Date().toISOString() } };
      await this.repo.update(id, { metadata } as any);
      throw new ServiceUnavailableException({ code: 'FIX_WORKFLOW_UNAVAILABLE', message: 'The correction workflow could not be started; retry is allowed' });
    }
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, status: 'FIX_STARTING', incidentId: id, requestId: claim.requestId, workflow: claim.workflow };
  }

  async rejectFix(id: string, user: any, body: { reason?: string } = {}) {
    this.assertCanApprove(user);
    const incident = await this.findOne(id);
    if (incident.prUrl) throw new ConflictException('A Pull Request already exists for this incident');
    const metadata = { ...(incident.metadata || {}), fixRequest: {
      ...((incident.metadata as any)?.fixRequest || {}), status: 'REJECTED', rejectedBy: user.id,
      rejectedAt: new Date().toISOString(), rejectionReason: body.reason || null,
    }};
    await this.repo.update(id, { status: 'rejected' as IncidentStatus, metadata });
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, status: 'rejected', incidentId: id };
  }


  async triggerBuild(projectId: string) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project || !project.jenkinsToken) {
      throw new BadRequestException({ success: false, code: 'JENKINS_NOT_CONFIGURED', message: 'Jenkins non configuré pour ce projet' });
    }
    const jenkinsUrl = project.jenkinsUrl || 'http://172.31.172.61:8082';
    const separator = project.jenkinsToken.indexOf(':');
    if (separator <= 0 || separator === project.jenkinsToken.length - 1) {
      throw new BadRequestException({ success: false, code: 'JENKINS_NOT_CONFIGURED', message: 'Credential Jenkins invalide' });
    }
    const user = project.jenkinsToken.slice(0, separator);
    const token = project.jenkinsToken.slice(separator + 1);
    const authHeader = 'Basic ' + Buffer.from(user + ':' + token).toString('base64');
    const request = async (url: string, init: RequestInit = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try { return await fetch(url, { ...init, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    };
    const throwJenkinsFailure = (status: number) => {
      const result = classifyJenkinsTriggerStatus(status);
      const body = { success: false, code: result.code, message: `Jenkins a refusé la requête (${status})` };
      if (result.code === 'JENKINS_JOB_NOT_FOUND') throw new NotFoundException(body);
      if (result.code === 'JENKINS_TRIGGER_CONFLICT') throw new ConflictException(body);
      if (result.code === 'JENKINS_UNAVAILABLE') throw new ServiceUnavailableException(body);
      throw new BadGatewayException(body);
    };
    try {
      const requestedJobPath = project.jenkinsJobPath || project.jenkinsJobName;
      let resolvedJobPath: string;
      try {
        resolvedJobPath = resolveJenkinsJobPath(requestedJobPath);
      } catch {
        throw new BadRequestException({
          success: false,
          code: 'JENKINS_JOB_PATH_INVALID',
          message: 'Chemin du job Jenkins invalide',
        });
      }
      const metadataTree = 'name,fullName,buildable,_class,property[_class,parameterDefinitions[name,type,_class,defaultParameterValue[value,_class]]]';
      const metadataRes = await request(jenkinsUrl + resolvedJobPath + '/api/json?tree=' + metadataTree, {
        headers: { 'Authorization': authHeader },
      });
      if (!metadataRes.ok) throwJenkinsFailure(metadataRes.status);
      const metadata: any = await metadataRes.json();
      if (!isConcreteJenkinsBuildJob(metadata)) {
        throw new BadRequestException({
          success: false,
          code: 'JENKINS_TARGET_NOT_BUILDABLE',
          message: 'La cible Jenkins configurée n’est pas un job de build concret',
        });
      }
      const parameterDefinitions = getJenkinsParameterDefinitions(metadata);
      let resolvedParameters: ReturnType<typeof resolveJenkinsParameters>;
      try {
        // No Angular/user input is accepted here. Project overrides can be
        // added only through an explicit server-side allow-list in the future.
        resolvedParameters = resolveJenkinsParameters(parameterDefinitions, {});
      } catch {
        throw new BadRequestException({
          success: false,
          code: 'JENKINS_PARAMETERS_INVALID',
          message: 'Les paramètres Jenkins ne peuvent pas être résolus de manière sûre',
        });
      }
      const triggerEndpoint = selectJenkinsTriggerEndpoint(parameterDefinitions.length > 0);
      const crumbRes = await request(jenkinsUrl + '/crumbIssuer/api/json', {
        headers: { 'Authorization': authHeader },
      });
      if (!crumbRes.ok) throwJenkinsFailure(crumbRes.status);
      const crumbData: any = await crumbRes.json();
      if (!crumbData?.crumbRequestField || !crumbData?.crumb) {
        throw new BadGatewayException({ success: false, code: 'JENKINS_CRUMB_INVALID', message: 'Réponse CSRF Jenkins invalide' });
      }
      const buildRes = await request(jenkinsUrl + resolvedJobPath + '/' + triggerEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          [crumbData.crumbRequestField]: crumbData.crumb,
          ...(parameterDefinitions.length > 0 ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(parameterDefinitions.length > 0 ? { body: resolvedParameters.body.toString() } : {}),
      });
      const classification = classifyJenkinsTriggerStatus(buildRes.status);
      if (!classification.accepted) throwJenkinsFailure(buildRes.status);
      const queueUrl = buildRes.headers.get('location');
      if (!isAcceptedJenkinsBuildResponse(buildRes.status, queueUrl)) {
        throw new BadGatewayException({
          success: false,
          code: 'JENKINS_TRIGGER_NOT_ACCEPTED',
          message: 'Jenkins n’a pas fourni de référence de queue pour un build concret',
        });
      }
      const queueId = Number(queueUrl!.match(/\/queue\/item\/(\d+)\/?$/)?.[1]);
      return {
        success: true,
        status: buildRes.status,
        job: project.jenkinsJobName,
        requestedJobPath,
        resolvedJobPath,
        queueUrl,
        queueId: Number.isInteger(queueId) ? queueId : null,
        triggerMode: triggerEndpoint,
        parameters: resolvedParameters.audit,
      };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      const timeout = err?.name === 'AbortError';
      throw new ServiceUnavailableException({
        success: false,
        code: timeout ? 'JENKINS_TIMEOUT' : 'JENKINS_UNAVAILABLE',
        message: timeout ? 'Délai Jenkins dépassé' : 'Jenkins indisponible',
      });
    }
  }
}
