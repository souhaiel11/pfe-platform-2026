// Increment 1 (sélection multiple CVE, cadrage OPTION A) — expose
// findingTaskId sur chaque CVE Trivy/OWASP renvoyée par GET /incidents, pour
// que le frontend n'ait plus à re-découvrir la correspondance CVE <->
// ManualRemediationTask par un matching de chaînes fragile côté client (voir
// cve-table.component.ts::taskFor(), qui reste inchangé et continue de
// servir le flux "traiter manuellement" existant).
//
// Additif strict : chaque objet CVE ne gagne QUE le champ `findingTaskId`
// (string | null) ; aucun champ existant n'est renommé, retiré ou modifié.
// Pure, testable indépendamment de TypeORM -- l'appelant (ManualRemediation
// Service.attachFindingTaskIds) fait le seul I/O (une requête groupée) puis
// délègue ici le calcul.
//
// La correspondance réutilise EXACTEMENT findingFingerprint(), la même
// fonction déjà canonique pour créer/dédupliquer les ManualRemediationTask
// (manual-remediation.service.ts::reconcileSource(), index unique
// (projectId, findingFingerprint)) -- jamais une seconde règle de matching
// divergente. Elle est volontairement appelée directement sur les objets CVE
// BRUTS de enrichedData.trivy/owasp.cves (sans repasser par
// normalizeReport()) : findingFingerprint() tolère déjà indifféremment la
// forme native Trivy (VulnerabilityID/PkgName) et la forme normalisée
// (id/pkg) via ses propres chaînes de repli -- les deux produisent le MÊME
// hash pour un même finding réel (voir finding-task-id-enrichment.spec.ts,
// "parité brut vs normalisé", qui prouve cette hypothèse plutôt que de la
// supposer).
import { findingFingerprint } from './finding-fingerprint';

export type FindingTaskIdLookup = (fingerprint: string) => string | null;

function tagCves(block: any, source: 'TRIVY' | 'OWASP', lookup: FindingTaskIdLookup): any {
  if (!block || !Array.isArray(block.cves)) return block;
  return {
    ...block,
    cves: block.cves.map((cve: any) => ({ ...cve, findingTaskId: lookup(findingFingerprint(source, cve)) ?? null })),
  };
}

/**
 * `enrichedData` peut être `null`/`undefined` (incident sans metadata) --
 * renvoyé tel quel, jamais une forme inventée. `sonar`/`zap`/tout autre champ
 * n'est jamais touché : seuls `trivy.cves`/`owasp.cves` gagnent le nouveau
 * champ.
 */
export function withFindingTaskIds(enrichedData: any, lookup: FindingTaskIdLookup): any {
  if (!enrichedData) return enrichedData;
  return {
    ...enrichedData,
    trivy: tagCves(enrichedData.trivy, 'TRIVY', lookup),
    owasp: tagCves(enrichedData.owasp, 'OWASP', lookup),
  };
}
