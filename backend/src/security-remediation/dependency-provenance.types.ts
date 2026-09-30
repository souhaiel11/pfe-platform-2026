// R-SEC-V1 — deterministic foundation for AI-assisted dependency-CVE
// remediation (Trivy/OWASP, Maven only this phase). Pure types; no I/O.
//
// Scope discipline for this phase, enforced by the classifier
// (security-eligibility-classifier.ts), never by convention alone:
//   - ONLY 'DIRECT_EXPLICIT' and 'PROPERTY_MANAGED' may become
//     AUTO_FIX_ELIGIBLE. 'BOM_MANAGED', 'TRANSITIVE', 'PLUGIN' and
//     'UNRESOLVED' always fall back to an existing non-auto remediation
//     type (DEVELOPER_ACTION_REQUIRED / ADMIN_ACTION_REQUIRED) — see R81's
//     own fail-closed precedent (generated-comment-guard.ts): an
//     unclassifiable/ambiguous input is a rejection, never a silent skip.

export type DependencyProvenanceKind =
  | 'DIRECT_EXPLICIT'
  | 'PROPERTY_MANAGED'
  | 'BOM_MANAGED'
  | 'TRANSITIVE'
  | 'PLUGIN'
  | 'UNRESOLVED'
  /**
   * V1.8 Phase 7B — the finding's own package is actually remediated by
   * editing a DIFFERENT coordinate entirely (the Maven <parent>), never by
   * touching this package's own declaration. Never produced by
   * resolveMavenProvenance()'s own dependency-tree/pom classification (that
   * function has no notion of a V1.8 plan) -- only ever set by
   * SecurityFindingDecisionService.decide()'s PARENT_VERSION branch, and
   * only when a ParentVersionRemediationPlan was actually supplied and the
   * real writer (maven-parent-patch-writer.ts) proved it applies. See this
   * kind's own SecurityFindingDecision.parentRemediationPlan/
   * parentPatchCandidate fields for the actual edit target/candidate --
   * never inferred from `package`/`installedVersion` on this record alone.
   */
  | 'PARENT_MANAGED';

/**
 * Grounded evidence for exactly where a Maven dependency's effective
 * version comes from. Every field here must be traced to real, fetched
 * content (pom.xml text, `mvn dependency:tree` output) at `groundedSha` —
 * never guessed. `controllingProperty`/`controllingElement` are null
 * whenever `kind` doesn't call for them (DIRECT_EXPLICIT has no property;
 * TRANSITIVE/UNRESOLVED have neither a controlling file nor element in
 * THIS repository).
 */
export interface DependencyProvenance {
  ecosystem: 'MAVEN';
  kind: DependencyProvenanceKind;
  /** groupId:artifactId — the canonical Maven coordinate, never a jar filename. */
  package: string;
  installedVersion: string;
  controllingFile: string | null;
  controllingElement: string | null;
  controllingProperty: string | null;
  /** Full 40-hex git SHA the provenance was resolved against — same discipline as CandidateManifest.candidateBaseSha. */
  groundedSha: string;
  /** Short human-readable trace of how `kind` was determined (e.g. the exact dependency:tree line, or the exact pom.xml fragment). Never fabricated. */
  evidence: string;
}
