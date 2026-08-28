// ─────────────────────────────────────────────────────────────
//  Azure Deploy — proxy vers l'agent hôte (infra/azure-deploy-agent/agent.py)
//  Fichier : src/azure-deploy/azure-deploy.module.ts
//  Enregistrement : ajouter AzureDeployModule aux imports de AppModule
//
//  Ce module ne détient JAMAIS de credential Azure. Le service principal
//  étant impossible (politique du tenant Esprit — Entra ID bloque la
//  création d'App Registration pour ce compte, voir diagnostic), on
//  utilise la session Azure personnelle (`az login`) déjà active sur
//  l'hôte WSL. Pour ne PAS régresser sur le moindre privilège visé
//  initialement (cette session a le rôle Owner sur TOUTE la subscription,
//  pas juste sur rg-pfe-devsecops), le token ne quitte JAMAIS l'hôte :
//  seul l'agent Python (infra/azure-deploy-agent/agent.py), qui tourne
//  nativement sur l'hôte et lit ~/.azure, exécute des commandes az. Ce
//  module ne fait que l'appeler en HTTP avec un secret partagé
//  (AZURE_DEPLOY_AGENT_SECRET), exactement comme n8n authentifie ses
//  callbacks avec N8N_CALLBACK_SECRET (voir jenkins-optimizer.module.ts).
//
//  L'agent est lié à 172.19.0.1 (gateway du bridge Docker "pfe-network"),
//  jamais à 0.0.0.0 — seuls les conteneurs de ce réseau l'atteignent.
// ─────────────────────────────────────────────────────────────
import { Module, Controller, Get, Post, Param, Body, UseGuards, HttpException, HttpStatus, Req } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Report } from '../reports/report.entity';
import { Project } from '../projects/project.entity';
import { Incident } from '../incidents/incident.entity';
import { AzureDeployReadinessService } from './azure-deploy-readiness.service';

const AGENT_URL = process.env.AZURE_DEPLOY_AGENT_URL || 'http://172.19.0.1:7799';
// Volontairement pas de valeur par défaut : sans cette variable d'env
// définie, tout appel à l'agent échoue fail-closed (même principe que
// N8N_CALLBACK_SECRET côté callbacks jenkins-optimizer/dockerfile-optimizer).
const AGENT_SECRET = process.env.AZURE_DEPLOY_AGENT_SECRET;

@Controller('azure-deploy')
export class AzureDeployController {
  constructor(
    private readonly readiness: AzureDeployReadinessService,
    @InjectRepository(Project) private readonly projectsRepo: Repository<Project>,
  ) {}

  private assertConfigured() {
    if (!AGENT_SECRET) {
      throw new HttpException(
        "AZURE_DEPLOY_AGENT_SECRET non configuré côté backend — l'agent de déploiement est inatteignable en toute sécurité.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Liste les projets configurés sans exposer de secret Azure.
  @UseGuards(JwtAuthGuard)
  @Get('projects')
  async projects() {
    const projects = await this.projectsRepo.find();
    return { projects: projects.filter(p => !!p.azureConfig).map(p => ({ id: p.id, name: p.name, target: p.azureConfig })) };
  }

  // Permet au front (futur bouton "Déployer") de vérifier AVANT d'agir que
  // la session Azure de l'hôte est valide, sans lancer de déploiement.
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
        // 409 = session Azure expirée (message clair déjà formé par l'agent) ;
        // on le propage tel quel, jamais un crash générique.
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

  // Renvoie l'état "prêt à déployer" d'un projet (par id) sans rien
  // déclencher — c'est ce que le front interroge pour activer/griser le
  // bouton "Déployer" avant même que l'utilisateur clique.
  @UseGuards(JwtAuthGuard)
  @Get('ready/:projectId')
  async ready(@Param('projectId') projectId: string) {
    return this.readiness.isReadyToDeploy(projectId);
  }

  // Déclenche un déploiement ACI réel depuis la configuration non sensible
  // du Project. L'agent applique en plus ses allow-lists resource group/ACR.
  @UseGuards(JwtAuthGuard)
  @Post('deploy')
  async deploy(@Body() body: { projectId: string; imageTag: string; requestId: string; confirmed: boolean; dryRun?: boolean }, @Req() req: any) {
    this.assertConfigured();
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) {
      throw new HttpException('Utilisateur non autorisé à déployer', HttpStatus.FORBIDDEN);
    }
    if (!body?.projectId || !body?.imageTag || !body?.requestId || body.confirmed !== true) {
      throw new HttpException('projectId, imageTag, requestId et confirmation explicite sont requis', HttpStatus.BAD_REQUEST);
    }
    const project = await this.projectsRepo.findOne({ where: { id: body.projectId } });
    if (!project) throw new HttpException('Projet introuvable', HttpStatus.NOT_FOUND);
    if (!project.azureConfig) throw new HttpException({ error: 'AZURE_NOT_CONFIGURED' }, HttpStatus.CONFLICT);

    // Gardien fail-closed, appliqué ICI même si le front a déjà consulté
    // /ready avant d'afficher le bouton — un appel direct à /deploy (front
    // buggé, script, curl) ne doit jamais pouvoir contourner la vérification.
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
        // Le déploiement ACI réel (create + polling + health check côté
        // agent) peut prendre plusieurs dizaines de secondes — signal large
        // mais borné, jamais infini.
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
}

@Module({
  imports: [TypeOrmModule.forFeature([Report, Project, Incident])],
  controllers: [AzureDeployController],
  providers: [AzureDeployReadinessService],
  // Exporté pour ReportsModule — la notification "prêt à déployer" (transition
  // false->true) réutilise le même juge que /ready et /deploy, jamais une copie.
  exports: [AzureDeployReadinessService],
})
export class AzureDeployModule {}
