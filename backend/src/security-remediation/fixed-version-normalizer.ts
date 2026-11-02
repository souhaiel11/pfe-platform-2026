/** Normalise la chaîne brute `fixedVersion` d'un scanner en tableau de versions candidates, sans jamais en deviner une en l'absence de données. */

/** Découpe la chaîne brute `fixedVersion` d'un scanner (séparée par des virgules) en tableau de versions candidates. */
export function parseFixedVersions(raw: string | null | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  return text
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}
