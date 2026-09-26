// V1.7 Phase B — the Trivy DB bootstrap contract, enforced.
//
// Fact, reproduced for real this predeploy phase: a genuinely fresh Trivy
// cache has NEITHER the vulnerability DB NOR the Java DB, and the
// production adapter's own --skip-db-update/--skip-java-db-update flags
// both FATAL-error on a true first run ("--skip-db-update cannot be
// specified on the first run"). Per the recommended contract (persistent
// cache volume, populated once out-of-band, checked for readiness BEFORE
// the worker accepts real evaluation traffic; incomplete/missing/stale
// fails closed; no evaluation itself ever triggers an implicit download):
// this module is that check, reused by both the HTTP /healthz endpoint AND
// server.ts's own build-scan handler (defense in depth -- fails closed even
// if whatever orchestrates this container never polls /healthz at all).
//
// Deliberately parses `trivy --version`'s own stable, documented,
// human-readable output (Vulnerability DB / Java DB sections) rather than
// reaching into Trivy's private on-disk cache file format, which carries no
// compatibility guarantee across versions.
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
const defaultCommand: ReadinessCommand = (cacheDir?: string) => execFileSync('trivy', ['--version'], {
  encoding: 'utf8', timeout: 30_000,
  // TRIVY_CACHE_DIR is Trivy's OWN native env var (Cobra's standard
  // flag<->env binding for its --cache-dir flag) -- deliberately NOT our
  // wrapper name SECURITY_TRIVY_CACHE_DIR (security-artifact-validator.ts's
  // env allowlist explicitly excludes forwarding any raw TRIVY_* override
  // from the calling process's own env into the scan, precisely to avoid
  // an uncontrolled option escaping into that call; setting it HERE,
  // explicitly, for the readiness probe only, is not that -- without this,
  // `trivy --version` would silently check its own default
  // $HOME/.cache/trivy instead of the actually-configured cache volume
  // whenever SECURITY_TRIVY_CACHE_DIR differs from that default, as it
  // does in the real deployed configuration.
  env: cacheDir ? { ...process.env, TRIVY_CACHE_DIR: cacheDir } : process.env,
});

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
