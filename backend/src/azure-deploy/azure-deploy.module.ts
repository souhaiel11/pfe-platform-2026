// Azure Deploy — proxy vers l'agent hôte (infra/azure-deploy-agent/agent.py).
import { deploymentHistoryEntry } from './deployment-history';
import { Module, Controller, Get, Post, Param, Body, Query, UseGuards, HttpException, HttpStatus, Req } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtOrInternalSecretGuard } from '../auth/jwt-or-internal-secret.guard';
import { Report } from '../reports/report.entity';
import { Project } from '../projects/project.entity';
import { Incident } from '../incidents/incident.entity';
import { AzureDeployReadinessService } from './azure-deploy-readiness.service';
import { AzureDeployRequestDto } from './dto/azure-deploy-request.dto';
import { RegisterArtifactDto } from './dto/register-artifact.dto';
import { AcrDigestLookup } from './deployment-identity.types';
import { DeploymentArtifact } from './deployment-artifact.entity';
import { DeploymentArtifactService } from './deployment-artifact.service';
import { DeploymentAuthorization } from './deployment-authorization.entity';
import { DeploymentAttempt } from './deployment-attempt.entity';
import { DeploymentAuthorizationService } from './deployment-authorization.service';
import { AuthorizeDeploymentDto } from './dto/authorize-deployment.dto';
import { evaluateLegacyDeployTransition } from './deployment-authorization-transition';
import { classifyAgentDeploymentResult } from './agent-deployment-result';
import { extractPushedManifestDigest, pendingPublicationOf } from './ci-publication-reconciler';
import { trustedJenkinsConsoleUrl } from '../webhooks/trusted-jenkins-url';

const AGENT_URL = process.env.AZURE_DEPLOY_AGENT_URL || 'http://172.19.0.1:7799';
const AGENT_SECRET = process.env.AZURE_DEPLOY_AGENT_SECRET;

const DEPLOYMENT_AUTHORIZATION_REQUIRED = process.env.DEPLOYMENT_AUTHORIZATION_REQUIRED === 'true';

