import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IncidentsService } from './incidents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtOrInternalSecretGuard } from '../auth/jwt-or-internal-secret.guard';
import { InternalSecretGuard } from '../auth/internal-secret.guard';

@ApiTags('Incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}
  // JwtOrInternalSecretGuard (pas JwtAuthGuard seul) : le node "Get Incidents"
  // de WF-Chat-V4 appelle cette route côté n8n sans session utilisateur —
  // même pattern que PUT :id (WF2/WF3). Élargit le blast radius de
  // N8N_INTERNAL_SECRET (encore un endpoint déverrouillé) — tracé comme
  // raison supplémentaire de rotation avant Azure (P1, cf. rapport soutenance).
  @UseGuards(JwtOrInternalSecretGuard)
  @Get() findAll(@Query('projectId') projectId?: string, @Query('status') status?: string, @Query('size') size?: number) { return this.service.findAll(projectId, status, size); }
  @UseGuards(JwtAuthGuard)
  @Get('project/:projectId/cycles') convergence(@Param('projectId') projectId: string) { return this.service.convergence(projectId); }
  @UseGuards(JwtAuthGuard)
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @UseGuards(JwtAuthGuard)
  @Post() create(@Body() dto: any) { return this.service.create(dto); }
  @UseGuards(JwtOrInternalSecretGuard)
  @Put(':id') update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @UseGuards(InternalSecretGuard)
  @Post(':id/validation') saveValidation(@Param('id') id: string, @Body() validation: any) { return this.service.saveValidation(id, validation); }
  @UseGuards(InternalSecretGuard)
  @Post(':id/workflow-status') saveWorkflowStatus(@Param('id') id: string, @Body() status: any) {
    return this.service.saveWorkflowBatchStatus(id, status);
  }
  @UseGuards(JwtAuthGuard)
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }

  @UseGuards(JwtAuthGuard)
  @Post(':id/approve') approveFix(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.approveFix(id, req.user, body || {});
  }
  @UseGuards(JwtAuthGuard)
  @Post(':id/retry') retryFix(@Param('id') id: string, @Req() req: any) {
    return this.service.retryFix(id, req.user);
  }
  // R21-AE — explicit admin action only. The stale threshold is a
  // precondition; no scheduler invokes this endpoint automatically.
  @UseGuards(JwtAuthGuard)
  @Post(':id/remediation/:requestId/reconcile-stale-dispatch')
  reconcileStaleDispatch(@Param('id') id: string, @Param('requestId') requestId: string,
    @Body() body: any, @Req() req: any) {
    return this.service.reconcileStaleDispatch(id, requestId, body || {}, req.user);
  }
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation') requestPrValidation(@Param('id') id: string, @Req() req: any) {
    return this.service.requestPrValidation(id, req.user);
  }
  // R21-AS — read/heal-only: proves and, if needed, fixes the Jenkins
  // PFE_VALIDATION_CONTEXT bootstrap gap without issuing a crumb or queuing a
  // build. Never mutates prValidationRequest. Same guard as requestPrValidation.
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/ensure-parameter') ensurePrValidationBootstrap(@Param('id') id: string, @Req() req: any) {
    return this.service.ensurePrValidationBootstrap(id, req.user);
  }
  // R42A — réconciliation gouvernée d'une validation PR restée QUEUED/RUNNING
  // face à un build Jenkins déjà terminal sans callback reçu. Ne déclenche
  // jamais Jenkins ; lecture seule côté Jenkins, une seule écriture DB via le
  // service. Même garde que requestPrValidation (admin/developer).
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/reconcile') reconcilePrValidation(@Param('id') id: string, @Req() req: any) {
    return this.service.reconcilePrValidation(id, req.user);
  }
  // R65 — action gouvernée explicite pour accepter un commit de remédiation
  // suivant légitime (même PR, même branche) comme nouvelle cible de
  // validation, sans jamais écraser fixRequest.prHeadSha (provenance
  // d'origine). Ne déclenche jamais Jenkins/WF1/WF3. Même garde que
  // requestPrValidation (admin/developer).
  @UseGuards(JwtAuthGuard)
  @Post(':id/pr-validation/refresh-target') refreshPrValidationTarget(@Param('id') id: string, @Req() req: any) {
    return this.service.refreshPrValidationTarget(id, req.user);
  }
  // BRIQUE 5 — explicit human authorization for exactly ONE causal
  // corrective attempt on the SAME PR/lineage. Same guard as
  // requestPrValidation/refreshPrValidationTarget (admin/developer). Never
  // exposes n8n directly: frontend -> backend -> WF2, this endpoint is the
  // only path.
  @UseGuards(JwtAuthGuard)
  @Post(':id/correct-and-revalidate') correctAndRevalidate(@Param('id') id: string, @Req() req: any) {
    return this.service.correctAndRevalidate(id, req.user);
  }
  @UseGuards(JwtAuthGuard)
  @Post(':id/reject') rejectFix(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.rejectFix(id, req.user, body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/trigger-build') triggerBuild(@Param('id') id: string, @Req() req: any) {
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) throw new ForbiddenException('Action non autorisée');
    return this.service.triggerBuild(id);
  }
}
