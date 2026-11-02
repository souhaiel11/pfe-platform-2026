// Cycle de vie gouverné d'une autorisation de déploiement.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Report, ReportType } from '../reports/report.entity';
import { normalizeReport } from '../common/report-normalizer';
import { AzureDeployReadinessService } from './azure-deploy-readiness.service';
import { DeploymentArtifactService, AcrDigestResolver, OciRevisionLookup } from './deployment-artifact.service';
import { DeploymentAuthorization, DeploymentAuthorizationMode } from './deployment-authorization.entity';
import { DeploymentAttempt } from './deployment-attempt.entity';
import { deriveDeploymentEnvironmentIdentity, computeDeploymentIdentityHash } from './deployment-identity';
import { evaluateSecurityValidationApplicability } from './security-validation-applicability';
import { evaluateGovernanceDecision } from './governance-decision';
import {
  evaluateAuthorizationRequest, AuthorizationRequestInput, AuthorizationMode,
  REQUIRED_MODE_FOR_DECISION, ROLES_ALLOWED_FOR_MODE,
  REQUIRED_CRITICAL_ACKNOWLEDGEMENTS, REQUIRED_CONDITIONAL_ACKNOWLEDGEMENTS,
} from './deployment-authorization-policy';
import { GovernanceClass, GovernanceDecisionResult, GovernanceRiskSignals } from './deployment-identity.types';
import { ArtifactPublicationSource } from './publication-provenance';

export const AUTHORIZATION_TTL_MINUTES = 15;

/** Aperçu en lecture seule de la gouvernance d'un build, destiné au frontend — jamais une forme que l'appelant pourrait soumettre en retour comme une vérité. */
export interface GovernancePreview {
  projectId: string;
  incidentId: string | null;
  mainBuildNumber: number | null;
  decision: GovernanceClass;
  buildIdentity: { resolved: boolean; commitSha: string | null };
  artifact: { provenanceVerified: boolean; artifactIdentityProven: boolean; publicationSource: ArtifactPublicationSource; digest: string | null; registry: string | null; repository: string | null; tag: string | null };
  environment: { resolved: boolean; identityHash: string | null; targetName: string | null; region: string | null };
  securityValidation: { applicability: string; status: string };
  failedControls: string[];
  warnings: string[];
  authorizationPolicy: {
    requiredMode: AuthorizationMode | null;
    rolesAllowed: string[];
    adminRequired: boolean;
    reasonRequired: boolean;
    acknowledgementRequirements: readonly string[];
    confirmationPhraseRequired: boolean;
  };
}

/** Entrée de création d'une autorisation : intention humaine (mode, motif, accusés) et identifiant du demandeur. */
export interface CreateAuthorizationInput {
  projectId: string;
  mainBuildNumber?: number;
  tag?: string;
  mode: DeploymentAuthorizationMode | null | undefined;
  reason?: string | null;
  acknowledgements?: Record<string, boolean> | null;
  confirmationPhrase?: string | null;
  requestedByUserId: string;
  requestedByRole: string;
}

/** Résultat de la création d'une autorisation. */
export interface CreateAuthorizationResult {
  ok: boolean;
  authorization?: DeploymentAuthorization;
  governanceClass?: GovernanceClass;
  failureCode?: string | null;
  reason?: string | null;
}

/** Entrée de la consommation d'une autorisation : identifiant d'autorisation, requestId d'idempotence, acteur. */
export interface ReserveAndConsumeInput {
  authorizationId: string;
  requestId: string;
  actorUserId: string;
  actorRole: string;
}

/** Résultat de la consommation d'une autorisation, incluant le cas de rejeu idempotent (duplicate). */
export interface ReserveAndConsumeResult {
  ok: boolean;
  duplicate?: boolean;
  existingState?: Record<string, any> | null;
  authorization?: DeploymentAuthorization;
  attempt?: DeploymentAttempt;
  project?: Project;
  failureCode?: string | null;
  reason?: string | null;
}

interface GovernanceSnapshot {
  decision: GovernanceDecisionResult;
  securityValidationApplicability: string;
  commitSha: string | null;
  artifactDigest: string | null;
  artifactTag: string | null;
  registry: string | null;
  repository: string | null;
  environmentIdentityHash: string | null;
  incidentId: string | null;
  mainBuildNumber: number | null;
  warnings: string[];
}

