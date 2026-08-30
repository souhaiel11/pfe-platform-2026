// incidents.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, ServiceUnavailableException, BadGatewayException, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident, IncidentStatus } from './incident.entity';
import { IncidentsGateway } from './incidents.gateway';
import { Project } from '../projects/project.entity';
import { sanitizeEntityProject } from '../common/sanitize-project';
import { writeErrorToEntity } from '../common/workflow-error';
import { createHash, randomUUID } from 'crypto';
import { buildConvergenceCycles } from '../common/governance';
import { ManualRemediationService } from '../manual-remediation/manual-remediation.service';

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

export type RemediationWorkflow = 'WF2' | 'WF4' | 'WF5';

export type WorkflowBatchStatus = 'FAILED' | 'PR_CREATED';

export type WorkflowBatchStatusInput = {
  status: WorkflowBatchStatus;
  workflowId: string;
  executionId: string;
  incidentId: string;
  requestId: string;
  batchId: string;
  batchKey: string;
  attemptCount: number;
  failureCode?: string;
  failureSummary?: string;
  failureNode?: string;
  prUrl?: string;
  prNumber?: number;
  completenessPassed?: boolean;
  processedFindingIds?: string[];
  updatedFiles?: string[];
  commitShas?: string[];
  prHeadSha?: string;
  completionEvidence?: Record<string, unknown>;
  reconciliation?: boolean;
};

export function remediationWorkflowFor(finding: any): RemediationWorkflow | null {
  const source = String(finding?.source || '').toUpperCase();
  const stage = String(finding?.stage || '').toLowerCase();
  return source === 'SONARQUBE' || stage === 'sonar' || stage === 'code' ? 'WF2'
    : source === 'JENKINS' || stage === 'jenkins' || stage === 'jenkinsfile' ? 'WF4'
    : source === 'DOCKER' || stage === 'docker' || stage === 'dockerfile' ? 'WF5' : null;
}

export function remediationBatchIdentity(incidentId: string, findingIds: string[]): string {
  return createHash('sha256').update(`${incidentId}\n${[...new Set(findingIds)].sort().join('\n')}`).digest('hex');
}

export function resolveRemediationBatch(allFindings: any[], requestedIds: string[]) {
  const findingIds = [...new Set((requestedIds || []).map(String).map(v => v.trim()).filter(Boolean))].sort();
  if (!findingIds.length) throw new BadRequestException('Au moins un identifiant technique findingId exact est requis.');
  const byId = new Map<string, any>();
  for (const finding of allFindings) {
    const id = String(finding?.id || finding?.key || '').trim();
    if (id && !byId.has(id)) byId.set(id, finding);
  }
  const missing = findingIds.filter(id => !byId.has(id));
  if (missing.length) throw new BadRequestException('Un ou plusieurs problèmes sélectionnés n’appartiennent pas à cet incident.');
  const findings = findingIds.map(id => byId.get(id));
  for (const finding of findings) {
    const remediationType = finding.remediationType || (finding.resolution === 'AUTO' ? 'AUTO_FIX_ELIGIBLE' : null);
    if (remediationType !== 'AUTO_FIX_ELIGIBLE') throw new BadRequestException('Tous les problèmes sélectionnés doivent être éligibles à une correction automatisable.');
  }
  const routes = [...new Set(findings.map(remediationWorkflowFor))];
  if (routes.length !== 1 || !routes[0]) throw new BadRequestException('Tous les problèmes sélectionnés doivent utiliser la même stratégie de correction spécialisée.');
  if (findings.length > 1 && routes[0] !== 'WF2') throw new BadRequestException('La correction groupée de plusieurs problèmes est actuellement disponible uniquement pour SonarQube.');
  return { findingIds, findings, workflow: routes[0] as RemediationWorkflow };
}

