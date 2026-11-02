// Extrait de façon déterministe (aucun LLM) la vraie cause d'échec depuis un log console Jenkins brut.

const GENERIC_NOISE = /script returned exit code/i;

// Motifs du plus spécifique au plus générique ; pour chaque niveau on garde la première occurrence
// chronologique (la cause racine, pas la conséquence générique en fin de pipeline).
const ERROR_LINE_PATTERNS: RegExp[] = [
  /cannot access .*: No such file or directory/i,
  /No such file or directory/i,
  /No such DSL method ['"]?[\w-]+['"]? found/i,
  /UnsupportedClassVersionError/,
  /Invalid option type ['"]?[\w-]+['"]?/i,
  /BUILD FAILURE/,
  /^ERROR: .+/,
];

/** Extrait erreur depuis console journal. */
export function extractErrorFromConsoleLog(log: string): string | null {
  const lines = log.split('\n');
  for (const pattern of ERROR_LINE_PATTERNS) {
    for (const line of lines) {
      if (GENERIC_NOISE.test(line)) continue;
      if (pattern.test(line)) {
        return line.replace(/^\[[0-9T:.\-Z]+\]\s*/, '').trim();
      }
    }
  }
  return null;
}