@Injectable()
export class DeploymentAuthorizationService {
  private readonly logger = new Logger(DeploymentAuthorizationService.name);

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(DeploymentAuthorization) private readonly authRepo: Repository<DeploymentAuthorization>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(DeploymentAttempt) private readonly attemptRepo: Repository<DeploymentAttempt>,
    private readonly readiness: AzureDeployReadinessService,
    private readonly artifacts: DeploymentArtifactService,
  ) {}

  /** Résout gouvernance Snapshot. */
  private async resolveGovernanceSnapshot(
    projectId: string,
    mainBuildNumber: number | undefined,
    tag: string | undefined,
    redigest?: AcrDigestResolver,
    ociLookup?: OciRevisionLookup,
  ): Promise<GovernanceSnapshot> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const { buildIdentity, validation } = await this.readiness.resolveBuildIdentity(projectId, mainBuildNumber);
    const environment = deriveDeploymentEnvironmentIdentity(project?.azureConfig as any);
    const artifactProvenance = await this.artifacts.resolveProvenDeploymentArtifact(projectId, redigest, ociLookup, mainBuildNumber ?? buildIdentity.buildIdentity?.mainBuildNumber);

    const applicability = buildIdentity.ok && buildIdentity.buildIdentity
      ? evaluateSecurityValidationApplicability(buildIdentity.buildIdentity.commitSha, validation).applicability
      : 'MISSING';

    const report = await this.reportRepo.findOne({ where: { projectId, type: ReportType.COMBINED }, order: { createdAt: 'DESC' } });
    let risk: GovernanceRiskSignals;
    let warnings: string[] = [];
    if (!report || !report.rawData) {
      risk = { securityValidationApplicability: applicability, testsStatus: null, sonarQualityGate: null, trivyCritical: 0, owaspCritical: 0, judgeDecision: null, unresolvedBlockingCount: 0, requiredStages: [] };
    } else {
      const normalized = normalizeReport(report.rawData);
      const stages = Object.values(normalized.stages || {}).map((s: any) => ({
        stage: s.stage || s.source || 'unknown', status: s.status, blocking: !!s.blocking, required: s.required !== false,
      }));
      const stageFindings = Object.values(normalized.stages || {}).flatMap((s: any) => Array.isArray(s.findings) ? s.findings : []);
      const unresolvedBlockingCount = stageFindings.filter((f: any) => f?.blocking === true && f?.resolved !== true).length;
      const testsStage: any = (normalized.stages || {})['tests'];
      risk = {
        securityValidationApplicability: applicability,
        testsStatus: testsStage?.status ?? null,
        sonarQualityGate: normalized.sonar.quality_gate,
        trivyCritical: normalized.trivy.critical || 0,
        owaspCritical: normalized.owasp.critical || 0,
        judgeDecision: report.judgeDecision || null,
        unresolvedBlockingCount,
        requiredStages: stages,
      };
      warnings = stages.filter((s: any) => s.status === 'WARNING' && !s.blocking).map((s: any) => `${s.stage}: ${s.status}`);
    }

    const decision = evaluateGovernanceDecision({ buildIdentity, artifactProvenance, environment, risk });

    return {
      decision,
      securityValidationApplicability: applicability,
      commitSha: buildIdentity.buildIdentity?.commitSha ?? null,
      artifactDigest: artifactProvenance.digest ?? null,
      artifactTag: artifactProvenance.tag ?? null,
      registry: artifactProvenance.registry ?? environment.environmentIdentity?.registry ?? null,
      repository: artifactProvenance.repository ?? null,
      environmentIdentityHash: environment.environmentIdentity?.environmentIdentityHash ?? null,
      incidentId: buildIdentity.buildIdentity?.incidentId ?? null,
      mainBuildNumber: buildIdentity.buildIdentity?.mainBuildNumber ?? mainBuildNumber ?? null,
      warnings,
    };
  }

  /** Concatène les trois listes de raisons de blocage de la décision en une seule liste plate de contrôles échoués. */
  private collectFailedControls(decision: GovernanceDecisionResult): string[] {
    return [...decision.technicallyImpossibleReasons, ...decision.criticalRiskReasons, ...decision.conditionalReasons];
  }

  /** Dérive, pour une classe de gouvernance donnée, le mode d'autorisation requis et les exigences (rôle, motif, accusés de réception, phrase de confirmation) qui en découlent. */
  private authorizationPolicyFor(decision: GovernanceClass): GovernancePreview['authorizationPolicy'] {
    const requiredMode = REQUIRED_MODE_FOR_DECISION[decision];
    return {
      requiredMode,
      rolesAllowed: requiredMode ? ROLES_ALLOWED_FOR_MODE[requiredMode] : [],
      adminRequired: requiredMode === 'CRITICAL_OVERRIDE',
      reasonRequired: requiredMode === 'CRITICAL_OVERRIDE' || requiredMode === 'CONDITIONAL_EXCEPTION',
      acknowledgementRequirements: requiredMode === 'CRITICAL_OVERRIDE'
        ? REQUIRED_CRITICAL_ACKNOWLEDGEMENTS
        : requiredMode === 'CONDITIONAL_EXCEPTION' ? REQUIRED_CONDITIONAL_ACKNOWLEDGEMENTS : [],
      confirmationPhraseRequired: requiredMode === 'CRITICAL_OVERRIDE',
    };
  }

  /** Aperçu en LECTURE SEULE de la gouvernance pour un build. */
  async getGovernancePreview(projectId: string, mainBuildNumber?: number, tag?: string, redigest?: AcrDigestResolver, ociLookup?: OciRevisionLookup): Promise<GovernancePreview> {
    const snapshot = await this.resolveGovernanceSnapshot(projectId, mainBuildNumber, tag, redigest, ociLookup);
    const { decision } = snapshot;
    return {
      projectId,
      incidentId: snapshot.incidentId,
      mainBuildNumber: snapshot.mainBuildNumber,
      decision: decision.class,
      buildIdentity: { resolved: decision.buildIdentity.ok, commitSha: decision.buildIdentity.buildIdentity?.commitSha ?? null },
      artifact: {
        provenanceVerified: !!decision.artifactProvenance?.ok,
        artifactIdentityProven: decision.artifactProvenance?.provenanceEvidence?.artifactIdentityProven === true,
        publicationSource: (decision.artifactProvenance?.provenanceEvidence?.publicationSource as ArtifactPublicationSource) ?? 'UNKNOWN',
        digest: snapshot.artifactDigest, registry: snapshot.registry, repository: snapshot.repository, tag: snapshot.artifactTag,
      },
      environment: {
        resolved: decision.environment.ok, identityHash: snapshot.environmentIdentityHash,
        targetName: decision.environment.environmentIdentity?.targetName ?? null,
        region: decision.environment.environmentIdentity?.region ?? null,
      },
      securityValidation: { applicability: snapshot.securityValidationApplicability, status: snapshot.securityValidationApplicability },
      failedControls: this.collectFailedControls(decision),
      warnings: snapshot.warnings,
      authorizationPolicy: this.authorizationPolicyFor(decision.class),
    };
  }

  /** Crée une DeploymentAuthorization immuable. */
  async createAuthorization(input: CreateAuthorizationInput, redigest?: AcrDigestResolver, ociLookup?: OciRevisionLookup): Promise<CreateAuthorizationResult> {
    const snapshot = await this.resolveGovernanceSnapshot(input.projectId, input.mainBuildNumber, input.tag, redigest, ociLookup);
    const { decision } = snapshot;

    const policyInput: AuthorizationRequestInput = {
      mode: input.mode, reason: input.reason, acknowledgements: input.acknowledgements,
      confirmationPhrase: input.confirmationPhrase, requestedByRole: input.requestedByRole,
    };
    const evaluation = evaluateAuthorizationRequest(decision.class, policyInput);
    if (!evaluation.ok) {
      this.logger.warn(`Authorization request denied for project ${input.projectId}: ${evaluation.failureCode} — ${evaluation.reason}`);
      return { ok: false, governanceClass: decision.class, failureCode: evaluation.failureCode, reason: evaluation.reason };
    }

    if (decision.class === 'TECHNICALLY_IMPOSSIBLE' || !snapshot.commitSha || !snapshot.artifactDigest || !snapshot.registry || !snapshot.repository || !snapshot.environmentIdentityHash) {
      return { ok: false, governanceClass: decision.class, failureCode: 'DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE', reason: 'Identité/provenance/environnement insuffisamment résolus — aucune autorisation exploitable ne peut être créée.' };
    }

    const authorizationIdentityHash = computeDeploymentIdentityHash({
      projectId: input.projectId, commitSha: snapshot.commitSha, artifactDigest: snapshot.artifactDigest,
      environmentIdentity: { environmentIdentityHash: snapshot.environmentIdentityHash },
    });

    const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_MINUTES * 60_000);
    const failedControls = this.collectFailedControls(decision);

    const saved = await this.authRepo.save(this.authRepo.create({
      projectId: input.projectId,
      incidentId: snapshot.incidentId,
      mainBuildNumber: snapshot.mainBuildNumber!,
      commitSha: snapshot.commitSha,
      artifactDigest: snapshot.artifactDigest,
      artifactTag: snapshot.artifactTag,
      registry: snapshot.registry,
      repository: snapshot.repository,
      environmentIdentityHash: snapshot.environmentIdentityHash,
      decisionAtAuthorization: decision.class,
      securityValidationApplicability: snapshot.securityValidationApplicability,
      riskSnapshot: { criticalRiskReasons: decision.criticalRiskReasons, conditionalReasons: decision.conditionalReasons },
      failedControls,
      warnings: snapshot.warnings,
      requestedByUserId: input.requestedByUserId,
      requestedByRole: input.requestedByRole,
      authorizationMode: input.mode!,
      reason: input.reason ?? null,
      acknowledgements: input.acknowledgements ?? null,
      authorizationIdentityHash,
      status: 'CREATED',
      expiresAt,
    }));
    return { ok: true, authorization: saved, governanceClass: decision.class };
  }

  /** Réserve et Consume autorisation. */
  async reserveAndConsumeAuthorization(input: ReserveAndConsumeInput, redigest?: AcrDigestResolver, ociLookup?: OciRevisionLookup): Promise<ReserveAndConsumeResult> {
    return this.authRepo.manager.transaction(async (manager) => {
      const authRepoTx = manager.getRepository(DeploymentAuthorization);
      const locked = await authRepoTx.findOne({ where: { id: input.authorizationId }, lock: { mode: 'pessimistic_write' } });
      if (!locked) return { ok: false, failureCode: 'DEPLOY_AUTHORIZATION_NOT_FOUND', reason: 'Autorisation introuvable.' };
      if (locked.status !== 'CREATED') {
        return { ok: false, failureCode: `DEPLOY_AUTHORIZATION_${locked.status}`, reason: `Autorisation déjà dans l'état ${locked.status} — ne peut être consommée.` };
      }
      if (locked.expiresAt && locked.expiresAt.getTime() < Date.now()) {
        locked.status = 'EXPIRED';
        await authRepoTx.save(locked);
        return { ok: false, failureCode: 'DEPLOY_AUTHORIZATION_EXPIRED', reason: 'Autorisation expirée — une nouvelle autorisation est requise.' };
      }

      const projectRepoTx = manager.getRepository(Project);
      const lockedProject = await projectRepoTx.findOne({ where: { id: locked.projectId }, lock: { mode: 'pessimistic_write' } });
      if (!lockedProject) return { ok: false, failureCode: 'DEPLOY_PROJECT_NOT_FOUND', reason: 'Projet introuvable — autorisation non consommée.' };

      const existing = lockedProject.azureDeploymentState;
      if (existing?.requestId === input.requestId) {
        return { ok: true, duplicate: true, existingState: existing, authorization: locked };
      }
      if (existing?.status === 'DISPATCHING') {
        return { ok: false, failureCode: 'DEPLOY_DEPLOYMENT_IN_PROGRESS', reason: 'Un autre déploiement est déjà en cours pour ce projet.' };
      }

      const fresh = await this.resolveGovernanceSnapshot(locked.projectId, locked.mainBuildNumber, undefined, redigest, ociLookup);
      if (
        fresh.commitSha !== locked.commitSha ||
        fresh.artifactDigest !== locked.artifactDigest ||
        fresh.registry !== locked.registry ||
        fresh.repository !== locked.repository ||
        fresh.environmentIdentityHash !== locked.environmentIdentityHash
      ) {
        const changed = (['commitSha', 'artifactDigest', 'registry', 'repository', 'environmentIdentityHash'] as const)
          .filter(field => (fresh as any)[field] !== (locked as any)[field])
          .map(field => `${field} : « ${(locked as any)[field] ?? '∅'} » → « ${(fresh as any)[field] ?? 'non résolu'} »`);
        return { ok: false, failureCode: 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED', reason: `L’identité a changé depuis l’autorisation (${changed.join(' ; ')}) — nouvelle autorisation requise.` };
      }
      if (fresh.decision.class !== locked.decisionAtAuthorization) {
        return { ok: false, failureCode: 'DEPLOY_AUTHORIZATION_RISK_CHANGED', reason: `État de risque/gouvernance modifié depuis l’autorisation (${locked.decisionAtAuthorization} -> ${fresh.decision.class}) — nouvelle autorisation requise.` };
      }

      lockedProject.azureDeploymentState = { requestId: input.requestId, status: 'DISPATCHING', imageTag: locked.artifactTag, updatedAt: new Date().toISOString() };
      await projectRepoTx.save(lockedProject);

      const attemptRepoTx = manager.getRepository(DeploymentAttempt);
      const attempt = await attemptRepoTx.save(attemptRepoTx.create({
        authorizationId: locked.id, requestId: input.requestId, projectId: locked.projectId, incidentId: locked.incidentId,
        mainBuildNumber: locked.mainBuildNumber, actorUserId: input.actorUserId, actorRole: input.actorRole,
        commitSha: locked.commitSha, artifactDigest: locked.artifactDigest, registry: locked.registry, repository: locked.repository,
        environmentIdentityHash: locked.environmentIdentityHash, governanceDecision: locked.decisionAtAuthorization,
        authorizationMode: locked.authorizationMode, reason: locked.reason, riskSnapshot: locked.riskSnapshot, dispatchStatus: 'DISPATCHING',
      }));

      locked.status = 'CONSUMED';
      locked.consumedAt = new Date();
      await authRepoTx.save(locked);

      return { ok: true, authorization: locked, attempt, project: lockedProject };
    });
  }
}
