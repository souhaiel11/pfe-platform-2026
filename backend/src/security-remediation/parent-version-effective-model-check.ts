/** Prouve, à partir d'un arbre de dépendances réel post-patch, l'effet concret d'une bascule de version du `<parent>` sur les dépendances gérées — jamais déduit de la seule version du parent. */
import { mavenGraph } from './maven-remediation-scope';

export interface AffectedDependencyExpectation {
  /** groupId:artifactId */
  package: string;
  /** Version résolue que V1.8 attend pour ce paquet après la bascule du parent. */
  expectedVersion: string;
}

export type ParentEffectiveModelCheckReason =
  | 'EMPTY_OR_MALFORMED_DEPENDENCY_TREE'
  | 'DEPENDENCY_NOT_PRESENT_IN_CANDIDATE_TREE'
  | 'DEPENDENCY_VERSION_MISMATCH';

export type ParentEffectiveModelCheckResult =
  | { ok: true }
  | { ok: false; reason: ParentEffectiveModelCheckReason; detail: string };

/** Vérifie que chaque dépendance affectée par une bascule de version du parent résout bien, dans l'arbre réel du candidat patché, à la version exacte attendue — refuse si absente ou différente. */
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
