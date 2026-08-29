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
const STATUS_FR: Record<string, string> = { PASSED: 'réussi', FAILED: 'en échec', WARNING: 'en avertissement', RUNNING: 'en cours', NOT_RUN: 'non exécuté', NOT_REACHED: 'non atteint' };
const STAGE_FR: Record<string, string> = { build: 'Build', tests: 'Tests', sonar: 'SonarQube', security: 'Sécurité', trivy: 'Trivy', owasp: 'OWASP Dependency-Check', zap: 'ZAP', container: 'Conteneur', docker: 'Docker', deploy: 'Déploiement' };

export function prioritizeStages(stages: GovernedStage[]) {
  const ranked = stages.map((s, index) => ({ ...s, rank: ORDER.indexOf(s.stage.toLowerCase()) < 0 ? ORDER.length + index : ORDER.indexOf(s.stage.toLowerCase()) }));
  const blockers = ranked.filter(s => s.blocking || (s.required !== false && BAD_REQUIRED.has(s.status))).sort((a, b) => a.rank - b.rank);
  const warnings = ranked.filter(s => s.status === 'WARNING' && !s.blocking).sort((a, b) => a.rank - b.rank);
  const first = blockers[0];
  return {
    blockers,
    warnings,
    priority: first?.rank ?? null,
    nextAction: first ? `Corriger l’étape ${STAGE_FR[first.stage.toLowerCase()] || first.stage} : ${first.message || STATUS_FR[first.status] || 'état indisponible'}` : null,
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
  if (!input.currentBuild || input.validatedBuild !== input.currentBuild) blockingReasons.push('La validation ne correspond pas au build courant');
  if (!input.validationPassed) blockingReasons.push('La validation après correction n’est pas réussie');
  if (!input.correlationVerified) blockingReasons.push('La corrélation projet/build/incident/PR n’est pas vérifiée');
  if (input.sonarRequired && !input.sonarCorrelationVerified) blockingReasons.push('La corrélation de l’analyse SonarQube n’est pas vérifiée');
  if (input.sonarRequired && input.sonarStatus !== 'OK') blockingReasons.push('Le Quality Gate SonarQube requis n’est pas validé');
  if (input.unresolvedBlockingCount > 0) blockingReasons.push(`${input.unresolvedBlockingCount} ${input.unresolvedBlockingCount === 1 ? 'problème bloquant non résolu' : 'problèmes bloquants non résolus'}`);
  if (['APPROVAL_REQUESTED', 'FIX_STARTING', 'PR_CREATED'].includes(input.fixRequestStatus || '')) blockingReasons.push('Une demande de correction est en cours');
  for (const stage of priority.blockers) blockingReasons.push(`${STAGE_FR[stage.stage.toLowerCase()] || stage.stage} : ${STATUS_FR[stage.status] || 'état indisponible'}`);
  return {
    status: blockingReasons.length ? 'NOT_READY' as const : 'READY' as const,
    ready: blockingReasons.length === 0,
    blockingReasons: [...new Set(blockingReasons)],
    warnings: priority.warnings.map(w => `${STAGE_FR[w.stage.toLowerCase()] || w.stage} : ${w.message || STATUS_FR[w.status] || 'état indisponible'}`),
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
