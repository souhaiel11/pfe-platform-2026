/** Expose la gestion des tâches de remédiation manuelle : liste, résumé, complétion/réouverture humaine, lancement de batch automatique, relance et récupération d'un dispatch WF6 bloqué. */
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ManualRemediationService } from './manual-remediation.service';
import { RetrySecurityRemediationDto } from './retry-security-remediation.dto';
import { ReconcileStaleWf6DispatchDto } from './reconcile-stale-wf6-dispatch.dto';

@ApiTags('Manual remediation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('manual-remediation')
export class ManualRemediationController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: ManualRemediationService) {}
  /** Liste les tâches de remédiation manuelle d'un projet, filtrables par statut/source/sévérité. */
  @Get() list(@Query('projectId') projectId: string, @Query('status') status?: string, @Query('source') source?: string, @Query('severity') severity?: string, @Query('includeV18') includeV18?: string) { return this.service.list(projectId, { status, source, severity, includeV18: includeV18 === 'true' }); }
  /** Liste les fichiers cibles réservés qui semblent bloqués (aucune tentative active n'avance plus). */
  @Get('stale-targets') staleTargets(@Req() req: any) { return this.service.staleTargets(req.user); }
  /** Abandonne volontairement la réservation d'un fichier cible pour relancer une remédiation bloquée. */
  @Post(':id/abandon-target') abandonTarget(@Param('id') id: string, @Body() body: { expectedAttemptId: string }, @Req() req: any) { return this.service.abandonTarget(id, body?.expectedAttemptId, req.user); }
  /** « Merge effectué » : constate sur GitHub, sans build, le merge de la PR de correction et libère le fichier traité. */
  @Post(':id/confirm-merge') confirmMerge(@Param('id') id: string, @Req() req: any) { return this.service.confirmPullRequestMerged(id, req.user); }
  /** Résumé agrégé (compteurs par statut/source) des tâches de remédiation d'un projet. */
  @Get('summary') summary(@Query('projectId') projectId: string) { return this.service.summary(projectId); }
  /** Marque manuellement une tâche comme traitée (fermeture humaine, hors flux automatique). */
  @Patch(':id/complete') complete(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: any) { return this.service.complete(id, req.user, body?.note); }
  /** Rouvre une tâche de remédiation précédemment close ou vérifiée. */
  @Patch(':id/reopen') reopen(@Param('id') id: string, @Req() req: any) { return this.service.reopen(id, req.user); }
  /** Lance une remédiation automatique groupée (un seul candidat/build/scan/PR) sur plusieurs findings sélectionnés. */
  @Post('launch-batch') launchBatch(@Body() body: { projectId: string; findingTaskIds: string[] }, @Req() req: any) {
    return this.service.launchBatchRemediation(body?.projectId, body?.findingTaskIds, req.user);
  }
  /** Relance une remédiation automatique précédemment échouée, avec vérification optionnelle de concurrence optimiste. */
  @Post(':id/retry') retry(@Param('id') id: string, @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) body: RetrySecurityRemediationDto, @Req() req: any) {
    return this.service.retrySecurityRemediation(id, body || {}, req.user);
  }
  /** Récupération réservée aux administrateurs d'un batch WF6 resté bloqué à l'état DISPATCHING. */
  @Post(':id/reconcile-stale-dispatch') reconcileStaleDispatch(@Param('id') id: string, @Body() body: ReconcileStaleWf6DispatchDto, @Req() req: any) {
    return this.service.reconcileStaleWf6Dispatch(id, body, req.user);
  }
}
