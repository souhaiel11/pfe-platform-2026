// Service central des incidents : cycle de vie complet, routage vers WF2/WF4/WF5, validation de PR,
// autorisation de fusion, annulation WF2, récupération post-écriture — le plus gros fichier du backend.
import { redeliveryConfig, findPrValidationDeliveryInN8n, postPrValidationDelivery } from './pr-validation-redelivery';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, ServiceUnavailableException, BadGatewayException, HttpException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Incident, IncidentStatus } from './incident.entity';
import { extendSonarFiles, fixRequestHoldsFiles, releaseSonarFiles, reserveSonarFiles, SonarFileHolder, sonarTargetFiles } from './sonar-file-reservation';
import { IncidentsGateway } from './incidents.gateway';
import { Project } from '../projects/project.entity';
import { sanitizeEntityProject } from '../common/sanitize-project';
import { writeErrorToEntity } from '../common/workflow-error';
import { createHash, randomUUID } from 'crypto';
import { buildConvergenceCycles } from '../common/governance';
import { resolveJenkinsInternalUrl } from '../common/jenkins-url';
import { ManualRemediationService } from '../manual-remediation/manual-remediation.service';
import { deriveFindingsAndHealth } from '../validation/finding-pipeline-separation';
import { computeMergeAuthorization, deriveRemediationResult, deriveExactCorrelationVerified, deriveHeadVerificationResult } from '../validation/merge-authorization';
import { buildDefaultValueSemanticsEvidence, CandidateFileRecord } from '../validation/default-value-semantics-assembler';
import { validateCanonicalEvidenceBinding, mergeCanonicalEvidenceWithStatic, identityMatches, RULE_REGISTRY } from '../validation/semantic-evidence-core';
import { resolveSemanticEvidenceAdapter } from '../validation/adapters/registry';
import { CandidateVerificationService } from '../candidate-verification/candidate-verification.service';
import { HeadVerificationRequest, HeadVerification, VerificationEvidence } from '../candidate-verification/candidate-verification.types';
import { isFullGitSha } from '../candidate-verification/candidate-digest';
export { isFullGitSha };
import { redactAndCapEvidence } from '../candidate-verification/verification-evidence';
import { analyzeRegression, conservativeRegressionPolicy } from '../validation/pr-regression-engine';
import { combineRegressionVerdict } from '../validation/regression-verdict';
import { normalizeSonarFindings } from '../validation/sonar-regression-adapter';
import { buildCorrectiveContext } from '../validation/corrective-context';
import { isWorkflowIdentity, resolveAttemptWorkflowIdentity } from './workflow-attempt-identity';
import { commonPrCreatedFields, isPostWriteFailureNode, PostWriteRecoveryInput,
  postWriteRecoveryIdentity, validatePostWriteRecoveryEvidence } from './post-write-recovery';
import { ExecutionStartedInput, CancelFixRequestInput, PreWriteGateInput,
  isPositiveN8nExecutionId, isTerminalFixRequestStatus, matchesActiveAttempt,
  boundedCancelReason, cancelledFixRequest } from './wf2-cancellation.types';
import { sanitizeIncidentPatch, userMetadata } from './incident-write.dto';
import { validateExecutionBinding, validateRequestIdentifier } from './wf2-cancellation.types';
import { stopN8nExecution, N8nStopOutcome, N8nStopResult } from './n8n-execution-client';
import { isManualReviewFailure, reclassifyFindingsAsManual, MANUAL_REVIEW_SUMMARY, WF2_MANUAL_REVIEW_CODE } from './wf2-manual-review';

/** Traduit le code HTTP brut renvoyé par Jenkins lors d'un déclenchement de build en un verdict métier (accepté ou refusé + code d'erreur). */
export function classifyJenkinsTriggerStatus(status: number): { accepted: boolean; code?: string } {
  if (status === 201) return { accepted: true };
  // QA-E2E-2026-10-11 (défaut D-9, reproduit en direct).
  if (status === 303) return { accepted: false, code: 'JENKINS_TRIGGER_ALREADY_QUEUED' };
  if (status >= 300 && status < 400) return { accepted: false, code: 'JENKINS_TRIGGER_NOT_ACCEPTED' };
  if (status >= 200 && status < 300) return { accepted: false, code: 'JENKINS_TRIGGER_NOT_ACCEPTED' };
  if (status === 401 || status === 403) return { accepted: false, code: 'JENKINS_AUTH_FAILED' };
  if (status === 404) return { accepted: false, code: 'JENKINS_JOB_NOT_FOUND' };
  if (status === 400) return { accepted: false, code: 'JENKINS_TRIGGER_REJECTED' };
  if (status === 409) return { accepted: false, code: 'JENKINS_TRIGGER_CONFLICT' };
  if (status >= 500) return { accepted: false, code: 'JENKINS_UNAVAILABLE' };
  return { accepted: false, code: 'JENKINS_TRIGGER_FAILED' };
}

/** Délai maximal d'attente de la découverte d'un job PR par l'indexation multibranche Jenkins. */
const PR_JOB_DISCOVERY_TIMEOUT_MS = Number(process.env.PR_JOB_DISCOVERY_TIMEOUT_MS || 90_000);

/**
 * GET des métadonnées d'un job PR Jenkins. Une PR tout juste créée n'existe dans Jenkins qu'après
 * l'indexation du job multibranche parent (périodique) : sur un 404, on déclenche UNE indexation
 * (aucun build n'est lancé, NoTriggerBranchProperty) puis on attend l'apparition du job.
 */
export async function fetchPrJobMetadataWithDiscovery(jenkinsInternalUrl: string, resolvedJobPath: string, authHeader: string, url: string): Promise<Response> {
  const get = () => fetch(url, { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000) });
  let response = await get();
  const parentPath = resolvedJobPath.replace(/\/job\/[^/]+\/?$/, '');
  if (response.status !== 404 || !parentPath || parentPath === resolvedJobPath) return response;
  await fetch(`${jenkinsInternalUrl}${parentPath}/build?delay=0`, { method: 'POST', headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  const deadline = Date.now() + PR_JOB_DISCOVERY_TIMEOUT_MS;
  while (response.status === 404 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5_000));
    response = await get();
  }
  return response;
}

/** Nombre maximal de réexpéditions automatiques d'un callback WF3 perdu, par demande de validation. */
const MAX_PR_VALIDATION_REDELIVERIES = 3;

/** Construit l'identifiant du job Jenkins d'une PR à partir du nom du job multibranche et du numéro de PR. */
export function buildPrValidationJobName(baseJobName: string, prNumber: number): string {
  return `${baseJobName}-multibranch/job/PR-${prNumber}`;
}

/** Valide et encode un chemin de job Jenkins configuré en un chemin REST sûr (`/job/.../job/...`), en rejetant tout segment suspect. */
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

/** Dérive le "full name" interne Jenkins (`a/b`) à partir du chemin REST déjà validé (`/job/a/job/b`), pour cibler un WorkflowJob depuis un script Groovy. */
export function jenkinsWorkflowFullName(resolvedJobPath: string): string {
  const segments = String(resolvedJobPath || '').split('/job/').map(decodeURIComponent).filter(Boolean);
  if (!segments.length || segments.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Invalid Jenkins job path for script targeting');
  }
  return segments.join('/');
}

/** Échappe une chaîne pour une insertion sûre entre apostrophes dans un script Groovy. */
function escapeGroovySingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Génère le script Groovy qui ajoute (ou remplace) le paramètre Jenkins `PFE_VALIDATION_CONTEXT` sur un job identifié par son nom complet. */
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

/** Vérifie que les métadonnées Jenkins décrivent bien un job concret (buildable) de type WorkflowJob. */
export function isConcreteJenkinsBuildJob(metadata: any): boolean {
  return metadata?.buildable === true
    && metadata?._class === 'org.jenkinsci.plugins.workflow.job.WorkflowJob';
}

/** Confirme qu'un déclenchement de build Jenkins a bien été accepté (201 + URL d'item de file d'attente valide). */
export function isAcceptedJenkinsBuildResponse(status: number, queueUrl: string | null): boolean {
  return status === 201 && !!queueUrl && /\/queue\/item\/\d+\/?$/.test(queueUrl);
}

type JenkinsParameterDefinition = {
  name?: string;
  type?: string;
  _class?: string;
  defaultParameterValue?: { value?: unknown } | null;
};

/** Extrait la liste des définitions de paramètres Jenkins depuis les métadonnées brutes d'un job. */
export function getJenkinsParameterDefinitions(metadata: any): JenkinsParameterDefinition[] {
  const property = (metadata?.property || []).find((item: any) =>
    item?._class === 'hudson.model.ParametersDefinitionProperty'
  );
  return Array.isArray(property?.parameterDefinitions) ? property.parameterDefinitions : [];
}

/** Construit le corps de requête des paramètres Jenkins à partir des définitions du job, en validant chaque override contre la liste connue et en masquant les valeurs sensibles. */
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
    if (!sensitive) body.append(name, typeof value === 'boolean' ? String(value) : String(value));
    audit.push({ name, source: overridden ? 'PROJECT_ALLOWED_OVERRIDE' : 'JENKINS_DEFAULT', sensitive });
  }
  return { body, audit };
}

/** Choisit l'endpoint Jenkins à appeler selon que le job attend des paramètres ou non. */
export function selectJenkinsTriggerEndpoint(parameterized: boolean): 'build' | 'buildWithParameters' {
  return parameterized ? 'buildWithParameters' : 'build';
}

export type PrValidationStatus = 'REQUESTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** Calcule l'identité déterministe (hash SHA-256) d'une demande de validation de PR, à partir du projet, du numéro de PR, du SHA de tête et du lot. */
export function prValidationIdentity(projectId: string, prNumber: number, prHeadSha: string, batchId: string): string {
  return createHash('sha256').update(`${projectId}\n${prNumber}\n${prHeadSha.toLowerCase()}\n${batchId}`).digest('hex');
}

/** Identité dédiée à une revalidation explicite sur le même SHA (différente de prValidationIdentity pour ne jamais invalider les identités déjà persistées). */
export function prValidationRevalidationIdentity(projectId: string, prNumber: number, prHeadSha: string, batchId: string, epoch: number): string {
  return createHash('sha256').update(`${projectId}\n${prNumber}\n${prHeadSha.toLowerCase()}\n${batchId}\nrevalidation\n${Number(epoch)}`).digest('hex');
}

/** Détermine le SHA de base réel d'une tentative de correction (celui de son parent git véritable, pas forcément le SHA source d'origine). */
export function resolveDefaultValueSemanticsBaseSha(fixRequest: any): string {
  const correctiveBase = fixRequest?.correctiveDispatch?.blockedSha;
  if (isFullGitSha(correctiveBase)) return String(correctiveBase).toLowerCase();
  return String(fixRequest?.baselineSha || '').toLowerCase();
}

