// Regroupe les traitements de Trivy préparation au déploiement.
import { execFileSync } from 'child_process';

export interface TrivyDbStatus {
  present: boolean;
  updatedAt: string | null;
  nextUpdate: string | null;
  stale: boolean;
}

export interface TrivyCacheReadiness {
  ready: boolean;
  reason: string | null;
  vulnDb: TrivyDbStatus;
  javaDb: TrivyDbStatus;
}

// Trivy's own observed refresh cadence this session: vuln DB NextUpdate is
// ~24h after UpdatedAt; Java DB is cached for ~3 days. One full missed
// refresh cycle of slack before declaring staleness a READINESS failure
// (not merely a warning) -- matches "too stale according to explicit
// policy", stated here explicitly rather than left implicit.
const VULN_DB_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const JAVA_DB_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

/** Analyse base de données Section. */
function parseDbSection(versionOutput: string, header: string): TrivyDbStatus {
  const section = versionOutput.split(header)[1];
  if (!section) return { present: false, updatedAt: null, nextUpdate: null, stale: true };
  const updatedAt = section.match(/UpdatedAt:\s*(.+)/)?.[1]?.trim() ?? null;
  const nextUpdate = section.match(/NextUpdate:\s*(.+)/)?.[1]?.trim() ?? null;
  if (!updatedAt) return { present: false, updatedAt: null, nextUpdate: null, stale: true };
  const updatedAtMs = Date.parse(updatedAt);
  const maxAgeMs = header === 'Java DB:' ? JAVA_DB_MAX_AGE_MS : VULN_DB_MAX_AGE_MS;
  const stale = !Number.isFinite(updatedAtMs) || (Date.now() - updatedAtMs) > maxAgeMs;
  return { present: true, updatedAt, nextUpdate, stale };
}

// Command-injection seam, same convention as builder-scanner/candidate-
// verifier's own ArtifactCommand -- a fault-test seam, never part of a real
// request path.
export type ReadinessCommand = (cacheDir?: string) => string;
/** Exécute la commande système utilisée par le contrôle. */
const defaultCommand: ReadinessCommand = (cacheDir?: string) => execFileSync('trivy', ['--version'], {
  encoding: 'utf8', timeout: 30_000,
  env: cacheDir ? { ...process.env, TRIVY_CACHE_DIR: cacheDir } : process.env,
});

/** Vérifie que le cache Trivy est prêt pour un scan. */
export function checkTrivyCacheReadiness(cacheDir?: string, command: ReadinessCommand = defaultCommand): TrivyCacheReadiness {
  let versionOutput: string;
  try {
    versionOutput = command(cacheDir);
  } catch (error: any) {
    return {
      ready: false, reason: `trivy --version failed: ${error?.message || 'unknown error'}`,
      vulnDb: { present: false, updatedAt: null, nextUpdate: null, stale: true },
      javaDb: { present: false, updatedAt: null, nextUpdate: null, stale: true },
    };
  }
  const vulnDb = parseDbSection(versionOutput, 'Vulnerability DB:');
  const javaDb = parseDbSection(versionOutput, 'Java DB:');
  const problems: string[] = [];
  if (!vulnDb.present) problems.push('vulnerability DB missing');
  else if (vulnDb.stale) problems.push('vulnerability DB stale');
  if (!javaDb.present) problems.push('Java DB missing');
  else if (javaDb.stale) problems.push('Java DB stale');
  return { ready: problems.length === 0, reason: problems.length ? problems.join('; ') : null, vulnDb, javaDb };
}
