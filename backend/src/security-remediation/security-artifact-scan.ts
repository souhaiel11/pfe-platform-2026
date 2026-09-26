// V1.7 predeploy phase — extracted verbatim from candidate-verifier/src/
// security-artifact-validator.ts (its original, single home) so BOTH
// candidate-verifier (the orchestrator's own source-digest binding checks
// and the SecurityArtifactValidator contract it calls through) and the NEW
// dedicated builder/scanner (builder-scanner/, the only place that now
// actually execs podman/trivy) can import the SAME pure, dependency-free
// implementations instead of two independently-maintained copies. Nothing
// here spawns a subprocess itself beyond `git ls-files` (read-only,
// harmless, identical to what it always did) -- no podman, no trivy, no
// network. That real execution lives ONLY in builder-scanner/src/
// security-artifact-validator.ts now.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CveTarget, MavenRemediationScope } from './maven-remediation-scope';

export interface SecurityArtifactScan {
  mode: 'TRIVY_IMAGE_ARCHIVE';
  sourceDigest: string;
  artifactDigest: string;
  reportDigest: string;
  buildPassed: boolean;
  scannerVersion: string;
  report: any;
  timings?: Record<string, number>;
}

export class ArtifactRuntimeError extends Error {
  constructor(public readonly code: string, public readonly stage: string, public readonly exitCode?: number) {
    super(`${code}:${stage}`); this.name = 'ArtifactRuntimeError';
  }
}

export function trackedSourceDigest(workspace: string): string {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: workspace, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  if (!paths.length) throw new Error('NO_TRACKED_SOURCE');
  const hash = createHash('sha256');
  for (const p of paths) {
    const full = path.join(workspace, p);
    if (!fs.lstatSync(full).isFile()) throw new Error('NON_REGULAR_SOURCE_FILE');
    hash.update(p + '\0'); hash.update(fs.readFileSync(full)); hash.update('\0');
  }
  return hash.digest('hex');
}

export function cveTargets(scan: SecurityArtifactScan, cve: string): CveTarget[] {
  if (!scan.buildPassed || scan.mode !== 'TRIVY_IMAGE_ARCHIVE'
    || !/^[0-9a-f]{64}$/.test(scan.artifactDigest) || !/^[0-9a-f]{64}$/.test(scan.reportDigest)
    || !scan.scannerVersion || scan.report?.SchemaVersion !== 2 || scan.report?.ArtifactType !== 'container_image'
    || !Array.isArray(scan.report.Results) || !scan.report.Results.length
    || !scan.report.Results.some((r: any) => r.Type === 'jar' && Array.isArray(r.Packages) && r.Packages.length)) {
    throw new Error('INCOMPLETE_SECURITY_SCAN');
  }
  const result: CveTarget[] = [];
  for (const r of scan.report.Results) {
    if (!r || typeof r.Target !== 'string'
      || (r.Packages !== undefined && !Array.isArray(r.Packages))
      || (r.ModifiedFindings !== undefined && (!Array.isArray(r.ModifiedFindings) || r.ModifiedFindings.length))) {
      throw new Error('MALFORMED_OR_FILTERED_SECURITY_SCAN');
    }
    if (r.Vulnerabilities !== undefined && r.Vulnerabilities !== null && !Array.isArray(r.Vulnerabilities)) throw new Error('MALFORMED_SECURITY_SCAN');
    for (const v of r.Vulnerabilities ?? []) {
      if (!v || typeof v.VulnerabilityID !== 'string') throw new Error('MALFORMED_SECURITY_SCAN');
      if (v.VulnerabilityID !== cve) continue;
      if (!v.PkgName || !v.InstalledVersion) throw new Error('INCOMPLETE_CVE_MATCH');
      result.push({ package: v.PkgName, installedVersion: v.InstalledVersion,
        fixedVersions: typeof v.FixedVersion === 'string' ? v.FixedVersion.split(/[,\s]+/).filter(Boolean) : [],
        location: [r.Target, v.PkgPath].filter(Boolean).join(':') });
    }
  }
  return result.sort((a, b) => (a.package + a.location).localeCompare(b.package + b.location));
}

export function provesSecurityClosure(scan: SecurityArtifactScan, scope: MavenRemediationScope): boolean {
  try {
    if (cveTargets(scan, scope.targetCve).length !== 0) return false;
    const packages = scan.report.Results.flatMap((r: any) => r.Packages ?? []);
    return scope.affectedPackages.every(p => {
      const found = packages.filter((x: any) => x.Name === p.package);
      return found.length > 0 && found.every((x: any) => x.Version === p.targetVersion);
    });
  } catch { return false; }
}
