export type StageStatus = 'PASSED' | 'FAILED' | 'WARNING' | 'RUNNING' | 'NOT_RUN' | 'NOT_REACHED';

export interface GovernedStage {
  stage: string;
  status: StageStatus;
  blocking?: boolean;
  required?: boolean;
  message?: string;
  source?: string;
  findingCount?: number;
}

const ORDER = ['build', 'tests', 'sonar', 'security', 'trivy', 'owasp', 'zap', 'container', 'deploy'];
const BAD_REQUIRED = new Set<StageStatus>(['FAILED', 'RUNNING', 'NOT_RUN', 'NOT_REACHED']);

export function prioritizeStages(stages: GovernedStage[]) {
  const ranked = stages.map((s, index) => ({ ...s, rank: ORDER.indexOf(s.stage.toLowerCase()) < 0 ? ORDER.length + index : ORDER.indexOf(s.stage.toLowerCase()) }));
  const blockers = ranked.filter(s => s.blocking || (s.required !== false && BAD_REQUIRED.has(s.status))).sort((a, b) => a.rank - b.rank);
  const warnings = ranked.filter(s => s.status === 'WARNING' && !s.blocking).sort((a, b) => a.rank - b.rank);
  const first = blockers[0];
  return {
    blockers,
    warnings,
    priority: first?.rank ?? null,
    nextAction: first ? `Resolve ${first.stage}: ${first.message || first.status}` : null,
  };
}

export interface ReadinessInput {
  currentBuild: number | null;
  validatedBuild: number | null;
  validationPassed: boolean;
  correlationVerified: boolean;
  sonarRequired: boolean;
  sonarCorrelationVerified: boolean;
  sonarStatus: string | null;
  unresolvedBlockingCount: number;
  fixRequestStatus?: string | null;
  stages: GovernedStage[];
}

export function evaluateReadiness(input: ReadinessInput) {
  const blockingReasons: string[] = [];
  const priority = prioritizeStages(input.stages);
  if (!input.currentBuild || input.validatedBuild !== input.currentBuild) blockingReasons.push('Validation does not match the current build');
  if (!input.validationPassed) blockingReasons.push('Post-fix validation has not passed');
  if (!input.correlationVerified) blockingReasons.push('Project/build/incident/PR correlation is unverified');
  if (input.sonarRequired && !input.sonarCorrelationVerified) blockingReasons.push('Sonar analysisId correlation is unverified');
  if (input.sonarRequired && input.sonarStatus !== 'OK') blockingReasons.push(`Required Sonar quality gate is ${input.sonarStatus || 'unavailable'}`);
  if (input.unresolvedBlockingCount > 0) blockingReasons.push(`${input.unresolvedBlockingCount} unresolved blocking finding(s)`);
  if (['APPROVAL_REQUESTED', 'FIX_STARTING', 'PR_CREATED'].includes(input.fixRequestStatus || '')) blockingReasons.push(`Fix request is ${input.fixRequestStatus}`);
  for (const stage of priority.blockers) blockingReasons.push(`${stage.stage}=${stage.status}`);
  return {
    status: blockingReasons.length ? 'NOT_READY' as const : 'READY' as const,
    ready: blockingReasons.length === 0,
    blockingReasons: [...new Set(blockingReasons)],
    warnings: priority.warnings.map(w => `${w.stage}: ${w.message || w.status}`),
    currentBuild: input.currentBuild,
    validatedBuild: input.validatedBuild,
    unresolvedBlockingCount: input.unresolvedBlockingCount,
    requiredStages: input.stages,
    correlationVerified: input.correlationVerified && (!input.sonarRequired || input.sonarCorrelationVerified),
    recommendedNextAction: priority.nextAction,
  };
}

export function buildConvergenceCycles(incidents: any[]) {
  return [...incidents].sort((a, b) => Number(a.buildNumber || 0) - Number(b.buildNumber || 0)).map((incident, index) => {
    const metadata = incident.metadata || {};
    const findings = Object.values(metadata.enrichedData?.stages || {}).flatMap((s: any) => Array.isArray(s.findings) ? s.findings : []);
    const validation = metadata.validation || null;
    const prNumber = Number(validation?.prNumber ?? metadata.fixRequest?.prNumber ?? String(incident.prUrl || '').match(/\/pull\/(\d+)/)?.[1]) || null;
    return {
      cycle: index + 1,
      buildNumber: Number(incident.buildNumber) || null,
      status: incident.status,
      incidentIds: [incident.id],
      findingCount: findings.length,
      blockingCount: findings.filter((f: any) => f?.blocking === true && f?.resolved !== true).length,
      fixRequest: metadata.fixRequest || null,
      prUrl: incident.prUrl || null,
      prNumber,
      correlationVerified: validation?.correlationVerified === true,
      fixRequestId: metadata.fixRequest?.requestId || validation?.fixRequestId || null,
      validationResult: validation?.validationStatus || null,
      validationBuildNumber: Number(validation?.buildNumber) || null,
      startedAt: incident.createdAt || null,
      completedAt: validation?.validatedAt || incident.resolvedAt || null,
    };
  });
}
