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
import { computeMergeAuthorization, deriveRemediationResult, deriveExactCorrelationVerified, deriveHeadVerificationResult } from '../validation/merge-authorization';
import { buildDefaultValueSemanticsEvidence, CandidateFileRecord } from '../validation/default-value-semantics-assembler';
import { validateCanonicalEvidenceBinding, mergeCanonicalEvidenceWithStatic, identityMatches, RULE_REGISTRY } from '../validation/semantic-evidence-core';
import { resolveSemanticEvidenceAdapter } from '../validation/adapters/registry';
import { CandidateVerificationService } from '../candidate-verification/candidate-verification.service';
import { HeadVerificationRequest, HeadVerification, VerificationEvidence } from '../candidate-verification/candidate-verification.types';
import { redactAndCapEvidence } from '../candidate-verification/verification-evidence';
import { analyzeRegression, conservativeRegressionPolicy } from '../validation/pr-regression-engine';
import { combineRegressionVerdict } from '../validation/regression-verdict';
import { normalizeSonarFindings } from '../validation/sonar-regression-adapter';
import { buildCorrectiveContext } from '../validation/corrective-context';
import { isWorkflowIdentity, resolveAttemptWorkflowIdentity } from './workflow-attempt-identity';
import { commonPrCreatedFields, isPostWriteFailureNode, PostWriteRecoveryInput,
  postWriteRecoveryIdentity, validatePostWriteRecoveryEvidence } from './post-write-recovery';

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

// R80.2 — identity for an EXPLICIT, human-authorized same-SHA revalidation
// (see reRunPrValidation). Deliberately a DIFFERENT hash function from
// prValidationIdentity above, not that function extended with an extra
// epoch parameter: every historical persisted prValidationRequest.
// validationRequestId was computed by the 4-field formula above, and
// sameIdentity comparisons throughout requestPrValidation/saveValidation
// compare freshly-computed values against those persisted ones. Changing
// the base formula's shape (even by adding an epoch param defaulting to 0)
// would silently break every existing persisted identity across every
// project/incident that predates this change — never worth the risk for a
// feature only the NEW rerun path needs. `epoch` (>=1) is never derived
// from this identity string alone; the caller (reRunPrValidation) always
// carries and compares the numeric `epoch` field explicitly, this hash is
// only the value threaded through Jenkins/WF3 the same way the base
// identity already is.
export function prValidationRevalidationIdentity(projectId: string, prNumber: number, prHeadSha: string, batchId: string, epoch: number): string {
  return createHash('sha256').update(`${projectId}\n${prNumber}\n${prHeadSha.toLowerCase()}\n${batchId}\nrevalidation\n${Number(epoch)}`).digest('hex');
}

export function isFullGitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

// R79 — the sha a candidate's OWN writes are based on, for fetching its
// pre-edit file content. `fixRequest.baselineSha` is the ORIGINAL
// source-scan commit (used for the unrelated Sonar scanner-regression
// diff) and only coincides with a candidate's real git parent on a batch's
// very first attempt; a corrective (2nd+) attempt's real parent is whatever
// PR head it was dispatched on top of, already recorded verbatim as
// correctiveDispatch.blockedSha. Generic: reads only structural
// dispatch/attempt bookkeeping, never a project-specific field/class name.
export function resolveDefaultValueSemanticsBaseSha(fixRequest: any): string {
  const correctiveBase = fixRequest?.correctiveDispatch?.blockedSha;
  if (isFullGitSha(correctiveBase)) return String(correctiveBase).toLowerCase();
  return String(fixRequest?.baselineSha || '').toLowerCase();
}