/** Indique si la tentative corrective en cours a été déclenchée spécifiquement pour corriger un défaut de sémantique de valeur par défaut. */
export function correctiveBlockingCausesDeclareDefaultValueSemanticsDefect(fixRequest: any): boolean {
  const causes = fixRequest?.correctiveDispatch?.correctiveContext?.blockingCauses;
  return Array.isArray(causes) && causes.some((cause: any) => cause?.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT');
}

/** Vérifie si au moins une paire de champs vérifiée correspond exactement à une cause bloquante enregistrée et que son verdict n'est pas un défaut prouvé. */
export function defaultValueSemanticsRelevantPairWasChecked(
  fixRequest: any,
  checkedFieldPairs: ReadonlyArray<{ verdict: string; ruleType?: string; [key: string]: unknown }>,
): boolean {
  const causes = fixRequest?.correctiveDispatch?.correctiveContext?.blockingCauses;
  if (!Array.isArray(causes)) return false;
  const relevantCauses = causes.filter((cause: any) => cause?.type && RULE_REGISTRY[cause.type]);
  if (!relevantCauses.length) return false;
  return relevantCauses.some((cause: any) => {
    const rule = RULE_REGISTRY[cause.type];
    return checkedFieldPairs.some(pair => pair.verdict !== 'PROVEN_DEFECT'
      && (pair.ruleType === undefined || pair.ruleType === cause.type)
      && identityMatches(rule, pair as Record<string, string>, cause));
  });
}

/** Normalise n'importe quelle forme d'URL distante GitHub (SSH, HTTPS, déjà canonique) en `owner/repo` minuscule. */
export function canonicalGitRepo(value: unknown): string {
  return String(value || '')
    .replace(/^git@github\.com:/, '')
    .replace(/^ssh:\/\/git@github\.com\//, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

/** Décode le paramètre `PFE_VALIDATION_CONTEXT` renvoyé par Jenkins (base64url/base64 + JSON) pour retrouver le contexte de validation d'origine. */
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

/** Vérifie la condition liée à Jenkins construction Matches PR validation. */
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

/** Encode le contexte de validation de PR en base64url pour le transmettre à Jenkins comme paramètre de build. */
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
  manualReviewRequired?: boolean;
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
  // R76 -- optional, bounded candidate-verification diagnostic summary (see
  // verification-evidence.ts). Never trusted blindly even though WF2 already
  // bounds it -- sanitizeVerificationEvidence() re-validates/re-caps/re-redacts
  // server-side before persistence, same defense-in-depth posture as every
  // other WF2-supplied field on this input.
  verificationEvidence?: unknown;
};

/** Retire les informations sensibles de les preuves de vérification. */
export function sanitizeVerificationEvidence(input: unknown): VerificationEvidence | null {
  if (!input || typeof input !== 'object') return null;
  const raw: any = input;
  const overall = ['PASS', 'FAIL', 'INCONCLUSIVE'].includes(raw.overall) ? raw.overall : null;
  const failureClass = typeof raw.failureClass === 'string' ? raw.failureClass.slice(0, 80) : null;
  const compileStatus = ['SUCCESS', 'FAILED', 'NOT_RUN'].includes(raw.compile?.status) ? raw.compile.status : null;
  const compileExitCode = Number.isInteger(raw.compile?.exitCode) ? raw.compile.exitCode : null;
  const regressionStatus = ['SUCCESS', 'FAILED', 'NOT_RUN', 'UNKNOWN'].includes(raw.tests?.regressionStatus) ? raw.tests.regressionStatus : null;
  const staticStatus = raw.staticAnalysis?.status === 'NOT_RUN' ? 'NOT_RUN' : null;
  return {
    overall, failureClass,
    compile: { status: compileStatus, exitCode: compileExitCode, evidenceTail: redactAndCapEvidence(raw.compile?.evidenceTail) },
    tests: { regressionStatus, evidenceTail: redactAndCapEvidence(raw.tests?.evidenceTail) },
    staticAnalysis: { status: staticStatus },
  };
}

export type StaleDispatchRecoveryInput = {
  batchId: string;
  attemptCount: number;
};

// WF2 cancellation (Phase 2, 2026-10-04) -- CANCELLED is treated exactly
// like FIX_FAILED by the retry machinery: a cancelled remediation is just
// as retryable as a failed one, never a dead end. Kept as a 2-element list
// rather than hardcoding a second literal everywhere this function's shape
// is mirrored.
const RETRYABLE_FIX_REQUEST_STATUSES = ['FIX_FAILED', 'CANCELLED'];
/** Détermine si une demande de correction échouée ou annulée peut être retentée (statut, éligibilité et absence de tentative plus récente déjà en cours). */
export function canRetryFixRequest(fixRequest: any): boolean {
  if (!RETRYABLE_FIX_REQUEST_STATUSES.includes(fixRequest?.status) || fixRequest?.retryEligible !== true) return false;
  const attemptCount = Number(fixRequest.attemptCount);
  if (!Number.isInteger(attemptCount) || attemptCount < 1) return false;
  const attempts = Array.isArray(fixRequest.attempts) ? fixRequest.attempts : [];
  const currentAttempt = attempts.find((attempt: any) => Number(attempt.attempt) === attemptCount);
  if (!currentAttempt || !RETRYABLE_FIX_REQUEST_STATUSES.includes(currentAttempt.status)) return false;
  return !attempts.some((attempt: any) => Number(attempt.attempt) > attemptCount
    && ['FIX_STARTING', 'DISPATCHED', 'PR_CREATED', 'VALIDATING', 'CANCEL_REQUESTED'].includes(String(attempt.status)));
}

/** Détermine quel workflow n8n (WF2/WF4/WF5) doit traiter un problème donné, selon sa source/scanner d'origine. */
export function remediationWorkflowFor(finding: any): RemediationWorkflow | null {
  const source = String(finding?.source || '').toUpperCase();
  const stage = String(finding?.stage || '').toLowerCase();
  return source === 'SONARQUBE' || stage === 'sonar' || stage === 'code' ? 'WF2'
    : source === 'JENKINS' || stage === 'jenkins' || stage === 'jenkinsfile' ? 'WF4'
    : source === 'DOCKER' || stage === 'docker' || stage === 'dockerfile' ? 'WF5' : null;
}

/** Calcule l'identité déterministe d'un lot de corrections (hash de l'incident + des identifiants de problèmes triés). */
export function remediationBatchIdentity(incidentId: string, findingIds: string[]): string {
  return createHash('sha256').update(`${incidentId}\n${[...new Set(findingIds)].sort().join('\n')}`).digest('hex');
}

/** Valide et construit un lot de correction à partir des identifiants demandés : existence, éligibilité à l'auto-fix, et cohérence de la stratégie de correction. */
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

const MISSING_FINDING_ID_SENTINELS = new Set(['undefined', 'null', '']);

/** Résout l'identifiant canonique d'un problème, qu'il provienne d'un finding brut (`.id`/`.key`) ou déjà canonicalisé (`.findingId`), en rejetant les valeurs sentinelles. */
function resolveCanonicalFindingId(finding: any): string | null {
  for (const candidate of [finding?.findingId, finding?.id, finding?.key]) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (!value || MISSING_FINDING_ID_SENTINELS.has(value)) continue;
    return value;
  }
  return null;
}

/** Transforme un problème brut en charge utile normalisée pour WF2/WF4/WF5, en échouant explicitement si aucun identifiant exploitable n'existe. */
export function workflowFinding(finding: any) {
  const findingId = resolveCanonicalFindingId(finding);
  if (!findingId) {
    // Fail closed BEFORE any WF2 dispatch — never serialize "undefined" or
    // silently drop the finding. Thrown synchronously inside .map(), so
    // every caller (approveFix/retryFix/correctAndRevalidate) aborts before
    // its fetch() call.
    throw new BadRequestException({ code: 'FINDING_ID_MISSING', message: 'Un problème sélectionné n’a pas d’identifiant exploitable (findingId/id/key absents ou invalides).' });
  }
  return {
    findingId,
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

/** Identité technique du balayage automatique des validations PR (traçée dans reconciledBy / lastCallbackRedeliveryBy). */
const PR_VALIDATION_RECONCILER = { id: 'system-pr-validation-reconciler', role: 'admin' };

@Injectable()
export class IncidentsService implements OnModuleInit, OnModuleDestroy {
  private prValidationSweep?: NodeJS.Timeout;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(Incident) private readonly repo: Repository<Incident>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly gateway: IncidentsGateway,
    private readonly manualRemediation: ManualRemediationService,
    private readonly candidateVerification: CandidateVerificationService,
  ) {}

  /** Démarre le balayage périodique des validations PR restées actives (callback WF3 perdu), sauf désactivation explicite. */
  onModuleInit() {
    if (process.env.PR_VALIDATION_AUTO_RECONCILE === 'false' || !redeliveryConfig()) return;
    const everyMs = Number(process.env.PR_VALIDATION_AUTO_RECONCILE_INTERVAL_MS || 5 * 60_000);
    this.prValidationSweep = setInterval(() => {
      this.sweepStalePrValidations().catch(e => console.warn(`[pr-validation] balayage automatique en échec : ${e?.message || e}`));
    }, everyMs);
    this.prValidationSweep.unref?.();
  }

  /** Arrête le balayage périodique. */
  onModuleDestroy() {
    if (this.prValidationSweep) clearInterval(this.prValidationSweep);
  }

  /** Réconcilie chaque validation PR encore QUEUED/RUNNING depuis plus de PR_VALIDATION_STALE_MS (10 min par défaut). */
  async sweepStalePrValidations() {
    const staleMs = Number(process.env.PR_VALIDATION_STALE_MS || 10 * 60_000);
    const rows: { id: string }[] = await this.repo.query(
      `SELECT id FROM incidents WHERE metadata->'prValidationRequest'->>'status' IN ('QUEUED', 'RUNNING')
        AND COALESCE((metadata->'prValidationRequest'->>'updatedAt')::timestamptz, "updatedAt") < now() - ($1::double precision * interval '1 millisecond')`,
      [staleMs]);
    for (const { id } of rows) {
      try {
        const result: any = await this.reconcilePrValidation(id, PR_VALIDATION_RECONCILER);
        if (result?.reconciled || result?.reason === 'CALLBACK_REDELIVERED') console.log(`[pr-validation] incident ${id} : ${result.reason || 'RECONCILED'}`);
      } catch (e: any) {
        console.warn(`[pr-validation] incident ${id} non réconcilié automatiquement : ${e?.message || e}`);
      }
    }
  }

  /** Retire les secrets du projet lie avant de renvoyer un incident. */
  private sanitizeIncident(incident: any) {
    return sanitizeEntityProject(incident);
  }

  /** Version d'instance de canonicalGitRepo, pour normaliser une URL de dépôt au sein du service. */
  private canonicalRepository(value: string): string {
    return canonicalGitRepo(value);
  }

  /** Récupère les détails d'une pull request GitHub (SHA de tête, état, etc.) pour le dépôt d'un projet. */
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

  /** Récupère le contenu et le SHA blob d'un fichier du dépôt GitHub à un commit donné. */
  private async githubFileAtSha(project: Project, path: string, sha: string): Promise<{ sha: string; content: string }> {
    const repository = this.canonicalRepository(project.githubRepo);
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'pfe-post-write-recovery' };
    if (project.githubToken) headers.Authorization = `Bearer ${project.githubToken}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`https://api.github.com/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`, {
      headers, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new BadGatewayException({ code: 'POST_WRITE_RECOVERY_REMOTE_FILE_UNAVAILABLE', path });
    const body: any = await response.json();
    if (!isFullGitSha(body?.sha) || body?.encoding !== 'base64' || typeof body?.content !== 'string') {
      throw new BadGatewayException({ code: 'POST_WRITE_RECOVERY_REMOTE_FILE_INVALID', path });
    }
    return { sha: String(body.sha).toLowerCase(), content: Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8') };
  }

  /** Lit le SHA de tête actuel d'une branche GitHub du dépôt du projet. */
  private async githubBranchHead(project: Project, branch: string): Promise<string> {
    const repository = this.canonicalRepository(project.githubRepo);
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'pfe-post-write-recovery' };
    if (project.githubToken) headers.Authorization = `Bearer ${project.githubToken}`;
    const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, {
      headers, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new ConflictException({ code: 'POST_WRITE_RECOVERY_BRANCH_NOT_FOUND' });
    const body: any = await response.json();
    const head = String(body?.object?.sha || '').toLowerCase();
    if (!isFullGitSha(head)) throw new BadGatewayException({ code: 'POST_WRITE_RECOVERY_BRANCH_RESPONSE_INVALID' });
    return head;
  }

  /** Vérifie auprès de n8n s'il existe déjà une exécution WF2 active, pour éviter un double déclenchement. */
  private async hasActiveWf2Execution(): Promise<boolean> {
    const apiKey = String(process.env.N8N_API_KEY || '').trim();
    if (!apiKey) throw new ServiceUnavailableException({ code: 'POST_WRITE_RECOVERY_ACTIVE_EXECUTION_UNVERIFIED' });
    const base = String(process.env.N8N_URL || 'http://n8n:5678').replace(/\/$/, '');
    const workflowId = this.configuredWf2Identity();
    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/executions?workflowId=${encodeURIComponent(workflowId)}&status=running&limit=1`, {
        headers: { 'X-N8N-API-KEY': apiKey }, signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException({ code: 'POST_WRITE_RECOVERY_ACTIVE_EXECUTION_UNVERIFIED' });
    }
    if (!response.ok) throw new ServiceUnavailableException({ code: 'POST_WRITE_RECOVERY_ACTIVE_EXECUTION_UNVERIFIED' });
    const body: any = await response.json();
    const executions = Array.isArray(body?.data) ? body.data : Array.isArray(body?.results) ? body.results : [];
    return executions.length > 0;
  }

  /** Revérifie sur GitHub que les fichiers déclarés écrits par une récupération post-écriture existent réellement au SHA annoncé. */
  private async verifyRecoveryRemoteFiles(project: Project, input: PostWriteRecoveryInput): Promise<void> {
    for (const file of input.evidence.files) {
      const remote = await this.githubFileAtSha(project, file.path, input.expectedHeadSha);
      const receipt = input.evidence.receipts.find(item => item.targetFile === file.path)!;
      if (remote.sha !== receipt.newSha.toLowerCase()) {
        throw new ConflictException({ code: 'POST_WRITE_RECOVERY_BLOB_SHA_MISMATCH', path: file.path });
      }
      const contentSha256 = createHash('sha256').update(remote.content, 'utf8').digest('hex');
      if (contentSha256 !== file.contentSha256.toLowerCase()) {
        throw new ConflictException({ code: 'POST_WRITE_RECOVERY_CONTENT_SHA_MISMATCH', path: file.path });
      }
    }
  }

  /** Liste les incidents, filtrables par projet et statut, bornés à une taille maximale. */
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
    // Increment 1 (sélection multiple CVE, cadrage OPTION A) — findingTaskId
    // par CVE, additif, voir ManualRemediationService.attachFindingTaskIds()
    // pour la raison de ce point d'attache exact (c'est ICI, pas ailleurs,
    // que metadata.enrichedData.trivy/owasp.cves atteint réellement le
    // frontend).
    return this.manualRemediation.attachFindingTaskIds(incidents.map(i => this.sanitizeIncident(i)));
  }

  /** Récupère un incident par son identifiant, ou lève une 404 s'il n'existe pas. */
  async findOne(id: string) {
    const i = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!i) throw new NotFoundException('Incident introuvable.');
    return this.sanitizeIncident(i);
  }

  /** Increment 1 (sélection multiple CVE, cadrage OPTION A). */
  async findOneForClient(id: string) {
    const [enriched] = await this.manualRemediation.attachFindingTaskIds([await this.findOne(id)]);
    return enriched;
  }

  /** Calcule les cycles de convergence (gouvernance des étapes) d'un projet à partir de ses incidents. */
  async convergence(projectId: string) {
    const incidents = await this.repo.find({ where: { projectId }, order: { createdAt: 'ASC' } });
    return { projectId, cycles: buildConvergenceCycles(incidents) };
  }

  /** Crée un nouvel incident, typiquement à partir d'un événement Jenkins reçu via webhook. */
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

    dto = sanitizeIncidentPatch(dto) as typeof dto;
    const incident = this.repo.create(dto);
    const saved = await this.repo.save(incident);
    await this.manualRemediation.syncIncident(saved);
    this.gateway.emit('incident:created', saved);
    return saved;
  }

  /** Met à jour un incident existant avec les champs fournis, après assainissement du patch. */
  async update(id: string, dto: Partial<Incident>) {
    const safe = sanitizeIncidentPatch(dto);
    await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new NotFoundException('Incident introuvable.');
      const payload: any = { ...safe };
      if (safe.metadata !== undefined) payload.metadata = { ...(current.metadata || {}), ...userMetadata(safe.metadata) };
      if (safe.errorReason) Object.assign(payload, writeErrorToEntity({ reason: safe.errorReason, detail: safe.errorDetail, step: safe.errorStep }));
      // Generic writes never transition the backend-owned remediation lifecycle.
      await repo.update(id, payload);
    });
    const updated = await this.findOne(id);
    await this.manualRemediation.syncIncident(updated as Incident);
    this.gateway.emit('incident:updated', updated);
    return updated;
  }

  /** Fusionne un patch de métadonnées qui ne touche pas au cycle de vie de l'incident (évite d'écraser l'état de workflow en cours). */
  private async mergeNonLifecycleMetadata(id: string, patch: Record<string, any>) {
    await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new NotFoundException('Incident introuvable.');
      const { fixRequest: ignored, ...other } = patch;
      await repo.update(id, { metadata: { ...(current.metadata || {}), ...other } } as any);
    });
  }

  /** Transition canonique appelée par WF2, et par la procédure contrôlée de réconciliation. */
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
        || !isWorkflowIdentity(workflowId)
        || !Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > Number(fix.attemptCount)
        || !executionId) {
        throw new ConflictException('Le statut WF2 ne correspond pas à la demande de correction active.');
      }

      const attempt = (Array.isArray(fix.attempts) ? fix.attempts : [])
        .find((entry: any) => Number(entry.attempt) === attemptCount);
      if (!attempt) throw new ConflictException('La tentative WF2 corrélée ne correspond pas à la demande active.');

      const expectedWorkflowId = resolveAttemptWorkflowIdentity(fix, attempt);
      if (!expectedWorkflowId) {
        throw new ConflictException({ code: 'WF2_ATTEMPT_IDENTITY_UNRESOLVED',
          message: 'L’identité du workflow de cette tentative ne peut pas être prouvée.' });
      }
      if (workflowId !== expectedWorkflowId) {
        throw new ConflictException('Le statut WF2 ne correspond pas à l’identité de cette tentative.');
      }

      if (attemptCount === Number(fix.attemptCount) && fix.n8nExecutionId && fix.n8nExecutionId !== executionId) {
        throw new ConflictException('Le callback ne correspond pas à l’exécution enregistrée.');
      }
      if (fix.status === 'CANCELLED') return { applied: false, duplicate: false, stale: true, incident,
        status: fix.status, code: 'STALE_OR_TERMINAL_ATTEMPT_CALLBACK' };

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
      const terminalAttempt = ['FIX_FAILED', 'PR_CREATED', 'VALIDATING', 'VALIDATED', 'REJECTED', 'CANCELLED']
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

      /** Met les valeurs au même format avant comparaison. */
      const normalize = (values: unknown): string[] => [...new Set(Array.isArray(values)
        ? values.map(String).map(value => value.trim()).filter(Boolean) : [])].sort();
      const isCorrectiveAttempt = attempt.corrective === true;
      const correctiveBlockingCauses = isCorrectiveAttempt && Array.isArray(fix.correctiveDispatch?.correctiveContext?.blockingCauses)
        ? fix.correctiveDispatch.correctiveContext.blockingCauses : [];
      const isCanonicalCorrectiveBatch = isCorrectiveAttempt && correctiveBlockingCauses.length > 0;
      const expectedFindingIds = isCanonicalCorrectiveBatch
        ? normalize(correctiveBlockingCauses.map((cause: any, index: number) =>
            cause?.findingId ? String(cause.findingId) : `${fix.batchId}:issue-${index}`))
        : normalize(fix.findingIds);
      // A cause with no findingId of its own has no proven 1:1 tie to a
      // historical finding's file either — only THAT case may legitimately
      // target a different, deterministically-grounded file (R73). A cause
      // that already names its own finding (e.g. TARGET_FINDING_INVALID)
      // keeps the strict historical-file-coverage requirement below.
      const hasUngroundedHistoricalIdentity = isCorrectiveAttempt
        && correctiveBlockingCauses.some((cause: any) => !cause?.findingId);
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
          && (hasUngroundedHistoricalIdentity || expectedFiles.every(file => plannedFiles.includes(file)))
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

      const verificationEvidence = callbackStatus === 'FAILED' ? sanitizeVerificationEvidence(input.verificationEvidence) : null;
      const attempts = fix.attempts.map((entry: any) => Number(entry.attempt) === attemptCount
        ? callbackStatus === 'FAILED'
          ? { ...entry, status: 'FIX_FAILED', workflowId, workflowExecutionId: executionId, failedAt: now,
              failureCode: String(input.failureCode || 'WF2_EXECUTION_ERROR').slice(0, 80),
              failureSummary: String(input.failureSummary || 'Erreur d’exécution WF2').slice(0, 500),
              failureNode: String(input.failureNode || '').slice(0, 120) || null,
              verificationEvidence }
          : { ...entry, status: 'PR_CREATED', workflowId, workflowExecutionId: executionId, prCreatedAt: now }
        : entry);
      events.push({
        identity: eventIdentity, workflowId, executionId, attempt: attemptCount,
        status: callbackStatus, recordedAt: now,
        source: input.reconciliation ? 'RECONCILIATION' : 'WF2_CALLBACK',
      });
      const manualReview = callbackStatus === 'FAILED' && isManualReviewFailure(input);
      const nextFix = callbackStatus === 'FAILED'
        ? { ...fix, status: 'FIX_FAILED', attempts, workflowEvents: events, failedAt: now,
            lastErrorCode: manualReview ? WF2_MANUAL_REVIEW_CODE : String(input.failureCode || 'WF2_EXECUTION_ERROR').slice(0, 80),
            lastError: manualReview ? MANUAL_REVIEW_SUMMARY : String(input.failureSummary || 'Erreur d’exécution WF2').slice(0, 500),
            manualReviewRequired: manualReview,
            failedNode: String(input.failureNode || '').slice(0, 120) || null,
            verificationEvidence,
            workflowId, workflowExecutionId: executionId,
            completionEvidence: input.completionEvidence || fix.completionEvidence || null,
            // Relancer le même lot redonnerait le même refus : seule une autre sélection est proposée.
            retryEligible: !manualReview }
        : { ...fix, ...commonPrCreatedFields({
              prUrl: String(input.prUrl), prNumber: Number(input.prNumber), prHeadSha: String(input.prHeadSha), now,
              evidence: { processedFindingIds, candidateAcceptedFindingIds: acceptedFindingIds,
                candidateVerifiedFiles: verifiedFiles, plannedFiles, updatedFiles, commitShas,
                fileResults: input.fileResults as any[] },
            }), attempts, workflowEvents: events, workflowId, workflowExecutionId: executionId,
            // Compatibility only: preserve legacy evidence if an old workflow
            // supplied it, but never synthesize scanner-resolution semantics.
            effectiveRemediatedFindingIds: normalize(input.effectiveRemediatedFindingIds),
            verifiedFiles: normalize(input.verifiedFiles) };
      if (callbackStatus === 'PR_CREATED') {
        // La PR peut toucher plus de fichiers que ceux des constats sélectionnés : on les réserve aussi.
        const extended = await extendSonarFiles(manager,
          { projectId: incident.projectId, incidentId: id, batchId: fix.batchId, files: [...expectedFiles, ...verifiedFiles] });
        nextFix.fileLock = { ...(fix.fileLock || {}), reservedAt: fix.fileLock?.reservedAt || now,
          files: [...new Set([...(fix.fileLock?.files || []), ...extended.files])].sort(),
          ...(extended.contested.length ? { contestedFiles: extended.contested } : {}) };
      }
      const nextMetadata = callbackStatus === 'PR_CREATED'
        ? this.invalidateActiveValidationForNewSha({ ...metadata, fixRequest: nextFix }, String(input.prHeadSha || ''), 'CORRECTIVE_PR_CREATED')
        : manualReview
          ? reclassifyFindingsAsManual({ ...metadata, fixRequest: nextFix }, expectedFindingIds)
          : { ...metadata, fixRequest: nextFix };
      const patch: any = { metadata: nextMetadata };
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
    if (result.applied && result.status === 'PR_CREATED') {
      this.dispatchAutomaticInitialPrValidation(id).catch(error => {
        console.warn(`[incidents] automatic initial PR validation failed for incident ${id}: ${error?.message || error}`);
      });
    }
    return { success: true, applied: result.applied, duplicate: result.duplicate, stale: result.stale,
      incidentId: id, status: result.status, ...(result.code ? { code: result.code } : {}) };
  }

  /** Transmet automatique Initial PR validation. */
  private async dispatchAutomaticInitialPrValidation(id: string): Promise<void> {
    const systemActor = { id: 'system-auto-pr-validation', role: 'admin' };
    await this.requestPrValidation(id, systemActor);
  }

  /** Réconcilie périmé envoi. */
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

  /** Enregistre exécution Started. */

  // PART 2 -- called by WF2 itself, immediately after intake, to register
  // its own n8n execution id before anything else happens. Must tolerate
  // arriving while startFix() is still between FIX_STARTING and DISPATCHED
  // (see PART 3 below) -- hence accepting both statuses, never assuming one.
  /** Enregistre qu'une exécution n8n a réellement démarré pour cette demande, afin de pouvoir plus tard l'annuler ou la surveiller. */
  async recordExecutionStarted(id: string, requestId: string, input: ExecutionStartedInput) {
    validateExecutionBinding(input);
    validateRequestIdentifier(requestId);
    if (!input || requestId !== input.requestId) {
      throw new ConflictException('L’identifiant de la demande de correction ne correspond pas.');
    }
    if (!isPositiveN8nExecutionId(input.executionId)) {
      throw new BadRequestException('L’identifiant d’exécution n8n est invalide.');
    }
    const result = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const metadata: any = incident.metadata || {};
      const fix: any = metadata.fixRequest || {};
      if (!matchesActiveAttempt(fix, requestId, input.batchId, input.attemptCount)) {
        throw new ConflictException('L’exécution WF2 ne correspond pas à la demande de correction active.');
      }
      if (fix.workflow !== 'WF2' || (fix.n8nExecutionId && fix.n8nExecutionId !== input.executionId)) {
        throw new ConflictException('WF2 execution ownership mismatch.');
      }
      if (fix.sideEffectsStarted === true) {
        throw new ConflictException('Execution registration after Git barrier is forbidden.');
      }
      const now = new Date().toISOString();
      // The narrow, critical race this whole feature exists to close: a
      // cancellation already arrived (and is, by construction of the cancel
      // endpoint, necessarily BEFORE any persistent Git side effect --
      // sideEffectsStarted can never be true while status is still
      // CANCEL_REQUESTED, see the pre-write gate below) -- so it is always
      // safe to resolve straight to CANCELLED here, never to DISPATCHED.
      if (fix.status === 'CANCEL_REQUESTED') {
        const nextFix = cancelledFixRequest({ ...fix, n8nExecutionId: input.executionId,
          executionRegisteredAt: fix.executionRegisteredAt || now,
          lastHeartbeatAt: now, executionPhase: 'STARTED' }, now);
        await repo.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
        return { cancelRequested: true, cancelled: true };
      }
      if (!['FIX_STARTING', 'DISPATCHED'].includes(fix.status)) {
        // Late/duplicate registration against an already-terminal request
        // (including a plain CANCELLED with no pending cancellation) --
        // idempotent no-op, never an error, never overwritten.
        return { cancelRequested: true, cancelled: fix.status === 'CANCELLED', stale: true, status: fix.status };
      }
      const nextFix = { ...fix, n8nExecutionId: input.executionId,
        executionRegisteredAt: fix.executionRegisteredAt || now,
        lastHeartbeatAt: now, executionPhase: 'STARTED' };
      await repo.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
      return { cancelRequested: false, cancelled: false };
    });
    if (result.cancelled) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
    }
    return { success: true, ...result };
  }

  /** Renvoie pre écriture contrôle pour le traitement ou l’affichage. */
  async preWriteGate(id: string, requestId: string, input: PreWriteGateInput) {
    validateExecutionBinding(input);
    validateRequestIdentifier(requestId);
    const result = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const metadata: any = incident.metadata || {};
      const fix: any = metadata.fixRequest || {};
      if (!input || requestId !== input.requestId || !matchesActiveAttempt(fix, requestId, input.batchId, input.attemptCount)) {
        throw new ConflictException('La porte d’écriture WF2 ne correspond pas à la demande de correction active.');
      }
      if (fix.workflow !== 'WF2' || !isPositiveN8nExecutionId(input.executionId)
        || fix.n8nExecutionId !== input.executionId
        || typeof fix.executionRegisteredAt !== 'string' || !Number.isFinite(Date.parse(fix.executionRegisteredAt))) {
        throw new ConflictException('WF2 execution ownership mismatch.');
      }
      const now = new Date().toISOString();
      if (fix.status === 'CANCEL_REQUESTED') {
        if (fix.sideEffectsStarted === true) throw new ConflictException('Inconsistent cancellation state.');
        const nextFix = cancelledFixRequest(fix, now);
        await repo.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
        return { allowed: false, cancelRequested: true };
      }
      if (isTerminalFixRequestStatus(fix.status)) {
        // Another terminal outcome already won (e.g. an admin's stale-
        // dispatch reconciliation raced in) -- never overwritten, never
        // allowed either: whatever already decided this request's fate
        // stands.
        return { allowed: false, cancelRequested: false };
      }
      if (!['FIX_STARTING', 'DISPATCHED'].includes(fix.status)) {
        return { allowed: false, cancelRequested: false };
      }
      const nextFix = { ...fix, sideEffectsStarted: true, sideEffectsStartedAt: fix.sideEffectsStartedAt || now,
        executionPhase: 'GIT_WRITE', lastHeartbeatAt: now };
      await repo.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
      return { allowed: true, cancelRequested: false };
    });
    if (!result.allowed && result.cancelRequested) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
    }
    return result;
  }

  /** Annule correction demande. */
  async cancelFixRequest(id: string, requestId: string, input: CancelFixRequestInput, user: any) {
    this.assertCanApprove(user);
    validateRequestIdentifier(requestId);
    const reason = boundedCancelReason(input?.reason);

    const phase1 = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const metadata: any = incident.metadata || {};
      const fix: any = metadata.fixRequest || {};
      if (!fix.requestId || fix.requestId !== requestId) {
        throw new ConflictException('La demande de correction ciblée est introuvable ou obsolète.');
      }
      if (fix.workflow !== 'WF2' || !Number.isInteger(fix.attemptCount) || fix.attemptCount < 1) {
        throw new ConflictException('Current WF2 attempt cannot be proven.');
      }
      if (fix.n8nExecutionId && (!isPositiveN8nExecutionId(fix.n8nExecutionId)
        || typeof fix.executionRegisteredAt !== 'string' || !Number.isFinite(Date.parse(fix.executionRegisteredAt)))) {
        throw new ConflictException('Invalid registered execution identifier.');
      }
      if (isTerminalFixRequestStatus(fix.status)) {
        return { outcome: 'terminal' as const, status: fix.status };
      }
      if (fix.sideEffectsStarted === true) {
        return { outcome: 'too_late' as const };
      }
      if (!['FIX_STARTING', 'DISPATCHED', 'CANCEL_REQUESTED'].includes(fix.status)) {
        // Fail-closed: no known non-terminal status besides these three
        // should ever reach here; never guess a behaviour for one that does.
        throw new ConflictException('Cette demande de correction ne peut pas être annulée dans son état actuel.');
      }
      // B2 vs B16: a concurrent sibling call still resolving (no recorded
      // attempt error yet) must never trigger a second real n8n stop call --
      // but once a PRIOR attempt has actually finished and failed
      // (lastCancelAttemptError set by finalizeCancellation), a fresh cancel
      // click is a deliberate, explicit retry and must be allowed to try again.
      const priorAttemptFailed = fix.status === 'CANCEL_REQUESTED' && !!fix.lastCancelAttemptError;
      const alreadyRequested = fix.status === 'CANCEL_REQUESTED' && !priorAttemptFailed;
      const now = new Date().toISOString();
      const nextFix = { ...fix, status: 'CANCEL_REQUESTED',
        cancelRequestedAt: fix.cancelRequestedAt || now,
        cancelReason: fix.cancelReason ?? reason,
        ...(priorAttemptFailed ? { lastCancelAttemptError: null } : {}) };
      await repo.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
      return { outcome: 'requested' as const, alreadyRequested, executionId: fix.n8nExecutionId || null, batchId: fix.batchId, attemptCount: fix.attemptCount };
    });

    if (phase1.outcome === 'terminal') {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
      return { success: true, status: phase1.status, alreadyTerminal: true };
    }
    if (phase1.outcome === 'too_late') {
      throw new ConflictException({ code: 'CANCELLATION_TOO_LATE',
        message: 'La correction a déjà commencé à écrire sur GitHub et ne peut plus être annulée automatiquement.' });
    }

    const updatedAfterRequest = await this.findOne(id);
    this.gateway.emit('incident:updated', updatedAfterRequest);

    if (phase1.alreadyRequested) {
      // B2 -- a cancellation is already pending: never call n8n stop a
      // second time for the same reason it was already called once; just
      // reflect the current real state.
      const currentFix: any = (updatedAfterRequest.metadata as any)?.fixRequest || {};
      return { success: true, status: currentFix.status, duplicate: true,
        waitingForExecutionRegistration: currentFix.status === 'CANCEL_REQUESTED' && !currentFix.n8nExecutionId };
    }

    if (!phase1.executionId) {
      // PART 7 -- cancelled before the execution id was ever registered:
      // nothing to stop yet. recordExecutionStarted() above will see
      // CANCEL_REQUESTED and resolve to CANCELLED itself when it arrives.
      return { success: true, status: 'CANCEL_REQUESTED', waitingForExecutionRegistration: true };
    }

    const stop = await stopN8nExecution(phase1.executionId);
    return this.finalizeCancellation(id, requestId, phase1.batchId, phase1.attemptCount, phase1.executionId, stop);
  }

  /** Prépare le résultat lié à finalize annulation. */
  private async finalizeCancellation(id: string, requestId: string, batchId: string, attemptCount: number, executionId: string, stop: N8nStopResult) {
    // Fail-closed: only an outcome that PROVES the execution is no longer
    // running is allowed to resolve CANCEL_REQUESTED -> CANCELLED. NOT_FOUND
    // is deliberately excluded -- n8n's own API returns the identical 404
    // both when the execution is genuinely gone AND when this API key
    // simply cannot see the workflow (misconfigured scope/sharing); treating
    // that as "safely stopped" would not be fail-closed.
    const resolvableOutcomes: N8nStopOutcome[] = ['STOP_SUCCEEDED', 'ALREADY_STOPPED'];
    const result = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const metadata: any = incident.metadata || {};
      const fix: any = metadata.fixRequest || {};
      if (!matchesActiveAttempt(fix, requestId, batchId, attemptCount) || fix.n8nExecutionId !== executionId || fix.status !== 'CANCEL_REQUESTED') {
        // Something else already resolved this request (a real terminal
        // callback, an admin reconciliation, the pre-write gate, or even a
        // second finalization) -- never overwritten.
        return { status: fix.status, resolved: false, alreadyMoved: true };
      }
      if (fix.sideEffectsStarted === true) {
        // The pre-write gate won the race between phase 1's commit and this
        // transaction -- never claim CANCELLED once Git writes may have begun.
        return { status: fix.status, resolved: false, tooLateDiscovered: true };
      }
      if (!resolvableOutcomes.includes(stop.outcome)) {
        const nextFix = { ...fix, lastCancelAttemptError: stop.outcome, lastCancelAttemptAt: new Date().toISOString() };
        await repo.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
        return { status: 'CANCEL_REQUESTED', resolved: false, stopOutcome: stop.outcome };
      }
      const now = new Date().toISOString();
      const attempts = (Array.isArray(fix.attempts) ? fix.attempts : []).map((attempt: any) =>
        Number(attempt.attempt) === Number(fix.attemptCount) ? { ...attempt, status: 'CANCELLED', cancelledAt: now } : attempt);
      const nextFix = { ...fix, status: 'CANCELLED', cancelledAt: now, attempts, retryEligible: true };
      await repo.update(id, { metadata: { ...metadata, fixRequest: nextFix } } as any);
      return { status: 'CANCELLED', resolved: true };
    });
    if (result.resolved || result.tooLateDiscovered) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
    }
    if (result.tooLateDiscovered) {
      throw new ConflictException({ code: 'CANCELLATION_TOO_LATE',
        message: 'La correction a déjà commencé à écrire sur GitHub et ne peut plus être annulée automatiquement.' });
    }
    if (!result.resolved && result.stopOutcome) {
      return { success: true, status: result.status, n8nStopOutcome: result.stopOutcome,
        error: 'Impossible de confirmer l’arrêt de l’exécution n8n. Vous pouvez réessayer.' };
    }
    return { success: true, status: result.status };
  }

  /** Supprime un incident par son identifiant. */
  async remove(id: string) {
    const i = await this.findOne(id);
    await this.repo.remove(i);
    return { message: 'Incident supprimé.' };
  }

  /** Persiste le résultat de validation post-PR envoyé par WF3 (findings approuvés, régression, autorisation de merge) sur l'incident. */
  async saveValidation(id: string, validation: any) {
    const incident = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!incident) throw new NotFoundException('Incident introuvable.');
    const currentMeta = (incident as any).metadata || {};
    const fixRequest = currentMeta.fixRequest || {};
    /** Normalise l’identité du dépôt avant comparaison. */
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
    // Même identité que requestPrValidation() (project.jenkinsJobName). Pour un job
    // principal multibranch, incident.jenkinsJobName vaut « <job>/<branche> »
    // (ex. projet-validation-vermeg/main) : le comparer rejetait en 409 toute
    // validation WF3 légitime de ces projets.
    const expectedJenkinsJob = incident.project?.jenkinsJobName || incident.jenkinsJobName;
    if (validation.jenkinsJob !== expectedJenkinsJob) throw new ConflictException('La validation ne correspond pas au job Jenkins attendu.');
    const expectedPrJob = buildPrValidationJobName(expectedJenkinsJob, prNumber);
    if (validation.prValidationJob !== expectedPrJob) throw new ConflictException('La validation ne correspond pas au job PR attendu.');
    if (!isFullGitSha(validation.expectedPrHeadSha) || !isFullGitSha(validation.checkoutSha)
      || validation.expectedPrHeadSha.toLowerCase() !== validation.checkoutSha.toLowerCase()
      || validation.expectedPrHeadSha.toLowerCase() !== String(validationRequest.expectedPrHeadSha).toLowerCase()) {
      throw new ConflictException('Le commit validé ne correspond pas au HEAD attendu de la Pull Request.');
    }
    const headVerification: any = validationRequest.headVerification;
    if (headVerification) {
      const expectedTarget = String(validationRequest.expectedPrHeadSha || '').toLowerCase();
      const headOk = headVerification.mode === 'HEAD_ONLY' && headVerification.overall === 'PASS'
        && headVerification.workspace?.exactShaVerified === true
        && String(headVerification.workspace?.checkoutSha || '').toLowerCase() === expectedTarget
        && String(headVerification.identity?.targetSha || '').toLowerCase() === expectedTarget
        && String(headVerification.identity?.validationRequestId || '') === String(validationRequest.validationRequestId || '')
        && String(headVerification.identity?.requestId || '') === String(fixRequest.requestId || '')
        && String(headVerification.identity?.batchId || '') === String(fixRequest.batchId || '')
        && Number(headVerification.identity?.candidateAttempt) === Number(fixRequest.attemptCount)
        && canonicalRepo(headVerification.identity?.repository || '') === repository;
      if (!headOk) throw new ConflictException('La preuve de vérification HEAD ne correspond pas à l’identité de validation attendue.');
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
    const passed = jenkinsStatus === 'SUCCESS' && correlationVerified && !missingRequiredStage && !badStage && everyFindingValid;
    const validationStatus = passed ? 'VALIDATED' : (hasInvalidFinding ? 'INVALID' : 'INCONCLUSIVE');
    const validationRecord = {
      ...validation, findingResults, passed, validationStatus, projectId: incident.projectId,
      incidentId: incident.id, fixRequestId: fixRequest.requestId, repository, prNumber, buildNumber,
      jenkinsStatus, sonarStatus, correlationVerified, validatedAt: new Date().toISOString(),
      // BRIQUE 4 — sonarStatus deliberately absent from failureReasons: a red
      // global Quality Gate is never framed as a remediation "failure reason"
      // here (it surfaces as a mergeAuthorization advisory instead, see below).
      failureReasons: [jenkinsStatus !== 'SUCCESS' ? `Jenkins=${jenkinsStatus || 'MISSING'}` : null,
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

    const baselineSonar = (currentMeta as any)?.enrichedData?.sonar;
    const baselineSonarIssues = baselineSonar?.issues;
    const frozenBaselineSha = isFullGitSha((fixRequest as any).baselineSha) ? String((fixRequest as any).baselineSha).toLowerCase() : null;
    const currentSourceCommitSha = isFullGitSha((currentMeta as any)?.sourceCommitSha) ? String((currentMeta as any).sourceCommitSha).toLowerCase() : null;
    const baselineCorrelated = !!frozenBaselineSha && frozenBaselineSha === currentSourceCommitSha;
    const baselineTotal = Number(baselineSonar?.total);
    const baselineCollectedCount = Number(baselineSonar?.collectedCount);
    const baselineComplete = baselineCorrelated && baselineSonar?.complete === true && Array.isArray(baselineSonarIssues)
      && Number.isInteger(baselineTotal) && baselineTotal >= 0
      && Number.isInteger(baselineCollectedCount) && baselineCollectedCount >= 0
      && baselineCollectedCount === baselineTotal
      && baselineSonarIssues.length === baselineCollectedCount;
    // BRIQUE 3 CLOSEOUT — PART 3/4 : la complétude du candidat est un booléen
    // explicite fourni par WF3 ("Get Full Candidate Sonar Snapshot" ->
    // candidateSnapshotComplete), jamais inférée de "c'est un tableau" (un
    // tableau tronqué par une pagination incomplète serait sinon traité comme
    // complet). L'égalité exacte candidateSha == expectedCandidateSha reste
    // revérifiée à l'intérieur même d'analyzeRegression.
    const candidateComplete = (validation as any).candidateSnapshotComplete === true
      && Array.isArray((validation as any).candidateFindingsSnapshot);
    const candidateShaMatches = isFullGitSha(validation.checkoutSha) && isFullGitSha(validation.expectedPrHeadSha)
      && validation.checkoutSha.toLowerCase() === validation.expectedPrHeadSha.toLowerCase();
    const regression = analyzeRegression({
      expectedCandidateSha: validation.expectedPrHeadSha,
      baseline: {
        sha: baselineCorrelated ? frozenBaselineSha : null,
        findings: normalizeSonarFindings(baselineSonarIssues),
        complete: baselineComplete,
      },
      candidate: {
        sha: isFullGitSha(validation.checkoutSha) ? String(validation.checkoutSha).toLowerCase() : null,
        findings: normalizeSonarFindings((validation as any).candidateFindingsSnapshot),
        complete: candidateComplete,
      },
      policy: conservativeRegressionPolicy,
    });
    const evidenceReasons: string[] = [];
    if (!frozenBaselineSha || !currentSourceCommitSha) evidenceReasons.push('BASELINE_SHA_UNAVAILABLE');
    else if (!baselineCorrelated) evidenceReasons.push('BASELINE_SHA_MISMATCH');
    if (!baselineComplete) evidenceReasons.push('BASELINE_SNAPSHOT_INCOMPLETE');
    if (!candidateShaMatches) evidenceReasons.push('CANDIDATE_SHA_MISMATCH');
    if (!candidateComplete) evidenceReasons.push('CANDIDATE_SNAPSHOT_INCOMPLETE');
    const evidenceIntegrity = { ok: evidenceReasons.length === 0, reasons: evidenceReasons };
    const headVerificationResult = deriveHeadVerificationResult(headVerification);
    // TODO: PROVEN requires persisted evidence of equivalent Sonar profiles/configuration
    // tied to BOTH exact analyses. No callback boolean may enable comparability.
    const scannerComparability = 'UNPROVEN' as const;
    const combinedVerdict = combineRegressionVerdict({
      headVerificationResult, scannerDiff: regression, evidenceIntegrity, scannerComparability,
    });
    (validationRecord as any).regression = {
      ...regression,
      contractVersion: 1,
      ...combinedVerdict,
      scannerDiff: regression,
      headVerificationResult,
      evidenceIntegrity,
      scannerComparability,
      blockingIntroducedFindings: combinedVerdict.blockingCauses.flatMap(cause =>
        cause.type === 'SCANNER_FINDING' ? [cause.finding] : []),
    };

    const candidateFileRecords: CandidateFileRecord[] = (Array.isArray(fixRequest.fileResults) ? fixRequest.fileResults : [])
      .map((fr: any) => ({ targetFile: String(fr.targetFile || ''), fileOperation: String(fr.fileOperation || ''), oldSha: fr.oldSha ?? null, newSha: String(fr.newSha || '') }))
      .filter((fr: CandidateFileRecord) => fr.targetFile && fr.newSha);
    const defaultValueSemanticsBaseSha = resolveDefaultValueSemanticsBaseSha(fixRequest);
    let defaultValueSemanticsAudit: Awaited<ReturnType<typeof buildDefaultValueSemanticsEvidence>>;
    try {
      defaultValueSemanticsAudit = await buildDefaultValueSemanticsEvidence(
        candidateFileRecords,
        {
          fixRequestId: String(fixRequest.requestId || ''), batchId: String(fixRequest.batchId || ''),
          attemptCount: Number(fixRequest.attemptCount) || 0,
          candidateId: `${fixRequest.batchId}-attempt-${fixRequest.attemptCount}`,
          candidateDigest: (fixRequest as any).candidateDigest ?? null,
          candidateBaseSha: defaultValueSemanticsBaseSha,
          prHeadSha: String(validation.checkoutSha || '').toLowerCase(),
        },
        (path, sha) => this.githubFileAtSha(incident.project, path, sha),
      );
    } catch {
      defaultValueSemanticsAudit = {
        verdict: 'VERIFICATION_REQUIRED', evaluatedSha: String(validation.checkoutSha || '').toLowerCase(),
        candidateId: `${fixRequest.batchId}-attempt-${fixRequest.attemptCount}`, candidateDigest: null,
        fixRequestId: String(fixRequest.requestId || ''), batchId: String(fixRequest.batchId || ''),
        attemptCount: Number(fixRequest.attemptCount) || 0, evidence: [], checkedPairs: 0, checkedFieldPairs: [], computedAt: new Date().toISOString(),
      };
    }
    const semanticEvidenceEnvelope = (validation as any).semanticEvidence;
    const semanticEvidenceAdapter = resolveSemanticEvidenceAdapter(semanticEvidenceEnvelope?.reportFormat);
    if (semanticEvidenceAdapter) {
      const executionIdentity = { provider: 'JENKINS', buildId: buildNumber };
      const canonicalEvidence = semanticEvidenceAdapter
        .parse(semanticEvidenceEnvelope.payload, { evaluatedSha: String(validation.checkoutSha || ''), executionIdentity })
        .map(e => validateCanonicalEvidenceBinding(e, validation.checkoutSha, executionIdentity))
        .filter((e): e is NonNullable<typeof e> => e !== null);
      if (canonicalEvidence.length) {
        defaultValueSemanticsAudit = mergeCanonicalEvidenceWithStatic(
          defaultValueSemanticsAudit,
          canonicalEvidence,
          (identity, ruleType) => (defaultValueSemanticsAudit.checkedFieldPairs || []).find((p: any) =>
            (p.ruleType === undefined || p.ruleType === ruleType) && identityMatches(RULE_REGISTRY[ruleType], identity, p)),
        ) as typeof defaultValueSemanticsAudit;
      }
    }
    (validationRecord as any).defaultValueSemantics = defaultValueSemanticsAudit;
    // R79 — this batch's own corrective reason (not any project-specific
    // literal) determines whether an unresolved/stale re-check may be
    // silently ignored — see computeMergeAuthorization's doc.
    const defaultValueSemanticsRequired = correctiveBlockingCausesDeclareDefaultValueSemanticsDefect(fixRequest);
    const defaultValueSemanticsEvaluatedShaMatches = String(defaultValueSemanticsAudit.evaluatedSha || '').toLowerCase()
      === String(validation.checkoutSha || '').toLowerCase();
    const defaultValueSemanticsRelevantPairChecked = defaultValueSemanticsRelevantPairWasChecked(
      fixRequest, defaultValueSemanticsAudit.checkedFieldPairs || [],
    );

    const mergeAuth = computeMergeAuthorization({
      remediationResult: deriveRemediationResult(
        findingResults.map(r => r.result as 'VALID' | 'INVALID' | 'INCONCLUSIVE'),
      ),
      exactCorrelationVerified: deriveExactCorrelationVerified({
        correlationVerified: validation.correlationVerified,
        checkoutSha: validation.checkoutSha,
        expectedPrHeadSha: validation.expectedPrHeadSha,
      }),
      requiredStagesComplete: jenkinsStatus === 'SUCCESS' && !missingRequiredStage && !badStage,
      regressionResult: combinedVerdict.result,
      headVerificationResult,
      pipelineHealth: (validationRecord as any).derived?.pipelineHealth ?? null,
      validationInProgress: false, // saveValidation est terminal
      defaultValueSemanticsResult: defaultValueSemanticsAudit.verdict,
      defaultValueSemanticsRequired,
      defaultValueSemanticsEvaluatedShaMatches,
      defaultValueSemanticsCheckedPairs: defaultValueSemanticsAudit.checkedPairs,
      defaultValueSemanticsRelevantPairChecked,
    });
    // BRIQUE 4 — AUTHORIZED SHA: liée à un commit EXACT, jamais transférée
    // silencieusement. Persistée UNIQUEMENT quand authorization===MERGE_READY ;
    // si la PR change ensuite, cette valeur reste figée sur l'ancien SHA et ne
    // peut jamais autoriser un nouveau HEAD (une toute nouvelle validation
    // gouvernée doit recalculer sa propre mergeAuthorization pour le SHA cible).
    const authorizedSha = mergeAuth.authorization === 'MERGE_READY' && isFullGitSha(validation.checkoutSha)
      ? String(validation.checkoutSha).toLowerCase() : null;
    const correctiveActionAllowed = mergeAuth.authorization === 'BLOCKED';
    (validationRecord as any).mergeAuthorization = {
      ...mergeAuth,
      advisories: [...mergeAuth.advisories, ...combinedVerdict.advisories.map(({ code, message }) => ({ code, message }))],
      authorizedSha,
      correctiveActionAllowed,
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

    await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const latest = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!latest || JSON.stringify(latest.metadata?.fixRequest || {}) !== JSON.stringify(fixRequest)
        || JSON.stringify(latest.metadata?.prValidationRequest || null) !== JSON.stringify(validationRequest)
        || ['CANCEL_REQUESTED', 'CANCELLED'].includes(String(latest.metadata?.fixRequest?.status))) {
        throw new ConflictException('La correction ou la validation a changé pendant le traitement.');
      }
      await repo.update(id, { metadata: { ...(latest.metadata || {}), validation: mergedMeta.validation,
        cycles: mergedMeta.cycles, prValidationRequest: mergedMeta.prValidationRequest, fixRequest: mergedMeta.fixRequest },
        status: newStatus as IncidentStatus } as any);
    });

    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { ...updated, validation: validationRecord };
  }

  /** Vérifie que l'utilisateur courant a le rôle requis pour approuver/rejeter une correction, sinon lève une interdiction. */
  private assertCanApprove(user: any) {
    if (!user || !['admin', 'developer'].includes(String(user.role || '').toLowerCase())) {
      throw new ForbiddenException('Vous n’avez pas l’autorisation de demander une correction pour ce projet.');
    }
  }

  /** Prépare le résultat lié à invalidate actif validation pour nouveau SHA. */
  private invalidateActiveValidationForNewSha(metadata: any, newSha: string, reason: string): any {
    const current: any = metadata?.validation;
    const targetSha = String(newSha || '').toLowerCase();
    const currentSha = String(current?.mergeAuthorization?.forSha || current?.checkoutSha || '').toLowerCase();
    if (!current || !isFullGitSha(targetSha) || !currentSha || currentSha === targetSha) return metadata;
    const now = new Date().toISOString();
    const history = Array.isArray(metadata.validationHistory) ? [...metadata.validationHistory] : [];
    history.push({ ...current, invalidatedAt: now, invalidatedForSha: targetSha, invalidationReason: reason });
    const previousRegression = current.regression || {};
    const activeValidation = {
      ...current,
      checkoutSha: null,
      headVerification: null,
      findingResults: [],
      candidateFindingsSnapshot: null,
      candidateSnapshotComplete: false,
      regression: {
        ...previousRegression,
        result: 'INCONCLUSIVE',
        candidateSha: targetSha,
        blockingIntroducedFindings: [],
      },
      derived: current.derived ? {
        ...current.derived,
        findings: [],
        pipelineHealth: current.derived.pipelineHealth ? {
          build: 'UNKNOWN', tests: 'UNKNOWN', sonarQualityGate: 'UNKNOWN',
          trivy: 'UNKNOWN', owasp: 'UNKNOWN', zap: 'UNKNOWN',
          technicalFailure: 'VALIDATION_STALE', requiredStagesStatus: 'INCOMPLETE',
        } : null,
      } : current.derived,
      validationStatus: 'INCONCLUSIVE',
      result: 'INCONCLUSIVE',
      staleForSha: targetSha,
      staleAt: now,
      mergeAuthorization: {
        ...(current.mergeAuthorization || {}),
        authorization: 'INCONCLUSIVE',
        headVerificationResult: 'INCONCLUSIVE',
        regressionResult: 'INCONCLUSIVE',
        authorizedSha: null,
        correctiveActionAllowed: false,
        blockingReasons: [],
        technicalReasons: ['VALIDATION_STALE'],
        forSha: targetSha,
        computedAt: now,
      },
    };
    return { ...metadata, validation: activeValidation, validationHistory: history };
  }

  /** Rassemble tous les problèmes détectés (Sonar/Trivy/OWASP/ZAP) attachés à un incident, dans une liste unique. */
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

  /** Détermine le ou les problèmes concernés par une demande d'approbation (un seul findingId explicite, ou tous les éligibles). */
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

  /** Résout l'URL du webhook n8n correspondant à un workflow de remédiation (WF2/WF4/WF5). */
  private workflowUrl(workflow: string): string {
    const base = process.env.N8N_URL || 'http://n8n:5678';
    const paths: Record<string, string> = {
      WF2: process.env.N8N_WF2_WEBHOOK || `${base}/webhook/wf2-approve`,
      WF4: process.env.N8N_WF4_APPLY_WEBHOOK || `${base}/webhook/jenkinsfile-apply`,
      WF5: process.env.N8N_WF5_APPLY_WEBHOOK || `${base}/webhook/dockerfile-apply`,
    };
    return paths[workflow];
  }

  /** Lit l'identité de workflow WF2 configurée côté backend, utilisée pour corréler les dispatches. */
  private configuredWf2Identity(): string {
    const identity = process.env.N8N_WF2_ID;
    if (!isWorkflowIdentity(identity)) {
      throw new ServiceUnavailableException({ code: 'WF2_DISPATCH_IDENTITY_UNCONFIGURED',
        message: 'L’identité du workflow WF2 doit être configurée avant une nouvelle tentative.' });
    }
    return identity;
  }

  /** Rassemble le contexte GitHub nécessaire au dispatch (branche par défaut, SHA, contenu du fichier ciblé). */
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

  /** Point d'entrée de l'approbation humaine : lance la correction automatique pour le(s) problème(s) sélectionné(s). */
  async approveFix(id: string, user: any, body: { findingId?: string; findingIds?: string[] } = {}) {
    return this.startFix(id, user, body, false);
  }

  /** Retente une correction précédemment échouée ou annulée, en réutilisant le même point d'entrée que l'approbation initiale. */
  async retryFix(id: string, user: any) {
    return this.startFix(id, user, {}, true);
  }

  /** Identifie le détenteur d'une réservation de fichier : incident (bloque tant que sa correction tient ses fichiers), tâche WF6 (bloque toujours), ou réservation orpheline. */
  private async describeSonarFileHolder(manager: EntityManager, holderId: string): Promise<SonarFileHolder> {
    const holder = await manager.getRepository(Incident).findOne({ where: { id: holderId } });
    if (holder) {
      const fix = (holder.metadata as any)?.fixRequest;
      return { kind: 'INCIDENT', needsFiles: fixRequestHoldsFiles(fix), title: holder.title,
        prNumber: Number(fix?.prNumber) || null, prUrl: fix?.prUrl || holder.prUrl || null };
    }
    const [task] = await manager.query(`SELECT id FROM manual_remediation_tasks WHERE id = $1::uuid`, [holderId]);
    return task ? { kind: 'SECURITY_TASK', needsFiles: true } : { kind: 'ORPHAN', needsFiles: false };
  }

  /** « Merge effectué » : constate sur GitHub que la PR de correction Sonar est fusionnée (ou fermée sans merge) et libère les fichiers qu'elle réservait. */
  async confirmPullRequestMerged(id: string, user: any) {
    this.assertCanApprove(user);
    const incident = await this.repo.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident introuvable.');
    const fix: any = (incident.metadata as any)?.fixRequest;
    if (!fix || fix.workflow !== 'WF2' || !fix.prUrl || !Number.isSafeInteger(Number(fix.prNumber))) {
      throw new ConflictException('Aucune Pull Request de correction en attente de merge pour cet incident.');
    }
    if (fix.fileLock?.releasedAt) {
      return { incidentId: id, status: 'FILES_RELEASED', alreadyReleased: true, reason: fix.fileLock.releaseReason, files: fix.fileLock.files || [] };
    }
    const project = await this.projectRepo.findOne({ where: { id: incident.projectId } });
    if (!project) throw new BadRequestException('Le projet associé à cet incident est introuvable.');
    const pr = await this.githubPullRequest(project, Number(fix.prNumber));
    const merged = pr?.merged === true;
    if (!merged && pr?.state !== 'closed') {
      throw new ConflictException(`La Pull Request #${fix.prNumber} n’est pas encore fusionnée sur GitHub.`);
    }
    if (merged && (!pr?.base?.repo?.default_branch || pr?.base?.ref !== pr.base.repo.default_branch)) {
      throw new ConflictException('La Pull Request n’a pas été fusionnée dans la branche par défaut.');
    }
    if (merged && (!isFullGitSha(String(pr?.merge_commit_sha || '')) || !pr?.merged_at)) {
      throw new ConflictException('GitHub ne fournit pas le commit de merge.');
    }
    const reason = merged ? 'PR_MERGED' : 'PR_CLOSED_UNMERGED';
    const releasedAt = new Date().toISOString();
    const fileLock = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const locked = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      const current: any = (locked?.metadata as any)?.fixRequest;
      if (!locked || current?.requestId !== fix.requestId) {
        throw new ConflictException('La demande de correction a changé pendant la vérification. Actualisez la page.');
      }
      if (current.fileLock?.releasedAt) return current.fileLock;
      await releaseSonarFiles(manager, locked.projectId, id, `${reason}:${String(user.id || user.role)}`);
      const next = { ...(current.fileLock || {}), files: current.fileLock?.files || [], releasedAt, releaseReason: reason,
        releasedBy: String(user.id || user.role),
        ...(merged ? { prMergedAt: pr.merged_at, mergeCommitSha: String(pr.merge_commit_sha).toLowerCase() } : {}) };
      await repo.update(id, { metadata: { ...(locked.metadata || {}), fixRequest: { ...current, fileLock: next } } } as any);
      return next;
    });
    this.gateway.emit('incident:updated', await this.findOne(id));
    return { incidentId: id, status: 'FILES_RELEASED', reason, files: fileLock.files || [],
      ...(merged ? { mergeCommitSha: fileLock.mergeCommitSha } : {}) };
  }

  /** Cœur du déclenchement de correction : construit le lot, choisit le workflow cible et dispatche vers n8n (WF2/WF4/WF5). */
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
      const current = (incident.metadata as any)?.fixRequest;
      // Correction Sonar sur un incident qui a déjà une PR : refus explicite tant que son merge n'est pas
      // confirmé (« Merge effectué »), puis nouveau cycle de correction sur ce même incident.
      const sonarCycle = !explicitRetry && !!incident.prUrl && current?.workflow === 'WF2';
      if (!explicitRetry && incident.prUrl && !sonarCycle) throw new ConflictException('Une Pull Request existe déjà pour cet incident.');
      if (!sonarCycle && [IncidentStatus.COMPLETED, IncidentStatus.APPROVED, IncidentStatus.VALIDATING].includes(incident.status)) {
        throw new ConflictException(`L’état actuel de l’incident ne permet pas une nouvelle demande de correction.`);
      }
      const legacy = body.findingId ? [body.findingId] : [];
      if (!explicitRetry && body.findingIds !== undefined && !Array.isArray(body.findingIds)) throw new BadRequestException('Le champ technique findingIds doit être une liste.');
      if (!explicitRetry && Array.isArray(body.findingIds) && !body.findingIds.length) throw new BadRequestException('Sélectionnez au moins une erreur à corriger.');
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
      const meta: any = incident.metadata || {};
      if (sonarCycle) {
        if (batch.workflow !== 'WF2') throw new ConflictException('Une Pull Request existe déjà pour cet incident.');
        const prLabel = Number(current.prNumber) > 0 ? `#${Number(current.prNumber)}` : '';
        if (!current.fileLock?.releasedAt) {
          const held = sonarTargetFiles(current.fileLock?.files || (current.findings || []).map((f: any) => f.file || f.component));
          const overlap = sonarTargetFiles(batch.findings.map((f: any) => f.file || f.component)).filter(file => held.includes(file));
          throw new ConflictException({ code: 'SONAR_FILE_PR_PENDING_MERGE', status: 'TARGET_PR_PENDING', files: overlap, pullRequest: current.prUrl,
            message: (overlap.length
              ? `${overlap.length > 1 ? 'Les fichiers' : 'Le fichier'} ${overlap.join(', ')} ${overlap.length > 1 ? 'sont déjà modifiés' : 'est déjà modifié'} par la Pull Request ${prLabel ? prLabel + ' ' : ''}de cet incident, pas encore fusionnée. `
              : `La Pull Request ${prLabel ? prLabel + ' ' : ''}de cet incident n’est pas encore fusionnée. `)
              + 'Fusionnez-la sur GitHub puis cliquez « Merge effectué — libérer les fichiers » (onglet « Validation PR ») pour lancer cette correction. Aucune nouvelle correction n’a été lancée.' });
        }
        const corrected = new Set([...(meta.remediatedFindingIds || []), ...(current.findingIds || [])].map(String));
        if (batch.findingIds.some(findingId => corrected.has(findingId))) {
          throw new BadRequestException(`Un problème sélectionné a déjà été corrigé par la Pull Request ${prLabel ? prLabel + ' ' : ''}fusionnée.`);
        }
      }
      const results = sonarCycle ? []
        : meta.validation?.derived?.findings || meta.validation?.findingResults || meta.prValidationRequest?.findingResults || [];
      for (const finding of batch.findings) {
        const findingId = String(finding.id || finding.key);
        if ((meta.remediatedFindingIds || []).map(String).includes(findingId)) {
          throw new BadRequestException('Un problème sélectionné a déjà été corrigé par une Pull Request fusionnée de cet incident.');
        }
        const validated = results.some((r: any) => String(r.findingId) === findingId && String(r.verdict ?? r.result).toUpperCase() === 'VALID');
        const baseline = finding.baselineSha || finding.sourceCommitSha;
        if (validated || finding.stale === true || ['RESOLVED', 'CLOSED', 'FIXED'].includes(String(finding.status || '').toUpperCase())
          || (baseline && String(baseline).toLowerCase() !== String(meta.sourceCommitSha || '').toLowerCase())) {
          throw new BadRequestException('Un problème sélectionné est résolu, obsolète ou associé à une autre baseline.');
        }
      }
      const batchId = remediationBatchIdentity(id, batch.findingIds);
      const currentFindingIds = Array.isArray(current?.findingIds)
        ? current.findingIds.map(String) : (current?.findingId ? [String(current.findingId)] : []);
      const sameSelection = JSON.stringify([...new Set(currentFindingIds.map(v => v.trim()))].sort()) === JSON.stringify(batch.findingIds);
      const sameBatch = sameSelection && (!current?.batchId || current.batchId === batchId);
      const ownsRequestedFinding = batch.findingIds.some(findingId => currentFindingIds.includes(findingId));
      // Une sélection MODIFIÉE (sous-ensemble/ensemble différent) après un échec définitif n'est pas une collision.
      const isModifiedSelectionAfterFailure = !explicitRetry && RETRYABLE_FIX_REQUEST_STATUSES.includes(current?.status) && !sameSelection;
      if (!explicitRetry && ownsRequestedFinding && !isModifiedSelectionAfterFailure) {
        throw new ConflictException('Une demande de correction existe déjà pour ce problème. Utilisez « Réessayer la correction ».');
      }
      if (explicitRetry && !sameBatch) {
        throw new ConflictException('La tentative de correction ne correspond pas au batch existant.');
      }
      if (!explicitRetry && sameBatch && !RETRYABLE_FIX_REQUEST_STATUSES.includes(current.status)) {
        return { duplicate: true as const, attemptCount: Number(current.attemptCount || 1), incident, requestId: current.requestId, batchId, metadata: incident.metadata, ...batch };
      }
      // CANCEL_REQUESTED is deliberately included here (a pending
      // cancellation must resolve to CANCELLED/terminal before a brand-new
      // fixRequest can start) but CANCELLED itself is NOT -- it is terminal
      // and retryable, same as FIX_FAILED.
      if (!sonarCycle && current && ['APPROVAL_REQUESTED', 'FIX_STARTING', 'DISPATCHED', 'PR_CREATED', 'VALIDATING', 'CANCEL_REQUESTED'].includes(current.status)) {
        throw new ConflictException('Une demande de correction incompatible est déjà en cours.');
      }
      const requestId = explicitRetry ? current.requestId : randomUUID();
      const canonicalFindings = batch.findings.map(workflowFinding);
      const attemptCount = explicitRetry ? Number(current.attemptCount || 1) + 1 : 1;
      const authorizedAt = new Date().toISOString();
      const attempts = [
        ...(explicitRetry && Array.isArray(current.attempts) ? current.attempts : []),
        { attempt: attemptCount, status: 'FIX_STARTING', authorizedBy: user.id, authorizedAt,
          ...(batch.workflow === 'WF2' ? { expectedWorkflowId: this.configuredWf2Identity() } : {}) },
      ];
      const baselineSha = explicitRetry && isFullGitSha(current?.baselineSha)
        ? String(current.baselineSha).toLowerCase()
        : (isFullGitSha((incident.metadata as any)?.sourceCommitSha)
          ? String((incident.metadata as any).sourceCommitSha).toLowerCase()
          : null);
      // « Modifier la sélection » crée un TOUT NOUVEAU fixRequest (nouveau
      // requestId + nouveau batchId, ci-dessus) -- l'ancien fixRequest
      // FIX_FAILED n'est jamais muté ni perdu : il est archivé tel quel
      // (aucune copie/modification de champ) dans previousFixRequests avant
      // d'être remplacé, preuve d'audit immuable pour l'ancienne tentative.
      const previousFixRequests = Array.isArray((incident.metadata as any)?.previousFixRequests)
        ? (incident.metadata as any).previousFixRequests : [];
      // Verrou de fichier Sonar : un fichier déjà modifié par la PR non fusionnée d'une autre
      // correction refuse ce lot (rollback complet de la transaction, rien n'est lancé).
      let fileLock = explicitRetry ? current?.fileLock || null : null;
      if (batch.workflow === 'WF2') {
        if (!explicitRetry) await releaseSonarFiles(manager, incident.projectId, id, 'SONAR_SELECTION_REPLACED');
        const files = await reserveSonarFiles(manager,
          { projectId: incident.projectId, incidentId: id, batchId, files: canonicalFindings.map(f => f.file) },
          holderId => this.describeSonarFileHolder(manager, holderId));
        fileLock = { files: [...new Set([...(fileLock?.files || []), ...files])].sort(), reservedAt: fileLock?.reservedAt || authorizedAt };
      }
      const metadata = { ...(incident.metadata || {}), fixRequest: {
        requestId, batchId, status: 'FIX_STARTING', workflow: batch.workflow,
        findingId: batch.findingIds[0], findingIds: batch.findingIds, findings: canonicalFindings,
        approvedBy: user.id, approvedAt: explicitRetry ? (current?.approvedAt || authorizedAt) : authorizedAt, baselineSha,
        attemptCount, attempts, lastError: null, failedAt: null, retryEligible: false,
        ...(fileLock ? { fileLock } : {}),
      }, cycles: Array.isArray((incident.metadata as any)?.cycles) ? (incident.metadata as any).cycles : [],
      previousFixRequests: isModifiedSelectionAfterFailure || sonarCycle ? [...previousFixRequests, current] : previousFixRequests } as any;
      if (sonarCycle) {
        // Nouveau cycle sur le même incident : la PR fusionnée et sa validation sont archivées, ses
        // constats restent marqués corrigés, et la nouvelle demande repart d'un état sans PR.
        metadata.closedCorrectionCycles = [...(Array.isArray(meta.closedCorrectionCycles) ? meta.closedCorrectionCycles : []),
          { fixRequest: current, validation: meta.validation || null, prValidationRequest: meta.prValidationRequest || null, closedAt: authorizedAt }];
        metadata.remediatedFindingIds = [...new Set([...(meta.remediatedFindingIds || []), ...(current.findingIds || [])].map(String))];
        delete metadata.validation;
        delete metadata.prValidationRequest;
      }
      await repo.update(id, { metadata, ...(sonarCycle ? { prUrl: null, status: IncidentStatus.ANALYZED } : {}) } as any);
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
      await this.repo.manager.transaction(async manager => {
        const repo = manager.getRepository(Incident);
        const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        const meta = current?.metadata || {};
        const fix = meta.fixRequest || {};
        if (!matchesActiveAttempt(fix, claim.requestId, claim.batchId, claim.attemptCount)
          || fix.status !== 'FIX_STARTING' || fix.n8nExecutionId || fix.sideEffectsStarted) return;
        const attempts = (fix.attempts || []).map((a: any) => a.attempt === claim.attemptCount
          ? { ...a, status: 'FIX_FAILED', failedAt, error: 'Workflow unavailable' } : a);
        await repo.update(id, { metadata: { ...meta, fixRequest: { ...fix, status: 'FIX_FAILED', attempts,
          lastError: 'Workflow unavailable', failedAt, retryEligible: true } } } as any);
      });
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
    return { success: true, duplicate: false, status: updated.metadata?.fixRequest?.status, incidentId: id, requestId: claim.requestId, batchId: claim.batchId, batchKey: claim.batchId, attemptCount: claim.attemptCount, findingIds: claim.findingIds };
  }

  /** Rejette une proposition de correction : marque les problèmes concernés comme refusés, sans dispatcher de workflow. */
  async rejectFix(id: string, user: any, body: { reason?: string } = {}) {
    this.assertCanApprove(user);
    await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const fix = incident.metadata?.fixRequest || {};
      if (incident.prUrl || fix.sideEffectsStarted || ['CANCEL_REQUESTED', 'CANCELLED'].includes(fix.status)) {
        throw new ConflictException('La correction ne peut plus être rejetée dans cet état.');
      }
      const metadata = { ...(incident.metadata || {}), fixRequest: { ...fix, status: 'REJECTED', rejectedBy: user.id,
        rejectedAt: new Date().toISOString(), rejectionReason: boundedCancelReason(body.reason) } };
      await repo.update(id, { status: 'rejected' as IncidentStatus, metadata });
    });
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, status: 'rejected', incidentId: id };
  }

  /** Garantit PR validation paramètre. */
  private async ensurePrValidationParameter(jenkinsInternalUrl: string, authHeader: string, resolvedJobPath: string):
    Promise<{ status: 'ALREADY_PRESENT' | 'INJECTED'; definitions: ReturnType<typeof getJenkinsParameterDefinitions> }> {
    /** Classe l’échec Jenkins avec son code et son diagnostic. */
    const jenkinsFailure = (code: string, message: string) => Object.assign(new Error(message), { jenkinsFailureCode: code });
    const metadataTree = 'name,fullName,buildable,_class,property[_class,parameterDefinitions[name,type,_class,defaultParameterValue[value,_class]]]';
    /** Récupère Metadata. */
    const fetchMetadata = async () => {
      const response = await fetchPrJobMetadataWithDiscovery(jenkinsInternalUrl, resolvedJobPath, authHeader,
        `${jenkinsInternalUrl}${resolvedJobPath}/api/json?tree=${metadataTree}`);
      if (!response.ok) throw jenkinsFailure(classifyJenkinsTriggerStatus(response.status).code || 'JENKINS_JOB_NOT_FOUND', `Jenkins metadata HTTP ${response.status}`);
      let metadata: any;
      try { metadata = await response.json(); }
      catch { throw jenkinsFailure('JENKINS_RESPONSE_INVALID', 'Jenkins metadata response was not valid JSON'); }
      if (!isConcreteJenkinsBuildJob(metadata)) throw jenkinsFailure('JENKINS_TARGET_NOT_BUILDABLE', 'Jenkins PR target is not a concrete buildable job');
      return metadata;
    };
    /** Vérifie la présence de paramètre. */
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

  /** Garantit PR validation Bootstrap. */
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

  /** Déclenche une demande de validation de PR : calcule l'identité de validation et prépare le build Jenkins gouverné. */
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
      // Une transaction Jenkins FAILED (échec de mise en file, pas un résultat de remédiation) reste sur la même identité logique.
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
    return this.triggerGovernedPrValidationBuild(id, claim);
  }

  /** Déclenche Governed PR validation construction. */
  private async triggerGovernedPrValidationBuild(id: string, claim: { request: any; project: Project }) {
    const project: Project = claim.project;
    const prNumber = Number(claim.request.prNumber);
    const repository = String(claim.request.repository || '');
    const remoteHeadSha = String(claim.request.expectedPrHeadSha || '').toLowerCase();
    const validationRequestId = String(claim.request.validationRequestId || '');
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

    const headVerificationRequest: HeadVerificationRequest = {
      verifyHeadOnly: true, repository, targetSha: remoteHeadSha,
      validationRequestId, requestId: claim.request.requestId, batchId: claim.request.batchId,
      candidateAttempt: Number(claim.request.attemptCount),
    };
    let headVerification: HeadVerification | null;
    try {
      headVerification = await this.candidateVerification.verifyHead(headVerificationRequest);
    } catch {
      // A malformed request or an unexpected throw is an infrastructure
      // fact, never a proven candidate defect -- fail closed exactly like a
      // transport failure below, never a fabricated PASS.
      headVerification = null;
    }
    // Never trust the sub-service's overall==='PASS' as a bare boolean: the
    // exact-SHA equality that PASS is supposed to imply is re-proven here,
    // independently, against the SAME governed remoteHeadSha this call was
    // issued for. No fuzzy matching.
    const headEligible = !!headVerification && headVerification.overall === 'PASS'
      && headVerification.workspace?.exactShaVerified === true
      && String(headVerification.workspace?.checkoutSha || '').toLowerCase() === remoteHeadSha
      && String(headVerification.identity?.targetSha || '').toLowerCase() === remoteHeadSha;
    if (!headEligible) {
      const failureSummary = headVerification
        ? `HEAD_ONLY overall=${headVerification.overall} failureClass=${headVerification.failureClass ?? 'null'} checkoutSha=${headVerification.workspace?.checkoutSha ?? 'null'}`
        : 'La vérification HEAD n’a pas pu être exécutée (requête invalide ou verifier inaccessible).';
      const now2 = new Date().toISOString();
      const current: any = await this.repo.findOne({ where: { id } });
      const currentMeta: any = current.metadata || {};
      // BRIQUE 4 — only an explicit worker code-failure class is proof that
      // the candidate itself is defective. A bare overall='FAIL' is not
      // sufficient: old workers and malformed responses can report FAIL for
      // workspace/timeout failures. Fail closed in that case and keep the
      // validation INCONCLUSIVE rather than accusing the candidate.
      const codeFailureClasses = new Set([
        'CANDIDATE_COMPILE_FAILURE',
        'CANDIDATE_TEST_REGRESSION',
      ]);
      const technicalFailureClasses = new Set([
        'WORKSPACE_TIMEOUT',
        'WORKSPACE_CREATION_FAILED',
        'WORKSPACE_SHA_MISMATCH',
        'WORKSPACE_INFRA_FAILURE',
        'VERIFIER_UNAVAILABLE',
        'VERIFIER_TIMEOUT',
        'VERIFIER_PROTOCOL_ERROR',
        'SHA_UNAVAILABLE',
        'UNKNOWN',
      ]);
      const failureClass = String(headVerification?.failureClass || '');
      const candidateProvenDefective = headVerification?.overall === 'FAIL'
        && codeFailureClasses.has(failureClass);
      // Explicit technical classes, absent evidence, INCONCLUSIVE, and any
      // unrecognized class all remain fail-safe INCONCLUSIVE. The boolean is
      // deliberately not used to turn an unknown class into a code failure.
      const technicalFailure = !headVerification
        || headVerification.overall === 'INCONCLUSIVE'
        || technicalFailureClasses.has(failureClass)
        || !codeFailureClasses.has(failureClass);
      const inconclusive = technicalFailure || !candidateProvenDefective;
      const failed = {
        ...claim.request, status: 'FAILED',
        failureCode: inconclusive ? 'HEAD_VERIFICATION_INCONCLUSIVE' : 'CANDIDATE_TEST_FAILURE',
        result: inconclusive ? 'INCONCLUSIVE' : 'INVALID',
        failureSummary: failureSummary.slice(0, 300), headVerification: headVerification ?? null,
        failedAt: now2, updatedAt: now2,
      };
      await this.mergeNonLifecycleMetadata(id, { prValidationRequest: failed });
      throw new ServiceUnavailableException('La vérification HEAD exacte n’a pas confirmé un candidat valide pour cette Pull Request — Jenkins n’a pas été déclenché.');
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
    /** Classe l’échec Jenkins avec son code et son diagnostic. */
    const jenkinsFailure = (code: string, message: string) => Object.assign(new Error(message), { jenkinsFailureCode: code });
    try {
      const metadataTree = 'name,fullName,buildable,_class,property[_class,parameterDefinitions[name,type,_class,defaultParameterValue[value,_class]]]';
      const metadataResponse = await fetchPrJobMetadataWithDiscovery(jenkinsInternalUrl, resolvedJobPath, authHeader,
        `${jenkinsInternalUrl}${resolvedJobPath}/api/json?tree=${metadataTree}`);
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
      const queued = { ...claim.request, status: 'QUEUED', headVerification, queueUrl, queuedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prValidationJob };
      await this.mergeNonLifecycleMetadata(id, { prValidationRequest: queued });
      return { success: true, duplicate: false, validationRequest: queued };
    } catch (error: any) {
      const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      const failureCode = timeout ? 'JENKINS_TIMEOUT' : String(error?.jenkinsFailureCode || 'JENKINS_TRIGGER_FAILED');
      // Bounded, sanitized: HTTP status numbers and fixed messages only, never
      // a Jenkins response body (which could carry stack traces or config).
      const failureSummary = String(error?.message || 'Le build PR n’a pas pu être mis en file.').slice(0, 300);
      const current: any = await this.repo.findOne({ where: { id } });
      const currentMeta: any = current.metadata || {};
      // BRIQUE 4 — a Jenkins trigger failure (timeout, auth, job not found,
      // queue rejected, ...) is an infrastructure fact, never a proven
      // candidate defect: always INCONCLUSIVE, never BLOCKED.
      const failed = { ...claim.request, status: 'FAILED', result: 'INCONCLUSIVE', headVerification, failureCode, failureSummary, failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prValidationJob };
      await this.mergeNonLifecycleMetadata(id, { prValidationRequest: failed });
      throw new ServiceUnavailableException('La validation PR n’a pas pu être mise en file dans Jenkins.');
    }
  }

  /** Prépare le résultat lié à re Run PR validation. */
  async reRunPrValidation(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const initialFix: any = (snapshot.metadata as any)?.fixRequest || {};
    // Deliberately stricter than requestPrValidation's own PR_CREATED gate:
    // a revalidation only ever makes sense once a full remediation has
    // already reached VALIDATED — never for a PR still awaiting its first
    // validation (that path is requestPrValidation itself, epoch 0).
    if (initialFix.status !== 'VALIDATED' || !snapshot.prUrl || !initialFix.prNumber) {
      throw new ConflictException('Cette action nécessite une correction déjà validée avec une Pull Request active.');
    }
    const validationTargetSha = String(initialFix.validationTargetSha || initialFix.prHeadSha || '').toLowerCase();
    if (!isFullGitSha(validationTargetSha)) {
      throw new ConflictException('Le HEAD exact de validation n’est pas disponible.');
    }
    const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);
    const initialPrValidationRequest: any = (snapshot.metadata as any)?.prValidationRequest || {};
    if (String(initialPrValidationRequest.expectedPrHeadSha || '').toLowerCase() !== validationTargetSha) {
      throw new ConflictException('Aucune validation terminée n’existe pour le SHA cible actuel.');
    }
    const prNumber = Number(initialFix.prNumber);
    const pull = await this.githubPullRequest(snapshot.project, prNumber);
    const remoteHeadSha = String(pull?.head?.sha || '').toLowerCase();
    const remoteHeadBranch = String(pull?.head?.ref || '');
    const expectedBranch = `fix/pfe-${snapshot.id}-${initialFix.requestId}`;
    if (pull?.state !== 'open' || remoteHeadBranch !== expectedBranch || remoteHeadSha !== validationTargetSha) {
      throw new ConflictException('La Pull Request a changé depuis la dernière validation — une revalidation à SHA identique n’est plus possible ; utilisez l’actualisation de cible puis une nouvelle validation.');
    }
    const repository = this.canonicalRepository(snapshot.project.githubRepo);
    const now = new Date().toISOString();

    // ── Transaction: identical pessimistic-write pattern to
    // requestPrValidation's own claim transaction, so two concurrent human
    // clicks serialize on the SAME incident-row lock — no in-memory lock,
    // no separate mutex, consistent with the existing architecture. ──
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
      if (fix.status !== 'VALIDATED' || fix.requestId !== initialFix.requestId || fix.batchId !== initialFix.batchId
        || fixTargetSha !== remoteHeadSha || Number(fix.prNumber) !== prNumber) {
        throw new ConflictException('L’état de la correction a changé avant le lancement de la revalidation.');
      }
      const existing: any = metadata.prValidationRequest || {};
      if (String(existing.expectedPrHeadSha || '').toLowerCase() !== remoteHeadSha) {
        throw new ConflictException('Aucune validation terminée n’existe pour le SHA cible actuel.');
      }
      // Additive field, absent on every historical record — resolves to 0
      // (epoch 0, requestPrValidation's own normal request) with no
      // migration, exactly as required.
      const currentEpoch = Number(existing.epoch) || 0;
      const existingTerminal = TERMINAL_STATUSES.has(String(existing.status));
      if (!existingTerminal) {
        if (currentEpoch >= 1) {
          return { duplicate: true, request: existing, project };
        }
        throw new ConflictException('La validation PR actuelle n’est pas terminée — une revalidation ne peut être demandée que sur une validation terminée (COMPLETED ou FAILED).');
      }
      const nextEpoch = currentEpoch + 1;
      const revalidationRequestId = prValidationRevalidationIdentity(incident.projectId, prNumber, remoteHeadSha, fix.batchId, nextEpoch);
      const previousAttempts = [...(Array.isArray(existing.previousAttempts) ? existing.previousAttempts : []), existing];
      const request = {
        validationRequestId: revalidationRequestId, validationType: 'PR_VALIDATION', status: 'REQUESTED',
        projectId: incident.projectId, incidentId: incident.id, fixRequestId: fix.requestId,
        requestId: fix.requestId, batchId: fix.batchId, batchKey: fix.batchKey || fix.batchId,
        // Never touched: this is infrastructure revalidation, not a new
        // corrective attempt.
        attemptCount: Number(fix.attemptCount), repository, prNumber, prUrl: incident.prUrl,
        prHeadBranch: remoteHeadBranch, expectedPrHeadSha: remoteHeadSha,
        createdBy: user.id, createdAt: now, updatedAt: now,
        epoch: nextEpoch, revalidation: true, revalidationReason: 'SAME_SHA_REVALIDATION',
        retryAttempt: 0, previousAttempts,
      };
      const auditEvent = {
        type: 'SAME_SHA_REVALIDATION', incidentId: incident.id, projectId: incident.projectId, prNumber,
        sha: remoteHeadSha,
        previousValidationRequestId: existing.validationRequestId ?? null,
        newValidationRequestId: revalidationRequestId,
        previousEpoch: currentEpoch, newEpoch: nextEpoch,
        actorId: user.id ?? null, actorRole: user.role ?? null,
        at: now,
      };
      const auditLog = Array.isArray(metadata.revalidationAuditLog) ? metadata.revalidationAuditLog : [];
      await incidents.update(id, {
        metadata: { ...metadata, prValidationRequest: request, revalidationAuditLog: [...auditLog, auditEvent] },
      } as any);
      return { duplicate: false, request, project };
    });
    if (claim.duplicate) {
      return { success: true, duplicate: true, validationRequest: claim.request };
    }
    return this.triggerGovernedPrValidationBuild(id, claim);
  }

  /** R65 — action gouvernée explicite pour accepter un commit de remédiation suivant légitime (même PR, même branche) comme nouvelle cible de validation. */
  async refreshPrValidationTarget(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const fix: any = (snapshot.metadata as any)?.fixRequest || {};
    if (!['PR_CREATED', 'VALIDATED'].includes(String(fix.status)) || !snapshot.prUrl || !fix.prNumber) {
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
      // Idempotent target refresh, except that an older active authorization
      // may still be present on a partially migrated record; neutralize it
      // even when the target value itself is already current.
      const snapshotMetadata = snapshot.metadata || {};
      const nextMetadata = this.invalidateActiveValidationForNewSha(
        snapshotMetadata, remoteHeadSha, 'PR_VALIDATION_TARGET_REFRESHED',
      );
      if (nextMetadata !== snapshotMetadata) {
        await this.repo.manager.transaction(async manager => {
          const repo = manager.getRepository(Incident);
          const latest = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
          if (!latest || JSON.stringify(latest.metadata?.fixRequest) !== JSON.stringify(fix)) throw new ConflictException('La correction a changé pendant la vérification.');
          const updatedMetadata = this.invalidateActiveValidationForNewSha(latest.metadata || {}, remoteHeadSha, 'PR_VALIDATION_TARGET_REFRESHED');
          await repo.update(id, { metadata: updatedMetadata } as any);
        });
      }
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
      if (!['PR_CREATED', 'VALIDATED'].includes(String(currentFix.status)) || currentFix.requestId !== fix.requestId
        || currentFix.batchId !== fix.batchId || Number(currentFix.prNumber) !== prNumber) {
        throw new ConflictException('La demande de correction a changé avant l’actualisation de la cible.');
      }
      const priorTarget = String(currentFix.validationTargetSha || currentFix.prHeadSha).toLowerCase();
      if (priorTarget === remoteHeadSha) {
        return { changed: false, validationTargetSha: priorTarget };
      }
      const nextFix = {
        ...currentFix,
        status: 'PR_CREATED',
        validationTargetSha: remoteHeadSha,
        validationTargetHistory: [
          ...(Array.isArray(currentFix.validationTargetHistory) ? currentFix.validationTargetHistory : []),
          historyEntry,
        ],
      };
      const nextMetadata = this.invalidateActiveValidationForNewSha(
        { ...metadata, fixRequest: nextFix }, remoteHeadSha, 'PR_VALIDATION_TARGET_REFRESHED',
      );
      await incidents.update(id, { metadata: nextMetadata } as any);
      return { changed: true, validationTargetSha: remoteHeadSha };
    });
    if (result.changed) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
    }
    return { success: true, changed: result.changed, validationTargetSha: result.validationTargetSha, originalPrHeadSha: fix.prHeadSha };
  }

  /** Vérifie la condition liée à recompute PR validation Policy. */
  async recomputePrValidationPolicy(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const metadata: any = snapshot.metadata || {};
    const fix: any = metadata.fixRequest || {};
    const prValidationRequest: any = metadata.prValidationRequest || {};
    const validation: any = metadata.validation || {};

    // ── Strict eligibility (R67 §2) ───────────────────────────────────────
    if (!snapshot.prUrl || !fix.prNumber) {
      throw new ConflictException('Aucune Pull Request de correction n’est disponible pour cette convergence.');
    }
    if (fix.status !== 'VALIDATED') {
      throw new ConflictException('Cette action nécessite une correction déjà validée avec succès.');
    }
    if (prValidationRequest.status !== 'COMPLETED') {
      throw new ConflictException('Aucune validation PR terminée à réévaluer — une validation active ou absente ne peut pas être réévaluée.');
    }
    if (!validation || Object.keys(validation).length === 0) {
      throw new ConflictException('Aucune preuve de validation persistée pour ce candidat.');
    }
    if (!validation.mergeAuthorization) {
      throw new ConflictException('Aucune autorisation de merge existante à réévaluer.');
    }
    const expectedPrHeadSha = String(validation.expectedPrHeadSha || '').toLowerCase();
    if (!isFullGitSha(expectedPrHeadSha)) {
      throw new ConflictException('Le HEAD exact validé est indisponible.');
    }

    // ── Exact-SHA correlation across EVERY persisted record (R67 §4) — a
    // recompute must never run against evidence that is even slightly stale
    // or ambiguous. Any mismatch here is a silent-refresh risk; reject, never
    // guess which record is authoritative.
    const checkoutSha = String(validation.checkoutSha || '').toLowerCase();
    const prValidationRequestSha = String(prValidationRequest.expectedPrHeadSha || '').toLowerCase();
    const fixRequestSha = String(fix.validationTargetSha || fix.prHeadSha || '').toLowerCase();
    if (checkoutSha !== expectedPrHeadSha || prValidationRequestSha !== expectedPrHeadSha || fixRequestSha !== expectedPrHeadSha) {
      throw new ConflictException('Les preuves de validation persistées ne correspondent pas exactement au même commit — réévaluation refusée.');
    }

    // ── Live GitHub head must STILL be exactly this SHA (R67 §2/§4) — a
    // recompute is never authorized to silently accept a moved PR; that is
    // refresh-target's job, and it starts a genuinely new remediation cycle.
    const prNumber = Number(fix.prNumber);
    const pull = await this.githubPullRequest(snapshot.project, prNumber);
    const remoteHeadSha = String(pull?.head?.sha || '').toLowerCase();
    if (pull?.state !== 'open' || remoteHeadSha !== expectedPrHeadSha) {
      throw new ConflictException('La Pull Request a changé depuis la validation — réévaluation refusée. Une nouvelle validation gouvernée est requise.');
    }

    // ── Required-stage completeness, re-derived from the SAME persisted
    // facts saveValidation() used to compute it the first time (jenkinsStatus
    // + requiredStages are both verbatim-persisted on validationRecord) —
    // never new evidence, never a fresh Jenkins call.
    const requiredStages: any[] = Array.isArray(validation.requiredStages) ? validation.requiredStages : [];
    const requiredNames = ['build', 'tests', 'sonar'];
    const missingRequiredStage = requiredNames.find(name => !requiredStages.some((stage: any) => stage.stage === name && stage.required === true));
    const badStage = requiredStages.find((s: any) => s.required !== false && s.status !== 'PASSED' && !(s.status === 'WARNING' && !s.blocking));
    const jenkinsStatus = String(validation.jenkinsStatus || '').toUpperCase();
    const requiredStagesComplete = jenkinsStatus === 'SUCCESS' && !missingRequiredStage && !badStage;
    if (!requiredStagesComplete) {
      throw new ConflictException('Les preuves de complétude du pipeline sont insuffisantes pour réévaluer cette autorisation.');
    }
    const exactCorrelationVerified = deriveExactCorrelationVerified({
      correlationVerified: validation.correlationVerified, checkoutSha: validation.checkoutSha, expectedPrHeadSha: validation.expectedPrHeadSha,
    });
    if (!exactCorrelationVerified) {
      throw new ConflictException('La corrélation exacte SHA/Sonar n’est plus vérifiée pour ce candidat.');
    }

    // ── R67 §3/§5 — the ONLY IO in this action: the existing R66 evidence
    // assembler, GitHub content fetches bound to already-persisted immutable
    // blob SHAs. Never Jenkins, never Sonar, never WF3, never the PR/branch.
    const candidateFileRecords: CandidateFileRecord[] = (Array.isArray(fix.fileResults) ? fix.fileResults : [])
      .map((fr: any) => ({ targetFile: String(fr.targetFile || ''), fileOperation: String(fr.fileOperation || ''), oldSha: fr.oldSha ?? null, newSha: String(fr.newSha || '') }))
      .filter((fr: CandidateFileRecord) => fr.targetFile && fr.newSha);
    // R79 — see the identical fix/rationale in saveValidation() above.
    const defaultValueSemanticsBaseSha = resolveDefaultValueSemanticsBaseSha(fix);
    let defaultValueSemanticsAudit: Awaited<ReturnType<typeof buildDefaultValueSemanticsEvidence>>;
    try {
      defaultValueSemanticsAudit = await buildDefaultValueSemanticsEvidence(
        candidateFileRecords,
        {
          fixRequestId: String(fix.requestId || ''), batchId: String(fix.batchId || ''),
          attemptCount: Number(fix.attemptCount) || 0,
          candidateId: `${fix.batchId}-attempt-${fix.attemptCount}`,
          candidateDigest: (fix as any).candidateDigest ?? null,
          candidateBaseSha: defaultValueSemanticsBaseSha,
          prHeadSha: expectedPrHeadSha,
        },
        (path, sha) => this.githubFileAtSha(snapshot.project, path, sha),
      );
    } catch {
      defaultValueSemanticsAudit = {
        verdict: 'VERIFICATION_REQUIRED', evaluatedSha: expectedPrHeadSha,
        candidateId: `${fix.batchId}-attempt-${fix.attemptCount}`, candidateDigest: null,
        fixRequestId: String(fix.requestId || ''), batchId: String(fix.batchId || ''),
        attemptCount: Number(fix.attemptCount) || 0, evidence: [], checkedPairs: 0, checkedFieldPairs: [], computedAt: new Date().toISOString(),
      };
    }
    const previouslyExecutedEvidence = (Array.isArray(validation.defaultValueSemantics?.checkedFieldPairs)
      ? validation.defaultValueSemantics.checkedFieldPairs.filter((p: any) => p?.source === 'EXECUTED_TEST' && p?.ruleType && RULE_REGISTRY[p.ruleType]) : [])
      .map((p: any) => {
        const rule = RULE_REGISTRY[p.ruleType];
        const subjectIdentity: Record<string, string> = {};
        rule.identityKeys.forEach(key => { subjectIdentity[key] = p[key]; });
        return {
          evidenceType: 'EXECUTED_TEST' as const, ruleType: p.ruleType, subjectIdentity, cases: [],
          result: p.verdict, evaluatedSha: expectedPrHeadSha,
          executionIdentity: { provider: 'JENKINS', buildId: fix.workflowExecutionId ?? '' },
          provenance: { adapter: 'PERSISTED_REUSE', reportFormat: 'PERSISTED_REUSE' },
        };
      });
    if (previouslyExecutedEvidence.length) {
      defaultValueSemanticsAudit = mergeCanonicalEvidenceWithStatic(
        defaultValueSemanticsAudit,
        previouslyExecutedEvidence,
        (identity, ruleType) => (defaultValueSemanticsAudit.checkedFieldPairs || []).find((p: any) =>
          (p.ruleType === undefined || p.ruleType === ruleType) && identityMatches(RULE_REGISTRY[ruleType], identity, p)),
      ) as typeof defaultValueSemanticsAudit;
    }
    const defaultValueSemanticsRequired = correctiveBlockingCausesDeclareDefaultValueSemanticsDefect(fix);
    const defaultValueSemanticsEvaluatedShaMatches = String(defaultValueSemanticsAudit.evaluatedSha || '').toLowerCase() === expectedPrHeadSha;
    const defaultValueSemanticsRelevantPairChecked = defaultValueSemanticsRelevantPairWasChecked(
      fix, defaultValueSemanticsAudit.checkedFieldPairs || [],
    );

    // ── R67 §6 — REUSE computeMergeAuthorization() verbatim, never
    // duplicated. remediationResult/regressionResult/headVerificationResult
    // are read back from the existing mergeAuthorization record (they were
    // echoed onto it the first time, unchanged facts); only
    // defaultValueSemanticsResult is newly computed.
    const mergeAuth = computeMergeAuthorization({
      remediationResult: validation.mergeAuthorization.remediationResult,
      exactCorrelationVerified,
      requiredStagesComplete,
      regressionResult: validation.mergeAuthorization.regressionResult,
      headVerificationResult: validation.mergeAuthorization.headVerificationResult,
      pipelineHealth: validation.derived?.pipelineHealth ?? null,
      validationInProgress: false,
      defaultValueSemanticsResult: defaultValueSemanticsAudit.verdict,
      defaultValueSemanticsRequired,
      defaultValueSemanticsEvaluatedShaMatches,
      defaultValueSemanticsCheckedPairs: defaultValueSemanticsAudit.checkedPairs,
      defaultValueSemanticsRelevantPairChecked,
    });
    const previousAuthorization = String(validation.mergeAuthorization.authorization || '');
    const authorizedSha = mergeAuth.authorization === 'MERGE_READY' ? expectedPrHeadSha : null;
    const correctiveActionAllowed = mergeAuth.authorization === 'BLOCKED';
    const now = new Date().toISOString();
    // Merge fresh pipelineHealth-derived advisories with the previously
    // persisted ones (e.g. scanner-comparability advisories from the
    // original regression analysis, which this action never recomputes),
    // de-duplicated by code — never silently dropped, never duplicated.
    const previousAdvisories = Array.isArray(validation.mergeAuthorization.advisories) ? validation.mergeAuthorization.advisories : [];
    const seenAdvisoryCodes = new Set<string>();
    const advisories = [...mergeAuth.advisories, ...previousAdvisories].filter((a: any) => {
      if (seenAdvisoryCodes.has(a.code)) return false;
      seenAdvisoryCodes.add(a.code);
      return true;
    });
    const policyReevaluation = {
      reason: 'R67_SAME_SHA_POLICY_REEVALUATION',
      evaluatedSha: expectedPrHeadSha,
      previousAuthorization,
      newAuthorization: mergeAuth.authorization,
      defaultValueSemanticsVerdict: defaultValueSemanticsAudit.verdict,
      computedAt: now,
      reevaluatedBy: user.id,
    };

    // ── R67 §7/§9 — persist under a lock, re-verifying identity is still
    // exactly what we evaluated (idempotency/race safety): a second call
    // with nothing changed reaches the exact same conclusion and appends
    // another (harmless, bounded) audit entry rather than corrupting state.
    const result: any = await this.repo.manager.transaction(async manager => {
      const incidents = manager.getRepository(Incident);
      const incident: any = await incidents.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const currentMeta: any = incident.metadata || {};
      const currentFix: any = currentMeta.fixRequest || {};
      const currentPrValidationRequest: any = currentMeta.prValidationRequest || {};
      const currentValidation: any = currentMeta.validation || {};
      if (currentFix.status !== 'VALIDATED' || currentPrValidationRequest.status !== 'COMPLETED'
        || String(currentValidation.checkoutSha || '').toLowerCase() !== expectedPrHeadSha
        || String(currentValidation.expectedPrHeadSha || '').toLowerCase() !== expectedPrHeadSha) {
        throw new ConflictException('L’état a changé avant la réévaluation.');
      }
      const previousReevaluations = Array.isArray(currentValidation.policyReevaluations) ? currentValidation.policyReevaluations : [];
      const nextValidation = {
        ...currentValidation,
        defaultValueSemantics: defaultValueSemanticsAudit,
        mergeAuthorization: { ...mergeAuth, advisories, authorizedSha, correctiveActionAllowed, computedAt: now, forSha: expectedPrHeadSha },
        // Bounded: keep the most recent 20 reevaluation records, never
        // unbounded growth from repeated idempotent calls.
        policyReevaluations: [...previousReevaluations, policyReevaluation].slice(-20),
      };
      await incidents.update(id, { metadata: { ...currentMeta, validation: nextValidation } } as any);
      return { mergeAuth: nextValidation.mergeAuthorization, defaultValueSemanticsAudit, policyReevaluation };
    });

    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, mergeAuthorization: result.mergeAuth, defaultValueSemantics: result.defaultValueSemanticsAudit, policyReevaluation: result.policyReevaluation };
  }

  /** Prépare le résultat lié à correct et Revalidate. */
  async correctAndRevalidate(id: string, user: any) {
    this.assertCanApprove(user);
    const snapshot = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const metadata: any = snapshot.metadata || {};
    const fix: any = metadata.fixRequest || {};
    const validation: any = metadata.validation || {};
    if (!snapshot.prUrl || !fix.prNumber || !fix.requestId || !fix.batchId) {
      throw new ConflictException('Aucune Pull Request de correction n’est disponible pour cette convergence.');
    }
    if (validation?.mergeAuthorization?.authorization !== 'BLOCKED'
      || validation?.mergeAuthorization?.correctiveActionAllowed !== true) {
      throw new ConflictException('Une correction supplémentaire n’est autorisée que lorsque la Pull Request est bloquée par un défaut prouvé.');
    }
    const blockedSha = String(validation.checkoutSha || '').toLowerCase();
    if (!isFullGitSha(blockedSha)) {
      throw new ConflictException('Le commit exact bloqué est indisponible.');
    }
    // Phase 3 — structured, proven evidence only. Never invents a file/line/
    // root cause from a generic message: if nothing extractable exists,
    // refuse to dispatch rather than run blindly.
    const correctiveContext = buildCorrectiveContext({ previousAttempt: Number(fix.attemptCount || 0), validation });
    if (correctiveContext.blockingCauses.length === 0) {
      throw new ConflictException('Aucune cause de blocage exploitable n’a pu être extraite — décision humaine requise.');
    }
    const prNumber = Number(fix.prNumber);
    // Phase 1 items 5-7 — verify the PR is still open at EXACTLY the SHA
    // that was proven BLOCKED, before authorizing anything. If it moved
    // (Case I: someone pushed in the meantime), fail closed — a fresh
    // governed validation is required first, never a correction on top of
    // an unproven commit.
    const pull = await this.githubPullRequest(snapshot.project, prNumber);
    const remoteHeadSha = String(pull?.head?.sha || '').toLowerCase();
    const expectedBranch = `fix/pfe-${snapshot.id}-${fix.requestId}`;
    if (pull?.state !== 'open' || String(pull?.head?.ref || '') !== expectedBranch) {
      throw new ConflictException('La Pull Request n’est plus ouverte ou ne correspond plus à cette demande de correction.');
    }
    if (remoteHeadSha !== blockedSha) {
      throw new ConflictException('La Pull Request a changé depuis le blocage constaté — une nouvelle validation gouvernée est requise avant toute correction.');
    }
    const nextAttempt = Number(fix.attemptCount || 0) + 1;
    // Phase 2 — deterministic corrective-attempt identity: a duplicate HTTP
    // delivery (double-click) for the SAME lineage/blocked-SHA/next-attempt
    // must never dispatch a second WF2 execution.
    const correctiveAttemptIdentity = createHash('sha256')
      .update(`${id}\n${fix.requestId}\n${fix.batchId}\n${prNumber}\n${blockedSha}\n${nextAttempt}`)
      .digest('hex');

    const claim: any = await this.repo.manager.transaction(async manager => {
      const incidents = manager.getRepository(Incident);
      const incident: any = await incidents.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const currentMeta: any = incident.metadata || {};
      const currentFix: any = currentMeta.fixRequest || {};
      const currentValidation: any = currentMeta.validation || {};
      if (currentFix.requestId !== fix.requestId || currentFix.batchId !== fix.batchId
        || Number(currentFix.prNumber) !== prNumber
        || currentValidation?.mergeAuthorization?.authorization !== 'BLOCKED'
        || currentValidation?.mergeAuthorization?.correctiveActionAllowed !== true
        || String(currentValidation.checkoutSha || '').toLowerCase() !== blockedSha) {
        throw new ConflictException('La demande de correction a changé avant l’autorisation.');
      }
      const existingDispatch = currentFix.correctiveDispatch;
      if ((existingDispatch?.identity === correctiveAttemptIdentity && ['AUTHORIZED', 'DISPATCHED'].includes(String(existingDispatch.status)))
        || ['FIX_STARTING', 'DISPATCHED'].includes(String(currentFix.status))) {
        return { duplicate: true as const, correctiveDispatch: existingDispatch || currentFix.correctiveDispatch || null, status: currentFix.status };
      }
      const now = new Date().toISOString();
      const attempts = [
        ...(Array.isArray(currentFix.attempts) ? currentFix.attempts : []),
        { attempt: nextAttempt, status: 'FIX_STARTING', authorizedBy: user.id, authorizedAt: now, corrective: true,
          expectedWorkflowId: this.configuredWf2Identity() },
      ];
      const correctiveDispatchRecord = {
        identity: correctiveAttemptIdentity, status: 'AUTHORIZED', attempt: nextAttempt,
        authorizedBy: user.id, authorizedAt: now, blockedSha, correctiveContext,
      };
      const nextFix = {
        ...currentFix, status: 'FIX_STARTING', attemptCount: nextAttempt, attempts,
        n8nExecutionId: undefined, executionRegisteredAt: undefined, lastHeartbeatAt: undefined, executionPhase: undefined,
        cancelRequestedAt: undefined, cancelledAt: undefined, cancelReason: undefined,
        sideEffectsStarted: false, sideEffectsStartedAt: undefined, lastCancelAttemptError: undefined,
        lastError: null, failedAt: null, retryEligible: false, correctiveDispatch: correctiveDispatchRecord,
      };
      await incidents.update(id, { metadata: { ...currentMeta, fixRequest: nextFix } } as any);
      return { duplicate: false as const, correctiveDispatch: correctiveDispatchRecord };
    });

    if (claim.duplicate) {
      return { success: true, duplicate: true, incidentId: id, status: claim.status, correctiveDispatch: claim.correctiveDispatch };
    }

    const project: Project = snapshot.project;
    try {
      // R69 — canonicalFindings construction AND the pre-dispatch
      // correlation guard now live INSIDE this try block (they did not
      // before — a real gap this fix also closes): either one throwing
      // must be recorded as a governed FIX_FAILED/retryEligible attempt
      // exactly like a network/Jenkins failure below, never leave
      // fixRequest.status dangling at FIX_STARTING.
      const canonicalFindings = (Array.isArray(fix.findings) ? fix.findings : []).map(workflowFinding);
      const expectedFindingIdSet = new Set((Array.isArray(fix.findingIds) ? fix.findingIds : []).map((value: any) => String(value)));
      const actualFindingIdSet = new Set(canonicalFindings.map(f => f.findingId));
      const correlationOk = expectedFindingIdSet.size > 0
        && expectedFindingIdSet.size === actualFindingIdSet.size
        && [...expectedFindingIdSet].every(idValue => actualFindingIdSet.has(idValue))
        && (!canonicalFindings[0] || expectedFindingIdSet.has(canonicalFindings[0].findingId));
      if (!correlationOk) {
        throw new ConflictException({ code: 'FINDING_CORRELATION_MISMATCH', message: 'La corrélation des identifiants de problèmes est rompue avant l’envoi à WF2 — envoi refusé.' });
      }
      const payload: any = {
        incidentId: id, projectId: project.id, findingId: fix.findingIds?.[0], findingIds: fix.findingIds,
        buildNumber: snapshot.buildNumber ?? (metadata as any)?.enrichedData?.build?.number ?? null,
        batchKey: fix.batchKey || fix.batchId, batchId: fix.batchId,
        stage: canonicalFindings[0]?.stage, source: canonicalFindings[0]?.source,
        remediationType: 'AUTO_FIX_ELIGIBLE', requestId: fix.requestId,
        attemptCount: nextAttempt,
        approvedBy: { id: user.id, role: user.role },
        finding: canonicalFindings[0], findings: canonicalFindings,
        repository: project.githubRepo,
        defaultBranch: metadata.defaultBranch || null,
        correctiveAttempt: true, correctiveContext,
      };
      const response = await fetch(this.workflowUrl('WF2'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
    } catch (err: any) {
      const failedAt = new Date().toISOString();
      await this.repo.manager.transaction(async manager => {
        const incidents = manager.getRepository(Incident);
        const current: any = await incidents.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!current) return;
        const currentMeta: any = current.metadata || {};
        const currentFix: any = currentMeta.fixRequest || {};
        if (currentFix.requestId !== fix.requestId || currentFix.batchId !== fix.batchId
          || Number(currentFix.attemptCount) !== nextAttempt || currentFix.status !== 'FIX_STARTING'
          || currentFix.n8nExecutionId || currentFix.sideEffectsStarted) return;
        const attempts = (currentFix.attempts || []).map((a: any) => a.attempt === nextAttempt
          ? { ...a, status: 'FIX_FAILED', failedAt, error: err?.message || 'Workflow unavailable' } : a);
        const correctiveDispatch = currentFix.correctiveDispatch?.identity === correctiveAttemptIdentity
          ? { ...currentFix.correctiveDispatch, status: 'FAILED' } : currentFix.correctiveDispatch;
        await incidents.update(id, { metadata: { ...currentMeta, fixRequest: {
          ...currentFix, status: 'FIX_FAILED', attempts, lastError: err?.message || 'Workflow unavailable', failedAt, retryEligible: true, correctiveDispatch,
        } } } as any);
      });
      throw new ServiceUnavailableException({ code: 'CORRECTIVE_WORKFLOW_UNAVAILABLE', message: 'La correction n’a pas pu démarrer. Vous pouvez réessayer.' });
    }
    const dispatchedAt = new Date().toISOString();
    await this.repo.manager.transaction(async manager => {
      const incidents = manager.getRepository(Incident);
      const current: any = await incidents.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) return;
      const currentMeta: any = current.metadata || {};
      const currentFix: any = currentMeta.fixRequest || {};
      if (currentFix.requestId !== fix.requestId || currentFix.batchId !== fix.batchId
        || Number(currentFix.attemptCount) !== nextAttempt || currentFix.status !== 'FIX_STARTING') return;
      const attempts = (currentFix.attempts || []).map((a: any) => a.attempt === nextAttempt ? { ...a, status: 'DISPATCHED', dispatchedAt } : a);
      const correctiveDispatch = currentFix.correctiveDispatch?.identity === correctiveAttemptIdentity
        ? { ...currentFix.correctiveDispatch, status: 'DISPATCHED' } : currentFix.correctiveDispatch;
      await incidents.update(id, { metadata: { ...currentMeta, fixRequest: { ...currentFix, status: 'DISPATCHED', attempts, dispatchedAt, correctiveDispatch } } } as any);
    });
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, duplicate: false, status: updated.metadata?.fixRequest?.status, incidentId: id, requestId: fix.requestId, batchId: fix.batchId, attemptCount: nextAttempt, correctiveContext };
  }

  /** Prépare le résultat lié à recover Post écriture. */
  async recoverPostWrite(id: string, input: PostWriteRecoveryInput, user: any) {
    this.assertCanApprove(user);
    const recoveryIdentity = postWriteRecoveryIdentity(input);
    const snapshot: any = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!snapshot) throw new NotFoundException('Incident introuvable.');
    const metadata: any = snapshot.metadata || {};
    const fix: any = metadata.fixRequest;
    if (!fix || fix.requestId !== input.fixRequestId || fix.batchId !== input.batchId) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_REQUEST_MISMATCH' });
    }
    const priorRecovery = fix.postWriteRecovery;
    if (priorRecovery?.status === 'COMPLETED') {
      if (priorRecovery.identity !== recoveryIdentity) {
        throw new ConflictException({ code: 'POST_WRITE_RECOVERY_CONFLICT' });
      }
      return { success: true, duplicate: true, recoveredExistingPr: true, status: 'PR_CREATED',
        incidentId: id, requestId: fix.requestId, batchId: fix.batchId, postWriteRecovery: priorRecovery };
    }
    if (fix.status !== 'FIX_FAILED') throw new ConflictException({ code: 'POST_WRITE_RECOVERY_FIX_NOT_FAILED' });
    const attempts: any[] = Array.isArray(fix.attempts) ? fix.attempts : [];
    const sourceAttempt = attempts.find(attempt => Number(attempt.attempt) === Number(input.sourceAttempt));
    const currentAttempt = attempts.find(attempt => Number(attempt.attempt) === Number(fix.attemptCount));
    if (!sourceAttempt) throw new ConflictException({ code: 'POST_WRITE_RECOVERY_SOURCE_ATTEMPT_MISSING' });
    if (sourceAttempt.status !== 'FIX_FAILED' || String(sourceAttempt.workflowExecutionId || '') !== String(input.sourceExecutionId)) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_SOURCE_EXECUTION_MISMATCH' });
    }
    if (!isPostWriteFailureNode(sourceAttempt.failureNode)) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_NOT_POST_WRITE_FAILURE' });
    }
    if (!Number.isInteger(Number(fix.attemptCount)) || input.sourceAttempt >= Number(fix.attemptCount)) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_ATTEMPT_ORDER_INVALID' });
    }
    if (!currentAttempt || currentAttempt.status !== 'FIX_FAILED'
      || attempts.some(attempt => ['FIX_STARTING', 'DISPATCHED', 'VALIDATING'].includes(String(attempt.status)))) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_ACTIVE_ATTEMPT' });
    }
    if (await this.hasActiveWf2Execution()) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_ACTIVE_WF2_EXECUTION' });
    }
    const expectedBranchIdentity = `fix/pfe-${id}-${fix.requestId}`;
    if (input.expectedBranch !== expectedBranchIdentity) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_BRANCH_IDENTITY_MISMATCH' });
    }
    const expectedFindingIds = Array.isArray(fix.findingIds) ? fix.findingIds.map(String) : [];
    const evidence = validatePostWriteRecoveryEvidence(input, expectedFindingIds);
    const project: Project = snapshot.project;
    if (!project) throw new BadRequestException({ code: 'POST_WRITE_RECOVERY_PROJECT_MISSING' });
    const repository = this.canonicalRepository(project.githubRepo);
    const remoteBranchHead = await this.githubBranchHead(project, input.expectedBranch);
    if (remoteBranchHead !== input.expectedHeadSha.toLowerCase()) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_BRANCH_HEAD_MISMATCH' });
    }
    const pull = await this.githubPullRequest(project, input.prNumber);
    const baseBranch = String(metadata.defaultBranch || pull?.base?.ref || 'main');
    if (String(pull?.state).toLowerCase() !== 'open'
      || this.canonicalRepository(pull?.head?.repo?.full_name) !== repository
      || this.canonicalRepository(pull?.base?.repo?.full_name) !== repository
      || String(pull?.head?.ref || '') !== input.expectedBranch
      || String(pull?.base?.ref || '') !== baseBranch
      || String(pull?.head?.sha || '').toLowerCase() !== input.expectedHeadSha.toLowerCase()) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_PR_MISMATCH' });
    }
    const prUrl = String(pull?.html_url || '');
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/i.test(prUrl)) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_PR_URL_INVALID' });
    }
    await this.verifyRecoveryRemoteFiles(project, input);

    const result: any = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(Incident);
      const incident: any = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!incident) throw new NotFoundException('Incident introuvable.');
      const currentMetadata: any = incident.metadata || {};
      const currentFix: any = currentMetadata.fixRequest || {};
      if (currentFix.postWriteRecovery?.status === 'COMPLETED') {
        if (currentFix.postWriteRecovery.identity !== recoveryIdentity) {
          throw new ConflictException({ code: 'POST_WRITE_RECOVERY_CONFLICT' });
        }
        return { applied: false, duplicate: true, incident, recovery: currentFix.postWriteRecovery };
      }
      if (currentFix.requestId !== input.fixRequestId || currentFix.batchId !== input.batchId
        || currentFix.status !== 'FIX_FAILED' || Number(currentFix.attemptCount) !== Number(fix.attemptCount)
        || JSON.stringify(currentFix.attempts || []) !== JSON.stringify(fix.attempts || [])) {
        throw new ConflictException({ code: 'POST_WRITE_RECOVERY_STATE_CHANGED' });
      }
      const now = new Date().toISOString();
      const recovery = { identity: recoveryIdentity, status: 'COMPLETED', sourceAttempt: input.sourceAttempt,
        sourceExecutionId: String(input.sourceExecutionId), candidateDigest: input.candidateDigest.toLowerCase(),
        branchName: input.expectedBranch, recoveredHeadSha: input.expectedHeadSha.toLowerCase(),
        prNumber: input.prNumber, prUrl, recoveredExistingPr: true, recoveredAt: now, recoveredBy: user.id };
      const workflowEvents = [...(Array.isArray(currentFix.workflowEvents) ? currentFix.workflowEvents : []), {
        identity: `${recoveryIdentity}:POST_WRITE_RECOVERY_COMPLETED`, workflowId: this.configuredWf2Identity(),
        executionId: String(input.sourceExecutionId), attempt: input.sourceAttempt,
        status: 'POST_WRITE_RECOVERY_COMPLETED', recordedAt: now, source: 'GOVERNED_POST_WRITE_RECOVERY',
      }];
      const nextFix = { ...currentFix, ...commonPrCreatedFields({ prUrl, prNumber: input.prNumber,
          prHeadSha: input.expectedHeadSha.toLowerCase(), now, evidence }),
        attempts: currentFix.attempts, attemptCount: currentFix.attemptCount, workflowEvents,
        postWriteRecovery: recovery };
      const nextMetadata = this.invalidateActiveValidationForNewSha(
        { ...currentMetadata, fixRequest: nextFix }, input.expectedHeadSha.toLowerCase(), 'POST_WRITE_RECOVERY_COMPLETED');
      const patch: any = { metadata: nextMetadata, prUrl, status: IncidentStatus.FIX_GENERATED };
      await repo.update(id, patch);
      Object.assign(incident, patch);
      return { applied: true, duplicate: false, incident, recovery };
    });
    if (result.applied) {
      const updated = await this.findOne(id);
      this.gateway.emit('incident:updated', updated);
      this.dispatchAutomaticInitialPrValidation(id).catch(error => {
        console.warn(`[incidents] automatic initial PR validation failed after post-write recovery for incident ${id}: ${error?.message || error}`);
      });
    }
    return { success: true, duplicate: result.duplicate, recoveredExistingPr: true, status: 'PR_CREATED',
      incidentId: id, requestId: fix.requestId, batchId: fix.batchId, postWriteRecovery: result.recovery };
  }

  /** Réconcilie la validation de la PR. */
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
      // Never guess VALIDATED : un build SUCCESS sans callback n'est jamais conclu ici. On renvoie
      // à WF1 la notification Jenkins d'origine de CE build (retrouvée dans n8n) pour que WF3
      // recalcule l'évidence et que saveValidation() reste seul juge (SHA, job, batch, demande active).
      const config = redeliveryConfig();
      if (!config) throw new ConflictException('Le build Jenkins est SUCCESS sans callback reçu — réconciliation manuelle requise (récupération automatique non configurée).');
      const delivery = await findPrValidationDeliveryInN8n(config, { buildPath: jobPath, buildNumber: Number(buildData.number),
        validationRequestId: String(request.validationRequestId), notBefore: Date.parse(String(request.queuedAt || request.createdAt || '')) - 60_000 });
      if (!delivery) throw new ConflictException('Le build Jenkins est SUCCESS sans callback reçu — notification Jenkins d’origine introuvable dans n8n, réconciliation manuelle requise.');
      // Compteur écrit AVANT l'envoi, sur la valeur courante verrouillée : WF3 peut répondre en ~1 s et
      // ne doit jamais être écrasé par une copie périmée de la demande.
      const claimed = await this.repo.manager.transaction(async manager => {
        const repo = manager.getRepository(Incident);
        const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        const live: any = (current?.metadata as any)?.prValidationRequest;
        if (!current || !live || live.validationRequestId !== request.validationRequestId || !['QUEUED', 'RUNNING'].includes(String(live.status))) return null;
        const redeliveries = Number(live.callbackRedeliveries || 0);
        if (redeliveries >= MAX_PR_VALIDATION_REDELIVERIES) return { exhausted: true };
        await repo.update(id, { metadata: { ...(current.metadata as any), prValidationRequest: { ...live, callbackRedeliveries: redeliveries + 1,
          lastCallbackRedeliveryAt: new Date().toISOString(), lastCallbackRedeliveryBuild: buildData.number, lastCallbackRedeliveryBy: user?.id || 'system' } } } as any);
        return { exhausted: false };
      });
      if (!claimed) return { reconciled: false, reason: 'NO_LONGER_ACTIVE', validationRequest: request };
      if (claimed.exhausted) throw new ConflictException('Le build Jenkins est SUCCESS sans callback reçu après plusieurs réexpéditions — réconciliation manuelle requise.');
      await postPrValidationDelivery(config, delivery);
      return { reconciled: false, reason: 'CALLBACK_REDELIVERED', buildNumber: buildData.number, validationRequest: request };
    }
    const now = new Date().toISOString();
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
    await this.mergeNonLifecycleMetadata(id, { prValidationRequest: reconciled });
    return { reconciled: true, validationRequest: reconciled };
  }

  /** Déclenche manuellement un build Jenkins standard pour un projet (hors chaîne de validation de PR). */
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
    /** Prépare ou transmet la demande au service concerné. */
    const request = async (url: string, init: RequestInit = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try { return await fetch(url, { ...init, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    };
    /** Signale une erreur pour throw Jenkins échec. */
    const throwJenkinsFailure = (status: number, queueUrl?: string | null) => {
      const result = classifyJenkinsTriggerStatus(status);
      const body: Record<string, unknown> = { success: false, code: result.code, message: `Jenkins a refusé la requête (${status})` };
      if (result.code === 'JENKINS_JOB_NOT_FOUND') throw new NotFoundException(body);
      if (result.code === 'JENKINS_TRIGGER_CONFLICT') throw new ConflictException(body);
      if (result.code === 'JENKINS_TRIGGER_ALREADY_QUEUED') {
        // Défaut D-9 : message honnête + le queueId réellement concerné, pour
        // que l'UI puisse dire « un build est déjà en file » plutôt que
        // « agent injoignable ».
        const existing = Number(String(queueUrl || '').match(/\/queue\/item\/(\d+)\/?$/)?.[1]);
        body.message = 'Un déclenchement identique est déjà en file d’attente pour ce job — Jenkins a fusionné la demande.';
        if (Number.isInteger(existing)) body.queueId = existing;
        if (queueUrl) body.queueUrl = queueUrl;
        throw new ConflictException(body);
      }
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
        // QA-E2E D-9 — NE PAS suivre la redirection : le 303 de Jenkins et son
        // en-tête Location sont l'information utile (quel élément de file a
        // absorbé la demande). La suivre transformait le diagnostic en un 200
        // opaque et effaçait le Location.
        redirect: 'manual',
      });
      const queueUrl = buildRes.headers.get('location');
      const classification = classifyJenkinsTriggerStatus(buildRes.status);
      if (!classification.accepted) throwJenkinsFailure(buildRes.status, queueUrl);
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