@Controller('azure-deploy')
export class AzureDeployController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private readonly readiness: AzureDeployReadinessService,
    private readonly artifacts: DeploymentArtifactService,
    private readonly authorizations: DeploymentAuthorizationService,
    @InjectRepository(Project) private readonly projectsRepo: Repository<Project>,
    @InjectRepository(DeploymentAttempt) private readonly attemptsRepo: Repository<DeploymentAttempt>,
    @InjectRepository(Incident) private readonly incidentsRepo: Repository<Incident>,
    @InjectRepository(DeploymentArtifact) private readonly artifactsRepo: Repository<DeploymentArtifact>,
  ) {}

  /**
   * Enregistre l'image du dernier build publié mais encore PENDING (bibliothèque R59 : plus de reçu envoyé
   * par Jenkins). Le reçu est reconstitué depuis le log du Jenkins configuré du projet, puis
   * registerArtifact() recoupe le digest avec le registre : même exigence de preuve qu'un callback CI.
   */
  private async reconcilePendingPublication(projectId: string): Promise<void> {
    if (!AGENT_SECRET) return;
    const incident = await this.incidentsRepo.createQueryBuilder('i')
      .where('i."projectId" = :projectId', { projectId })
      .andWhere(`i.metadata->'enrichedData'->'docker'->>'provenance_status' = 'PENDING'`)
      .orderBy('i."createdAt"', 'DESC').getOne();
    const pending = pendingPublicationOf(incident);
    if (!pending) return;
    if (await this.artifactsRepo.findOne({ where: { projectId, buildNumber: pending.buildNumber, tag: pending.tag } as any })) return;
    const project = await this.projectsRepo.findOne({ where: { id: projectId } });
    const consoleUrl = project ? trustedJenkinsConsoleUrl(pending.buildUrl, project) : null;
    if (!consoleUrl || !project?.jenkinsToken) return;
    const res = await fetch(consoleUrl, { headers: { Authorization: 'Basic ' + Buffer.from(project.jenkinsToken).toString('base64') },
      redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return;
    const manifestDigest = extractPushedManifestDigest(await res.text(), pending.tag);
    if (!manifestDigest) return;
    const result: any = await this.artifacts.registerArtifact(
      { projectId, buildNumber: pending.buildNumber, commitSha: pending.commitSha, repository: pending.repository, tag: pending.tag,
        pushReceipt: { manifestDigest, buildNumber: pending.buildNumber, jenkinsBuildUrl: pending.buildUrl } },
      (params) => this.resolveArtifactDigest(params),
      (params) => this.inspectArtifactLabels(params),
      { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK', attestedByUserId: null },
    );
    console.log(`[azure-deploy] publication du build #${pending.buildNumber} (${pending.tag}) : ${JSON.stringify(result).slice(0, 400)}`);
  }

  /** Refuse fail-closed tout appel à l'agent si AZURE_DEPLOY_AGENT_SECRET n'est pas défini côté backend. */
  private assertConfigured() {
    if (!AGENT_SECRET) {
      throw new HttpException(
        "AZURE_DEPLOY_AGENT_SECRET non configuré côté backend — l'agent de déploiement est inatteignable en toute sécurité.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** Endpoint HTTP : liste les projets ayant une cible Azure configurée, sans exposer aucun secret. */
  @UseGuards(JwtAuthGuard)
  @Get('projects')
  async projects() {
    const projects = await this.projectsRepo.find();
    return { projects: projects.filter(p => !!p.azureConfig).map(p => ({ id: p.id, name: p.name, target: p.azureConfig })) };
  }

  /** Endpoint HTTP : interroge l'agent pour vérifier que la session `az login` de l'hôte est toujours valide, sans rien déployer. */
  @UseGuards(JwtAuthGuard)
  @Get('session-status')
  async sessionStatus() {
    this.assertConfigured();
    try {
      const res = await fetch(`${AGENT_URL}/session-status`, {
        headers: { 'X-Agent-Secret': AGENT_SECRET as string },
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new HttpException(data, res.status);
      }
      return data;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        `Agent de déploiement Azure injoignable sur l'hôte : ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /** Endpoint HTTP : renvoie le verdict prêt/pas-prêt à déployer, sans rien déclencher (délègue entièrement à AzureDeployReadinessService). */
  @UseGuards(JwtAuthGuard)
  @Get('ready/:projectId')
  async ready(@Param('projectId') projectId: string) {
    // Bornée à 45 s pour ne jamais bloquer la page ; au-delà, l'enregistrement se poursuit en arrière-plan.
    const reconciliation = this.reconcilePendingPublication(projectId)
      .catch(e => console.warn(`[azure-deploy] réconciliation de publication en échec : ${e?.message || e}`));
    await Promise.race([reconciliation, new Promise(resolve => setTimeout(resolve, 45_000))]);
    return this.readiness.isReadyToDeploy(projectId);
  }

  /** Endpoint HTTP : résout l'identité de déploiement (commit/artefact/environnement) à titre purement observationnel, sans toucher à la logique de /deploy. */
  @UseGuards(JwtAuthGuard)
  @Get('identity/:projectId')
  async identity(@Param('projectId') projectId: string, @Query('tag') tag?: string) {
    return this.readiness.resolveDeploymentIdentity(
      projectId,
      tag || 'latest',
      AGENT_SECRET ? (params) => this.resolveArtifactDigest(params) : undefined,
    );
  }

  /** Endpoint HTTP : les 10 derniers déploiements du projet (lecture seule), pour garder le lien vers l'application après actualisation. */
  @UseGuards(JwtAuthGuard)
  @Get('history/:projectId')
  async history(@Param('projectId') projectId: string) {
    const attempts = await this.attemptsRepo.find({ where: { projectId } as any, order: { createdAt: 'DESC' } as any, take: 10 });
    return attempts.map(deploymentHistoryEntry);
  }

  /** Endpoint HTTP : expose l'aperçu de gouvernance en lecture seule (même calcul que POST /authorize), pour que le futur frontend l'affiche sans jamais pouvoir le soumettre comme une vérité. */
  @UseGuards(JwtAuthGuard)
  @Get('governance/:projectId')
  async governance(@Param('projectId') projectId: string, @Query('mainBuildNumber') mainBuildNumber?: string, @Query('tag') tag?: string) {
    return this.authorizations.getGovernancePreview(
      projectId,
      mainBuildNumber ? Number(mainBuildNumber) : undefined,
      tag,
      AGENT_SECRET ? (params) => this.resolveArtifactDigest(params) : undefined,
      AGENT_SECRET ? (params) => this.inspectArtifactLabels(params) : undefined,
    );
  }

  /** Demande à l'agent hôte de résoudre un tag vers un digest ACR immuable (lecture seule, `az acr repository show`) — le backend ne détient jamais de credential ACR lui-même. */
  private async resolveArtifactDigest(params: { registry: string; repository: string; tag: string }): Promise<AcrDigestLookup> {
    this.assertConfigured();
    const res = await fetch(`${AGENT_URL}/resolve-digest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': AGENT_SECRET as string },
      body: JSON.stringify(params),
      // Appels az Windows (session + registre) : plusieurs secondes chacun ; 15 s faisait échouer à tort
      // la re-vérification du digest au moment du déploiement.
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    if (!res.ok || !data?.found) return { found: false };
    return { found: true, registry: data.registry, repository: data.repository, tag: data.tag, digest: data.digest };
  }

  /** Endpoint HTTP : indique si un artefact PROUVÉ existe pour le commit/build validé courant du projet, avec re-vérification TOCTOU fraîche du digest. */
  @UseGuards(JwtAuthGuard)
  @Get('artifacts/provenance/:projectId')
  async provenance(@Param('projectId') projectId: string) {
    return this.artifacts.resolveProvenDeploymentArtifact(
      projectId,
      AGENT_SECRET ? (params) => this.resolveArtifactDigest(params) : undefined,
      AGENT_SECRET ? (params) => this.inspectArtifactLabels(params) : undefined,
    );
  }

  /** Demande à l'agent de lire les labels OCI (org.opencontainers.image.revision) d'une image — manifeste+config uniquement, jamais de pull des couches d'image. */
  private async inspectArtifactLabels(params: { registry: string; repository: string; digest: string }): Promise<{ available: boolean; revision?: string | null }> {
    this.assertConfigured();
    const res = await fetch(`${AGENT_URL}/inspect-artifact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': AGENT_SECRET as string },
      body: JSON.stringify({ registry: params.registry, repository: params.repository, digest: params.digest }),
      // L'agent peut devoir tirer l'image (hôte sans buildx) pour lire ses labels : ~40 s la première fois.
      signal: AbortSignal.timeout(300000),
    });
    const data = await res.json();
    if (!res.ok || !data?.found) return { available: false };
    return { available: true, revision: data.revision ?? null };
  }

  /** Endpoint HTTP : enregistrement manuel (admin uniquement) d'un artefact construit/poussé à la main dans le grand livre de provenance. */
  @UseGuards(JwtAuthGuard)
  @Post('artifacts/register')
  async registerArtifact(@Body() body: RegisterArtifactDto, @Req() req: any) {
    if (String(req.user?.role || '').toLowerCase() !== 'admin') {
      throw new HttpException('Enregistrement de provenance réservé aux administrateurs', HttpStatus.FORBIDDEN);
    }
    const actorUserId = req.user?.id || req.user?.sub || null;
    if (!actorUserId) {
      throw new HttpException("Identité de l'administrateur non résolue — une attestation de publication manuelle doit être nominative.", HttpStatus.FORBIDDEN);
    }
    this.assertConfigured();
    return this.artifacts.registerArtifact(
      body,
      (params) => this.resolveArtifactDigest(params),
      (params) => this.inspectArtifactLabels(params),
      {
        requireVerifiedProvenance: false,
        publicationChannel: 'MANUAL_ADMIN',
        attestedByUserId: String(actorUserId),
      },
    );
  }

  /** Endpoint HTTP (callback CI ou admin) : enregistre la provenance d'un artefact publié par le pipeline. */
  @UseGuards(JwtOrInternalSecretGuard)
  @Post('artifacts/provenance')
  async artifactProvenanceCallback(@Body() body: RegisterArtifactDto, @Req() req: any) {
    const viaInternalSecret = req.authChannel === 'INTERNAL_SECRET';
    let publicationChannel: 'CI_CALLBACK' | 'MANUAL_ADMIN' = 'CI_CALLBACK';
    let attestedByUserId: string | null = null;
    if (!viaInternalSecret) {
      const role = String(req.user?.role || '').toLowerCase();
      if (role !== 'admin') {
        throw new HttpException(
          "Enregistrement de provenance réservé au pipeline (secret interne) ou aux administrateurs — un appel humain non administrateur ne peut pas revendiquer la provenance d'une publication.",
          HttpStatus.FORBIDDEN,
        );
      }
      const actorUserId = req.user?.id || req.user?.sub || null;
      if (!actorUserId) {
        throw new HttpException("Identité de l'administrateur non résolue — une attestation de publication doit être nominative.", HttpStatus.FORBIDDEN);
      }
      publicationChannel = 'MANUAL_ADMIN';
      attestedByUserId = String(actorUserId);
    }
    this.assertConfigured();
    return this.artifacts.registerArtifact(
      body,
      (params) => this.resolveArtifactDigest(params),
      (params) => this.inspectArtifactLabels(params),
      { requireVerifiedProvenance: true, publicationChannel, attestedByUserId },
    );
  }

  /** Endpoint HTTP : crée une autorisation de déploiement gouvernée en recalculant tout côté serveur — ne déploie jamais rien par elle-même. */
  @UseGuards(JwtAuthGuard)
  @Post('authorize/:projectId')
  async authorize(@Param('projectId') projectId: string, @Body() body: AuthorizeDeploymentDto, @Req() req: any) {
    this.assertConfigured();
    const result = await this.authorizations.createAuthorization(
      {
        projectId, mainBuildNumber: body.mainBuildNumber, tag: body.tag, mode: body.mode,
        reason: body.reason, acknowledgements: body.acknowledgements, confirmationPhrase: body.confirmationPhrase,
        requestedByUserId: req.user?.id || req.user?.sub, requestedByRole: String(req.user?.role || '').toLowerCase(),
      },
      AGENT_SECRET ? (params) => this.resolveArtifactDigest(params) : undefined,
      AGENT_SECRET ? (params) => this.inspectArtifactLabels(params) : undefined,
    );
    if (!result.ok) {
      throw new HttpException({ error: result.failureCode, message: result.reason, governanceClass: result.governanceClass }, HttpStatus.CONFLICT);
    }
    return { authorizationId: result.authorization!.id, governanceClass: result.governanceClass, expiresAt: result.authorization!.expiresAt };
  }

  /** Endpoint HTTP : déclenche un déploiement ACI réel. */
  @UseGuards(JwtAuthGuard)
  @Post('deploy')
  async deploy(@Body() body: AzureDeployRequestDto, @Req() req: any) {
    this.assertConfigured();
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) {
      throw new HttpException('Utilisateur non autorisé à déployer', HttpStatus.FORBIDDEN);
    }

    if (body.authorizationId) {
      return this.deployWithAuthorization(body, req);
    }

    const transition = evaluateLegacyDeployTransition(DEPLOYMENT_AUTHORIZATION_REQUIRED, false);
    if (!transition.allowed) {
      throw new HttpException({ error: transition.failureCode, message: 'Un authorizationId est requis pour tout déploiement — le mode DEPLOYMENT_AUTHORIZATION_REQUIRED est actif.' }, HttpStatus.CONFLICT);
    }

    if (!body?.projectId || !body?.imageTag || !body?.requestId || body.confirmed !== true) {
      throw new HttpException('projectId, imageTag, requestId et confirmation explicite sont requis', HttpStatus.BAD_REQUEST);
    }
    const project = await this.projectsRepo.findOne({ where: { id: body.projectId } });
    if (!project) throw new HttpException('Projet introuvable', HttpStatus.NOT_FOUND);
    if (!project.azureConfig) throw new HttpException({ error: 'AZURE_NOT_CONFIGURED' }, HttpStatus.CONFLICT);

    const readiness = await this.readiness.isReadyToDeploy(body.projectId);
    if (!readiness.ready) {
      throw new HttpException(
        {
          error: 'NOT_READY_TO_DEPLOY',
          message: `Projet '${project.name}' non prêt à être déployé.`,
          reasons: readiness.reasons,
        },
        HttpStatus.CONFLICT,
      );
    }

    if (body.dryRun) return { status: 'AZURE_DISPATCH_READY', dryRun: true, requestId: body.requestId, target: readiness.deploymentTarget };

    const reservation = await this.projectsRepo.manager.transaction(async manager => {
      const locked = await manager.getRepository(Project).findOne({ where: { id: body.projectId }, lock: { mode: 'pessimistic_write' } });
      if (!locked) throw new HttpException('Projet introuvable', HttpStatus.NOT_FOUND);
      const existing = locked.azureDeploymentState;
      if (existing?.requestId === body.requestId) return { duplicate: existing, project: locked };
      if (existing?.status === 'DISPATCHING') throw new HttpException({ error: 'DEPLOYMENT_IN_PROGRESS' }, HttpStatus.CONFLICT);
      locked.azureDeploymentState = { requestId: body.requestId, status: 'DISPATCHING', imageTag: body.imageTag, updatedAt: new Date().toISOString() };
      await manager.save(locked);
      return { duplicate: null, project: locked };
    });
    if (reservation.duplicate) return { duplicate: true, ...reservation.duplicate };
    const reservedProject = reservation.project;

    try {
      const res = await fetch(`${AGENT_URL}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': AGENT_SECRET as string },
        body: JSON.stringify({ projectId: reservedProject.id, requestId: body.requestId, imageTag: body.imageTag, target: reservedProject.azureConfig }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new HttpException(data, res.status);
      }
      reservedProject.azureDeploymentState = { requestId: body.requestId, status: 'DEPLOYED', imageTag: body.imageTag, updatedAt: new Date().toISOString(), result: data };
      await this.projectsRepo.save(reservedProject);
      return data;
    } catch (e: any) {
      reservedProject.azureDeploymentState = { requestId: body.requestId, status: 'FAILED', imageTag: body.imageTag, updatedAt: new Date().toISOString() };
      await this.projectsRepo.save(reservedProject);
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        `Agent de déploiement Azure injoignable sur l'hôte : ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /** Chemin de déploiement GOUVERNÉ. */
  private async deployWithAuthorization(body: AzureDeployRequestDto, req: any) {
    if (!body.requestId) {
      throw new HttpException('requestId requis pour un déploiement gouverné', HttpStatus.BAD_REQUEST);
    }

    const project = await this.projectsRepo.findOne({ where: { id: body.projectId } });
    if (!project || !project.azureConfig) throw new HttpException({ error: 'AZURE_NOT_CONFIGURED' }, HttpStatus.CONFLICT);

    if (body.dryRun) {
      return { status: 'AZURE_DISPATCH_READY', dryRun: true, requestId: body.requestId, authorizationId: body.authorizationId, target: project.azureConfig };
    }

    const reservation = await this.authorizations.reserveAndConsumeAuthorization(
      {
        authorizationId: body.authorizationId!, requestId: body.requestId,
        actorUserId: req.user?.id || req.user?.sub, actorRole: String(req.user?.role || '').toLowerCase(),
      },
      AGENT_SECRET ? (params) => this.resolveArtifactDigest(params) : undefined,
      AGENT_SECRET ? (params) => this.inspectArtifactLabels(params) : undefined,
    );
    if (!reservation.ok) {
      throw new HttpException({ error: reservation.failureCode, message: reservation.reason }, HttpStatus.CONFLICT);
    }
    if (reservation.duplicate) return { duplicate: true, ...reservation.existingState };

    const authorization = reservation.authorization!;
    if (authorization.projectId !== body.projectId) {
      throw new HttpException({ error: 'DEPLOY_AUTHORIZATION_PROJECT_MISMATCH' }, HttpStatus.CONFLICT);
    }
    const reservedProject = reservation.project!;
    const attempt = reservation.attempt!;

    let httpStatus: number | null = null;
    let data: any = null;
    try {
      const res = await fetch(`${AGENT_URL}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': AGENT_SECRET as string },
        body: JSON.stringify({
          projectId: reservedProject.id, requestId: body.requestId,
          imageTag: authorization.artifactTag, artifactDigest: authorization.artifactDigest,
          target: reservedProject.azureConfig,
        }),
        signal: AbortSignal.timeout(180000),
      });
      httpStatus = res.status;
      data = await res.json();
    } catch {
    }
    const result = classifyAgentDeploymentResult(httpStatus, data);
    const status = result.deploymentSuccess ? 'DEPLOYED' : 'FAILED';
    await this.projectsRepo.manager.transaction(async manager => {
      const currentProject = await manager.findOne(Project, { where: { id: reservedProject.id }, lock: { mode: 'pessimistic_write' } });
      const currentAttempt = await manager.findOne(DeploymentAttempt, { where: { id: attempt.id }, lock: { mode: 'pessimistic_write' } });
      if (!currentAttempt || currentAttempt.dispatchStatus !== 'DISPATCHING' ||
          currentProject?.azureDeploymentState?.requestId !== body.requestId ||
          currentProject.azureDeploymentState.status !== 'DISPATCHING') {
        throw new HttpException({ error: 'DEPLOY_ATTEMPT_NOT_DISPATCHING' }, HttpStatus.CONFLICT);
      }
      currentAttempt.dispatchStatus = status;
      currentAttempt.dispatchResult = { ...result, agentResponse: data };
      currentAttempt.completedAt = new Date();
      await manager.save(currentAttempt);
      currentProject.azureDeploymentState = {
        requestId: body.requestId, attemptId: attempt.id, authorizationId: authorization.id,
        status, imageTag: authorization.artifactTag, updatedAt: new Date().toISOString(),
        result: data, failureCode: result.failureCode, failureReason: result.failureReason,
      };
      await manager.save(currentProject);
    });
    if (!result.deploymentSuccess) {
      throw new HttpException({ success: false, error: result.failureCode, message: result.failureReason,
        transportSuccess: result.transportSuccess, deploymentSuccess: false,
        authorizationId: authorization.id, attemptId: attempt.id, requestId: body.requestId },
      httpStatus !== null && httpStatus >= 400 && httpStatus <= 599 ? httpStatus : HttpStatus.BAD_GATEWAY);
    }
    return { ...data, authorizationId: authorization.id, artifactDigest: authorization.artifactDigest };
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Report, Project, Incident, DeploymentArtifact, DeploymentAuthorization, DeploymentAttempt])],
  controllers: [AzureDeployController],
  providers: [AzureDeployReadinessService, DeploymentArtifactService, DeploymentAuthorizationService],
  exports: [AzureDeployReadinessService],
})
export class AzureDeployModule {}
