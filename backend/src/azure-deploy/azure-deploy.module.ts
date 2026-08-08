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
import { Module, Controller, Get, Post, Param, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Report } from '../reports/report.entity';
import { Project } from '../projects/project.entity';
import { AzureDeployReadinessService } from './azure-deploy-readiness.service';

const AGENT_URL = process.env.AZURE_DEPLOY_AGENT_URL || 'http://172.19.0.1:7799';
// Volontairement pas de valeur par défaut : sans cette variable d'env
// définie, tout appel à l'agent échoue fail-closed (même principe que
// N8N_CALLBACK_SECRET côté callbacks jenkins-optimizer/dockerfile-optimizer).
const AGENT_SECRET = process.env.AZURE_DEPLOY_AGENT_SECRET;

@Controller('azure-deploy')
export class AzureDeployController {
  constructor(private readonly readiness: AzureDeployReadinessService) {}

  private assertConfigured() {
    if (!AGENT_SECRET) {
      throw new HttpException(
        "AZURE_DEPLOY_AGENT_SECRET non configuré côté backend — l'agent de déploiement est inatteignable en toute sécurité.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Liste les projets déployables — reflète le registre fixe côté agent
  // (PROJECTS dans agent.py), jamais une liste construite par le backend.
  @UseGuards(JwtAuthGuard)
  @Get('projects')
  async projects() {
    this.assertConfigured();
    try {
      const res = await fetch(`${AGENT_URL}/projects`, {
        headers: { 'X-Agent-Secret': AGENT_SECRET as string },
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok) throw new HttpException(data, res.status);
      return data;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        `Agent de déploiement Azure injoignable sur l'hôte : ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
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

  // Déclenche un déploiement ACI réel. Le backend ne fait QUE relayer un
  // couple {project, imageTag} — il ne choisit JAMAIS containerName, image
  // complète, cpu/memory/ports ni resourceGroup : ces paramètres vivent
  // exclusivement dans le registre fixe PROJECTS de l'agent hôte. Même si ce
  // module était compromis ou appelé avec un body forgé, il ne peut pas
  // faire exécuter à l'agent autre chose qu'un déploiement d'un projet
  // déclaré, avec le tag d'image demandé (validé côté agent par une regex
  // stricte avant tout usage).
  @UseGuards(JwtAuthGuard)
  @Post('deploy')
  async deploy(@Body() body: { project: string; imageTag: string }) {
    this.assertConfigured();
    if (!body?.project || !body?.imageTag) {
      throw new HttpException('project et imageTag sont requis', HttpStatus.BAD_REQUEST);
    }

    // Gardien fail-closed, appliqué ICI même si le front a déjà consulté
    // /ready avant d'afficher le bouton — un appel direct à /deploy (front
    // buggé, script, curl) ne doit jamais pouvoir contourner la vérification.
    const readiness = await this.readiness.isReadyToDeployByProjectName(body.project);
    if (!readiness.ready) {
      throw new HttpException(
        {
          error: 'NOT_READY_TO_DEPLOY',
          message: `Projet '${body.project}' non prêt à être déployé.`,
          reasons: readiness.reasons,
        },
        HttpStatus.CONFLICT,
      );
    }

    try {
      const res = await fetch(`${AGENT_URL}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': AGENT_SECRET as string },
        body: JSON.stringify(body),
        // Le déploiement ACI réel (create + polling + health check côté
        // agent) peut prendre plusieurs dizaines de secondes — signal large
        // mais borné, jamais infini.
        signal: AbortSignal.timeout(180000),
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
}

@Module({
  imports: [TypeOrmModule.forFeature([Report, Project])],
  controllers: [AzureDeployController],
  providers: [AzureDeployReadinessService],
})
export class AzureDeployModule {}
