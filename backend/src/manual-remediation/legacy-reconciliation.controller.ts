/** Expose les 3 actions de réconciliation des findings legacy (retrait du flux moderne, vérification et autorisation de réadmission), réservées aux administrateurs. */
import { Body, Controller, Param, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LegacyReconciliationService } from './legacy-reconciliation.service';
import { LegacyModernEligibilityDto, LegacyReconciliationDto } from './legacy-reconciliation.dto';
@Controller('manual-remediation/legacy-reconciliation')
@UseGuards(JwtAuthGuard)
export class LegacyReconciliationController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service:LegacyReconciliationService) {}
  /** Retire un groupe de findings legacy audités du flux de remédiation moderne, après vérification de leur empreinte attendue. */
  @Post(':groupId/reconcile')
  reconcile(@Param('groupId') groupId:string,@Body(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true})) body:LegacyReconciliationDto,@Req() req:any) {
    return this.service.reconcile(groupId,body.expectedGroupDigest,req.user);
  }
  /** Vérifie, sans rien modifier, si une tâche archivée legacy est éligible à une réadmission dans le flux moderne. */
  @Post(':groupId/eligibility')
  eligibility(@Param('groupId') groupId:string,@Body(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true})) body:LegacyModernEligibilityDto,@Req() req:any) {
    return this.service.eligibility(groupId,body.taskId,body.expectedArchiveDigest,req.user);
  }
  /** Autorise effectivement la réadmission moderne d'une tâche legacy (même contrôle que eligibility, mais écrit l'autorisation). */
  @Post(':groupId/authorize-modern')
  authorize(@Param('groupId') groupId:string,@Body(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true})) body:LegacyModernEligibilityDto,@Req() req:any) {
    return this.service.eligibility(groupId,body.taskId,body.expectedArchiveDigest,req.user,true);
  }
}
