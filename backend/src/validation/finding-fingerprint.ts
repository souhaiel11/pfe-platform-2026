// Identité canonique, technologiquement neutre, d'un finding scanner.

export interface FingerprintableFinding {
  source: string;
  rule: string;
  path: string;
}

// Normalise un chemin brut de scanner : retire le préfixe "<projectKey>:", uniformise
// les séparateurs, et met en minuscules.
export function normalizeFindingPath(path: string): string {
  return String(path || '')
    .replace(/^[^:]*:/, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

/** Calcule l'identité canonique d'un finding (source::règle::chemin normalisé), stable entre deux analyses indépendantes et insensible au déplacement de ligne. */
export function computeFindingFingerprint(finding: FingerprintableFinding): string | null {
  const source = String(finding.source || '').trim().toUpperCase();
  const rule = String(finding.rule || '').trim();
  const path = normalizeFindingPath(finding.path);
  if (!source || !rule || !path) return null;
  return `${source}::${rule}::${path}`;
}
