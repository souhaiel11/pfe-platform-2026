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
import { resolveJenkinsInternalUrl } from '../common/jenkins-url';
import { ManualRemediationService } from '../manual-remediation/manual-remediation.service';
import { deriveFindingsAndHealth } from '../validation/finding-pipeline-separation';
import { computeMergeAuthorization, deriveRemediationResult, deriveExactCorrelationVerified } from '../validation/merge-authorization';

export function classifyJenkinsTriggerStatus(status: number): { accepted: boolean; code?: string } {
  if (status === 201) return { accepted: true };
  if (status >= 200 && status < 300) return { accepted: false, code: 'JENKINS_TRIGGER_NOT_ACCEPTED' };
  if (status === 401 || status === 403) return { accepted: false, code: 'JENKINS_AUTH_FAILED' };
  if (status === 404) return { accepted: false, code: 'JENKINS_JOB_NOT_FOUND' };
  if (status === 400) return { accepted: false, code: 'JENKINS_TRIGGER_REJECTED' };
  if (status === 409) return { accepted: false, code: 'JENKINS_TRIGGER_CONFLICT' };
  if (status >= 500) return { accepted: false, code: 'JENKINS_UNAVAILABLE' };
  return { accepted: false, code: 'JENKINS_TRIGGER_FAILED' };
}

