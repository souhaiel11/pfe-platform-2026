// Endpoints HTTP des incidents.
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IncidentsService } from './incidents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtOrInternalSecretGuard } from '../auth/jwt-or-internal-secret.guard';
import { InternalSecretGuard } from '../auth/internal-secret.guard';
import { ExecutionStartedInput, PreWriteGateInput, CancelFixRequestInput } from './wf2-cancellation.types';
import { IncidentWriteDto } from './incident-write.dto';
import { PostWriteRecoveryDto } from './post-write-recovery';

@ApiTags('Incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: IncidentsService) {}

  // Liste les incidents (filtrables par projet/statut, bornés en taille) — accessible à un utilisateur
  // authentifié ou à n8n via le secret interne (WF-Chat-V4).
  @UseGuards(JwtOrInternalSecretGuard)
  @Get() findAll(@Query('projectId') projectId?: string, @Query('status') status?: string, @Query('size') size?: number) { return this.service.findAll(projectId, status, size); }

  // Renvoie les cycles de convergence d'un projet (vue gouvernance).
  @UseGuards(JwtAuthGuard)
  @Get('project/:projectId/cycles') convergence(@Param('projectId') projectId: string) { return this.service.convergence(projectId); }

  // Récupère un incident, enrichi pour l'affichage client (seule route qui atteint réellement le frontend).
  @UseGuards(JwtAuthGuard)
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOneForClient(id); }

  // Crée un incident.
  @UseGuards(JwtAuthGuard)
  @Post() create(@Body() dto: IncidentWriteDto) { return this.service.create(dto); }

  // Met à jour un incident (appelé par l'utilisateur ou par n8n WF1/WF2/WF3).
  @UseGuards(JwtOrInternalSecretGuard)
  @Put(':id') update(@Param('id') id: string, @Body() dto: IncidentWriteDto) { return this.service.update(id, dto); }

  // Enregistre le résultat de validation PR envoyé par n8n (WF3).
  @UseGuards(InternalSecretGuard)
  @Post(':id/validation') saveValidation(@Param('id') id: string, @Body() validation: any) { return this.service.saveValidation(id, validation); }

  // Enregistre le statut de lot d'un workflow (WF2) envoyé par n8n.
  @UseGuards(InternalSecretGuard)
  @Post(':id/workflow-status') saveWorkflowStatus(@Param('id') id: string, @Body() status: any) {
    return this.service.saveWorkflowBatchStatus(id, status);
  }

  // Supprime un incident.
  @UseGuards(JwtAuthGuard)
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }

  // Approuve un correctif proposé (déclenche WF2/WF4/WF5 selon le type).
  @UseGuards(JwtAuthGuard)
  @Post(':id/approve') approveFix(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.approveFix(id, req.user, body || {});
  }

  // Relance une tentative de correction après échec.
  @UseGuards(JwtAuthGuard)
  @Post(':id/retry') retryFix(@Param('id') id: string, @Req() req: any) {
    return this.service.retryFix(id, req.user);
  }

  // « Merge effectué » : constate le merge de la PR Sonar sur GitHub et libère les fichiers qu'elle réservait.
  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-merge') confirmMerge(@Param('id') id: string, @Req() req: any) {
    return this.service.confirmPullRequestMerged(id, req.user);
  }

  // Récupère l'état après une écriture GitHub dont le callback normal a été perdu, à partir d'une
  // preuve de récupération fournie par le client.
  @UseGuards(JwtAuthGuard)
  @Post(':id/recover-post-write') recoverPostWrite(@Param('id') id: string, @Body() body: PostWriteRecoveryDto, @Req() req: any) {
    return this.service.recoverPostWrite(id, body, req.user);
  }

  // Réconcilie manuellement un dispatch WF6 resté bloqué au-delà du seuil de péremption (action admin
  // explicite, jamais automatique).
  @UseGuards(JwtAuthGuard)
  @Post(':id/remediation/:requestId/reconcile-stale-dispatch')
  reconcileStaleDispatch(@Param('id') id: string, @Param('requestId') requestId: string,
    @Body() body: any, @Req() req: any) {
    return this.service.reconcileStaleDispatch(id, requestId, body || {}, req.user);
  }

  // Déclenche une demande de validation PR (build Jenkins de validation).
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation') requestPrValidation(@Param('id') id: string, @Req() req: any) {
    return this.service.requestPrValidation(id, req.user);
  }

  // Vérifie (et corrige si besoin) le paramètre Jenkins requis pour lancer une validation PR, sans
  // jamais déclencher de build.
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/ensure-parameter') ensurePrValidationBootstrap(@Param('id') id: string, @Req() req: any) {
    return this.service.ensurePrValidationBootstrap(id, req.user);
  }

  // Réconcilie une validation PR restée bloquée (QUEUED/RUNNING) face à un build Jenkins déjà terminé
  // sans callback reçu, sans jamais redéclencher Jenkins.
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/reconcile') reconcilePrValidation(@Param('id') id: string, @Req() req: any) {
    return this.service.reconcilePrValidation(id, req.user);
  }

  // Accepte un commit de remédiation suivant légitime (même PR/branche) comme nouvelle cible de
  // validation, sans jamais écraser la provenance d'origine.
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/refresh-target') refreshPrValidationTarget(@Param('id') id: string, @Req() req: any) {
    return this.service.refreshPrValidationTarget(id, req.user);
  }

  // Recalcule l'autorisation de fusion pour le SHA déjà validé, face à la politique backend actuelle,
  // sans redéclencher Jenkins/Sonar/WF3.
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/recompute-policy') recomputePrValidationPolicy(@Param('id') id: string, @Req() req: any) {
    return this.service.recomputePrValidationPolicy(id, req.user);
  }

  // Relance un build Jenkins de validation sur le même SHA de PR déjà validé (ex: après correction
  // d'un problème d'infrastructure de validation), jamais une nouvelle tentative corrective.
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/re-run') reRunPrValidation(@Param('id') id: string, @Req() req: any) {
    return this.service.reRunPrValidation(id, req.user);
  }

  // Autorise explicitement UNE tentative corrective causale sur la même PR, en passant par WF2 (jamais
  // d'appel direct à n8n depuis le frontend).
  @UseGuards(JwtAuthGuard)
  @Post(':id/correct-and-revalidate') correctAndRevalidate(@Param('id') id: string, @Req() req: any) {
    return this.service.correctAndRevalidate(id, req.user);
  }

  // Rejette un correctif proposé.
  @UseGuards(JwtAuthGuard)
  @Post(':id/reject') rejectFix(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.rejectFix(id, req.user, body || {});
  }

  // Enregistre le démarrage réel d'une exécution WF2 (appelé uniquement par n8n), pour lier précisément
  // l'identifiant d'exécution à la tentative de correction.
  @UseGuards(InternalSecretGuard)
  @Post(':id/remediation/:requestId/execution-started')
  recordExecutionStarted(@Param('id') id: string, @Param('requestId') requestId: string, @Body() body: ExecutionStartedInput) {
    return this.service.recordExecutionStarted(id, requestId, body);
  }

  // Point de passage juste avant l'écriture GitHub (appelé uniquement par n8n), pour vérifier qu'une
  // annulation n'est pas déjà en cours.
  @UseGuards(InternalSecretGuard)
  @Post(':id/remediation/:requestId/pre-write-gate')
  preWriteGate(@Param('id') id: string, @Param('requestId') requestId: string, @Body() body: PreWriteGateInput) {
    return this.service.preWriteGate(id, requestId, body);
  }

  // Annule une exécution WF2 en cours, à la demande de l'utilisateur.
  @UseGuards(JwtAuthGuard)
  @Post(':id/remediation/:requestId/cancel')
  cancelFixRequest(@Param('id') id: string, @Param('requestId') requestId: string, @Body() body: CancelFixRequestInput, @Req() req: any) {
    return this.service.cancelFixRequest(id, requestId, body || {}, req.user);
  }

  // Déclenche un build manuel, réservé aux rôles admin/developer (vérification de rôle faite ici, pas
  // dans le service).
  @UseGuards(JwtAuthGuard)
  @Post(':id/trigger-build') triggerBuild(@Param('id') id: string, @Req() req: any) {
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) throw new ForbiddenException('Action non autorisée');
    return this.service.triggerBuild(id);
  }
}
