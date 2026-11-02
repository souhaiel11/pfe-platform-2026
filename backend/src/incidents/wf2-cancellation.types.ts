// Types et validations pures pour l'annulation réelle d'une exécution WF2.
import { BadRequestException } from '@nestjs/common';
import { IsString, IsNotEmpty, MaxLength, Matches, IsInt, Min, Max, IsOptional, IsISO8601 } from 'class-validator';

export type FixRequestStatus =
  | 'FIX_STARTING' | 'DISPATCHED' | 'CANCEL_REQUESTED' | 'CANCELLED'
  | 'PR_CREATED' | 'FIX_FAILED' | 'VALIDATING' | 'VALIDATED' | 'COMPLETED' | 'REJECTED';

export const TERMINAL_FIX_REQUEST_STATUSES: FixRequestStatus[] =
  ['PR_CREATED', 'FIX_FAILED', 'VALIDATED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

/** Indique si un statut de demande de correction est terminal (ne doit plus jamais être écrasé). */
export function isTerminalFixRequestStatus(status: unknown): boolean {
  return TERMINAL_FIX_REQUEST_STATUSES.includes(String(status) as FixRequestStatus);
}

/** Vérifie qu'une valeur a bien la forme d'un identifiant d'exécution n8n valide (entier positif en chaîne). */
export function isPositiveN8nExecutionId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
}

export const CANCEL_REASON_MAX_LENGTH = 300;

/** Nettoie et tronque la raison d'annulation fournie par l'utilisateur à une longueur maximale sûre. */
export function boundedCancelReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, CANCEL_REASON_MAX_LENGTH);
}

export class ExecutionStartedInput {
  @IsString() @IsNotEmpty() @MaxLength(128) requestId: string;
  @IsString() @IsNotEmpty() @MaxLength(128) batchId: string;
  @IsInt() @Min(1) @Max(1000000) attemptCount: number;
  @IsString() @Matches(/^[1-9][0-9]{0,18}$/) executionId: string;
  @IsOptional() @IsISO8601() executionStartedAt?: string;
}

export class CancelFixRequestInput {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class PreWriteGateInput {
  @IsString() @IsNotEmpty() @MaxLength(128) requestId: string;
  @IsString() @IsNotEmpty() @MaxLength(128) batchId: string;
  @IsInt() @Min(1) @Max(1000000) attemptCount: number;
  @IsString() @Matches(/^[1-9][0-9]{0,18}$/) executionId: string;
}

/** Vérifie qu'une requête cible exactement la tentative de correction active (même requestId, batchId et numéro de tentative), jamais implicitement. */
export function matchesActiveAttempt(
  fix: any,
  requestId: unknown,
  batchId: unknown,
  attemptCount: unknown,
): boolean {
  return !!fix
    && fix.requestId === requestId
    && fix.batchId === batchId
    && typeof batchId === 'string' && batchId.length > 0
    && typeof attemptCount === 'number' && Number.isInteger(attemptCount) && attemptCount > 0
    && Number(fix.attemptCount) === Number(attemptCount);
}

export interface FixRequestCancellationFields {
  n8nExecutionId?: string;
  executionRegisteredAt?: string;
  cancelRequestedAt?: string;
  cancelledAt?: string;
  cancelReason?: string | null;
  lastHeartbeatAt?: string;
  executionPhase?: 'STARTED' | 'GIT_WRITE';
  sideEffectsStarted?: boolean;
  sideEffectsStartedAt?: string;
  lastCancelAttemptError?: string | null;
  lastCancelAttemptAt?: string;
}

/** Produit la version annulée d'une demande de correction (statut CANCELLED, tentative courante marquée annulée, retry réautorisé). */
export function cancelledFixRequest(fix: any, now: string) {
  return { ...fix, status: 'CANCELLED', cancelledAt: fix.cancelledAt || now, retryEligible: true,
    attempts: (Array.isArray(fix.attempts) ? fix.attempts : []).map((a: any) =>
      Number(a.attempt) === Number(fix.attemptCount) ? { ...a, status: 'CANCELLED', cancelledAt: now } : a) };
}

/** Valide qu'un identifiant de requête (requestId/batchId) est une chaîne non vide et raisonnablement bornée. */
export function validateRequestIdentifier(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new BadRequestException('Identifiant de correction invalide.');
}
/** Valide l'intégralité de l'identité d'exécution (requestId, batchId, numéro de tentative, executionId) avant d'accepter un callback n8n. */
export function validateExecutionBinding(input: ExecutionStartedInput | PreWriteGateInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Identité d’exécution invalide.');
  validateRequestIdentifier(input.requestId);
  validateRequestIdentifier(input.batchId);
  if (!Number.isInteger(input.attemptCount) || input.attemptCount < 1 || input.attemptCount > 1000000
    || !isPositiveN8nExecutionId(input.executionId)) throw new BadRequestException('Identité d’exécution invalide.');
}