// R49 — single canonical builder for the PR validation job identity. This
// value is issued to Jenkins once (requestPrValidation), threaded verbatim
// through PFE_VALIDATION_CONTEXT -> Jenkins -> PlatformReporter -> WF1 -> WF3,
// and must match byte-for-byte when saveValidation() re-derives its own
// expectation at write-back time. Proven live on real PR-24 build #3: a
// second, independently-written `/PR-${n}` (missing `/job/`) formula in
// saveValidation() rejected the exact value this function issues, with a 409
// -- Jenkins' own REST job path convention (`/job/<multibranch>/job/PR-<n>`)
// is canonical, not a shortened display form.
export function buildPrValidationJobName(baseJobName: string, prNumber: number): string {
  return `${baseJobName}-multibranch/job/PR-${prNumber}`;
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

// R21-AS — the REST job path (`/job/<a>/job/<b>`) and Jenkins' internal item
// "full name" (`<a>/<b>`, used by Jenkins.instance.getItemByFullName) are two
// different encodings of the same item identity. Deriving the full name from
// an already-`resolveJenkinsJobPath`-validated path (rather than accepting
// one directly from a caller) means the strict segment characters that path
// already enforced apply here too. A second, narrower allowlist is still
// applied, since this value is embedded into a Groovy script string, not
// just a URL.
export function jenkinsWorkflowFullName(resolvedJobPath: string): string {
  const segments = String(resolvedJobPath || '').split('/job/').map(decodeURIComponent).filter(Boolean);
  if (!segments.length || segments.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Invalid Jenkins job path for script targeting');
  }
  return segments.join('/');
}

function escapeGroovySingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// R21-AS — reuses exactly the parameter-injection semantics already present
// in jenkins-config/init.groovy.d/pfe-pr-head-discovery.groovy (add/replace
// only the PFE_VALIDATION_CONTEXT definition, preserving every other existing
// parameter), but scoped to one caller-identified WorkflowJob by exact full
// name, invocable on demand instead of only at Jenkins startup. The script is
// always built internally from a validated job identity -- no caller input
// is ever concatenated into Groovy source beyond that one escaped identifier.
export function buildParameterBootstrapScript(fullName: string): string {
  const safeName = escapeGroovySingleQuoted(fullName);
  return [
    'import jenkins.model.Jenkins',
    'import org.jenkinsci.plugins.workflow.job.WorkflowJob',
    'import hudson.model.ParametersDefinitionProperty',
    'import hudson.model.StringParameterDefinition',
    `def job = Jenkins.instance.getItemByFullName('${safeName}', WorkflowJob.class)`,
    "if (!job) { println 'PFE_BOOTSTRAP_RESULT:JOB_NOT_FOUND'; return }",
    'def existing = job.getProperty(ParametersDefinitionProperty)',
    "def definitions = existing?.parameterDefinitions?.findAll { it.name != 'PFE_VALIDATION_CONTEXT' } ?: []",
    "definitions << new StringParameterDefinition('PFE_VALIDATION_CONTEXT', '', 'Opaque non-secret PR validation correlation supplied by the authenticated platform.')",
    'job.removeProperty(ParametersDefinitionProperty)',
    'job.addProperty(new ParametersDefinitionProperty(definitions))',
    'job.save()',
    "println 'PFE_BOOTSTRAP_RESULT:OK'",
  ].join('\n');
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

export type PrValidationStatus = 'REQUESTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export function prValidationIdentity(projectId: string, prNumber: number, prHeadSha: string, batchId: string): string {
  return createHash('sha256').update(`${projectId}\n${prNumber}\n${prHeadSha.toLowerCase()}\n${batchId}`).digest('hex');
}

export function isFullGitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

// Canonical `owner/repo` form of any GitHub remote (URL or already-canonical
// string). Single source of truth so the reconciler's SHA correlation compares
// Jenkins' git remoteUrls against the project repo exactly as requestPrValidation
// derived it.
export function canonicalGitRepo(value: unknown): string {
  return String(value || '')
    .replace(/^git@github\.com:/, '')
    .replace(/^ssh:\/\/git@github\.com\//, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

// The exact PFE_VALIDATION_CONTEXT string the platform issued to Jenkins
// (encodePrValidationContext -> base64url). Jenkins echoes it back verbatim as a
// build parameter; decoding it is the strongest correlation the Jenkins-only
// reconciler has — it carries the exact validationRequestId.
export function decodeJenkinsValidationContext(rawValue: unknown): any | null {
  if (typeof rawValue !== 'string' || !rawValue) return null;
  for (const encoding of ['base64url', 'base64'] as const) {
    try {
      const parsed = JSON.parse(Buffer.from(rawValue, encoding).toString('utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* try next encoding */ }
  }
  return null;
}

// R72B — deterministic fallback correlation for a stale QUEUED/RUNNING validation
// whose persisted queueId matches no Jenkins build (proven live on PR-24: the
// platform POSTed queue item 1496, but Jenkins' multibranch machinery superseded
// it and the WorkflowRun that actually executed carries queueId 1505). Never
// guesses by "latest build": a build only qualifies when EVERY independent fact
// lines up — terminal, started after the request, exact PR-head SHA on the
// project's own repo (never the shared library), and the exact validationRequestId
// carried in PFE_VALIDATION_CONTEXT. The caller must still reject 0 matches
// (STILL_QUEUED) and >1 matches (CORRELATION_AMBIGUOUS).
export function jenkinsBuildMatchesPrValidation(
  build: any,
  criteria: { expectedPrHeadSha: string; validationRequestId: string; repository: string; notBefore: number },
): boolean {
  if (!build || build.building === true || !build.result) return false;
  if (!Number.isFinite(criteria.notBefore)) return false;
  const timestamp = Number(build.timestamp);
  if (!Number.isFinite(timestamp) || timestamp < criteria.notBefore) return false;
  const expectedSha = String(criteria.expectedPrHeadSha || '').toLowerCase();
  const repository = String(criteria.repository || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expectedSha) || !repository) return false;
  const actions: any[] = Array.isArray(build.actions) ? build.actions : [];
  const shaOnProjectRepo = actions.some((action: any) => {
    if (String(action?.lastBuiltRevision?.SHA1 || '').toLowerCase() !== expectedSha) return false;
    const remotes: any[] = Array.isArray(action?.remoteUrls) ? action.remoteUrls : [];
    return remotes.some((url: any) => canonicalGitRepo(url) === repository);
  });
  if (!shaOnProjectRepo) return false;
  const contexts = actions
    .flatMap((action: any) => (Array.isArray(action?.parameters) ? action.parameters : []))
    .filter((parameter: any) => parameter?.name === 'PFE_VALIDATION_CONTEXT')
    .map((parameter: any) => decodeJenkinsValidationContext(parameter.value))
    .filter(Boolean);
  if (!contexts.length) return false;
  return contexts.every((context: any) =>
    String(context.validationRequestId) === String(criteria.validationRequestId)
    && String(context.expectedPrHeadSha || '').toLowerCase() === expectedSha);
}

export function encodePrValidationContext(context: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(context)).toString('base64url');
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
  candidateAcceptedFindingIds?: string[];
  candidateVerifiedFiles?: string[];
  plannedFiles?: string[];
  effectiveRemediatedFindingIds?: string[];
  verifiedFiles?: string[];
  fileResults?: Array<Record<string, unknown>>;
  updatedFiles?: string[];
  commitShas?: string[];
  prHeadSha?: string;
  completionEvidence?: Record<string, unknown>;
  reconciliation?: boolean;
};

export type StaleDispatchRecoveryInput = {
  batchId: string;
  attemptCount: number;
};

export function canRetryFixRequest(fixRequest: any): boolean {
  if (fixRequest?.status !== 'FIX_FAILED' || fixRequest?.retryEligible !== true) return false;
  const attemptCount = Number(fixRequest.attemptCount);
  if (!Number.isInteger(attemptCount) || attemptCount < 1) return false;
  const attempts = Array.isArray(fixRequest.attempts) ? fixRequest.attempts : [];
  const currentAttempt = attempts.find((attempt: any) => Number(attempt.attempt) === attemptCount);
  if (!currentAttempt || currentAttempt.status !== 'FIX_FAILED') return false;
  return !attempts.some((attempt: any) => Number(attempt.attempt) > attemptCount
    && ['FIX_STARTING', 'DISPATCHED', 'PR_CREATED', 'VALIDATING'].includes(String(attempt.status)));
}

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

  private canonicalRepository(value: string): string {
    return canonicalGitRepo(value);
  }

  private async githubPullRequest(project: Project, prNumber: number): Promise<any> {
    const repository = this.canonicalRepository(project.githubRepo);
    if (!repository || repository.split('/').length !== 2) {
      throw new BadRequestException('GitHub n’est pas configuré pour valider cette Pull Request.');
    }
    // Une remédiation historique peut avoir un dépôt GitHub public canonique
    // sans jeton persisté sur le projet. La vérité distante d'une PR publique
    // reste vérifiable en lecture seule : le jeton est utilisé lorsqu'il existe,
    // mais son absence ne remplace jamais les contrôles exacts état/branche/SHA.
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pfe-pr-validation',
    };
    if (project.githubToken) headers.Authorization = `Bearer ${project.githubToken}`;
    const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${prNumber}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new BadGatewayException('La Pull Request ne peut pas être vérifiée auprès de GitHub.');
    }
    return response.json();
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
        || !Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > Number(fix.attemptCount)
        || !executionId) {
        throw new ConflictException('Le statut WF2 ne correspond pas à la demande de correction active.');
      }

      const attempt = (Array.isArray(fix.attempts) ? fix.attempts : [])
        .find((entry: any) => Number(entry.attempt) === attemptCount);
      if (!attempt) throw new ConflictException('La tentative WF2 corrélée ne correspond pas à la demande active.');

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
      // R21-AE — a callback belongs to exactly one attempt. Once another
      // human-authorized attempt exists, or once this attempt has reached a
      // terminal state (including governed stale-dispatch recovery), it can
      // never mutate the current request again. This check deliberately runs
      // under the same pessimistic lock as recovery: first terminal writer
      // wins and state can never be resurrected.
      const terminalAttempt = ['FIX_FAILED', 'PR_CREATED', 'VALIDATING', 'VALIDATED', 'REJECTED']
        .includes(String(attempt.status));
      if (attemptCount !== Number(fix.attemptCount) || (terminalAttempt && !incompleteReconciliation)) {
        return {
          applied: false, duplicate: false, stale: true, incident, status: fix.status,
          code: 'STALE_OR_TERMINAL_ATTEMPT_CALLBACK',
        };
      }
      if (attempt.workflowExecutionId && String(attempt.workflowExecutionId) !== executionId) {
        throw new ConflictException('L’exécution WF2 ne correspond pas à la tentative active.');
      }

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
      // R19.3C: candidate acceptance is deliberately distinct from scanner
      // resolution. Legacy WF2 callbacks remain supported during migration.
      const candidateAcceptedFindingIds = normalize(input.candidateAcceptedFindingIds);
      const acceptedFindingIds = candidateAcceptedFindingIds.length
        ? candidateAcceptedFindingIds : normalize(input.effectiveRemediatedFindingIds);
      const candidateVerifiedFiles = normalize(input.candidateVerifiedFiles);
      const verifiedFiles = candidateVerifiedFiles.length
        ? candidateVerifiedFiles : normalize(input.verifiedFiles);
      const declaredPlannedFiles = normalize(input.plannedFiles);
      const plannedFiles = candidateAcceptedFindingIds.length
        ? (declaredPlannedFiles.length ? declaredPlannedFiles : candidateVerifiedFiles)
        : expectedFiles;
      const updatedFiles = normalize(input.updatedFiles);
      const commitShas = normalize(input.commitShas);
      if (callbackStatus === 'PR_CREATED') {
        const fileResults = Array.isArray(input.fileResults) ? input.fileResults : [];
        const exactFindings = JSON.stringify(acceptedFindingIds) === JSON.stringify(expectedFindingIds);
        const resultFiles = normalize(fileResults.map((result: any) => result?.targetFile));
        const exactFiles = plannedFiles.length > 0
          && expectedFiles.every(file => plannedFiles.includes(file))
          && JSON.stringify(plannedFiles) === JSON.stringify(verifiedFiles)
          && JSON.stringify(resultFiles) === JSON.stringify(verifiedFiles);
        const validOutcomes = fileResults.length === verifiedFiles.length && fileResults.every((result: any) => {
          const neutralCandidate = result?.candidateStateVerified === true
            && String(result?.outcome) === 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION';
          const legacyRemediation = result?.finalStateVerified === true
            && ['MODIFIED_AND_REMEDIATED', 'ALREADY_REMEDIATED'].includes(String(result?.outcome));
          return (neutralCandidate || legacyRemediation) && verifiedFiles.includes(String(result?.targetFile));
        });
        if (input.completenessPassed !== true || !exactFindings || !exactFiles || !validOutcomes
          || !/^[a-f0-9]{40}$/i.test(String(input.prHeadSha || ''))) {
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
            candidateAcceptedFindingIds: acceptedFindingIds,
            candidateVerifiedFiles: verifiedFiles,
            plannedFiles,
            // Compatibility only: preserve legacy evidence if an old workflow
            // supplied it, but never synthesize scanner-resolution semantics.
            effectiveRemediatedFindingIds: normalize(input.effectiveRemediatedFindingIds),
            verifiedFiles: normalize(input.verifiedFiles), fileResults: input.fileResults,
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
      incidentId: id, status: result.status, ...(result.code ? { code: result.code } : {}) };
  }

  /**
   * R21-AE — explicit human/admin lifecycle reconciliation for a WF2 dispatch
   * that never produced a terminal callback. WF2 may already have performed
   * external side effects, so elapsed time never starts a retry automatically:
   * this action only moves DISPATCHED -> FIX_FAILED and records who authorized
   * that lifecycle correction. It never reverses GitHub effects and never
   * changes scanner/finding evidence.
   */
  async reconcileStaleDispatch(id: string, requestId: string, input: StaleDispatchRecoveryInput, user: any) {
    if (!user || String(user.role || '').toLowerCase() !== 'admin') {
      throw new ForbiddenException('Seul un administrateur peut réconcilier un dispatch WF2 obsolète.');
    }
    const configuredThreshold = Number(process.env.WF2_STALE_DISPATCH_MS || 30 * 60 * 1000);
    if (!Number.isFinite(configuredThreshold) || configuredThreshold <= 0) {
      throw new ServiceUnavailableException('Le seuil de dispatch WF2 obsolète est invalide.');
    }
    const result = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const metadata: any = incident.metadata || {};
      const fix: any = metadata.fixRequest || {};
      const attemptCount = Number(input?.attemptCount);
      if (fix.requestId !== requestId || fix.batchId !== input?.batchId || fix.workflow !== 'WF2') {
        throw new ConflictException('La récupération ne correspond pas au batch WF2 demandé.');
      }
      if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount !== Number(fix.attemptCount)) {
        throw new ConflictException('La récupération ne correspond pas à la tentative WF2 active.');
      }
      const attempts = Array.isArray(fix.attempts) ? fix.attempts : [];
      const attempt = attempts.find((entry: any) => Number(entry.attempt) === attemptCount);
      if (!attempt) throw new ConflictException('La tentative WF2 à récupérer est introuvable.');
      const recoveries = Array.isArray(fix.lifecycleRecoveries) ? [...fix.lifecycleRecoveries] : [];
      const priorRecovery = recoveries.find((entry: any) => entry?.recoveryType === 'STALE_DISPATCH'
        && Number(entry?.recoveredAttempt) === attemptCount);
      if (priorRecovery) {
        return { applied: false, duplicate: true, incident, status: fix.status, recovery: priorRecovery };
      }
      if (fix.status !== 'DISPATCHED' || attempt.status !== 'DISPATCHED' || fix.retryEligible !== false) {
        throw new ConflictException('La tentative WF2 n’est pas un dispatch actif récupérable.');
      }
      if (incident.prUrl || fix.prUrl || fix.prNumber) {
        throw new ConflictException('Une Pull Request existe déjà pour cette tentative WF2.');
      }
      const terminalCallback = (Array.isArray(fix.workflowEvents) ? fix.workflowEvents : [])
        .some((event: any) => Number(event?.attempt) === attemptCount
          && ['FAILED', 'PR_CREATED'].includes(String(event?.status)));
      if (terminalCallback) {
        throw new ConflictException('Un callback terminal WF2 est déjà enregistré pour cette tentative.');
      }
      const dispatchedAt = Date.parse(String(attempt.dispatchedAt || fix.dispatchedAt || ''));
      if (!Number.isFinite(dispatchedAt)) {
        throw new ConflictException('L’horodatage de dispatch WF2 est absent ou invalide.');
      }
      const recoveredAt = new Date().toISOString();
      if (Date.parse(recoveredAt) - dispatchedAt < configuredThreshold) {
        throw new ConflictException('Le dispatch WF2 n’a pas dépassé le seuil de récupération.');
      }
      const recovery = {
        recoveryType: 'STALE_DISPATCH', recoveredAttempt: attemptCount,
        previousStatus: 'DISPATCHED', newStatus: 'FIX_FAILED',
        reason: 'WF2_STALE_DISPATCH_RECONCILED', recoveredAt,
        authorizedBy: String(user.id || ''),
      };
      const nextAttempts = attempts.map((entry: any) => Number(entry.attempt) === attemptCount
        ? { ...entry, status: 'FIX_FAILED', failedAt: recoveredAt,
            failureCode: recovery.reason, failureSummary: 'Dispatch WF2 obsolète réconcilié par un administrateur.',
            recovery }
        : entry);
      const nextFix = {
        ...fix, status: 'FIX_FAILED', retryEligible: true, attempts: nextAttempts,
        failedAt: recoveredAt, lastErrorCode: recovery.reason,
        lastError: 'Dispatch WF2 obsolète réconcilié par un administrateur.',
        lifecycleRecoveries: [...recoveries, recovery],
      };
      const patch: any = { metadata: { ...metadata, fixRequest: nextFix } };
      await repo.update(id, patch);
      Object.assign(incident, patch);
      return { applied: true, duplicate: false, incident, status: nextFix.status, recovery };
    });
    if (result.applied) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
    }
    return {
      success: true, applied: result.applied, duplicate: result.duplicate,
      incidentId: id, requestId, batchId: input.batchId, attemptCount: input.attemptCount,
      status: result.status, retryEligible: result.applied ? true : result.incident?.metadata?.fixRequest?.retryEligible,
      recovery: result.recovery,
    };
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
    const validationRequest: any = currentMeta.prValidationRequest || null;
    if (!validation.fixRequestId || validation.fixRequestId !== fixRequest.requestId) throw new ConflictException('La validation ne correspond pas à la demande de correction.');
    if (!validationRequest || validation.validationRequestId !== validationRequest.validationRequestId) throw new ConflictException('La validation ne correspond pas à la demande de validation active.');
    if (validationRequest.status === 'COMPLETED' && currentMeta.validation?.validationRequestId === validation.validationRequestId) {
      return this.sanitizeIncident(incident);
    }
    if (!['QUEUED', 'RUNNING'].includes(String(validationRequest.status))) throw new ConflictException('La demande de validation n’est pas active.');
    if (validation.batchId !== fixRequest.batchId || validation.batchKey !== (fixRequest.batchKey || fixRequest.batchId)
      || Number(validation.attemptCount) !== Number(fixRequest.attemptCount)) throw new ConflictException('La validation ne correspond pas au batch de correction.');
    if (!repository || repository !== projectRepository) throw new ConflictException('La validation ne correspond pas au dépôt du projet.');
    const prNumber = Number(validation.prNumber);
    if (!Number.isInteger(prNumber) || prNumber <= 0 || !String(incident.prUrl || '').toLowerCase().includes(`${repository}/pull/${prNumber}`)) {
      throw new ConflictException('La validation ne correspond pas à la Pull Request attendue.');
    }
    const buildNumber = Number(validation.buildNumber ?? validation.build?.buildNumber);
    if (!Number.isInteger(buildNumber) || buildNumber <= 0) throw new ConflictException('Le build de validation est invalide.');
    if (validation.jenkinsJob !== incident.jenkinsJobName) throw new ConflictException('La validation ne correspond pas au job Jenkins attendu.');
    const expectedPrJob = buildPrValidationJobName(incident.jenkinsJobName, prNumber);
    if (validation.prValidationJob !== expectedPrJob) throw new ConflictException('La validation ne correspond pas au job PR attendu.');
    if (!isFullGitSha(validation.expectedPrHeadSha) || !isFullGitSha(validation.checkoutSha)
      || validation.expectedPrHeadSha.toLowerCase() !== validation.checkoutSha.toLowerCase()
      || validation.expectedPrHeadSha.toLowerCase() !== String(validationRequest.expectedPrHeadSha).toLowerCase()) {
      throw new ConflictException('Le commit validé ne correspond pas au HEAD attendu de la Pull Request.');
    }
    if (!validation.analysisId || !validation.ceTaskId) throw new ConflictException('La corrélation Sonar exacte est absente.');
    const jenkinsStatus = String(validation.jenkinsStatus ?? validation.build?.status ?? '').toUpperCase();
    const sonarStatus = String(validation.sonarStatus ?? validation.sonarQualityGate?.status ?? '').toUpperCase();
    const requiredStages = Array.isArray(validation.requiredStages) ? validation.requiredStages : [];
    const requiredNames = ['build', 'tests', 'sonar'];
    const missingRequiredStage = requiredNames.find(name => !requiredStages.some((stage: any) => stage.stage === name && stage.required === true));
    const badStage = requiredStages.find((s: any) => s.required !== false && s.status !== 'PASSED' && !(s.status === 'WARNING' && !s.blocking));
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
    const passed = jenkinsStatus === 'SUCCESS' && sonarStatus === 'OK' && correlationVerified && !missingRequiredStage && !badStage && everyFindingValid;
    const validationStatus = passed ? 'VALIDATED' : (hasInvalidFinding ? 'INVALID' : 'INCONCLUSIVE');
    const validationRecord = {
      ...validation, findingResults, passed, validationStatus, projectId: incident.projectId,
      incidentId: incident.id, fixRequestId: fixRequest.requestId, repository, prNumber, buildNumber,
      jenkinsStatus, sonarStatus, correlationVerified, validatedAt: new Date().toISOString(),
      failureReasons: [jenkinsStatus !== 'SUCCESS' ? `Jenkins=${jenkinsStatus || 'MISSING'}` : null,
        sonarStatus !== 'OK' ? `Sonar=${sonarStatus || 'MISSING'}` : null,
        !correlationVerified ? 'Sonar/build correlation unverified' : null,
        !everyFindingValid ? 'One or more approved findings are invalid or inconclusive' : null,
        missingRequiredStage ? `Required stage missing=${missingRequiredStage}` : null,
        badStage ? `${badStage.stage}=${badStage.status}` : null].filter(Boolean),
    };
    // R22-A Phase 7/8 — additive derived structure alongside the raw payload
    // above (never a replacement): separates per-finding verdicts from
    // overall pipeline health so a consumer can never mistake "the pipeline
    // was healthy" for "this specific finding is VALID", or vice versa.
    // Existing flat fields (validation.passed, validation.sonarStatus, ...)
    // are all still present, unchanged, for backward compatibility.
    (validationRecord as any).derived = deriveFindingsAndHealth(validationRecord);

    // ── ÉTAPE 2 — autorisation de merge (ADDITIF STRICT) ──────────────────
    // Projection PURE de signaux DÉJÀ calculés ci-dessus. NE MODIFIE NI
    // validation.passed NI validation.validationStatus NI la transition
    // incident.status plus bas : un consommateur futur lira uniquement
    // validation.mergeAuthorization, le lifecycle actuel est inchangé.
    // Découple le verdict de remédiation (findingResults) du Quality Gate
    // Sonar global — ce dernier n'est ici qu'un advisory ; il reste bloquant
    // pour le DÉPLOIEMENT via DeployReadiness (intouché).
    // regressionResult = 'INCONCLUSIVE' en dur : la détection de régression
    // (baseline findings + diff candidat) n'existe pas encore — chantier Phase 3.
    // Robuste aux records incomplets : deriveRemediationResult([]) => INCONCLUSIVE,
    // computeMergeAuthorization est pur et total (jamais d'exception).
    (validationRecord as any).mergeAuthorization = {
      ...computeMergeAuthorization({
        remediationResult: deriveRemediationResult(
          findingResults.map(r => r.result as 'VALID' | 'INVALID' | 'INCONCLUSIVE'),
        ),
        exactCorrelationVerified: deriveExactCorrelationVerified({
          correlationVerified: validation.correlationVerified,
          checkoutSha: validation.checkoutSha,
          expectedPrHeadSha: validation.expectedPrHeadSha,
        }),
        requiredStagesComplete: !missingRequiredStage && !badStage,
        regressionResult: 'INCONCLUSIVE', // TODO Phase 3 : baseline findings + diff candidat
        pipelineHealth: (validationRecord as any).derived?.pipelineHealth ?? null,
        validationInProgress: false, // saveValidation est terminal
      }),
      computedAt: validationRecord.validatedAt,
      forSha: validation.checkoutSha ?? null,
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
      prValidationRequest: { ...validationRequest, status: passed ? 'COMPLETED' : 'FAILED', result: validationStatus,
        buildNumber, checkoutSha: validation.checkoutSha, analysisId: validation.analysisId,
        findingResults, completedAt: validationRecord.validatedAt, updatedAt: validationRecord.validatedAt },
      fixRequest: { ...fixRequest, status: passed ? 'VALIDATED' : 'PR_CREATED', validationBuildNumber: buildNumber },
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
      if (!explicitRetry && incident.prUrl) throw new ConflictException('Une Pull Request existe déjà pour cet incident.');
      if ([IncidentStatus.COMPLETED, IncidentStatus.APPROVED, IncidentStatus.VALIDATING].includes(incident.status)) {
        throw new ConflictException(`L’état actuel de l’incident ne permet pas une nouvelle demande de correction.`);
      }
      const current = (incident.metadata as any)?.fixRequest;
      const legacy = body.findingId ? [body.findingId] : [];
      if (!explicitRetry && body.findingIds !== undefined && !Array.isArray(body.findingIds)) throw new BadRequestException('Le champ technique findingIds doit être une liste.');
      const requestedIds = explicitRetry
        ? (Array.isArray(current?.findingIds) ? current.findingIds.map(String) : (current?.findingId ? [String(current.findingId)] : []))
        : (body.findingIds?.length ? body.findingIds : legacy);
      if (explicitRetry && (!canRetryFixRequest(current) || !requestedIds.length)) {
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

  // R21-AS — narrow, self-contained fix for exactly one proven gap: a freshly
  // multibranch-indexed PR job exists but has never run its pipeline script,
  // so PFE_VALIDATION_CONTEXT (declared via a scripted properties() step) is
  // not yet registered in its parameter definitions. This does NOT address
  // the separate multibranch indexing race (job not existing at all is
  // classified JENKINS_JOB_NOT_FOUND by the metadata fetch itself, both here
  // and in requestPrValidation, and never reaches this function transparently
  // pretending to fix it) and it never triggers a build.
  private async ensurePrValidationParameter(jenkinsInternalUrl: string, authHeader: string, resolvedJobPath: string):
    Promise<{ status: 'ALREADY_PRESENT' | 'INJECTED'; definitions: ReturnType<typeof getJenkinsParameterDefinitions> }> {
    const jenkinsFailure = (code: string, message: string) => Object.assign(new Error(message), { jenkinsFailureCode: code });
    const metadataTree = 'name,fullName,buildable,_class,property[_class,parameterDefinitions[name,type,_class,defaultParameterValue[value,_class]]]';
    const fetchMetadata = async () => {
      const response = await fetch(`${jenkinsInternalUrl}${resolvedJobPath}/api/json?tree=${metadataTree}`, {
        headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw jenkinsFailure(classifyJenkinsTriggerStatus(response.status).code || 'JENKINS_JOB_NOT_FOUND', `Jenkins metadata HTTP ${response.status}`);
      let metadata: any;
      try { metadata = await response.json(); }
      catch { throw jenkinsFailure('JENKINS_RESPONSE_INVALID', 'Jenkins metadata response was not valid JSON'); }
      if (!isConcreteJenkinsBuildJob(metadata)) throw jenkinsFailure('JENKINS_TARGET_NOT_BUILDABLE', 'Jenkins PR target is not a concrete buildable job');
      return metadata;
    };
    const hasParameter = (definitions: ReturnType<typeof getJenkinsParameterDefinitions>) =>
      definitions.some(definition => definition.name === 'PFE_VALIDATION_CONTEXT');

    const initialDefinitions = getJenkinsParameterDefinitions(await fetchMetadata());
    if (hasParameter(initialDefinitions)) return { status: 'ALREADY_PRESENT', definitions: initialDefinitions };

    const fullName = jenkinsWorkflowFullName(resolvedJobPath);
    const script = buildParameterBootstrapScript(fullName);
    const scriptResponse = await fetch(`${jenkinsInternalUrl}/scriptText`, {
      method: 'POST', headers: { Authorization: authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ script }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!scriptResponse.ok) {
      throw jenkinsFailure(classifyJenkinsTriggerStatus(scriptResponse.status).code || 'JENKINS_PARAMETER_UNAVAILABLE', `Jenkins script console HTTP ${scriptResponse.status}`);
    }
    let scriptOutput = '';
    try { scriptOutput = await scriptResponse.text(); } catch { /* checked as empty below */ }
    if (!/PFE_BOOTSTRAP_RESULT:OK/.test(scriptOutput)) {
      // Covers JOB_NOT_FOUND-from-script (race: job removed between our two
      // fetches) and any other non-OK marker -- fail closed either way.
      throw jenkinsFailure('JENKINS_PARAMETER_UNAVAILABLE', 'Jenkins parameter bootstrap script did not report success');
    }
    const afterDefinitions = getJenkinsParameterDefinitions(await fetchMetadata());
    if (!hasParameter(afterDefinitions)) {
      throw jenkinsFailure('JENKINS_PARAMETER_UNAVAILABLE', 'PFE_VALIDATION_CONTEXT still absent after bootstrap injection');
    }
    return { status: 'INJECTED', definitions: afterDefinitions };
  }

  // R21-AS Phase 8 — read/heal-only entry point: proves and, if needed, fixes
  // the parameter bootstrap without ever reaching crumb issuance or
  // buildWithParameters. Never mutates prValidationRequest.
  async ensurePrValidationBootstrap(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const fix: any = (snapshot.metadata as any)?.fixRequest || {};
    if (fix.status !== 'PR_CREATED' || !fix.prNumber) {
      throw new ConflictException('Aucune Pull Request de correction n’est prête à être validée.');
    }
    const project = snapshot.project;
    const jenkinsInternalUrl = resolveJenkinsInternalUrl(project);
    if (!jenkinsInternalUrl || !project.jenkinsToken || !project.jenkinsJobName) {
      throw new BadRequestException('Jenkins n’est pas configuré pour la validation de Pull Request.');
    }
    const separator = project.jenkinsToken.indexOf(':');
    if (separator <= 0 || separator === project.jenkinsToken.length - 1) {
      throw new BadRequestException('Credential Jenkins invalide.');
    }
    const authHeader = 'Basic ' + Buffer.from(project.jenkinsToken).toString('base64');
    const prValidationJob = buildPrValidationJobName(project.jenkinsJobName, Number(fix.prNumber));
    const resolvedJobPath = resolveJenkinsJobPath(prValidationJob);
    try {
      const result = await this.ensurePrValidationParameter(jenkinsInternalUrl, authHeader, resolvedJobPath);
      return { success: true, status: result.status, prValidationJob, parameterCount: result.definitions.length };
    } catch (error: any) {
      throw new ServiceUnavailableException({
        success: false, code: error?.jenkinsFailureCode || 'JENKINS_PARAMETER_UNAVAILABLE',
        message: 'Le paramètre de validation Jenkins n’a pas pu être vérifié.',
      });
    }
  }

  async requestPrValidation(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const initialFix: any = (snapshot.metadata as any)?.fixRequest || {};
    if (initialFix.status !== 'PR_CREATED' || !snapshot.prUrl || !initialFix.prNumber) {
      throw new ConflictException('Aucune Pull Request de correction n’est prête à être validée.');
    }
    if (!isFullGitSha(initialFix.prHeadSha)) {
      throw new ConflictException('Le HEAD exact de la Pull Request n’est pas disponible.');
    }
    const prNumber = Number(initialFix.prNumber);
    const pull = await this.githubPullRequest(snapshot.project, prNumber);
    const remoteHeadSha = String(pull?.head?.sha || '').toLowerCase();
    const remoteHeadBranch = String(pull?.head?.ref || '');
    const expectedBranch = `fix/pfe-${snapshot.id}-${initialFix.requestId}`;
    // R65 — fixRequest.prHeadSha is immutable provenance (the SHA WF2 itself
    // verified at PR-creation time). The actual comparison baseline is the
    // governed validation target: prHeadSha until a human explicitly accepts
    // a legitimate follow-up commit via refresh-target (POST
    // :id/pr-validation/refresh-target), which then becomes
    // fixRequest.validationTargetSha. Never silently trust a live GitHub SHA
    // that diverges from the governed target — that would defeat the
    // freshness gate this proven bug protects (PR-24 R64).
    const initialTargetSha = String(initialFix.validationTargetSha || initialFix.prHeadSha).toLowerCase();
    if (pull?.state !== 'open' || remoteHeadBranch !== expectedBranch || remoteHeadSha !== initialTargetSha) {
      throw new ConflictException('La Pull Request a changé. Actualisez la cible avant de demander sa validation.');
    }
    const repository = this.canonicalRepository(snapshot.project.githubRepo);
    const validationRequestId = prValidationIdentity(snapshot.projectId, prNumber, remoteHeadSha, initialFix.batchId);
    const now = new Date().toISOString();
    const claim: any = await this.repo.manager.transaction(async manager => {
      const incidents = manager.getRepository(Incident);
      const projects = manager.getRepository(Project);
      const incident: any = await incidents.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const project = await projects.findOne({ where: { id: incident.projectId } });
      if (!project) throw new NotFoundException('Projet introuvable.');
      const metadata: any = incident.metadata || {};
      const fix: any = metadata.fixRequest || {};
      const fixTargetSha = String(fix.validationTargetSha || fix.prHeadSha || '').toLowerCase();
      if (fix.status !== 'PR_CREATED' || fix.requestId !== initialFix.requestId || fix.batchId !== initialFix.batchId
        || fixTargetSha !== remoteHeadSha || Number(fix.prNumber) !== prNumber) {
        throw new ConflictException('La demande de correction a changé avant le lancement de la validation.');
      }
      const existing = metadata.prValidationRequest;
      const sameIdentity = existing?.validationRequestId === validationRequestId;
      // Une transaction Jenkins FAILED (échec de mise en file, pas un
      // résultat de remédiation) reste sur la même identité logique — un
      // nouveau clic explicite doit pouvoir réessayer, jamais rester
      // bloqué indéfiniment sur l'échec de transport précédent. Tout
      // autre statut existant (REQUESTED/QUEUED/RUNNING/COMPLETED) reste
      // un doublon : au plus une tentative active à la fois, garanti par
      // le verrou pessimistic_write sur l'incident dans cette transaction.
      if (sameIdentity && existing.status !== 'FAILED') {
        return { duplicate: true, request: existing, project };
      }
      const retryAttempt = sameIdentity ? Number(existing.retryAttempt || 0) + 1 : 0;
      const previousAttempts = sameIdentity
        ? [...(Array.isArray(existing.previousAttempts) ? existing.previousAttempts : []), existing]
        : [];
      const request = {
        validationRequestId, validationType: 'PR_VALIDATION', status: 'REQUESTED',
        projectId: incident.projectId, incidentId: incident.id, fixRequestId: fix.requestId,
        requestId: fix.requestId, batchId: fix.batchId, batchKey: fix.batchKey || fix.batchId,
        attemptCount: Number(fix.attemptCount), repository, prNumber, prUrl: incident.prUrl,
        prHeadBranch: remoteHeadBranch, expectedPrHeadSha: remoteHeadSha,
        createdBy: user.id, createdAt: now, updatedAt: now,
        retryAttempt, previousAttempts,
      };
      await incidents.update(id, { metadata: { ...metadata, prValidationRequest: request } } as any);
      return { duplicate: false, request, project };
    });
    if (claim.duplicate) {
      return { success: true, duplicate: true, validationRequest: claim.request };
    }

    const project: Project = claim.project;
    const jenkinsInternalUrl = resolveJenkinsInternalUrl(project);
    if (!jenkinsInternalUrl || !project.jenkinsToken || !project.jenkinsJobName) {
      throw new BadRequestException('Jenkins n’est pas configuré pour la validation de Pull Request.');
    }
    const separator = project.jenkinsToken.indexOf(':');
    if (separator <= 0 || separator === project.jenkinsToken.length - 1) {
      throw new BadRequestException('Credential Jenkins invalide.');
    }
    if (!project.sonarqubeKey) {
      throw new BadRequestException('Aucune clé SonarQube n’est configurée pour ce projet.');
    }
    const authHeader = 'Basic ' + Buffer.from(project.jenkinsToken).toString('base64');
    const prValidationJob = buildPrValidationJobName(project.jenkinsJobName, prNumber);
    const resolvedJobPath = resolveJenkinsJobPath(prValidationJob);
    // R45 — clés Sonar déterministes pour le mode COMMUNITY_EXACT_SHA (isole
    // toujours l'analyse PR du projet principal, même quand une édition
    // Developer future utiliserait sonar.pullrequest.* nativement à la place).
    const baseSonarProjectKey = project.sonarqubeKey;
    const validationSonarProjectKey = `${baseSonarProjectKey}-pr-${prNumber}`;
    const context = { ...claim.request, jenkinsJob: project.jenkinsJobName, prValidationJob, baseSonarProjectKey, validationSonarProjectKey };
    // R21-AR — every failure below is classified with the same granular
    // taxonomy already proven in triggerBuild() (classifyJenkinsTriggerStatus),
    // instead of collapsing every Jenkins-side failure into one opaque
    // JENKINS_TRIGGER_FAILED. This matters specifically for a freshly
    // multibranch-indexed PR job: Jenkins only registers PFE_VALIDATION_CONTEXT
    // in job metadata once its declarative `properties([parameters([...])])`
    // step has executed at least once (proven live: PR-25's job existed after
    // indexing but its config.xml carried no ParametersDefinitionProperty yet).
    // JENKINS_PARAMETER_UNAVAILABLE names that exact bootstrap gap so it is
    // observable and distinguishable from every other Jenkins failure mode,
    // without attempting an automatic hidden bootstrap build here (rejected:
    // that would be an uncorrelated build using default/empty parameters, and
    // the shared library deliberately fails PR builds with an empty
    // PFE_VALIDATION_CONTEXT rather than run unauthenticated).
    const jenkinsFailure = (code: string, message: string) => Object.assign(new Error(message), { jenkinsFailureCode: code });
    try {
      const metadataTree = 'name,fullName,buildable,_class,property[_class,parameterDefinitions[name,type,_class,defaultParameterValue[value,_class]]]';
      const metadataResponse = await fetch(`${jenkinsInternalUrl}${resolvedJobPath}/api/json?tree=${metadataTree}`, {
        headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000),
      });
      if (!metadataResponse.ok) {
        throw jenkinsFailure(classifyJenkinsTriggerStatus(metadataResponse.status).code || 'JENKINS_TRIGGER_FAILED', `Jenkins metadata HTTP ${metadataResponse.status}`);
      }
      let jobMetadata: any;
      try { jobMetadata = await metadataResponse.json(); }
      catch { throw jenkinsFailure('JENKINS_RESPONSE_INVALID', 'Jenkins metadata response was not valid JSON'); }
      if (!isConcreteJenkinsBuildJob(jobMetadata)) throw jenkinsFailure('JENKINS_TARGET_NOT_BUILDABLE', 'Jenkins PR target is not a concrete buildable job');
      let definitions = getJenkinsParameterDefinitions(jobMetadata);
      if (!definitions.some(definition => definition.name === 'PFE_VALIDATION_CONTEXT')) {
        // R21-AS — job exists but has never run its pipeline script, so the
        // parameter it declares isn't registered yet. Heal on demand instead
        // of failing closed forever; any failure inside still propagates as a
        // classified jenkinsFailure into the same catch block below.
        const bootstrap = await this.ensurePrValidationParameter(jenkinsInternalUrl, authHeader, resolvedJobPath);
        definitions = bootstrap.definitions;
      }
      const crumbResponse = await fetch(`${jenkinsInternalUrl}/crumbIssuer/api/json`, {
        headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000),
      });
      if (!crumbResponse.ok) {
        throw jenkinsFailure(classifyJenkinsTriggerStatus(crumbResponse.status).code || 'JENKINS_CRUMB_FAILED', `Jenkins crumb HTTP ${crumbResponse.status}`);
      }
      let crumb: any;
      try { crumb = await crumbResponse.json(); }
      catch { throw jenkinsFailure('JENKINS_RESPONSE_INVALID', 'Jenkins crumb response was not valid JSON'); }
      if (!crumb?.crumbRequestField || !crumb?.crumb) throw jenkinsFailure('JENKINS_CRUMB_FAILED', 'Jenkins crumb response was missing required fields');
      const resolvedParameters = resolveJenkinsParameters(definitions, { PFE_VALIDATION_CONTEXT: encodePrValidationContext(context) });
      const buildResponse = await fetch(`${jenkinsInternalUrl}${resolvedJobPath}/buildWithParameters`, {
        method: 'POST', headers: { Authorization: authHeader, [crumb.crumbRequestField]: crumb.crumb, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: resolvedParameters.body,
        signal: AbortSignal.timeout(10_000),
      });
      const queueUrl = buildResponse.headers.get('location');
      if (!isAcceptedJenkinsBuildResponse(buildResponse.status, queueUrl)) {
        const classification = classifyJenkinsTriggerStatus(buildResponse.status);
        const code = classification.accepted ? 'JENKINS_TRIGGER_NOT_ACCEPTED' : (classification.code || 'JENKINS_TRIGGER_FAILED');
        throw jenkinsFailure(code, `Jenkins trigger HTTP ${buildResponse.status}`);
      }
      const current: any = await this.repo.findOne({ where: { id } });
      const currentMeta: any = current.metadata || {};
      const queued = { ...claim.request, status: 'QUEUED', queueUrl, queuedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prValidationJob };
      await this.repo.update(id, { metadata: { ...currentMeta, prValidationRequest: queued } } as any);
      return { success: true, duplicate: false, validationRequest: queued };
    } catch (error: any) {
      const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      const failureCode = timeout ? 'JENKINS_TIMEOUT' : String(error?.jenkinsFailureCode || 'JENKINS_TRIGGER_FAILED');
      // Bounded, sanitized: HTTP status numbers and fixed messages only, never
      // a Jenkins response body (which could carry stack traces or config).
      const failureSummary = String(error?.message || 'Le build PR n’a pas pu être mis en file.').slice(0, 300);
      const current: any = await this.repo.findOne({ where: { id } });
      const currentMeta: any = current.metadata || {};
      const failed = { ...claim.request, status: 'FAILED', failureCode, failureSummary, failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prValidationJob };
      await this.repo.update(id, { metadata: { ...currentMeta, prValidationRequest: failed } } as any);
      throw new ServiceUnavailableException('La validation PR n’a pas pu être mise en file dans Jenkins.');
    }
  }

  // R65 — action gouvernée explicite pour accepter un commit de remédiation
  // suivant légitime (même PR, même branche) comme nouvelle cible de
  // validation. Proven-necessary: fixRequest.prHeadSha is frozen provenance
  // (the SHA WF2 verified at PR-creation time) and requestPrValidation()
  // rejects any drift from it with 409 -- including a genuine, approved,
  // human-driven follow-up remediation commit on the SAME PR/branch (real
  // case: PR-24's S125 fix, R64). Never touches fixRequest.prHeadSha. Never
  // silently trusts GitHub -- only a human explicitly invoking this endpoint
  // can move the governed target, and only after the same open/branch checks
  // requestPrValidation itself performs. Never triggers Jenkins/WF1/WF3.
  async refreshPrValidationTarget(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const fix: any = (snapshot.metadata as any)?.fixRequest || {};
    if (fix.status !== 'PR_CREATED' || !snapshot.prUrl || !fix.prNumber) {
      throw new ConflictException('Aucune Pull Request de correction n’est prête à être validée.');
    }
    if (!isFullGitSha(fix.prHeadSha)) {
      throw new ConflictException('Le HEAD exact de la Pull Request n’est pas disponible.');
    }
    const prNumber = Number(fix.prNumber);
    const pull = await this.githubPullRequest(snapshot.project, prNumber);
    const remoteHeadSha = String(pull?.head?.sha || '').toLowerCase();
    const remoteHeadBranch = String(pull?.head?.ref || '');
    const expectedBranch = `fix/pfe-${snapshot.id}-${fix.requestId}`;
    const defaultBranch = (snapshot.metadata as any)?.defaultBranch;
    if (pull?.state !== 'open' || remoteHeadBranch !== expectedBranch
      || (defaultBranch && String(pull?.base?.ref || '') !== defaultBranch)) {
      throw new ConflictException('La Pull Request ne correspond plus à cette demande de correction — actualisation refusée.');
    }
    if (!isFullGitSha(remoteHeadSha)) {
      throw new BadGatewayException('Le HEAD de la Pull Request est introuvable auprès de GitHub.');
    }
    const currentTarget = String(fix.validationTargetSha || fix.prHeadSha).toLowerCase();
    if (currentTarget === remoteHeadSha) {
      // Idempotent: no DB write, no audit entry, nothing to refresh.
      return { success: true, changed: false, validationTargetSha: currentTarget, originalPrHeadSha: fix.prHeadSha };
    }
    const now = new Date().toISOString();
    const historyEntry = {
      event: 'PR_VALIDATION_TARGET_REFRESHED', from: currentTarget, to: remoteHeadSha,
      refreshedAt: now, refreshedBy: user.id, prNumber, branch: remoteHeadBranch,
    };
    const result: any = await this.repo.manager.transaction(async manager => {
      const incidents = manager.getRepository(Incident);
      const incident: any = await incidents.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const metadata: any = incident.metadata || {};
      const currentFix: any = metadata.fixRequest || {};
      if (currentFix.status !== 'PR_CREATED' || currentFix.requestId !== fix.requestId
        || currentFix.batchId !== fix.batchId || Number(currentFix.prNumber) !== prNumber) {
        throw new ConflictException('La demande de correction a changé avant l’actualisation de la cible.');
      }
      const priorTarget = String(currentFix.validationTargetSha || currentFix.prHeadSha).toLowerCase();
      if (priorTarget === remoteHeadSha) {
        return { changed: false, validationTargetSha: priorTarget };
      }
      const nextFix = {
        ...currentFix,
        validationTargetSha: remoteHeadSha,
        validationTargetHistory: [
          ...(Array.isArray(currentFix.validationTargetHistory) ? currentFix.validationTargetHistory : []),
          historyEntry,
        ],
      };
      await incidents.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
      return { changed: true, validationTargetSha: remoteHeadSha };
    });
    if (result.changed) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
    }
    return { success: true, changed: result.changed, validationTargetSha: result.validationTargetSha, originalPrHeadSha: fix.prHeadSha };
  }

  // R42A — réconciliation gouvernée d'une validation PR restée QUEUED/RUNNING
  // alors que son build Jenkins exact est déjà terminal, sans callback jamais
  // reçu (ex: crash pipeline avant l'étape de notification). Ne fabrique
  // jamais un résultat VALIDATED : un build SUCCESS sans callback reste en
  // échec fail-closed, nécessitant une intervention distincte. Ne touche
  // jamais fixRequest.status ni les findings — seule prValidationRequest est
  // mise à jour, avec l'historique précédent intact dans previousAttempts.
  async reconcilePrValidation(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const metadata: any = snapshot.metadata || {};
    const request = metadata.prValidationRequest;
    if (!request || !['QUEUED', 'RUNNING'].includes(String(request.status))) {
      throw new ConflictException('Aucune validation PR active à réconcilier.');
    }
    const project = snapshot.project;
    const jenkinsInternalUrl = resolveJenkinsInternalUrl(project);
    if (!jenkinsInternalUrl || !project.jenkinsToken) {
      throw new BadRequestException('Jenkins n’est pas configuré pour la réconciliation.');
    }
    if (!request.queueUrl || !request.prValidationJob) {
      throw new ConflictException('Aucune référence de file Jenkins persistée pour cette validation.');
    }
    // Jenkins purges resolved queue items from /queue/item/:id/api/json after a
    // while (proven directly against this real stale request: 404, item already
    // long resolved) -- the queueId Jenkins stamps permanently onto the build
    // itself is the reliable correlation, not the ephemeral queue endpoint.
    const queueIdMatch = String(request.queueUrl).match(/\/queue\/item\/(\d+)\//);
    if (!queueIdMatch) {
      throw new ConflictException('Référence de file Jenkins illisible pour cette validation.');
    }
    const submittedQueueId = Number(queueIdMatch[1]);
    const authHeader = 'Basic ' + Buffer.from(project.jenkinsToken).toString('base64');
    const jobPath = resolveJenkinsJobPath(request.prValidationJob);
    const buildsRes = await fetch(
      `${jenkinsInternalUrl}${jobPath}/api/json?tree=builds[number,result,building,queueId,timestamp,` +
      `actions[lastBuiltRevision[SHA1],remoteUrls,parameters[name,value]]]{0,50}`,
      { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000) },
    );
    if (!buildsRes.ok) throw new ServiceUnavailableException('Impossible de vérifier l’état du job Jenkins.');
    const buildsData: any = await buildsRes.json();
    const builds: any[] = Array.isArray(buildsData?.builds) ? buildsData.builds : [];
    // Primary correlation: the queueId Jenkins stamps permanently onto the build.
    let buildData = builds.find((b: any) => b.queueId === submittedQueueId);
    let correlationMethod: 'QUEUE_ID' | 'FALLBACK_SHA_CONTEXT' = 'QUEUE_ID';
    if (!buildData) {
      // R72B — the persisted queue item never became this build (Jenkins
      // multibranch supersession: POSTed item 1496, run stamped 1505). Fall
      // back to a deterministic multi-fact correlation. Never "latest build".
      const candidates = builds.filter((b: any) => jenkinsBuildMatchesPrValidation(b, {
        expectedPrHeadSha: String(request.expectedPrHeadSha || '').toLowerCase(),
        validationRequestId: String(request.validationRequestId || ''),
        repository: this.canonicalRepository(project.githubRepo),
        notBefore: Date.parse(String(request.createdAt || '')),
      }));
      if (candidates.length === 0) {
        // Either genuinely still queued/not yet started, or older than the
        // lookback window. Never guessed either way.
        return { reconciled: false, reason: 'STILL_QUEUED', validationRequest: request };
      }
      if (candidates.length > 1) {
        // More than one build satisfies every correlation fact — refuse rather
        // than pick one. A human must disambiguate.
        return {
          reconciled: false, reason: 'CORRELATION_AMBIGUOUS',
          candidateBuildNumbers: candidates.map((b: any) => b.number), validationRequest: request,
        };
      }
      buildData = candidates[0];
      correlationMethod = 'FALLBACK_SHA_CONTEXT';
    }
    if (buildData.building || !buildData.result) {
      return { reconciled: false, reason: 'STILL_RUNNING', validationRequest: request };
    }
    if (buildData.result === 'SUCCESS') {
      // Fail-closed on purpose: a SUCCESS build with no callback is a different,
      // more delicate gap (evidence may still be recoverable) than the proven
      // early-crash case this reconciliation targets. Never guess VALIDATED.
      throw new ConflictException('Le build Jenkins est SUCCESS sans callback reçu — réconciliation manuelle requise, non automatisée ici.');
    }
    const now = new Date().toISOString();
    // R47 — UNSTABLE is not the same failure shape as FAILURE/ABORTED: the
    // Shared Library wraps Sonar/Trivy/OWASP/ZAP in catchError(buildResult:
    // 'UNSTABLE'), so an UNSTABLE build always still completes and reaches its
    // terminal report/callback step (unlike a genuine pipeline crash, which
    // never gets there). Proven directly against real PR-24 build #2: its
    // callback DID reach n8n (WF1 execution 1894), which rejected the contract
    // fail-closed with INVALID_PR_VALIDATION_CONTRACT:ceTaskId,analysisId
    // because SonarQube Community Edition cannot produce native PR analysis
    // evidence. Labeling this JENKINS_PIPELINE_FAILED ("no callback sent")
    // would misstate what actually happened -- use the truthful code instead.
    //
    // R49 — UNSTABLE alone does not distinguish build #2 (Sonar never even
    // completed -- no ceTaskId) from build #3 (Sonar DID complete -- real
    // ceTaskId/analysisId/CE SUCCESS -- but WF3's evidence retrieval and the
    // backend write-back both failed downstream, for unrelated reasons: a
    // missing n8n Sonar credential and a job-format mismatch, both proven and
    // fixed). Extracting ceTaskId from the Jenkins console log itself (the
    // exact source ScannerRunner.resolveExactAnalysis() reads from) is real,
    // unfakeable evidence that Sonar analysis actually ran, without asserting
    // anything this endpoint cannot itself verify (it stays Jenkins-only,
    // never queries n8n).
    let sonarAnalysisRan = false;
    if (buildData.result === 'UNSTABLE') {
      const consoleRes = await fetch(`${jenkinsInternalUrl}${jobPath}/${buildData.number}/consoleText`, {
        headers: { Authorization: authHeader }, signal: AbortSignal.timeout(15_000),
      });
      const consoleText = consoleRes.ok ? await consoleRes.text() : '';
      sonarAnalysisRan = /ce\/task\?id=[A-Za-z0-9_-]+/.test(consoleText);
    }
    const isUnsupportedSonarPr = buildData.result === 'UNSTABLE' && !sonarAnalysisRan;
    const isInconclusiveEvidence = buildData.result === 'UNSTABLE' && sonarAnalysisRan;
    const failureCode = isUnsupportedSonarPr ? 'SONAR_PR_ANALYSIS_UNSUPPORTED'
      : isInconclusiveEvidence ? 'PR_VALIDATION_EVIDENCE_INCONCLUSIVE'
      : 'JENKINS_PIPELINE_FAILED';
    const failureSummary = isUnsupportedSonarPr
      ? `Jenkins build #${buildData.number} s’est terminé en UNSTABLE : l’analyse SonarQube Pull Request native n’est pas supportée par cette édition Community (ceTaskId/analysisId indisponibles), rejetée fail-closed par WF1.`
      : isInconclusiveEvidence
      ? `Jenkins build #${buildData.number} s’est terminé en UNSTABLE : l’analyse Sonar exact-SHA a bien abouti (ceTaskId présent dans les logs Jenkins) mais l’évidence de validation n’a pas pu être établie de façon concluante en aval (récupération WF3 et/ou écriture backend en échec).`
      : `Jenkins build #${buildData.number} s’est terminé en ${buildData.result} avant l’envoi du callback de validation.`;
    const reconciled = {
      ...request, status: 'FAILED',
      failureCode, failureSummary,
      jenkinsBuildNumber: buildData.number, jenkinsBuildResult: buildData.result,
      // Forensic audit: the queueId mismatch that forced the fallback is
      // preserved, never rewritten as if the submitted item had been the run.
      correlationMethod, submittedQueueId,
      matchedBuildQueueId: typeof buildData.queueId === 'number' ? buildData.queueId : null,
      reconciledAt: now, reconciledBy: user.id, updatedAt: now,
    };
    await this.repo.update(id, { metadata: { ...metadata, prValidationRequest: reconciled } } as any);
    return { reconciled: true, validationRequest: reconciled };
  }

  async triggerBuild(projectId: string) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const jenkinsUrl = project ? resolveJenkinsInternalUrl(project) : null;
    if (!project || !jenkinsUrl || !project.jenkinsToken) {
      throw new BadRequestException({ success: false, code: 'JENKINS_NOT_CONFIGURED', message: 'Jenkins non configuré pour ce projet' });
    }
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