// R79 — true iff this batch's OWN corrective dispatch declares a
// DEFAULT_VALUE_SEMANTICS_DEFECT blocking cause, i.e. the remediation's
// stated purpose IS the invariant default-value-semantics.ts checks. Never
// references a project-specific type/field/class name — only the
// structural blockingCauses[].type tag WF2/backend already define.
export function correctiveBlockingCausesDeclareDefaultValueSemanticsDefect(fixRequest: any): boolean {
  const causes = fixRequest?.correctiveDispatch?.correctiveContext?.blockingCauses;
  return Array.isArray(causes) && causes.some((cause: any) => cause?.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT');
}

// R79 — true iff at least one of `checkedFieldPairs` matches (exactly, on
// all four identity fields) a DEFAULT_VALUE_SEMANTICS_DEFECT blocking
// cause's own (sourceType, sourceField, candidateType, candidateField), AND
// that specific pair's own verdict is NOT PROVEN_DEFECT (a proven defect on
// the relevant pair already blocks via the top-level verdict check — this
// flag only needs to distinguish "the required pair came back safe" from
// "no relevant pair was ever checked"). Never references a project-specific
// type/field name — only the generic identity fields blockingCauses and
// checkedFieldPairs already both carry.
// R80 — generic over ANY registered rule type (RULE_REGISTRY), never
// assuming a fixed 4-field identity shape: identityMatches() compares
// exactly the identity keys the matched rule itself declares. Still keyed
// off `cause.type` because that is (and remains) the platform's own
// corrective-dispatch contract field naming which rule a blocking cause
// is — not a framework/project literal.
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
      && (pair.ruleType === undefined || pair.ruleType === cause.type) // legacy static pairs (pre-R80) carry no ruleType — still matched by identity alone
      && identityMatches(rule, pair as Record<string, string>, cause));
  });
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
  // R76 -- optional, bounded candidate-verification diagnostic summary (see
  // verification-evidence.ts). Never trusted blindly even though WF2 already
  // bounds it -- sanitizeVerificationEvidence() re-validates/re-caps/re-redacts
  // server-side before persistence, same defense-in-depth posture as every
  // other WF2-supplied field on this input.
  verificationEvidence?: unknown;
};

// R76 -- observability only. Whitelists exact fields, re-caps evidence tails,
// re-applies redaction server-side (never trusts the WF2 payload blindly),
// and degrades to null on anything malformed rather than throwing -- a
// missing/invalid evidence summary must never block persisting the
// failureCode/failureNode/failureSummary fields that already exist today.
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

// R69 — workflowFinding() is called on TWO genuinely different shapes: raw
// scanner/incident findings (Sonar/Trivy/OWASP/ZAP, always carrying `.id`
// and/or `.key`, never `.findingId` — see collectFindings()/startFix()
// above) when building a fresh batch, AND on the function's OWN already-
// canonicalized persisted output (fixRequest.findings[], which only ever
// carries `.findingId`) when a corrective attempt rebuilds a WF2 payload
// from persisted state (correctAndRevalidate). The previous `finding?.id ||
// finding?.key` resolution only understood the first shape; fed the second,
// it silently produced the STRING "undefined" (proven: execution 2023027's
// FINDING_CORRELATION_MISMATCH). resolveCanonicalFindingId() makes the
// function idempotent — safe on either input shape — and never lets a
// missing/sentinel value through.
const MISSING_FINDING_ID_SENTINELS = new Set(['undefined', 'null', '']);

