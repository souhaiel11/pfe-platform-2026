// Gardien « prêt à déployer » — le seul endroit qui décide si un projet peut être déployé.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportType } from '../reports/report.entity';
import { Project } from '../projects/project.entity';
import { normalizeReport } from '../common/report-normalizer';
import { Incident } from '../incidents/incident.entity';
import { evaluateReadiness, GovernedStage } from '../common/governance';
import {
  buildDeploymentIdentity,
  deriveDeploymentEnvironmentIdentity,
  evaluateArtifactIdentity,
  resolveValidatedDeploymentCommit,
} from './deployment-identity';
import { extractSecurityValidationEvidence, resolveBuildIdentity as resolveBuildIdentityCore } from './build-identity';
import { AcrDigestLookup, ArtifactResolutionResult, BuildIdentityResolutionResult, CommitResolutionResult, DeploymentIdentity, EnvironmentResolutionResult, SecurityValidationEvidence } from './deployment-identity.types';

/** Verdict complet de disponibilité au déploiement pour un projet, incluant la Strong Deployment Identity à titre informatif. */
export interface DeployReadiness {
  ready: boolean;
  reasons: string[];
  status?: 'READY' | 'NOT_READY';
  blockingReasons?: string[];
  warnings?: string[];
  currentBuild?: number | null;
  validatedBuild?: number | null;
  unresolvedBlockingCount?: number;
  requiredStages?: GovernedStage[];
  correlationVerified?: boolean;
  reportId?: string;
  reportCreatedAt?: Date;
  deploymentConfigured?: boolean;
  deploymentTarget?: Record<string, string | undefined> | null;
  identityResolved?: boolean;
  identityReasons?: string[];
  deploymentIdentity?: DeploymentIdentity | null;
}

/** Télémétrie de publication qu'un build a rapportée sur sa propre image — jamais une affirmation sur le code source. */
export interface BuildPublicationEvidence {
  incidentId: string | null;
  buildNumber: number | null;
  reportedPushStatus: string | null;
  reportedImageTag: string | null;
  reportedBuildStatus: string | null;
}

/** Résultat complet de résolution d'identité de déploiement (commit, artefact, environnement). */
export interface DeploymentIdentityResolution {
  identityResolved: boolean;
  identityReasons: string[];
  deploymentIdentity: DeploymentIdentity | null;
  commit: CommitResolutionResult;
  artifact: ArtifactResolutionResult;
  environment: EnvironmentResolutionResult;
}

const OK_QUALITY_GATES = ['OK', 'PASSED'];
const BLOCKING_QUALITY_GATES = ['ERROR', 'FAILED'];