export function workflowFinding(finding: any) {
  return {
    findingId: String(finding?.id || finding?.key),
    rule: finding?.rule || finding?.ruleKey || null,
    severity: finding?.severity || null,
    type: finding?.type || finding?.category || null,
    source: finding?.source || null,
    stage: finding?.stage || null,
    file: finding?.file || finding?.component || null,
    line: finding?.line ?? null,
    message: finding?.message || finding?.title || null,
    evidence: finding?.evidence || null,
    recommendation: finding?.recommendation || null,
    remediationType: 'AUTO_FIX_ELIGIBLE',
  };
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly repo: Repository<Incident>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly gateway: IncidentsGateway,
    private readonly manualRemediation: ManualRemediationService,
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
    if (!i) throw new NotFoundException('Incident introuvable.');
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
    await this.manualRemediation.syncIncident(saved);
    this.gateway.emit('incident:created', saved);
    return saved;
  }

  async update(id: string, dto: Partial<Incident>) {
    // Seul le PUT qui reporte explicitement une errorReason passe par le
    // helper (normalise errorDetail/errorStep à null si absents) — un
    // update normal (statut, prUrl, metadata...) sans errorReason n'est pas
    // touché, comportement identique à avant.
    let payload: any = (dto as any).errorReason
      ? {
          ...dto,
          ...writeErrorToEntity({
            reason: (dto as any).errorReason,
            detail: (dto as any).errorDetail,
            step: (dto as any).errorStep,
          }),
        }
      : dto;
    if ((dto as any).prUrl && (dto as any).status === IncidentStatus.FIX_GENERATED) {
      const current = await this.repo.findOne({ where: { id } });
      if (!current) throw new NotFoundException('Incident introuvable.');
      const metadata = current.metadata || {};
      payload = { ...payload, metadata: { ...metadata, fixRequest: {
        ...((metadata as any).fixRequest || {}), status: 'PR_CREATED', prUrl: (dto as any).prUrl, prCreatedAt: new Date().toISOString(),
      } } };
    }
    await this.repo.update(id, payload);
    const updated = await this.findOne(id);
    await this.manualRemediation.syncIncident(updated as Incident);
    this.gateway.emit('incident:updated', updated);
    return updated;
  }

  /**
   * Transition canonique appelée par WF2, et par la procédure contrôlée de
   * réconciliation. Toutes les données de corrélation sont validées sous le
   * verrou de l'incident. Aucun callback ne peut créer un nouveau batch.
   */
  async saveWorkflowBatchStatus(id: string, input: WorkflowBatchStatusInput) {
    const result = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const metadata: any = incident.metadata || {};
      const fix: any = metadata.fixRequest || {};
      const attemptCount = Number(input.attemptCount);
      const executionId = String(input.executionId || '').trim();
      const workflowId = String(input.workflowId || '').trim();
      if (input.incidentId !== id || fix.requestId !== input.requestId
        || fix.batchId !== input.batchId || input.batchKey !== input.batchId
        || fix.batchId !== input.batchKey || fix.workflow !== 'WF2'
        || workflowId !== (process.env.N8N_WF2_ID || '9adcV31eaIgJyMR0')
        || !Number.isInteger(attemptCount) || attemptCount !== Number(fix.attemptCount)
        || !executionId) {
        throw new ConflictException('Le statut WF2 ne correspond pas à la demande de correction active.');
      }

      const attempt = (Array.isArray(fix.attempts) ? fix.attempts : [])
        .find((entry: any) => Number(entry.attempt) === attemptCount);
      if (!attempt) throw new ConflictException('La tentative WF2 corrélée est introuvable.');
      if (attempt.workflowExecutionId && String(attempt.workflowExecutionId) !== executionId) {
        throw new ConflictException('L’exécution WF2 ne correspond pas à la tentative active.');
      }

      const callbackStatus = String(input.status || '').toUpperCase() as WorkflowBatchStatus;
      if (!['FAILED', 'PR_CREATED'].includes(callbackStatus)) {
        throw new BadRequestException('Statut de workflow non pris en charge.');
      }
      const now = new Date().toISOString();
      const events = Array.isArray(fix.workflowEvents) ? [...fix.workflowEvents] : [];
      const eventIdentity = `${workflowId}:${executionId}:${callbackStatus}`;
      if (events.some((event: any) => event.identity === eventIdentity)) {
        return { applied: false, duplicate: true, stale: false, incident, status: fix.status };
      }

      const incompleteReconciliation = input.reconciliation === true
        && String(input.failureCode || '') === 'WF2_BATCH_INCOMPLETE'
        && fix.status === 'PR_CREATED';
      // Une erreur tardive ne peut pas dégrader une PR, sauf réconciliation
      // applicative auditée prouvant que le batch était fonctionnellement incomplet.
      if (callbackStatus === 'FAILED' && ['PR_CREATED', 'VALIDATING', 'VALIDATED'].includes(fix.status)
        && !incompleteReconciliation) {
        return { applied: false, duplicate: false, stale: true, incident, status: fix.status };
      }
      if (callbackStatus === 'PR_CREATED' && fix.status !== 'DISPATCHED') {
        return { applied: false, duplicate: false, stale: true, incident, status: fix.status };
      }
      if (callbackStatus === 'FAILED' && !['FIX_STARTING', 'DISPATCHED'].includes(fix.status)
        && !incompleteReconciliation) {
        return { applied: false, duplicate: false, stale: true, incident, status: fix.status };
      }

      const normalize = (values: unknown): string[] => [...new Set(Array.isArray(values)
        ? values.map(String).map(value => value.trim()).filter(Boolean) : [])].sort();
      const expectedFindingIds = normalize(fix.findingIds);
      const expectedFiles = normalize((Array.isArray(fix.findings) ? fix.findings : [])
        .map((finding: any) => finding.file || finding.component));
      const processedFindingIds = normalize(input.processedFindingIds);
      const updatedFiles = normalize(input.updatedFiles);
      const commitShas = normalize(input.commitShas);
      if (callbackStatus === 'PR_CREATED') {
        const exactFindings = JSON.stringify(processedFindingIds) === JSON.stringify(expectedFindingIds);
        const exactFiles = JSON.stringify(updatedFiles) === JSON.stringify(expectedFiles);
        if (input.completenessPassed !== true || !exactFindings || !exactFiles
          || commitShas.length < expectedFiles.length || !/^[a-f0-9]{40}$/i.test(String(input.prHeadSha || ''))) {
          throw new ConflictException('La Pull Request WF2 ne couvre pas exactement le batch approuvé.');
        }
      }

      const attempts = fix.attempts.map((entry: any) => Number(entry.attempt) === attemptCount
        ? callbackStatus === 'FAILED'
          ? { ...entry, status: 'FIX_FAILED', workflowId, workflowExecutionId: executionId, failedAt: now,
              failureCode: String(input.failureCode || 'WF2_EXECUTION_ERROR').slice(0, 80),
              failureSummary: String(input.failureSummary || 'Erreur d’exécution WF2').slice(0, 500),
              failureNode: String(input.failureNode || '').slice(0, 120) || null }
          : { ...entry, status: 'PR_CREATED', workflowId, workflowExecutionId: executionId, prCreatedAt: now }
        : entry);
      events.push({
        identity: eventIdentity, workflowId, executionId, attempt: attemptCount,
        status: callbackStatus, recordedAt: now,
        source: input.reconciliation ? 'RECONCILIATION' : 'WF2_CALLBACK',
      });
      const nextFix = callbackStatus === 'FAILED'
        ? { ...fix, status: 'FIX_FAILED', attempts, workflowEvents: events, failedAt: now,
            lastErrorCode: String(input.failureCode || 'WF2_EXECUTION_ERROR').slice(0, 80),
            lastError: String(input.failureSummary || 'Erreur d’exécution WF2').slice(0, 500),
            failedNode: String(input.failureNode || '').slice(0, 120) || null,
            workflowId, workflowExecutionId: executionId,
            completionEvidence: input.completionEvidence || fix.completionEvidence || null,
            retryEligible: true }
        : { ...fix, status: 'PR_CREATED', attempts, workflowEvents: events, prUrl: input.prUrl,
            prNumber: Number(input.prNumber), prCreatedAt: now, workflowId, workflowExecutionId: executionId,
            completenessPassed: true, processedFindingIds, updatedFiles, commitShas,
            prHeadSha: String(input.prHeadSha), retryEligible: false };
      const patch: any = { metadata: { ...metadata, fixRequest: nextFix } };
      if (callbackStatus === 'PR_CREATED') {
        if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/i.test(String(input.prUrl || ''))
          || !Number.isInteger(Number(input.prNumber)) || Number(input.prNumber) <= 0) {
          throw new BadRequestException('La Pull Request WF2 est invalide.');
        }
        patch.prUrl = input.prUrl;
        patch.status = IncidentStatus.FIX_GENERATED;
      }
      await repo.update(id, patch);
      Object.assign(incident, patch);
      return { applied: true, duplicate: false, stale: false, incident, status: nextFix.status };
    });
    if (result.applied) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
    }
    return { success: true, applied: result.applied, duplicate: result.duplicate, stale: result.stale,
      incidentId: id, status: result.status };
  }

  async remove(id: string) {
    const i = await this.findOne(id);
    await this.repo.remove(i);
    return { message: 'Incident supprimé.' };
  }

  async saveValidation(id: string, validation: any) {
    const incident = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!incident) throw new NotFoundException('Incident introuvable.');
    const currentMeta = (incident as any).metadata || {};
    const fixRequest = currentMeta.fixRequest || {};
    const canonicalRepo = (value: string) => String(value || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').toLowerCase();
    const repository = canonicalRepo(validation.repository);
    const projectRepository = canonicalRepo(incident.project?.githubRepo);
    if (!validation.projectId || validation.projectId !== incident.projectId) throw new BadRequestException('La validation ne correspond pas au projet de l’incident.');
    if (!validation.fixRequestId || validation.fixRequestId !== fixRequest.requestId) throw new ConflictException('La validation ne correspond pas à la demande de correction.');
    if (!repository || repository !== projectRepository) throw new ConflictException('La validation ne correspond pas au dépôt du projet.');
    const prNumber = Number(validation.prNumber);
    if (!Number.isInteger(prNumber) || prNumber <= 0 || !String(incident.prUrl || '').toLowerCase().includes(`${repository}/pull/${prNumber}`)) {
      throw new ConflictException('La validation ne correspond pas à la Pull Request attendue.');
    }
    const buildNumber = Number(validation.buildNumber ?? validation.build?.buildNumber);
    if (!Number.isInteger(buildNumber) || buildNumber <= Number(incident.buildNumber || 0)) throw new ConflictException('Le build de validation doit être plus récent que celui de l’incident.');
    if (validation.jenkinsJob !== incident.jenkinsJobName) throw new ConflictException('La validation ne correspond pas au job Jenkins attendu.');
    const jenkinsStatus = String(validation.jenkinsStatus ?? validation.build?.status ?? '').toUpperCase();
    const sonarStatus = String(validation.sonarStatus ?? validation.sonarQualityGate?.status ?? '').toUpperCase();
    const badStage = (validation.requiredStages || []).find((s: any) => s.required !== false && s.status !== 'PASSED' && !(s.status === 'WARNING' && !s.blocking));
    const correlationVerified = validation.correlationVerified === true && validation.sonarCorrelationVerified === true;
    const approvedFindingIds: string[] = Array.isArray(fixRequest.findingIds)
      ? [...new Set<string>(fixRequest.findingIds.map((value: any) => String(value)))].sort()
      : (fixRequest.findingId ? [String(fixRequest.findingId)] : []);
    const submittedResults = Array.isArray(validation.findingResults) ? validation.findingResults : [];
    const resultIds = submittedResults.map((r: any) => String(r?.findingId || ''));
    const duplicatedResult = new Set(resultIds).size !== resultIds.length;
    const unexpectedResult = resultIds.some((findingId: string) => !approvedFindingIds.includes(findingId));
    const missingResult = approvedFindingIds.some(findingId => !resultIds.includes(findingId));
    if (fixRequest.batchId && (duplicatedResult || unexpectedResult || missingResult)) {
      throw new BadRequestException('La validation doit contenir exactement un résultat pour chaque problème approuvé.');
    }
    const findingResults = approvedFindingIds.map(findingId => {
      const submitted = submittedResults.find((r: any) => String(r?.findingId) === findingId);
      const result = String(submitted?.result || submitted?.status || 'INCONCLUSIVE').toUpperCase();
      return { findingId, result: ['VALID', 'INVALID', 'INCONCLUSIVE'].includes(result) ? result : 'INCONCLUSIVE', evidence: submitted?.evidence || null };
    });
    const everyFindingValid = !fixRequest.batchId || (findingResults.length > 0 && findingResults.every(r => r.result === 'VALID' && !!r.evidence));
    const hasInvalidFinding = findingResults.some(r => r.result === 'INVALID');
    const passed = jenkinsStatus === 'SUCCESS' && sonarStatus === 'OK' && correlationVerified && !badStage && everyFindingValid;
    const validationStatus = passed ? 'VALIDATED' : (hasInvalidFinding ? 'INVALID' : 'INCONCLUSIVE');
    const validationRecord = {
      ...validation, findingResults, passed, validationStatus, projectId: incident.projectId,
      incidentId: incident.id, fixRequestId: fixRequest.requestId, repository, prNumber, buildNumber,
      jenkinsStatus, sonarStatus, correlationVerified, validatedAt: new Date().toISOString(),
      failureReasons: [jenkinsStatus !== 'SUCCESS' ? `Jenkins=${jenkinsStatus || 'MISSING'}` : null,
        sonarStatus !== 'OK' ? `Sonar=${sonarStatus || 'MISSING'}` : null,
        !correlationVerified ? 'Sonar/build correlation unverified' : null,
        !everyFindingValid ? 'One or more approved findings are invalid or inconclusive' : null,
        badStage ? `${badStage.stage}=${badStage.status}` : null].filter(Boolean),
    };
    const previousCycles = Array.isArray(currentMeta.cycles) ? currentMeta.cycles : [];
    const cycles = [...previousCycles, {
      cycle: previousCycles.length + 1, sourceBuildNumber: incident.buildNumber, validationBuildNumber: buildNumber,
      incidentId: incident.id, findingId: fixRequest.findingId || null, findingIds: approvedFindingIds, fixRequestId: fixRequest.requestId,
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
      throw new ForbiddenException('Vous n’avez pas l’autorisation de demander une correction pour ce projet.');
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
    const unique = new Map<string, any>();
    for (const finding of [...stageFindings, ...scannerFindings, ...(guide?.developerGuide?.issues || [])]) {
      const id = String(finding?.id || finding?.key || '').trim();
      if (id && !unique.has(id)) unique.set(id, finding);
    }
    return [...unique.values()];
  }

  private resolveApprovalContext(incident: any, findingId?: string) {
    const findings = this.collectFindings(incident);
    const selected = findingId
      ? findings.find((f: any) => String(f.id || f.key) === String(findingId))
      : findings.find((f: any) => f.remediationType === 'AUTO_FIX_ELIGIBLE' || f.resolution === 'AUTO');
    if (!selected) throw new BadRequestException('Aucun problème éligible à une correction automatisable n’est disponible.');
    const remediationType = selected.remediationType || (selected.resolution === 'AUTO' ? 'AUTO_FIX_ELIGIBLE' : null);
    if (remediationType !== 'AUTO_FIX_ELIGIBLE') throw new BadRequestException('Ce problème nécessite une intervention humaine et ne peut pas lancer une correction automatique.');
    const source = String(selected.source || '').toUpperCase();
    const stage = String(selected.stage || '').toLowerCase();
    const workflow = source === 'SONARQUBE' || stage === 'sonar' || stage === 'code' ? 'WF2'
      : source === 'JENKINS' || stage === 'jenkins' || stage === 'jenkinsfile' ? 'WF4'
      : source === 'DOCKER' || stage === 'docker' || stage === 'dockerfile' ? 'WF5' : null;
    if (!workflow) throw new BadRequestException('Aucune stratégie de correction spécialisée n’est définie pour cette source.');
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

  async approveFix(id: string, user: any, body: { findingId?: string; findingIds?: string[] } = {}) {
    return this.startFix(id, user, body, false);
  }

  async retryFix(id: string, user: any) {
    return this.startFix(id, user, {}, true);
  }

  private async startFix(id: string, user: any, body: { findingId?: string; findingIds?: string[] }, explicitRetry: boolean) {
    this.assertCanApprove(user);
    const claim = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      // PostgreSQL cannot apply FOR UPDATE to the nullable side of the LEFT
      // JOIN generated by `relations: ['project']`. Lock only the incident
      // row, then resolve its project inside the same transaction.
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const project = await manager.getRepository(Project).findOne({ where: { id: incident.projectId } });
      if (!project) throw new BadRequestException('Le projet associé à cet incident est introuvable.');
      incident.project = project;
      if (incident.prUrl) throw new ConflictException('Une Pull Request existe déjà pour cet incident.');
      if ([IncidentStatus.COMPLETED, IncidentStatus.APPROVED, IncidentStatus.VALIDATING].includes(incident.status)) {
        throw new ConflictException(`L’état actuel de l’incident ne permet pas une nouvelle demande de correction.`);
      }
      const current = (incident.metadata as any)?.fixRequest;
      const legacy = body.findingId ? [body.findingId] : [];
      if (!explicitRetry && body.findingIds !== undefined && !Array.isArray(body.findingIds)) throw new BadRequestException('Le champ technique findingIds doit être une liste.');
      const requestedIds = explicitRetry
        ? (Array.isArray(current?.findingIds) ? current.findingIds.map(String) : (current?.findingId ? [String(current.findingId)] : []))
        : (body.findingIds?.length ? body.findingIds : legacy);
      if (explicitRetry && (current?.status !== 'FIX_FAILED' || current?.retryEligible !== true || !requestedIds.length)) {
        throw new ConflictException('Cette demande de correction ne peut pas être réessayée.');
      }
      // Compatibilité limitée pour les anciens écrans WF4/WF5 : leur appel
      // sans identifiant continue de choisir l’unique première action éligible.
      const fallback = !requestedIds.length ? this.resolveApprovalContext(incident).finding : null;
      const batch = resolveRemediationBatch(this.collectFindings(incident), requestedIds.length ? requestedIds : [fallback.id || fallback.key]);
      const batchId = remediationBatchIdentity(id, batch.findingIds);
      const sameBatch = current?.batchId === batchId || (!current?.batchId && batch.findingIds.length === 1 && current?.findingId === batch.findingIds[0]);
      const currentFindingIds = Array.isArray(current?.findingIds)
        ? current.findingIds.map(String) : (current?.findingId ? [String(current.findingId)] : []);
      const ownsRequestedFinding = batch.findingIds.some(findingId => currentFindingIds.includes(findingId));
      if (!explicitRetry && ownsRequestedFinding) {
        throw new ConflictException('Une demande de correction existe déjà pour ce problème. Utilisez « Réessayer la correction ».');
      }
      if (explicitRetry && !sameBatch) {
        throw new ConflictException('La tentative de correction ne correspond pas au batch existant.');
      }
      if (!explicitRetry && sameBatch && current.status !== 'FIX_FAILED') {
        return { duplicate: true as const, attemptCount: Number(current.attemptCount || 1), incident, requestId: current.requestId, batchId, metadata: incident.metadata, ...batch };
      }
      if (current && ['APPROVAL_REQUESTED', 'FIX_STARTING', 'DISPATCHED', 'PR_CREATED', 'VALIDATING'].includes(current.status)) {
        throw new ConflictException('Une demande de correction incompatible est déjà en cours.');
      }
      const requestId = explicitRetry ? current.requestId : randomUUID();
      const canonicalFindings = batch.findings.map(workflowFinding);
      const attemptCount = explicitRetry ? Number(current.attemptCount || 1) + 1 : 1;
      const authorizedAt = new Date().toISOString();
      const attempts = [
        ...(explicitRetry && Array.isArray(current.attempts) ? current.attempts : []),
        { attempt: attemptCount, status: 'FIX_STARTING', authorizedBy: user.id, authorizedAt },
      ];
      const metadata = { ...(incident.metadata || {}), fixRequest: {
        requestId, batchId, status: 'FIX_STARTING', workflow: batch.workflow,
        findingId: batch.findingIds[0], findingIds: batch.findingIds, findings: canonicalFindings,
        approvedBy: user.id, approvedAt: current?.approvedAt || authorizedAt,
        attemptCount, attempts, lastError: null, failedAt: null, retryEligible: false,
      }, cycles: Array.isArray((incident.metadata as any)?.cycles) ? (incident.metadata as any).cycles : [] };
      await repo.update(id, { metadata } as any);
      return { duplicate: false as const, retry: explicitRetry, attemptCount, incident, requestId, batchId, metadata, ...batch };
    });

    if (claim.duplicate) {
      return { success: true, duplicate: true, status: claim.metadata?.fixRequest?.status, incidentId: id, requestId: claim.requestId, batchId: claim.batchId };
    }

    const project = claim.incident.project as Project;
    const findings = claim.findings.map(workflowFinding);
    const payload: any = {
      incidentId: id, projectId: project.id, findingId: claim.findingIds[0], findingIds: claim.findingIds,
      buildNumber: claim.incident.buildNumber ?? (claim.incident.metadata as any)?.enrichedData?.build?.number ?? null,
      batchKey: claim.batchId, batchId: claim.batchId,
      stage: findings[0].stage, source: findings[0].source,
      remediationType: 'AUTO_FIX_ELIGIBLE', requestId: claim.requestId,
      attemptCount: claim.attemptCount,
      approvedBy: { id: user.id, role: user.role },
      finding: findings[0], findings,
      repository: project.githubRepo,
      defaultBranch: (claim.incident.metadata as any)?.defaultBranch || null,
    };
    try {
      if (claim.workflow === 'WF4') {
        const ctx = await this.githubContext(project, 'Jenkinsfile');
        Object.assign(payload, { owner: ctx.owner, repo: ctx.repo, baseBranch: ctx.defaultBranch, filePath: 'Jenkinsfile', originalJenkinsfile: ctx.content,
          retained: [{ ref: payload.findingId, title: findings[0].message || payload.findingId, recommendation: findings[0].recommendation || '' }], excluded: [] });
      } else if (claim.workflow === 'WF5') {
        const ctx = await this.githubContext(project, 'Dockerfile');
        Object.assign(payload, { owner: ctx.owner, repo: ctx.repo, baseBranch: ctx.defaultBranch, filePath: 'Dockerfile', dockerfile: ctx.content, findings, context: {} });
      }
      const response = await fetch(this.workflowUrl(claim.workflow), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
    } catch (err: any) {
      const failedAt = new Date().toISOString();
      const attempts = (claim.metadata.fixRequest.attempts || []).map((attempt: any) => attempt.attempt === claim.attemptCount
        ? { ...attempt, status: 'FIX_FAILED', failedAt, error: err?.message || 'Workflow unavailable' } : attempt);
      const metadata = { ...claim.metadata, fixRequest: { ...claim.metadata.fixRequest, status: 'FIX_FAILED', attempts, lastError: err?.message || 'Workflow unavailable', failedAt, retryEligible: true } };
      await this.repo.update(id, { metadata } as any);
      throw new ServiceUnavailableException({ code: 'FIX_WORKFLOW_UNAVAILABLE', message: 'La correction n’a pas pu démarrer. Vous pouvez réessayer.' });
    }
    const dispatchedAt = new Date().toISOString();
    await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new NotFoundException('Incident introuvable.');
      const currentMeta: any = current.metadata || {};
      const fix = currentMeta.fixRequest || {};
      // Un callback très rapide peut déjà avoir enregistré FIX_FAILED ou
      // PR_CREATED. L'acquittement HTTP ne doit jamais écraser cet état.
      if (fix.requestId !== claim.requestId || fix.batchId !== claim.batchId
        || Number(fix.attemptCount) !== claim.attemptCount || fix.status !== 'FIX_STARTING') return;
      const attempts = (fix.attempts || []).map((attempt: any) => attempt.attempt === claim.attemptCount
        ? { ...attempt, status: 'DISPATCHED', dispatchedAt } : attempt);
      await repo.update(id, { metadata: { ...currentMeta, fixRequest: { ...fix, status: 'DISPATCHED', attempts, dispatchedAt } } } as any);
    });
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, duplicate: false, status: 'DISPATCHED', incidentId: id, requestId: claim.requestId, batchId: claim.batchId, batchKey: claim.batchId, attemptCount: claim.attemptCount, findingIds: claim.findingIds };
  }

  async rejectFix(id: string, user: any, body: { reason?: string } = {}) {
    this.assertCanApprove(user);
    const incident = await this.findOne(id);
    if (incident.prUrl) throw new ConflictException('Une Pull Request existe déjà pour cet incident.');
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
