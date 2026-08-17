// Extraction deterministe (zero LLM) de la vraie cause d'echec depuis un log
// console Jenkins brut. Necessaire car un step 'sh' echoue en Groovy avec un
// message generique ("script returned exit code N") — le texte reel de
// l'erreur (stdout/stderr de la commande) n'existe QUE dans le log console,
// jamais dans l'exception Groovy capturable depuis le Jenkinsfile.
// Valide sur le log reel du build #18 (erreur mvnw) : extrait exactement
// "chmod: cannot access 'mvnw': No such file or directory", jamais le
// generique "script returned exit code 1" qui suit ~100 lignes plus loin.

const GENERIC_NOISE = /script returned exit code/i;

// Priorite decroissante : le plus specifique d'abord. Pour chaque niveau, on
// prend la PREMIERE occurrence chronologique dans le log (root cause, pas la
// consequence generique en fin de pipeline).
const ERROR_LINE_PATTERNS: RegExp[] = [
  /cannot access .*: No such file or directory/i,
  /No such file or directory/i,
  /No such DSL method ['"]?[\w-]+['"]? found/i,
  /UnsupportedClassVersionError/,
  /Invalid option type ['"]?[\w-]+['"]?/i,
  /BUILD FAILURE/,
  /^ERROR: .+/,
];

export function extractErrorFromConsoleLog(log: string): string | null {
  const lines = log.split('\n');
  for (const pattern of ERROR_LINE_PATTERNS) {
    for (const line of lines) {
      if (GENERIC_NOISE.test(line)) continue; // jamais la ligne generique, meme si elle matche un pattern large
      if (pattern.test(line)) {
        return line.replace(/^\[[0-9T:.\-Z]+\]\s*/, '').trim(); // retire l'horodatage Jenkins
      }
    }
  }
  return null;
}
