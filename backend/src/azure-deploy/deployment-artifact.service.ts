// Service propriétaire du grand livre DeploymentArtifact.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { AzureDeployReadinessService } from './azure-deploy-readiness.service';
import { DeploymentArtifact } from './deployment-artifact.entity';
import { deriveDeploymentEnvironmentIdentity, evaluateProvenDeploymentArtifact } from './deployment-identity';
import { toCommitResolutionResult } from './build-identity';
import {
  ArtifactIdentitySource,
  ArtifactPublicationSource,
  ArtifactPushReceipt,
  PublicationChannel,
  PublicationFailureCode,
  deriveArtifactIdentitySource,
  evaluateArtifactPublication,
} from './publication-provenance';
import { isFullGitSha } from '../candidate-verification/candidate-digest';
import {
  AcrDigestLookup,
  ArtifactProvenanceResolutionResult,
  DeploymentArtifactRecord,
} from './deployment-identity.types';

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;

/** Entrée de l'enregistrement d'un artefact : identité revendiquée du build, du dépôt et du tag. */
export interface RegisterArtifactInput {
  projectId: string;
  buildNumber: number;
  commitSha: string;
  repository: string;
  tag: string;
  digest?: string;
  pushReceipt?: ArtifactPushReceipt;
}

/** Options de l'enregistrement : niveau d'exigence de preuve et canal d'appel (callback CI ou admin manuel). */
export interface RegisterArtifactOptions {
  requireVerifiedProvenance: boolean;
  publicationChannel?: PublicationChannel;
  attestedByUserId?: string | null;
}

export type RegisterArtifactStatus = 'PROVENANCE_VERIFIED' | 'UNVERIFIED_MANUAL_ARTIFACT' | 'REJECTED';

/** Résultat de l'enregistrement, avec les deux verdicts distincts : identité du code source et identité de la publication. */
export interface RegisterArtifactResult {
  status: RegisterArtifactStatus;
  artifactId?: string;
  digest?: string | null;
  failureCode?: string | null;
  reason?: string | null;
  artifactIdentitySource?: ArtifactIdentitySource;
  publicationSource?: ArtifactPublicationSource;
  publicationFailureCode?: PublicationFailureCode | null;
  publicationReason?: string | null;
}

export type OciRevisionLookup = (params: { registry: string; repository: string; digest: string }) => Promise<{ available: boolean; revision?: string | null }>;
export type AcrDigestResolver = (params: { registry: string; repository: string; tag: string }) => Promise<AcrDigestLookup>;

