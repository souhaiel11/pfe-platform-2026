// Regroupe les traitements de finding tâche identifiant enrichment.
import { findingFingerprint } from './finding-fingerprint';

export type FindingTaskIdLookup = (fingerprint: string) => string | null;

/** Ajoute `findingTaskId` à chaque CVE d'un bloc scanner (trivy/owasp), retrouvé via son empreinte. */
function tagCves(block: any, source: 'TRIVY' | 'OWASP', lookup: FindingTaskIdLookup): any {
  if (!block || !Array.isArray(block.cves)) return block;
  return {
    ...block,
    cves: block.cves.map((cve: any) => ({ ...cve, findingTaskId: lookup(findingFingerprint(source, cve)) ?? null })),
  };
}

/** Enrichit les blocs trivy/owasp d'un enrichedData avec le findingTaskId de chaque CVE ; renvoie tel quel si enrichedData est absent. */
export function withFindingTaskIds(enrichedData: any, lookup: FindingTaskIdLookup): any {
  if (!enrichedData) return enrichedData;
  return {
    ...enrichedData,
    trivy: tagCves(enrichedData.trivy, 'TRIVY', lookup),
    owasp: tagCves(enrichedData.owasp, 'OWASP', lookup),
  };
}
