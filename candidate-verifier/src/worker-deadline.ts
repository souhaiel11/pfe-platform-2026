// Borne chaque étape au temps restant et arrête les traitements trop longs.
import { WORKER_DEADLINE_MS, MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';
export { WORKER_DEADLINE_MS, MIN_STAGE_BUDGET_MS };
export const DEFAULT_WORKER_BUDGET_MS = WORKER_DEADLINE_MS;
export const MAX_WORKER_BUDGET_MS = WORKER_DEADLINE_MS;

export interface WorkerDeadline {
  readonly totalBudgetMs: number;
  /** Calcule le temps écoulé depuis le début. */
  elapsedMs(): number;
  /** Calcule le temps restant avant l’échéance. */
  remainingMs(): number;
  /** Indique si le temps restant est inférieur au minimum exigé. */
  expired(minimumMs?: number): boolean;
  /** Borne le délai d’une étape sans laisser zéro désactiver la limite. */
  budgetFor(capMs: number): number;
}

class MonotonicWorkerDeadline implements WorkerDeadline {
  private readonly startedAtNs: bigint;
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(public readonly totalBudgetMs: number) {
    this.startedAtNs = process.hrtime.bigint();
  }
  /** Calcule le temps écoulé depuis le début. */
  elapsedMs(): number {
    return Number(process.hrtime.bigint() - this.startedAtNs) / 1_000_000;
  }
  /** Calcule le temps restant avant l’échéance. */
  remainingMs(): number {
    return Math.max(0, this.totalBudgetMs - this.elapsedMs());
  }
  /** Indique si le temps restant est inférieur au minimum exigé. */
  expired(minimumMs: number = MIN_STAGE_BUDGET_MS): boolean {
    return this.remainingMs() < minimumMs;
  }
  /** Borne le délai d’une étape au temps encore disponible. */
  budgetFor(capMs: number): number {
    // Un délai nul supprimerait la limite : conserver au moins 1 ms et vérifier le budget avant l’appel.
    return Math.max(1, Math.min(capMs, Math.floor(this.remainingMs())));
  }
}

/** Crée un délai global borné pour la vérification. */
export function createWorkerDeadline(requestedMs?: number): WorkerDeadline {
  const requested = typeof requestedMs === 'number' && Number.isFinite(requestedMs) && requestedMs > 0
    ? requestedMs : DEFAULT_WORKER_BUDGET_MS;
  return new MonotonicWorkerDeadline(Math.min(requested, MAX_WORKER_BUDGET_MS));
}
