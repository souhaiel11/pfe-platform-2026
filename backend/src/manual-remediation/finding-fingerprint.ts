import { createHash } from 'crypto';

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizedUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    url.searchParams.sort();
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return norm(value).replace(/\/$/, '');
  }
}

/**
 * Stable identity across builds (SHA-256 of non-secret canonical facts):
 * TRIVY = source + CVE/advisory + package; OWASP = source + CVE + dependency;
 * ZAP = source + alert/rule + normalized URL + parameter;
 * SONAR = source + rule + file. Version, severity and scanner finding IDs are
 * deliberately excluded because they may legitimately change between builds.
 */
export function findingFingerprint(sourceValue: unknown, finding: any): string {
  const source = norm(sourceValue || finding?.source).toUpperCase();
  let parts: string[];
  if (source === 'ZAP') {
    parts = [source, norm(finding?.rule || finding?.alertRef || finding?.pluginid || finding?.id || finding?.title || finding?.name), normalizedUrl(finding?.url), norm(finding?.param || finding?.parameter)];
  } else if (source === 'SONAR' || source === 'SONARQUBE') {
    parts = ['SONARQUBE', norm(finding?.rule || finding?.ruleKey || finding?.id), norm(finding?.file || finding?.component)];
  } else {
    parts = [source, norm(finding?.id || finding?.VulnerabilityID || finding?.cve || finding?.name), norm(finding?.pkg || finding?.PkgName || finding?.package || finding?.fileName || finding?.dependency)];
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
