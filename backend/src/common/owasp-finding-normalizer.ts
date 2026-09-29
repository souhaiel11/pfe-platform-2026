/** Dependency-Check identity only. No advisory range is a source of fixed versions. */
export interface OwaspMavenIdentity {
  groupId: string;
  artifactId: string;
  installedVersion: string;
  pkg: string;
  purl: string;
}

export function resolveOwaspMavenIdentity(dependency: any): OwaspMavenIdentity | null {
  const identities = new Map<string, OwaspMavenIdentity>();
  for (const entry of Array.isArray(dependency?.packages) ? dependency.packages : []) {
    if (!['HIGH', 'HIGHEST'].includes(String(entry?.confidence || '').toUpperCase())) continue;
    const purl = String(entry?.id || '');
    const match = /^pkg:maven\/([^/]+)\/([^/@]+)@([^?#]+)(?:\?[^#]*)?(?:#.*)?$/.exec(purl);
    if (!match) continue;
    try {
      const [groupId, artifactId, installedVersion] = match.slice(1, 4).map(decodeURIComponent);
      if (![groupId, artifactId].every(value => /^[A-Za-z0-9_.-]+$/.test(value))) continue;
      if (!/^[A-Za-z0-9_.+-]+$/.test(installedVersion)) continue;
      const pkg = `${groupId}:${artifactId}`;
      identities.set(`${pkg}@${installedVersion}`, { groupId, artifactId, installedVersion, pkg, purl });
    } catch { /* Malformed percent encoding: unresolved, never infer from the JAR. */ }
  }
  // Other ecosystems and low-confidence entries do not displace a unique Maven
  // identity. Multiple distinct credible Maven identities remain ambiguous.
  return identities.size === 1 ? [...identities.values()][0] : null;
}

export function normalizeOwaspFinding(dependency: any, vulnerability: any): any {
  const identity = resolveOwaspMavenIdentity(dependency);
  const severity = String(vulnerability?.severity || 'UNKNOWN').toUpperCase();
  const ruleOrCve = String(vulnerability?.name || '');
  const fileName = dependency?.fileName || null;
  return {
    id: ruleOrCve, ruleOrCve, cve: ruleOrCve, stage: 'owasp', source: 'OWASP',
    severity, category: 'DEPENDENCY', title: ruleOrCve || 'Dependency vulnerability',
    description: String(vulnerability?.description || '').substring(0, 400),
    file: fileName, fileName, line: null,
    // Retained only to locate the pre-enrichment task; never used to parse GAV.
    legacyPackage: fileName, dependency: fileName,
    packageType: identity ? 'maven' : null,
    pkg: identity?.pkg || fileName, package: identity?.pkg || fileName,
    purl: identity?.purl || null, groupId: identity?.groupId || null,
    artifactId: identity?.artifactId || null,
    installedVersion: identity?.installedVersion || null,
    fixedVersion: null, recommendation: null,
    evidence: vulnerability?.references?.[0]?.url || null,
    primaryUrl: vulnerability?.references?.[0]?.url || null,
    cvss: vulnerability?.cvssv3?.baseScore ?? vulnerability?.cvssv2?.score ?? null,
    blocking: severity === 'CRITICAL', remediationType: 'DEVELOPER_ACTION_REQUIRED',
  };
}
