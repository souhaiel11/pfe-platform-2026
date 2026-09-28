// Online warm-up uses only the verified baseline checkout and approved GAVs.
// The offline probe always runs; its usable output is the sufficiency gate.
// A failed probe is classified using warm-up health before any cache-miss
// diagnosis. Unknown warm-up failures remain infrastructure failures.
import { MavenBuildAdapter, WarmupResult, DependencyTreeResult } from './maven-build-adapter';
import { createWorkerDeadline } from './worker-deadline';

const WARMUP_STAGE_CAP_MS = 120_000;
const OFFLINE_ANALYSIS_STAGE_CAP_MS = 60_000;
const TOTAL_BUDGET_MS = 300_000;

export interface WarmupFailureReason {
  code: 'WARMUP_TIMEOUT' | 'WARMUP_NETWORK_FAILURE' | 'WARMUP_FAILED';
  detail: string;
  retryable: true;
}

export interface WarmedDependencyTreeResult {
  outcome: 'ANALYSIS_SUCCESS' | 'ANALYSIS_FAILED' | 'INFRASTRUCTURE_FAILURE';
  baselineWarmup: WarmupResult;
  targetWarmups: Array<{ gav: string; result: WarmupResult }>;
  analysis: DependencyTreeResult;
  infrastructureFailure?: WarmupFailureReason;
}

/** baselineWorkspacePath MUST be the verified baseline, never a patched
 * candidate. Targets are resolved there too, regardless of baseline warm-up
 * success. No build lifecycle goals are introduced. */
export function resolveDependencyTreeOffline(
  adapter: MavenBuildAdapter,
  baselineWorkspacePath: string,
  analysisWorkspacePath: string,
  targetGavs: string[],
  overallBudgetMs: number = TOTAL_BUDGET_MS,
): WarmedDependencyTreeResult {
  const deadline = createWorkerDeadline(overallBudgetMs);
  // Reserve up to 60s (half of a short budget) for the probe. Share the
  // remaining warm-up allowance across baseline + targets, never reset it.
  const analysisReserveMs = Math.min(OFFLINE_ANALYSIS_STAGE_CAP_MS, deadline.totalBudgetMs / 2);
  const warmupBudget = (stepsLeft: number) => Math.max(1, Math.min(WARMUP_STAGE_CAP_MS,
    Math.floor((deadline.remainingMs() - analysisReserveMs) / stepsLeft)));
  const baselineWarmup = adapter.dependencyGoOffline(baselineWorkspacePath, warmupBudget(targetGavs.length + 1));
  const targetWarmups = targetGavs.map((gav, i) => ({
    gav, result: adapter.resolveArtifact(baselineWorkspacePath, gav, warmupBudget(targetGavs.length - i)),
  }));
  const analysis = adapter.dependencyTree(analysisWorkspacePath, deadline.budgetFor(OFFLINE_ANALYSIS_STAGE_CAP_MS), { offline: true });
  const evidence = { baselineWarmup, targetWarmups, analysis };
  if (analysis.status === 'SUCCESS' && analysis.text !== null) {
    return { ...evidence, outcome: 'ANALYSIS_SUCCESS' };
  }

  const warmups = [baselineWarmup, ...targetWarmups.map(t => t.result)];
  // Explicit infrastructure evidence outranks unknown and non-network
  // failures, including when it comes from a later target warm-up.
  const timedOut = warmups.find(w => w.timedOut);
  const network = warmups.find(w => w.networkFailure);
  const ambiguous = warmups.find(w => w.status !== 'SUCCESS' && !w.resolutionFailure);
  const infrastructureFailure: WarmupFailureReason | undefined = timedOut
    ? { code: 'WARMUP_TIMEOUT', detail: timedOut.evidenceTail, retryable: true }
    : network
      ? { code: 'WARMUP_NETWORK_FAILURE', detail: network.evidenceTail, retryable: true }
      : ambiguous
        ? { code: 'WARMUP_FAILED', detail: ambiguous.evidenceTail || 'Warm-up failed for an unknown reason.', retryable: true }
        : undefined;
  return { ...evidence, outcome: infrastructureFailure ? 'INFRASTRUCTURE_FAILURE' : 'ANALYSIS_FAILED', infrastructureFailure };
}