@Injectable()
export class AzureDeployReadinessService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(Incident) private readonly incidentRepo: Repository<Incident>,
  ) {}

  /** Le verdict "prêt à déployer" complet pour un projet. */
  async isReadyToDeploy(projectId: string): Promise<DeployReadiness> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return { ready: false, status: 'NOT_READY', reasons: ['Projet introuvable'], blockingReasons: ['Projet introuvable'], deploymentConfigured: false };
    const deploymentConfigured = !!project.azureConfig;
    const deploymentTarget = project.azureConfig ? {
      provider: project.azureConfig.provider,
      resourceGroup: project.azureConfig.resourceGroup,
      targetName: project.azureConfig.targetName,
      registry: project.azureConfig.registry,
      imageRepository: project.azureConfig.imageRepository,
      region: project.azureConfig.region,
    } : null;
    const report = await this.reportRepo.findOne({
      where: { projectId, type: ReportType.COMBINED },
      order: { createdAt: 'DESC' },
    });

    if (!report) {
      return {
        ready: false,
        reasons: ['Aucun report combined pour ce projet — impossible de vérifier son état, refus par défaut.'], deploymentConfigured, deploymentTarget,
      };
    }

    if (!report.rawData || Object.keys(report.rawData).length === 0) {
      return {
        ready: false,
        reasons: ['Le dernier report combined a un rawData vide — impossible de vérifier son état, refus par défaut.'],
        reportId: report.id,
        reportCreatedAt: report.createdAt, deploymentConfigured, deploymentTarget,
      };
    }

    const normalized = normalizeReport(report.rawData);
    if (normalized._sourceFormat === 'empty') {
      return {
        ready: false,
        reasons: [
          "Le dernier report combined ne contient aucune donnée d'analyse exploitable (format non reconnu) — refus par défaut.",
        ],
        reportId: report.id,
        reportCreatedAt: report.createdAt, deploymentConfigured, deploymentTarget,
      };
    }

    const incident = await this.incidentRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });
    if (!incident) return { ready: false, status: 'NOT_READY', reasons: ['Aucun incident corrélé n’est disponible'], blockingReasons: ['Aucun incident corrélé n’est disponible'] };
    const metadata: any = incident.metadata || {};
    const validation: any = metadata.validation || {};
    const raw: any = report.rawData || {};
    const currentBuild = Number(raw?.enrichedData?.build?.number ?? raw?.build?.number ?? raw?.buildNumber ?? incident.buildNumber) || null;
    const stages: GovernedStage[] = Object.values(normalized.stages || {}).map((s: any) => ({
      stage: s.stage || s.source || 'unknown', status: s.status, blocking: !!s.blocking,
      required: s.required !== false, message: s.message, source: s.source,
      findingCount: Array.isArray(s.findings) ? s.findings.length : Number(s.findingCount || 0),
    }));
    const stageFindings = Object.values(normalized.stages || {}).flatMap((s: any) => Array.isArray(s.findings) ? s.findings : []);
    const unresolvedBlockingCount = stageFindings.filter((f: any) => f?.blocking === true && f?.resolved !== true).length;
    const gate = normalized.sonar.quality_gate;
    const result = evaluateReadiness({
      currentBuild,
      validatedBuild: Number(validation.buildNumber) || null,
      validationPassed: validation.validationStatus === 'VALIDATED' && validation.passed === true,
      correlationVerified: validation.correlationVerified === true && validation.projectId === projectId && validation.incidentId === incident.id,
      sonarRequired: true,
      sonarCorrelationVerified: validation.sonarCorrelationVerified === true,
      sonarStatus: validation.sonarStatus || gate || null,
      unresolvedBlockingCount,
      fixRequestStatus: metadata.fixRequest?.status,
      stages,
    });

    const reasons: string[] = [...result.blockingReasons];
    if (!deploymentConfigured) reasons.push('Le déploiement Azure n’est pas configuré pour ce projet');

    if (report.judgeDecision === 'BLOCK') {
      reasons.push('La décision de gouvernance bloque explicitement ce build');
    }

    const trivyCritical = normalized.trivy.critical || 0;
    const owaspCritical = normalized.owasp.critical || 0;
    if (trivyCritical > 0) reasons.push(`${trivyCritical} ${trivyCritical === 1 ? 'CVE critique' : 'CVE critiques'} Trivy`);
    if (owaspCritical > 0) reasons.push(`${owaspCritical} ${owaspCritical === 1 ? 'CVE critique' : 'CVE critiques'} OWASP Dependency-Check`);

    if (BLOCKING_QUALITY_GATES.includes(gate)) {
      reasons.push(`Le Quality Gate SonarQube est en échec (${gate})`);
    } else if (!OK_QUALITY_GATES.includes(gate)) {
      reasons.push(`Le Quality Gate SonarQube est indéterminé (${gate ?? 'valeur indisponible'}) — refus par défaut`);
    }

    const validationForIdentity = metadata.validation || null;
    const commit = resolveValidatedDeploymentCommit({
      reportBuildNumber: currentBuild,
      reportCommitSha: raw?.enrichedData?.build?.commitSha ?? raw?.build?.commitSha ?? null,
      validation: validationForIdentity,
    });
    const environment = deriveDeploymentEnvironmentIdentity(project.azureConfig as any);
    const artifact = evaluateArtifactIdentity({
      targetRegistry: project.azureConfig?.registry || null,
      targetRepository: project.azureConfig?.imageRepository || null,
      requestedTag: null,
      lookup: null,
    });
    const identityReasons: string[] = [];
    if (!commit.ok) identityReasons.push(`Identité de commit non résolue (${commit.failureCode})`);
    if (!environment.ok) identityReasons.push(`Identité d'environnement non résolue (${environment.failureCode})`);
    if (!artifact.ok) identityReasons.push(`Identité d'artefact non résolue (${artifact.failureCode})`);
    const deploymentIdentity = buildDeploymentIdentity({
      projectId,
      commit,
      artifact: { ...artifact, registry: project.azureConfig?.registry || '', repository: project.azureConfig?.imageRepository || '', tag: '' },
      environment,
    });

    return {
      ...result,
      ready: reasons.length === 0,
      status: reasons.length === 0 ? 'READY' : 'NOT_READY',
      reasons: [...new Set(reasons)],
      blockingReasons: [...new Set(reasons)],
      reportId: report.id,
      reportCreatedAt: report.createdAt,
      deploymentConfigured,
      deploymentTarget,
      identityResolved: commit.ok && artifact.ok && environment.ok,
      identityReasons,
      deploymentIdentity,
    };
  }

  /** Résolution complète de l'identité de déploiement AVEC une vraie recherche de digest ACR (via le résolveur injecté. */
  async resolveDeploymentIdentity(
    projectId: string,
    requestedTag: string,
    artifactLookup?: (params: { registry: string; repository: string; tag: string }) => Promise<AcrDigestLookup>,
  ): Promise<DeploymentIdentityResolution> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const emptyCommit: CommitResolutionResult = { ok: false, buildNumber: null, commitSha: null, evidence: {}, failureCode: 'DEPLOY_COMMIT_MISSING' };
    const emptyEnvironment: EnvironmentResolutionResult = { ok: false, environmentIdentity: null, failureCode: 'DEPLOY_ENVIRONMENT_UNRESOLVED' };
    const emptyArtifact: ArtifactResolutionResult = { ok: false, imageReference: null, artifactDigest: null, evidence: {}, failureCode: 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE' };
    if (!project) {
      return { identityResolved: false, identityReasons: ['Projet introuvable'], deploymentIdentity: null, commit: emptyCommit, artifact: emptyArtifact, environment: emptyEnvironment };
    }

    const report = await this.reportRepo.findOne({ where: { projectId, type: ReportType.COMBINED }, order: { createdAt: 'DESC' } });
    const incident = await this.incidentRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });
    const raw: any = report?.rawData || {};
    const reportBuildNumber = Number(raw?.enrichedData?.build?.number ?? raw?.build?.number ?? raw?.buildNumber) || null;
    const reportCommitSha = raw?.enrichedData?.build?.commitSha ?? raw?.build?.commitSha ?? null;
    const validation = (incident?.metadata as any)?.validation || null;

    const commit = resolveValidatedDeploymentCommit({ reportBuildNumber, reportCommitSha, validation });
    const environment = deriveDeploymentEnvironmentIdentity(project.azureConfig as any);

    let artifact: ArtifactResolutionResult = emptyArtifact;
    const registry = project.azureConfig?.registry || null;
    const repository = project.azureConfig?.imageRepository || null;
    if (artifactLookup && registry && repository && requestedTag) {
      let lookup: AcrDigestLookup | null = null;
      try {
        lookup = await artifactLookup({ registry, repository, tag: requestedTag });
      } catch {
        lookup = null;
      }
      artifact = evaluateArtifactIdentity({ targetRegistry: registry, targetRepository: repository, requestedTag, lookup });
    } else {
      artifact = evaluateArtifactIdentity({ targetRegistry: registry, targetRepository: repository, requestedTag: requestedTag || null, lookup: null });
    }

    const identityReasons: string[] = [];
    if (!commit.ok) identityReasons.push(`Identité de commit non résolue (${commit.failureCode})`);
    if (!environment.ok) identityReasons.push(`Identité d'environnement non résolue (${environment.failureCode})`);
    if (!artifact.ok) identityReasons.push(`Identité d'artefact non résolue (${artifact.failureCode})`);

    const deploymentIdentity = buildDeploymentIdentity({
      projectId,
      commit,
      artifact: { ...artifact, registry: registry || '', repository: repository || '', tag: requestedTag || '' },
      environment,
    });

    return { identityResolved: commit.ok && artifact.ok && environment.ok, identityReasons, deploymentIdentity, commit, artifact, environment };
  }

  /** Résout l'identité de build à partir des SEULES preuves propres au build (sourceCommitSha, id/numéro d'incident, dépôt GitHub du projet). */
  async resolveBuildIdentity(projectId: string, mainBuildNumber?: number): Promise<{ buildIdentity: BuildIdentityResolutionResult; validation: SecurityValidationEvidence }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const incident = mainBuildNumber
      ? await this.incidentRepo.findOne({ where: { projectId, buildNumber: mainBuildNumber }, order: { createdAt: 'DESC' } })
      : await this.incidentRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });

    const metadata: any = incident?.metadata || {};
    const validation = extractSecurityValidationEvidence(metadata.validation);

    const result = resolveBuildIdentityCore({
      projectId,
      incidentId: incident?.id ?? null,
      mainBuildNumber: incident?.buildNumber ?? null,
      sourceCommitSha: metadata.sourceCommitSha ?? null,
      repository: project?.githubRepo ?? null,
      branchOrRef: metadata.branch ?? null,
    });
    const buildIdentity: BuildIdentityResolutionResult = { ...result, securityValidationMissing: !validation.present };
    return { buildIdentity, validation };
  }

  /** Lit la télémétrie de PUBLICATION que le pipeline a lui-même rapportée pour un build (incident.metadata.enrichedData.docker). */
  async resolveBuildPublicationEvidence(projectId: string, mainBuildNumber?: number): Promise<BuildPublicationEvidence> {
    const incident = mainBuildNumber
      ? await this.incidentRepo.findOne({ where: { projectId, buildNumber: mainBuildNumber }, order: { createdAt: 'DESC' } })
      : await this.incidentRepo.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });
    const docker: any = (incident?.metadata as any)?.enrichedData?.docker || null;
    const rawStatus = docker?.push_status;
    return {
      incidentId: incident?.id ?? null,
      buildNumber: incident?.buildNumber ?? null,
      reportedPushStatus: typeof rawStatus === 'string' && rawStatus.trim() ? rawStatus.trim().toUpperCase() : null,
      reportedImageTag: typeof docker?.image_tag === 'string' && docker.image_tag.trim() ? docker.image_tag.trim() : null,
      reportedBuildStatus: typeof docker?.build_status === 'string' && docker.build_status.trim() ? docker.build_status.trim().toUpperCase() : null,
    };
  }

  /** Compatibilité lecture seule pour les anciens consommateurs qui identifient un projet par son nom plutôt que par son id — délègue entièrement à isReadyToDeploy(). */
  async isReadyToDeployByProjectName(name: string): Promise<DeployReadiness> {
    const project = await this.projectRepo.findOne({ where: { name } });
    if (!project) {
      return {
        ready: false,
        reasons: [`Projet '${name}' introuvable en base — impossible de vérifier son état, refus par défaut.`],
      };
    }
    return this.isReadyToDeploy(project.id);
  }
}
