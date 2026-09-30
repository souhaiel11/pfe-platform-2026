// V1.8 Phase 7 — §6: proves a PARENT_VERSION patch's REAL effect on the
// resolved dependency graph, never inferred from the parent version alone.
// A parent bump can fail to actually move a given dependency (a closer
// dependencyManagement entry, a BOM, or an explicit override elsewhere can
// all pin it) -- this only ever trusts a REAL `mvn dependency:tree` run
// against the candidate workspace (see mavenGraph(), already proven by
// maven-remediation-scope.ts), never the parent's own declared version as
// a proxy for what its managed dependencies actually resolved to.
import { mavenGraph } from './maven-remediation-scope';

export interface AffectedDependencyExpectation {
  /** groupId:artifactId */
  package: string;
  /** The resolved version V1.8 expects this package to have AFTER the parent bump (e.g. evidence.recommendedVersion / expectedResolvedDependency). */
  expectedVersion: string;
}

export type ParentEffectiveModelCheckReason =
  | 'EMPTY_OR_MALFORMED_DEPENDENCY_TREE'
  | 'DEPENDENCY_NOT_PRESENT_IN_CANDIDATE_TREE'
  | 'DEPENDENCY_VERSION_MISMATCH';

export type ParentEffectiveModelCheckResult =
  | { ok: true }
  | { ok: false; reason: ParentEffectiveModelCheckReason; detail: string };

/**
 * `candidateDependencyTree` = the REAL `mvn dependency:tree` output from the
 * PATCHED workspace (parent already bumped). For every CVE-affected
 * dependency V1.8's evidence names, proves it resolves in that REAL tree to
 * EXACTLY the version V1.8 expected -- never "some version", never assumed
 * from the parent bump succeeding structurally. A dependency absent from
 * the candidate tree, or present at any other version, fails closed.
 */
export function verifyParentUpgradeEffectiveVersions(
  candidateDependencyTree: string,
  affected: AffectedDependencyExpectation[],
): ParentEffectiveModelCheckResult {
  let graph: Map<string, string>;
  try {
    graph = mavenGraph(candidateDependencyTree);
  } catch (e: any) {
    return { ok: false, reason: 'EMPTY_OR_MALFORMED_DEPENDENCY_TREE', detail: String(e?.message || e) };
  }
  for (const dep of affected) {
    const resolved = graph.get(dep.package);
    if (resolved === undefined) {
      return { ok: false, reason: 'DEPENDENCY_NOT_PRESENT_IN_CANDIDATE_TREE', detail: `"${dep.package}" is not present in the candidate dependency tree at all -- cannot prove its resolved version.` };
    }
    if (resolved !== dep.expectedVersion) {
      return { ok: false, reason: 'DEPENDENCY_VERSION_MISMATCH', detail: `"${dep.package}" resolved to "${resolved}", expected "${dep.expectedVersion}".` };
    }
  }
  return { ok: true };
}
