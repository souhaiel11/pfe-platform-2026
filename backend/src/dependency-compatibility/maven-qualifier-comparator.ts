// Comparateur de versions Maven conscient des qualificatifs (alpha/beta/milestone/ rc/snapshot/ga/sp), additif et séparé du comparateur de production.
export type MavenVersionComparison = -1 | 0 | 1 | 'INCOMPARABLE';

type Token = { kind: 'NUM'; value: number } | { kind: 'QUALIFIER'; value: string; rank: number | null };

const KNOWN_QUALIFIER_RANK: Record<string, number> = {
  alpha: -5, a: -5,
  beta: -4, b: -4,
  milestone: -3, m: -3,
  rc: -2, cr: -2,
  snapshot: -1,
  '': 0, ga: 0, final: 0, release: 0,
  sp: 1,
};

// Met en minuscules un qualificatif pour le comparer à la table de rangs connue.
function normalizeQualifier(raw: string): string {
  return raw.toLowerCase();
}

// Découpe une chaîne de version en jetons numériques/qualificatifs alternés, comme
// le ferait le tokenizer réel de Maven pour le cas courant.
export function tokenizeMavenVersion(raw: string): Token[] {
  const tokens: Token[] = [];
  const normalized = String(raw ?? '').trim();
  const segments = normalized.split(/[.\-_]/).filter(s => s.length > 0);
  for (const segment of segments) {
    const parts = segment.match(/\d+|[A-Za-z]+/g) ?? [];
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        tokens.push({ kind: 'NUM', value: parseInt(part, 10) });
      } else {
        const q = normalizeQualifier(part);
        tokens.push({ kind: 'QUALIFIER', value: q, rank: q in KNOWN_QUALIFIER_RANK ? KNOWN_QUALIFIER_RANK[q] : null });
      }
    }
  }
  return tokens;
}

// Indique si un jeton est un qualificatif de pré-version (alpha/beta/milestone/rc/snapshot).
function isPreRelease(token: Token | undefined): boolean {
  return !!token && token.kind === 'QUALIFIER' && token.rank !== null && token.rank < 0;
}

/** Compare deux chaînes de version Maven. */
export function compareMavenVersions(rawA: string, rawB: string): MavenVersionComparison {
  const a = tokenizeMavenVersion(rawA);
  const b = tokenizeMavenVersion(rawB);
  if (!a.length || !b.length) return 'INCOMPARABLE';

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ta = a[i];
    const tb = b[i];
    if (ta && tb) {
      if (ta.kind === 'NUM' && tb.kind === 'NUM') {
        if (ta.value !== tb.value) return ta.value > tb.value ? 1 : -1;
        continue;
      }
      if (ta.kind === 'QUALIFIER' && tb.kind === 'QUALIFIER') {
        if (ta.rank === null || tb.rank === null) {
          if (ta.value === tb.value) continue;
          return 'INCOMPARABLE';
        }
        if (ta.rank !== tb.rank) return ta.rank > tb.rank ? 1 : -1;
        continue;
      }
      const numToken = ta.kind === 'NUM' ? ta : (tb as Token);
      const qualToken = ta.kind === 'NUM' ? tb : ta;
      if (qualToken.kind !== 'QUALIFIER' || qualToken.rank === null) return 'INCOMPARABLE';
      const numIsA = ta.kind === 'NUM';
      if (qualToken.rank < 0) return numIsA ? 1 : -1;
      if (qualToken.rank > 0) return numIsA ? -1 : 1;
      continue;
    }
    const longerSide = ta ? a : b;
    const extra = longerSide.slice(Math.min(a.length, b.length));
    /** Vérifie l’état suivant : Neutral. */
    const isNeutral = (t: Token) => (t.kind === 'NUM' && t.value === 0) || (t.kind === 'QUALIFIER' && t.rank === 0);
    if (extra.every(isNeutral)) continue;
    if (extra.every(t => isNeutral(t) || isPreRelease(t))) return ta ? -1 : 1;
    return ta ? 1 : -1;
  }
  return 0;
}
