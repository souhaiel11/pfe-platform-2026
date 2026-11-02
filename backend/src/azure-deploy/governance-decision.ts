// Modèle de décision de gouvernance pour le déploiement.
import {
  ArtifactProvenanceResolutionResult,
  BuildIdentityResolutionResult,
  EnvironmentResolutionResult,
  GovernanceDecisionResult,
  GovernanceRiskSignals,
} from './deployment-identity.types';

const OK_QUALITY_GATES_FOR_GOVERNANCE = ['OK', 'PASSED'];
const BLOCKING_QUALITY_GATES_FOR_GOVERNANCE = ['ERROR', 'FAILED'];

/** Classe une tentative de déploiement en TECHNICALLY_IMPOSSIBLE (identité non résolue. */
export function evaluateGovernanceDecision(input: {
  buildIdentity: BuildIdentityResolutionResult;
  artifactProvenance: ArtifactProvenanceResolutionResult | null;
  environment: EnvironmentResolutionResult;
  risk: GovernanceRiskSignals;
}): GovernanceDecisionResult {
  const technicallyImpossibleReasons: string[] = [];
  const criticalRiskReasons: string[] = [];
  const conditionalReasons: string[] = [];

  if (!input.buildIdentity.ok) {
    technicallyImpossibleReasons.push(`Identité de build non résolue (${input.buildIdentity.failureCode})`);
  }
  if (!input.environment.ok) {
    technicallyImpossibleReasons.push(`Identité d'environnement non résolue (${input.environment.failureCode})`);
  }
  if (input.artifactProvenance && !input.artifactProvenance.ok) {
    technicallyImpossibleReasons.push(`Provenance de l'artefact non résolue (${input.artifactProvenance.failureCode})`);
  }

  if (technicallyImpossibleReasons.length > 0) {
    return {
      class: 'TECHNICALLY_IMPOSSIBLE',
      technicallyImpossibleReasons: [...new Set(technicallyImpossibleReasons)],
      criticalRiskReasons: [], conditionalReasons: [],
      buildIdentity: input.buildIdentity, artifactProvenance: input.artifactProvenance, environment: input.environment,
    };
  }

  const r = input.risk;
  switch (r.securityValidationApplicability) {
    case 'APPLICABLE': break;
    case 'MISSING': criticalRiskReasons.push('Validation de sécurité WF3 absente'); break;
    case 'NOT_APPLICABLE': criticalRiskReasons.push('Validation de sécurité WF3 existante mais non applicable à cet artefact exact (candidate fix-PR distincte)'); break;
    case 'FAILED': criticalRiskReasons.push('Validation de sécurité WF3 applicable à cet artefact mais en échec'); break;
    case 'AMBIGUOUS': criticalRiskReasons.push('Validation de sécurité WF3 présente mais son applicabilité est indéterminée'); break;
  }
  if (r.testsStatus === 'FAILED') criticalRiskReasons.push('Tests applicatifs en échec');
  if (r.testsStatus === 'NOT_RUN' || r.testsStatus === null) criticalRiskReasons.push('Tests applicatifs non exécutés');
  if (r.sonarQualityGate != null && BLOCKING_QUALITY_GATES_FOR_GOVERNANCE.includes(r.sonarQualityGate)) {
    criticalRiskReasons.push(`Quality Gate SonarQube en échec (${r.sonarQualityGate})`);
  } else if (r.sonarQualityGate == null || !OK_QUALITY_GATES_FOR_GOVERNANCE.includes(r.sonarQualityGate)) {
    criticalRiskReasons.push(`Quality Gate SonarQube indéterminé (${r.sonarQualityGate ?? 'valeur indisponible'})`);
  }
  if (r.trivyCritical > 0) criticalRiskReasons.push(`${r.trivyCritical} CVE critique(s) Trivy`);
  if (r.owaspCritical > 0) criticalRiskReasons.push(`${r.owaspCritical} CVE critique(s) OWASP Dependency-Check`);
  if (r.judgeDecision === 'BLOCK') criticalRiskReasons.push('Décision de gouvernance : BLOCK');
  if (r.unresolvedBlockingCount > 0) criticalRiskReasons.push(`${r.unresolvedBlockingCount} problème(s) bloquant(s) non résolu(s)`);
  for (const stage of r.requiredStages) {
    if (stage.blocking) criticalRiskReasons.push(`Étape requise bloquante : ${stage.stage} (${stage.status})`);
  }

  for (const stage of r.requiredStages) {
    if (stage.status === 'WARNING' && !stage.blocking) {
      conditionalReasons.push(`Étape en avertissement, non bloquante : ${stage.stage}`);
    }
  }

  if (criticalRiskReasons.length > 0) {
    return {
      class: 'CRITICAL_RISK',
      technicallyImpossibleReasons: [], criticalRiskReasons: [...new Set(criticalRiskReasons)], conditionalReasons: [...new Set(conditionalReasons)],
      buildIdentity: input.buildIdentity, artifactProvenance: input.artifactProvenance, environment: input.environment,
    };
  }

  if (conditionalReasons.length > 0) {
    return {
      class: 'CONDITIONAL',
      technicallyImpossibleReasons: [], criticalRiskReasons: [], conditionalReasons: [...new Set(conditionalReasons)],
      buildIdentity: input.buildIdentity, artifactProvenance: input.artifactProvenance, environment: input.environment,
    };
  }

  return {
    class: 'READY',
    technicallyImpossibleReasons: [], criticalRiskReasons: [], conditionalReasons: [],
    buildIdentity: input.buildIdentity, artifactProvenance: input.artifactProvenance, environment: input.environment,
  };
}
