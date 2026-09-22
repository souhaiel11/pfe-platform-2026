// R-SEC-V1.3 §4/§9 — pure check: does a real `mvn dependency:tree
// -DoutputType=text` output actually resolve a given groupId:artifactId to
// a given version? No I/O here (the tree text itself is real, unmocked
// Maven output captured by candidate-verifier's MavenBuildAdapter) -- this
// is only the text-matching logic, factored out of what was previously
// inlined ad hoc in security-patch-real-proof.spec.ts so the orchestrator
// and its tests share exactly one implementation, never two that could drift.
//
// Real `mvn dependency:tree -DoutputType=text` lines look like:
//   "+- ch.qos.logback:logback-classic:jar:1.2.13:compile"
//   "\- ch.qos.logback:logback-classic:jar:1.2.13:compile" (last child)
// with leading indentation for nested depth. Anchored so e.g. "1.2.130"
// can never false-positive match a query for "1.2.13".
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function dependencyTreeResolvesTo(treeText: string, groupArtifact: string, version: string): boolean {
  if (!treeText || !groupArtifact || !version) return false;
  const pattern = new RegExp(`${escapeRegExp(groupArtifact)}:jar:${escapeRegExp(version)}(?:[:\\s]|$)`, 'm');
  return pattern.test(treeText);
}