@Injectable()
export class DeploymentArtifactService {
  private readonly logger = new Logger(DeploymentArtifactService.name);

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(DeploymentArtifact) private readonly artifactRepo: Repository<DeploymentArtifact>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly readiness: AzureDeployReadinessService,
  ) {}

  /** Recherche dans le registre un DeploymentArtifact prouvé pour le commit/build que l'identité de build du projet désigne, puis. */
  async resolveProvenDeploymentArtifact(projectId: string, redigest?: AcrDigestResolver, ociLookup?: OciRevisionLookup, mainBuildNumber?: number): Promise<ArtifactProvenanceResolutionResult> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const { buildIdentity } = await this.readiness.resolveBuildIdentity(projectId, mainBuildNumber);
    const commit = toCommitResolutionResult(buildIdentity);
    const environment = deriveDeploymentEnvironmentIdentity(project?.azureConfig as any);
    const targetRegistry = project?.azureConfig?.registry || null;
    const targetRepository = project?.azureConfig?.imageRepository || null;

    let candidate: DeploymentArtifactRecord | null = null;
    if (commit.ok && commit.buildNumber && commit.commitSha) {
      const row = await this.artifactRepo.findOne({
        where: { projectId, buildNumber: commit.buildNumber, commitSha: commit.commitSha.toLowerCase() },
        order: { createdAt: 'DESC' },
      });
      if (row) {
        candidate = {
          projectId: row.projectId, buildNumber: row.buildNumber, commitSha: row.commitSha,
          registry: row.registry, repository: row.repository, tag: row.tag, digest: row.digest,
          source: row.source, provenanceVerified: row.provenanceVerified,
          publicationSource: row.publicationSource ?? null,
        };
      }
    }

    let freshLookup: AcrDigestLookup | null = null;
    if (candidate && redigest) {
      try {
        freshLookup = await redigest({ registry: candidate.registry, repository: candidate.repository, tag: candidate.tag });
      } catch (e: any) {
        this.logger.warn(`TOCTOU re-resolve failed for project ${projectId}: ${e?.message}`);
        freshLookup = { found: false };
      }
    }

    let freshRevisionCheck: { available: boolean; revision?: string | null } | null = null;
    if (candidate && ociLookup) {
      try {
        freshRevisionCheck = await ociLookup({ registry: candidate.registry, repository: candidate.repository, digest: candidate.digest });
      } catch (e: any) {
        this.logger.warn(`OCI re-check failed for project ${projectId}: ${e?.message}`);
        freshRevisionCheck = { available: false };
      }
    }

    return evaluateProvenDeploymentArtifact({ commit, environment, targetRegistry, targetRepository, candidateArtifact: candidate, freshLookup, freshRevisionCheck });
  }

  /** Seul point d'entrée du grand livre des artefacts. */
  async registerArtifact(
    input: RegisterArtifactInput,
    redigest: AcrDigestResolver,
    ociLookup: OciRevisionLookup | undefined,
    options: RegisterArtifactOptions,
  ): Promise<RegisterArtifactResult> {
    if (!isFullGitSha(input.commitSha)) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_COMMIT_MISSING', reason: 'commitSha fourni invalide (doit être un sha-1 git complet).' };
    }
    if (input.digest !== undefined && !DIGEST_RE.test(input.digest)) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_DIGEST_MISSING', reason: 'digest fourni mal formé (doit être sha256:<64 hex>).' };
    }
    const project = await this.projectRepo.findOne({ where: { id: input.projectId } });
    if (!project || !project.azureConfig) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ENVIRONMENT_UNRESOLVED', reason: 'Projet introuvable ou cible Azure non configurée.' };
    }
    if (input.repository !== project.azureConfig.imageRepository) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH', reason: `repository fourni ("${input.repository}") ne correspond pas à la cible du projet ("${project.azureConfig.imageRepository}").` };
    }

    const { buildIdentity } = await this.readiness.resolveBuildIdentity(input.projectId, input.buildNumber);
    const commit = toCommitResolutionResult(buildIdentity);
    if (!commit.ok || !commit.buildNumber || !commit.commitSha) {
      return { status: 'REJECTED', failureCode: commit.failureCode || 'DEPLOY_COMMIT_MISSING', reason: 'Identité de build non résolue pour ce projet/build — impossible de corréler.' };
    }
    if (commit.buildNumber !== input.buildNumber) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_BUILD_MISMATCH', reason: `buildNumber fourni (${input.buildNumber}) ≠ build résolu (${commit.buildNumber}).` };
    }
    if (commit.commitSha.toLowerCase() !== input.commitSha.toLowerCase()) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_COMMIT_MISMATCH', reason: 'commitSha fourni ≠ sourceCommitSha réellement résolu pour ce build — jamais pris au mot.' };
    }

    let lookup: AcrDigestLookup;
    try {
      lookup = await redigest({ registry: project.azureConfig.registry, repository: input.repository, tag: input.tag });
    } catch (e: any) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE', reason: `Résolution ACR indisponible : ${e?.message}` };
    }
    if (!lookup.found || !lookup.digest || !DIGEST_RE.test(lookup.digest)) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_DIGEST_MISSING', reason: `Le tag "${input.tag}" ne résout vers aucun digest dans ${project.azureConfig.registry}/${input.repository}.` };
    }
    const digest = lookup.digest.toLowerCase();
    if (input.digest !== undefined && input.digest.toLowerCase() !== digest) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_DIGEST_MISMATCH', reason: `digest fourni ("${input.digest}") ≠ digest réellement résolu par ACR ("${digest}").` };
    }

    const existing = await this.artifactRepo.findOne({ where: { registry: project.azureConfig.registry, repository: input.repository, digest } });
    if (existing) {
      const identical = existing.projectId === input.projectId && existing.buildNumber === commit.buildNumber && existing.commitSha === commit.commitSha.toLowerCase();
      if (identical) {
        return {
          status: existing.provenanceVerified ? 'PROVENANCE_VERIFIED' : 'UNVERIFIED_MANUAL_ARTIFACT',
          artifactId: existing.id, digest, failureCode: null, reason: 'Déjà enregistré de façon identique — idempotent.',
          artifactIdentitySource: existing.artifactIdentitySource ?? deriveArtifactIdentitySource(existing.provenanceVerified),
          publicationSource: existing.publicationSource ?? 'UNKNOWN',
          publicationFailureCode: existing.publicationFailureCode ?? null,
          publicationReason: existing.publicationEvidence ?? null,
        };
      }
      return {
        status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_COMMIT_MISMATCH',
        reason: `Ce digest est déjà associé à un autre projet/build/commit (projectId=${existing.projectId}, buildNumber=${existing.buildNumber}, commitSha=${existing.commitSha}) — contradiction, jamais écrasé silencieusement.`,
      };
    }

    let provenanceVerified = false;
    let provenanceEvidence: string;
    let revisionCheck: { available: boolean; revision?: string | null } = { available: false };
    if (ociLookup) {
      try {
        revisionCheck = await ociLookup({ registry: project.azureConfig.registry, repository: input.repository, digest });
      } catch (e: any) {
        revisionCheck = { available: false };
      }
    }
    if (revisionCheck.available && revisionCheck.revision) {
      if (!isFullGitSha(revisionCheck.revision)) {
        return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_REVISION_MISMATCH', reason: `org.opencontainers.image.revision mal formé ("${revisionCheck.revision}") — doit être un sha-1 git complet.` };
      }
      if (revisionCheck.revision.toLowerCase() !== commit.commitSha.toLowerCase()) {
        return {
          status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_REVISION_MISMATCH',
          reason: `org.opencontainers.image.revision ("${revisionCheck.revision}") ≠ commit validé ("${commit.commitSha}").`,
        };
      }
      provenanceVerified = true;
      provenanceEvidence = `org.opencontainers.image.revision=${revisionCheck.revision} matches validated commit (independently verified)`;
    } else if (options.requireVerifiedProvenance) {
      return { status: 'REJECTED', failureCode: 'DEPLOY_ARTIFACT_REVISION_MISSING', reason: 'Aucun label org.opencontainers.image.revision trouvé sur cette image — requis pour un enregistrement CI (§10).' };
    } else {
      provenanceEvidence = 'Aucun label org.opencontainers.image.revision présent sur cette image — provenance non vérifiable (enregistrement manuel, §11).';
    }

    const artifactIdentitySource = deriveArtifactIdentitySource(provenanceVerified);
    const channel: PublicationChannel = options.publicationChannel ?? 'MANUAL_ADMIN';
    const publicationTelemetry = await this.readiness.resolveBuildPublicationEvidence(input.projectId, commit.buildNumber);
    const publication = evaluateArtifactPublication({
      channel,
      pushReceipt: input.pushReceipt ?? null,
      registryConfirmedDigest: digest,
      resolvedBuildNumber: commit.buildNumber,
      reportedPushStatus: publicationTelemetry.reportedPushStatus,
      attestedByUserId: options.attestedByUserId ?? null,
    });
    if (publication.publicationSource === 'UNKNOWN') {
      this.logger.warn(
        `Artifact ${project.azureConfig.registry}/${input.repository}:${input.tag} (${digest}) enregistré avec publication UNKNOWN `
        + `(${publication.failureCode}) — identité du code source: ${artifactIdentitySource}. Ne pourra pas autoriser de déploiement.`,
      );
    }

    const saved = await this.artifactRepo.save(this.artifactRepo.create({
      projectId: input.projectId, buildNumber: commit.buildNumber, commitSha: commit.commitSha.toLowerCase(),
      registry: project.azureConfig.registry, repository: input.repository, tag: input.tag, digest,
      source: this.legacySourceFor(publication.publicationSource),
      provenanceVerified, provenanceEvidence,
      artifactIdentitySource,
      publicationSource: publication.publicationSource,
      publicationEvidence: publication.evidence,
      publicationFailureCode: publication.failureCode,
      publicationReceipt: {
        ...publication.receipt,
        reportedImageTag: publicationTelemetry.reportedImageTag,
        reportedBuildStatus: publicationTelemetry.reportedBuildStatus,
        telemetryIncidentId: publicationTelemetry.incidentId,
      },
    }));
    return {
      status: provenanceVerified ? 'PROVENANCE_VERIFIED' : 'UNVERIFIED_MANUAL_ARTIFACT',
      artifactId: saved.id, digest, failureCode: null,
      reason: provenanceVerified ? null : 'Enregistré mais NON vérifié — ne satisfait pas la Strong Deployment Identity (§5).',
      artifactIdentitySource,
      publicationSource: publication.publicationSource,
      publicationFailureCode: publication.failureCode,
      publicationReason: publication.evidence,
    };
  }

  /** Projette le verdict de publication (claim C) vers la colonne legacy `source`, pour compatibilité avec les lecteurs existants — plus jamais écrite directement par un appelant. */
  private legacySourceFor(publicationSource: ArtifactPublicationSource): 'JENKINS_PIPELINE' | 'MANUAL_REGISTERED' | 'UNKNOWN' {
    switch (publicationSource) {
      case 'PIPELINE_VERIFIED': return 'JENKINS_PIPELINE';
      case 'MANUAL_ATTESTED': return 'MANUAL_REGISTERED';
      default: return 'UNKNOWN';
    }
  }
}