function resolveCanonicalFindingId(finding: any): string | null {
  for (const candidate of [finding?.findingId, finding?.id, finding?.key]) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (!value || MISSING_FINDING_ID_SENTINELS.has(value)) continue;
    return value;
  }
  return null;
}

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

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly repo: Repository<Incident>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly gateway: IncidentsGateway,
    private readonly manualRemediation: ManualRemediationService,
    private readonly candidateVerification: CandidateVerificationService,
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
      // R75 — corrective cardinality invariant. A corrective attempt's active
      // defect identity is correctiveIssues[] (one per proven blocking cause),
      // never the historical finding count/location — WF2 (R74/R75) already
      // plans and writes against exactly that identity. Per cause, prefer its
      // OWN `findingId` when present (e.g. the older TARGET_FINDING_INVALID
      // shape, which already names a specific still-invalid historical
      // finding 1:1 — synthesizing an id for that cause would be a
      // regression, not a fix); only synthesize `batchId:issue-<index>` for a
      // cause that carries no such field (e.g. DEFAULT_VALUE_SEMANTICS_DEFECT).
      // This mirrors, field-for-field, the SAME rule WF2 itself applies when
      // constructing correctiveIssues[].candidateId, from the SAME evidence
      // (fix.correctiveDispatch.correctiveContext.blockingCauses). It also
      // avoids requiring the corrective candidate's grounded target file to
      // equal the historical finding's file — which R73 can deliberately
      // make untrue.
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
      const nextFix = callbackStatus === 'FAILED'
        ? { ...fix, status: 'FIX_FAILED', attempts, workflowEvents: events, failedAt: now,
            lastErrorCode: String(input.failureCode || 'WF2_EXECUTION_ERROR').slice(0, 80),
            lastError: String(input.failureSummary || 'Erreur d’exécution WF2').slice(0, 500),
            failedNode: String(input.failureNode || '').slice(0, 120) || null,
            verificationEvidence,
            workflowId, workflowExecutionId: executionId,
            completionEvidence: input.completionEvidence || fix.completionEvidence || null,
            retryEligible: true }
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
      const nextMetadata = callbackStatus === 'PR_CREATED'
        ? this.invalidateActiveValidationForNewSha({ ...metadata, fixRequest: nextFix }, String(input.prHeadSha || ''), 'CORRECTIVE_PR_CREATED')
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
    // BRIQUE 4 — AUTOMATIC INITIAL PR VALIDATION: fired exactly once per real
    // WF2 PR_CREATED callback (never on a duplicate/stale/FAILED outcome —
    // `result.applied` is only true for a genuinely NEW, freshly-persisted
    // transition, thanks to the eventIdentity dedup and terminal-attempt
    // guards already enforced inside the transaction above). PR number, URL,
    // branch and head SHA are already durably persisted on `nextFix`/
    // `incident.prUrl` at this point (patch applied above). Fire-and-forget,
    // exactly like the existing WF4/WF5 auto-routing pattern in
    // webhooks.service.ts#routeToOptimizer: must never delay or fail this
    // callback's response to WF2. requestPrValidation() itself is the ONLY
    // place that decides REQUESTED/QUEUED/FAILED and is already idempotent
    // (prValidationRequest.validationRequestId keyed on
    // projectId+prNumber+prHeadSha+batchId) — a human clicking "Valider la
    // Pull Request" concurrently, or a second callback slipping past the
    // outer dedup, can never cause a second business validation run.
    if (result.applied && result.status === 'PR_CREATED') {
      this.dispatchAutomaticInitialPrValidation(id).catch(error => {
        console.warn(`[incidents] automatic initial PR validation failed for incident ${id}: ${error?.message || error}`);
      });
    }
    return { success: true, applied: result.applied, duplicate: result.duplicate, stale: result.stale,
      incidentId: id, status: result.status, ...(result.code ? { code: result.code } : {}) };
  }

  // BRIQUE 4 — system-triggered PR validation request, reusing
  // requestPrValidation() unchanged (same governance, same Jenkins/HEAD_ONLY
  // gate, same idempotent claim). A synthetic admin actor is used only for
  // audit attribution (`prValidationRequest.createdBy`) — never bypasses
  // assertCanApprove. Any failure here (Jenkins unreachable, HEAD_ONLY
  // unavailable, a conflicting concurrent request, ...) is already durably
  // recorded on prValidationRequest by requestPrValidation() itself (status
  // FAILED + failureCode + result) before it throws; this method only
  // exists so that thrown error can never surface as an unhandled rejection.
  // Never retried automatically — a human retry (or a later governed
  // refresh) remains required, exactly like any other FAILED validation.
  private async dispatchAutomaticInitialPrValidation(id: string): Promise<void> {
    const systemActor = { id: 'system-auto-pr-validation', role: 'admin' };
    await this.requestPrValidation(id, systemActor);
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
    // BRIQUE 2 — additive, backend-side recomputation of the HEAD_ONLY leg of
    // the identity invariant on final callback: never trust a boolean alone
    // (WF3/Jenkins are already re-proven above via checkoutSha/expectedPrHeadSha).
    // Deterministic, no fuzzy matching -- a headVerification computed for
    // another incident/request/batch/PR/attempt/SHA must never satisfy this
    // validation. Additive/backward-compatible: a prValidationRequest that
    // predates this check (no headVerification persisted) is left alone, so
    // this never breaks a record produced before Brique 2.
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
    // BRIQUE 4 — GLOBAL QUALITY GATE SEPARATION: `passed` (and everything
    // derived from it below: validationStatus, incident.status,
    // fixRequest.status, prValidationRequest.status/result, cycles[].status)
    // is the REMEDIATION-evidence verdict only. It must NEVER depend on the
    // global Sonar Quality Gate (`sonarStatus`) — a QG ERROR caused solely by
    // pre-existing/out-of-batch findings must not turn a clean remediation
    // into a failed one. Sonar analysis EXECUTION is still required
    // (`correlationVerified`, which already requires `sonarCorrelationVerified`
    // — proof the analysis actually ran and produced a real answer); only its
    // pass/fail VERDICT is excluded. `sonarStatus` remains fully persisted on
    // this record unchanged (see `sonarStatus` field below) so deployment
    // readiness (governance.ts/azure-deploy-readiness.service.ts, untouched)
    // keeps reading the real QG verdict as its own, separate, still-strict gate.
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

    // ── BRIQUE 3 — analyse de régression PR (ADDITIF STRICT) ───────────────
    // Compare le candidat exact-SHA déjà prouvé (validation.checkoutSha,
    // chaîne d'identité Brique 2) contre un instantané baseline immuable.
    // Ne mélange JAMAIS ceci avec findingResults (verdict de remédiation
    // ci-dessus) : les deux peuvent être simultanément VALIDATED/CLEAN,
    // VALIDATED/CHANGES_REQUIRED, etc. Fail closed par construction
    // (analyzeRegression).
    //
    // BRIQUE 3 CLOSEOUT — PART 2 : incident.metadata.enrichedData.sonar.issues
    // et incident.metadata.sourceCommitSha sont écrits ATOMIQUEMENT en un seul
    // PUT WF1 ("Save Final Decision to Backend" -> metadata: rawData), donc ne
    // peuvent pas diverger aujourd'hui par construction -- mais on ne se fie
    // JAMAIS à cette seule garantie architecturale : on revérifie ici que le
    // sourceCommitSha ACTUELLEMENT persisté sur l'incident correspond encore
    // exactement au baselineSha GELÉ dans fixRequest (startFix()). Si l'un des
    // deux dérive (ex: un futur appel écrase enrichedData sans sourceCommitSha),
    // la baseline devient non attribuable -> INCONCLUSIVE, jamais une
    // comparaison silencieuse entre deux builds différents.
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

    // ── R66 — default-value/deserialization-semantics review ───────────────
    // Runs AFTER the exact-SHA correlation gate above (validation.checkoutSha
    // is already proven === expectedPrHeadSha === validationRequest's frozen
    // target) and BEFORE computeMergeAuthorization(), which stays pure — all
    // IO happens here, in this one bounded call. Sourced entirely from data
    // the platform already persists: fixRequest.fileResults' immutable blob
    // SHAs (oldSha/newSha) plus the frozen candidateBaseSha/checkoutSha — no
    // new WF2 payload field. See default-value-semantics-assembler.ts for
    // the provenance verification (every fetch's returned blob SHA is
    // checked against the persisted one before its content is trusted) and
    // default-value-semantics.ts for the generic invariant itself. Never
    // throws by contract; the extra try/catch is defense in depth only —
    // any failure here degrades to VERIFICATION_REQUIRED, which is a no-op
    // for authorization, never a blocker and never a fabricated pass.
    const candidateFileRecords: CandidateFileRecord[] = (Array.isArray(fixRequest.fileResults) ? fixRequest.fileResults : [])
      .map((fr: any) => ({ targetFile: String(fr.targetFile || ''), fileOperation: String(fr.fileOperation || ''), oldSha: fr.oldSha ?? null, newSha: String(fr.newSha || '') }))
      .filter((fr: CandidateFileRecord) => fr.targetFile && fr.newSha);
    // R79 — the file content this candidate actually diffed against is the
    // sha it branched writes from, NOT `fixRequest.baselineSha` (that field
    // is the ORIGINAL source-scan commit, used for the unrelated Sonar
    // scanner-regression diff — see validation.regression.baselineSha).
    // Those two are only the same commit for a batch's very FIRST attempt;
    // for a corrective (2nd+) attempt, prior attempts already moved the PR
    // branch, so fetching file content at baselineSha either 404s or returns
    // an unrelated blob, and every provenance check inside
    // buildDefaultValueSemanticsEvidence() correctly fails closed — a real
    // bug (data mixup), not a policy choice. correctiveDispatch.blockedSha is
    // the exact, already-persisted "what this attempt's writes are based on"
    // fact for a corrective attempt; only the first attempt (no
    // correctiveDispatch yet) falls back to baselineSha, which is correct
    // for that case since nothing has moved the branch yet.
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
    // R80 — bridges AUTHORITATIVE EXECUTED test evidence into the same
    // audit the static analyzer produced, when the SAME already-verified
    // webhook body (checkoutSha/buildNumber already proven exact-match
    // above, before this line is ever reached) also carries a
    // semanticEvidence envelope. The adapter is selected purely by the
    // envelope's own declared `reportFormat` (JUnit today; any future
    // framework registers its own adapter in adapters/registry.ts without
    // this call site — or the core model — ever changing). Evidence bound
    // to any other sha/build/provider is rejected at
    // validateCanonicalEvidenceBinding and never reaches the merger — there
    // is no path for application code to assert this evidence outside this
    // already-authenticated, already-correlated call.
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

    // ── BRIQUE 4 — autorisation de merge : LA décision centrale ────────────
    // computeMergeAuthorization() est désormais l'unique décision métier
    // faisant autorité (VALIDATING/MERGE_READY/BLOCKED/INCONCLUSIVE). Découple
    // le verdict de remédiation (findingResults) et la régression (Brique 3)
    // du Quality Gate Sonar global — ce dernier n'est ici qu'un advisory ; il
    // reste bloquant pour le DÉPLOIEMENT via DeployReadiness (intouché).
    // `requiredStagesComplete` inclut désormais explicitement jenkinsStatus
    // (défense en profondeur : les stages requis seuls pourraient en théorie
    // être incohérents avec le statut global du build).
    // Robuste aux records incomplets : deriveRemediationResult([]) => INCONCLUSIVE,
    // computeMergeAuthorization est pur et total (jamais d'exception).
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
    // BRIQUE 5 — explicit, named flag rather than asking every consumer
    // (frontend included) to re-derive "is this BLOCKED for a remediable
    // reason". Today this is exactly `authorization === 'BLOCKED'` (Brique 4
    // guarantees blockingReasons only ever holds proven-defect codes,
    // FINDING_INVALID/REGRESSION_CHANGES_REQUIRED, never an uncertain/
    // infrastructure one) — but a future policy could in principle add a
    // BLOCKED code this platform cannot act on causally, and this flag is
    // the one place that distinction would be made, never the frontend.
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

  /**
   * A validation is candidate evidence for exactly one SHA. When an existing
   * validation target moves, retain the old record only as history and replace
   * the active view with an explicitly inconclusive, evidence-free state.
   */
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

  private configuredWf2Identity(): string {
    const identity = process.env.N8N_WF2_ID;
    if (!isWorkflowIdentity(identity)) {
      throw new ServiceUnavailableException({ code: 'WF2_DISPATCH_IDENTITY_UNCONFIGURED',
        message: 'L’identité du workflow WF2 doit être configurée avant une nouvelle tentative.' });
    }
    return identity;
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
      const results = meta.validation?.derived?.findings || meta.validation?.findingResults || meta.prValidationRequest?.findingResults || [];
      for (const finding of batch.findings) {
        const findingId = String(finding.id || finding.key);
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
      // Une sélection MODIFIÉE (sous-ensemble/ensemble différent) après un
      // échec définitif n'est pas une collision : c'est exactement le
      // scénario « Modifier la sélection » -- une toute nouvelle demande de
      // correction, jamais un doublon. Seule une resoumission du batch
      // IDENTIQUE (sameBatch) doit continuer à rediriger vers « Réessayer ».
      const isModifiedSelectionAfterFailure = !explicitRetry && current?.status === 'FIX_FAILED' && !sameSelection;
      if (!explicitRetry && ownsRequestedFinding && !isModifiedSelectionAfterFailure) {
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
        { attempt: attemptCount, status: 'FIX_STARTING', authorizedBy: user.id, authorizedAt,
          ...(batch.workflow === 'WF2' ? { expectedWorkflowId: this.configuredWf2Identity() } : {}) },
      ];
      // BRIQUE 3 CLOSEOUT — PART 1: incident.metadata.sourceCommitSha is the
      // exact source commit Jenkins/WF1 reported for the build that produced
      // this incident's findings (threaded from "Normalize Incident
      // Payload"'s commitSha, see wf1-incident-intake-analysis-v5-1's
      // "Prepare Final Report" node). Frozen here, once, at remediation
      // start -- never re-derived from a live/"latest main" lookup, and
      // never refreshed on retry (an explicit retry reuses the SAME frozen
      // value the original attempt captured, exactly like prHeadSha/
      // validationTargetSha elsewhere in this file). Absent/invalid source
      // SHA -> baselineSha stays null, which the regression engine already
      // treats as INCONCLUSIVE (never guessed).
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
      const metadata = { ...(incident.metadata || {}), fixRequest: {
        requestId, batchId, status: 'FIX_STARTING', workflow: batch.workflow,
        findingId: batch.findingIds[0], findingIds: batch.findingIds, findings: canonicalFindings,
        approvedBy: user.id, approvedAt: explicitRetry ? (current?.approvedAt || authorizedAt) : authorizedAt, baselineSha,
        attemptCount, attempts, lastError: null, failedAt: null, retryEligible: false,
      }, cycles: Array.isArray((incident.metadata as any)?.cycles) ? (incident.metadata as any).cycles : [],
      previousFixRequests: isModifiedSelectionAfterFailure ? [...previousFixRequests, current] : previousFixRequests };
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
    return this.triggerGovernedPrValidationBuild(id, claim);
  }

  // R80.2 — extracted verbatim from requestPrValidation's tail (the one and
  // only place this platform actually verifies a candidate HEAD and
  // triggers Jenkins for PR validation), so reRunPrValidation's explicit
  // same-SHA revalidation path can reuse it exactly rather than
  // reimplementing Jenkins-triggering. Every caller must have ALREADY
  // established `claim.request`/`claim.project` through its OWN governed
  // eligibility checks and transaction (identity, PR-open/branch/SHA
  // freshness, dedup) -- this method performs zero eligibility checks of
  // its own; it only proves the HEAD and triggers/queues the build.
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

    // BRIQUE 2 — the governed target (remoteHeadSha, already frozen above as
    // claim.request.expectedPrHeadSha) must be independently proven by an
    // exact-SHA HEAD_ONLY verification before Jenkins is ever triggered.
    // HEAD_ONLY never authorizes a write (Brique 1 write-guard rejects it
    // unconditionally) -- it only proves the exact PR-head commit compiles
    // and its own regression suite passes, so a broken/unreachable candidate
    // never consumes a Jenkins build. The input SHA is always the
    // already-governed remoteHeadSha -- HEAD_ONLY never resolves its own
    // "latest" branch tip.
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
      await this.repo.update(id, { metadata: { ...currentMeta, prValidationRequest: failed } } as any);
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
      const queued = { ...claim.request, status: 'QUEUED', headVerification, queueUrl, queuedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prValidationJob };
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
      // BRIQUE 4 — a Jenkins trigger failure (timeout, auth, job not found,
      // queue rejected, ...) is an infrastructure fact, never a proven
      // candidate defect: always INCONCLUSIVE, never BLOCKED.
      const failed = { ...claim.request, status: 'FAILED', result: 'INCONCLUSIVE', headVerification, failureCode, failureSummary, failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), prValidationJob };
      await this.repo.update(id, { metadata: { ...currentMeta, prValidationRequest: failed } } as any);
      throw new ServiceUnavailableException('La validation PR n’a pas pu être mise en file dans Jenkins.');
    }
  }

  // R80.2 — explicit, human-gated, SAME-SHA governed revalidation. Exists
  // for exactly one situation: validation INFRASTRUCTURE (Jenkins shared
  // library, backend evidence-parsing code, adapters — never the
  // application) changed after a validation already COMPLETED/FAILED for a
  // still-open PR whose remote HEAD has not moved, and a human wants a
  // fresh, governed Jenkins run against that SAME immutable candidate SHA
  // so the corrected infrastructure gets a chance to observe it. This is
  // NOT a new corrective attempt: fixRequest.attemptCount/batchId/requestId
  // are never touched, no WF2 execution is ever implied, and no application
  // commit is created. `validationEpoch` is the additive dimension that
  // makes this safe: epoch 0 is the request requestPrValidation always
  // creates (unchanged, byte-identical behavior, zero migration needed —
  // any historical record with no `epoch` field is simply epoch 0); this
  // method is the ONLY place epoch ever advances, and only past a terminal
  // (COMPLETED/FAILED) predecessor for the exact same SHA, one explicit
  // human call at a time.
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
    // Same live freshness proof requestPrValidation itself performs — never
    // trust the persisted expectedPrHeadSha alone: PR state, branch, and
    // remote HEAD are all re-proven against GitHub at call time, and any
    // drift (PR closed, branch changed, a new commit pushed) fails closed,
    // exactly like requestPrValidation. A genuine new commit must go through
    // refresh-target (a NEW target, NEW epoch-0 validation), never through
    // this same-SHA path.
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
        // Exactly-once / race safety (R80.2 §4): a concurrent call that
        // loses the lock race lands here and sees the FIRST call's
        // just-created epoch (currentEpoch>=1, still REQUESTED/QUEUED/
        // RUNNING) — return it as a duplicate, never allocate epoch+2.
        // currentEpoch===0 here means the ORIGINAL (non-rerun) validation
        // is still active/in-flight, which is a genuine precondition
        // failure (R80.2 §9-G/H), not a duplicate of anything this method
        // ever created.
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
        await this.repo.update(id, { metadata: nextMetadata } as any);
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

  // R67 — POST /:id/pr-validation/recompute-policy. The platform gap this
  // closes: a candidate can already be COMPLETED/VALIDATED against evidence
  // that was true and complete under the OLD policy, and then a NEW
  // deterministic check (R66's default-value-semantics invariant, or any
  // future one wired the same way) lands without the PR's SHA ever moving.
  // Every existing revalidation path (requestPrValidation,
  // refreshPrValidationTarget's non-idempotent branch, reconcilePrValidation)
  // is keyed on "the SHA moved" and is a correct no-op here — none of them
  // exist to re-run POLICY against unchanged, already-proven evidence. This
  // action does exactly that and nothing else: it never talks to Jenkins,
  // Sonar, or WF3, never creates a new prValidationRequest/validationRequestId,
  // never touches the PR/branch, and never increments fixRequest.attemptCount.
  // It reuses computeMergeAuthorization() (unchanged, still pure) fed with the
  // SAME persisted facts that already fed it once (remediationResult/
  // regressionResult/headVerificationResult are read back verbatim from the
  // existing mergeAuthorization record; exactCorrelationVerified/
  // requiredStagesComplete are re-derived from the same persisted
  // correlationVerified/checkoutSha/jenkinsStatus/requiredStages facts,
  // mirroring saveValidation()'s own derivation exactly) plus exactly one new
  // input: defaultValueSemanticsResult, computed via the existing R66
  // evidence assembler (buildDefaultValueSemanticsEvidence) against the same
  // immutable candidateBaseSha/prHeadSha/fileResults blob SHAs — no new
  // semantic detector. fixRequest.status is deliberately left at VALIDATED
  // (never forced back to PR_CREATED): doing so would make
  // requestPrValidation/refresh-target's SHA-moved branch believe a NEW
  // remediation cycle is needed, which is false — the candidate is unchanged,
  // only the verdict about it changed.
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
    // R80 — recompute-policy receives no fresh Jenkins webhook body, so it
    // can only reuse EXECUTED evidence already durably persisted from a
    // prior saveValidation() call — never accept a fresh claim here. Safe
    // because this action's own eligibility checks above already require
    // validation.checkoutSha === expectedPrHeadSha for the CURRENT record,
    // so any 'EXECUTED_TEST' pair already sitting on that same persisted
    // audit is, by construction, bound to this exact sha.
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

  // BRIQUE 5 — POST /:id/correct-and-revalidate. Exactly ONE causal
  // corrective attempt per explicit human authorization, on the SAME
  // remediation lineage (incidentId/requestId/batchId/PR/branch) — never a
  // second PR, never automatic. Permitted ONLY when the CURRENT persisted
  // validation.mergeAuthorization.authorization === 'BLOCKED': a PROVEN
  // defect (TARGET_FINDING_INVALID / NEW_BLOCKING_FINDING). Brique 4's own
  // design already guarantees BLOCKED never arises from an uncertain/
  // infrastructure signal (those are INCONCLUSIVE, a different value
  // entirely) — so this single check IS "reject INCONCLUSIVE causes"
  // (Phase 1 requirement #4), with no separate taxonomy needed. Never
  // touches fixRequest.findingIds/findings (the original approved batch is
  // immutable) — causal evidence travels in a SEPARATE correctiveContext.
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
      // Narrow pre-dispatch correlation guard, specific to THIS dispatch
      // call (never a reimplementation of WF2's own "Adapt Webhook Payload"
      // graph logic): the two independently-persisted arrays this payload
      // is built from — fix.findingIds (flat list) and fix.findings
      // (objects workflowFinding() just canonicalized) — must describe the
      // exact same set of findings before anything is sent. Every finding
      // already has a proven-non-sentinel findingId at this point
      // (workflowFinding() would already have thrown otherwise); this only
      // proves the two arrays agree with each other and with the payload's
      // own singular `finding`.
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
        // BRIQUE 5 — causal corrective mode. WF2's "Policy Gate" already
        // spreads every field of the incoming payload through unchanged (a
        // generic `{...data, ...computed}`, no allowlist truncates unknown
        // keys), so these two fields reach "Select Existing PR" without any
        // other WF2 wiring change. correctiveAttempt=true is the one flag
        // WF2 uses to refuse creating a replacement PR when the expected one
        // is not open (see n8n-workflows/active/wf2-...json, "Select Existing
        // PR" and n8n-workflows/scripts/wf2-corrective-same-pr.spec.mjs).
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
        if (Number(currentFix.attemptCount) !== nextAttempt || currentFix.status !== 'FIX_STARTING') return;
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
      if (Number(currentFix.attemptCount) !== nextAttempt || currentFix.status !== 'FIX_STARTING') return;
      const attempts = (currentFix.attempts || []).map((a: any) => a.attempt === nextAttempt ? { ...a, status: 'DISPATCHED', dispatchedAt } : a);
      const correctiveDispatch = currentFix.correctiveDispatch?.identity === correctiveAttemptIdentity
        ? { ...currentFix.correctiveDispatch, status: 'DISPATCHED' } : currentFix.correctiveDispatch;
      await incidents.update(id, { metadata: { ...currentMeta, fixRequest: { ...currentFix, status: 'DISPATCHED', attempts, dispatchedAt, correctiveDispatch } } } as any);
    });
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return { success: true, duplicate: false, status: 'DISPATCHED', incidentId: id, requestId: fix.requestId, batchId: fix.batchId, attemptCount: nextAttempt, correctiveContext };
  }

  /**
   * Governed recovery for a historical WF2 attempt whose candidate was fully
   * written before a post-write integration failure. This never dispatches
   * WF2, creates a PR, rewrites an attempt, or increments attemptCount.
   */
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
