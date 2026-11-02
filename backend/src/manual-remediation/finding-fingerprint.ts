// Calcule une empreinte stable d'un finding à partir de son identité et de son emplacement pour le comparer entre observations.
import { createHash } from 'crypto';

/** Calcule une empreinte stable et comparable pour un finding de sécurité, indépendante du scanner d'origine. */
function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalise une URL (retire le hash, trie les paramètres) pour que deux URLs équivalentes donnent la même empreinte. */
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

/** Calcule l'empreinte SHA-256 d'un finding à partir de ses champs stables (hors version/sévérité/id scanner, qui peuvent changer entre deux builds). */
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
