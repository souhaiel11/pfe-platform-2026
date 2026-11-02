/** Dérive le verdict de fermeture d'un lot de CVE à partir de deux scans Trivy réels (baseline avant patch, candidat après le build partagé). */
import { SecurityArtifactScan } from './security-artifact-scan';
import { CveClosureStatus } from './security-remediation-batch-orchestration.types';

export interface BatchClosureFindingVerdict {
  cveId: string;
  status: CveClosureStatus;
}

export interface BatchClosureVerdict {
  perCve: BatchClosureFindingVerdict[];
  /** true uniquement quand CHAQUE CVE cible a résolu à CLOSED. */
  allClosed: boolean;
}

/** Détermine le statut de fermeture d'une CVE : STILL_OPEN si encore présente dans le candidat, CLOSED si présente en baseline mais absente du candidat, NOT_OBSERVED si jamais confirmée en baseline. */
export function deriveCveClosureStatus(cveId: string, baselineCveIds: ReadonlySet<string>, candidateCveIds: ReadonlySet<string>): CveClosureStatus {
  const stillPresent = candidateCveIds.has(cveId);
  if (stillPresent) return 'STILL_OPEN';
  return baselineCveIds.has(cveId) ? 'CLOSED' : 'NOT_OBSERVED';
}

/** Calcule le verdict de fermeture global d'un lot de CVE cibles, en dérivant le statut de chacune puis le tout-ou-rien du lot entier. */
export function deriveBatchClosureVerdict(targetCveIds: string[], baselineCveIds: Iterable<string>, candidateCveIds: Iterable<string>): BatchClosureVerdict {
  const baseline = new Set(baselineCveIds), candidate = new Set(candidateCveIds);
  const perCve = targetCveIds.map(cveId => ({ cveId, status: deriveCveClosureStatus(cveId, baseline, candidate) }));
  return { perCve, allClosed: perCve.length > 0 && perCve.every(x => x.status === 'CLOSED') };
}

/** Extrait l'ensemble complet des identifiants de vulnérabilité présents dans un scan Trivy d'image, sans filtrer sur une CVE particulière. */
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
