/** Expose les 2 endpoints internes réservés aux opérateurs pour créer/révoquer un plan de test E2E de relance de remédiation, protégés par un secret dédié. */
import { Body, CanActivate, Controller, ExecutionContext, Injectable, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { IsISO8601, IsUUID } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import { harnessEnabled } from './retry-e2e-harness.logic';
import { RetryE2EHarnessService } from './retry-e2e-harness.service';
@Injectable()
export class RetryE2EOperatorGuard implements CanActivate {
  /** Vérifie le secret opérateur en temps constant, et refuse tout accès (404) si le harnais de test n'est pas activé. */
  canActivate(context: ExecutionContext): boolean {
    if (!harnessEnabled()) throw new NotFoundException();
    const expected = process.env.SECURITY_REMEDIATION_E2E_OPERATOR_SECRET || '';
    const supplied = context.switchToHttp().getRequest().headers['x-e2e-operator-secret'];
    return expected.length >= 32 && typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(expected)
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }
}
export class CreateRetryE2EPlanDto { @IsUUID() projectId: string; @IsUUID() taskId: string; @IsISO8601() expiresAt: string; }
export class RevokeRetryE2EPlanDto { @IsUUID() planId: string; }
@Controller('internal/test')
@UseGuards(RetryE2EOperatorGuard)
export class RetryE2EHarnessController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: RetryE2EHarnessService) {}
  /** Crée un nouveau plan de test E2E isolé pour une tâche donnée, avec une expiration bornée. */
  @Post('retry-e2e-plan') create(@Body() dto: CreateRetryE2EPlanDto) { return this.service.create(dto.projectId, dto.taskId, dto.expiresAt); }
  /** Révoque un plan de test E2E existant. */
  @Post('retry-e2e-plan/revoke') revoke(@Body() dto: RevokeRetryE2EPlanDto) { return this.service.revoke(dto.planId); }
}
