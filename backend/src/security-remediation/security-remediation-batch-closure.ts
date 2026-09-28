// Increment 1 — §4 "intersection des ensembles Trivy baseline/candidat".
// Pure: takes two already-extracted sets of CVE ids (baseline scan, before
// any patch; candidate scan, after the ONE shared build) and the list of
// CVEs this batch targets, and derives a per-CVE closure status plus the
// global tout-ou-rien verdict. No I/O, no scan parsing here — see
// allVulnerabilityIds() below for the one bit of real extraction, reusing
// the EXISTING SecurityArtifactScan shape (security-artifact-scan.ts)
// unchanged.
import { SecurityArtifactScan } from './security-artifact-scan';
import { CveClosureStatus } from './security-remediation-batch-orchestration.types';

export interface BatchClosureFindingVerdict {
  cveId: string;
  status: CveClosureStatus;
}

export interface BatchClosureVerdict {
  perCve: BatchClosureFindingVerdict[];
  /** true only when EVERY targetCve resolved to CLOSED — §3's global tout-ou-rien. */
  allClosed: boolean;
}

/**
 * A CVE that was never proven present in the BASELINE scan can never be
 * honestly reported "CLOSED" by this batch (closure means "was present,
 * now absent") — NOT_OBSERVED reflects that the scanner never actually
 * confirmed this target, distinct from a genuine fix. Mirrors the same
 * "never claim more than was proven" discipline as provesSecurityClosure()
 * in the singular flow.
 */
export function deriveCveClosureStatus(cveId: string, baselineCveIds: ReadonlySet<string>, candidateCveIds: ReadonlySet<string>): CveClosureStatus {
  const stillPresent = candidateCveIds.has(cveId);
  if (stillPresent) return 'STILL_OPEN';
  return baselineCveIds.has(cveId) ? 'CLOSED' : 'NOT_OBSERVED';
}

export function deriveBatchClosureVerdict(targetCveIds: string[], baselineCveIds: Iterable<string>, candidateCveIds: Iterable<string>): BatchClosureVerdict {
  const baseline = new Set(baselineCveIds), candidate = new Set(candidateCveIds);
  const perCve = targetCveIds.map(cveId => ({ cveId, status: deriveCveClosureStatus(cveId, baseline, candidate) }));
  return { perCve, allClosed: perCve.length > 0 && perCve.every(x => x.status === 'CLOSED') };
}

/**
 * Every VulnerabilityID present anywhere in a Trivy image-archive scan
 * report, regardless of which CVE(s) this batch targets — the same
 * fail-closed shape checks as cveTargets() (security-artifact-scan.ts),
 * minus the single-CVE filter, since a batch verdict needs the FULL set to
 * intersect against N target CVEs at once, not one at a time.
 */
export function allVulnerabilityIds(scan: SecurityArtifactScan): Set<string> {
  if (!scan.buildPassed || scan.mode !== 'TRIVY_IMAGE_ARCHIVE'
    || scan.report?.SchemaVersion !== 2 || scan.report?.ArtifactType !== 'container_image'
    || !Array.isArray(scan.report.Results)) {
    throw new Error('INCOMPLETE_SECURITY_SCAN');
  }
  const ids = new Set<string>();
  for (const r of scan.report.Results) {
    if (!r || typeof r.Target !== 'string') throw new Error('MALFORMED_OR_FILTERED_SECURITY_SCAN');
    if (r.Vulnerabilities !== undefined && r.Vulnerabilities !== null && !Array.isArray(r.Vulnerabilities)) throw new Error('MALFORMED_SECURITY_SCAN');
    for (const v of r.Vulnerabilities ?? []) {
      if (!v || typeof v.VulnerabilityID !== 'string') throw new Error('MALFORMED_SECURITY_SCAN');
      ids.add(v.VulnerabilityID);
    }
  }
  return ids;
}
