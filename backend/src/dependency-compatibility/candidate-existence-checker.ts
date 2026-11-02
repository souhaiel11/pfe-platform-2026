// Prouve qu'un artefact/version candidat existe réellement dans un dépôt accessible au projet, avant de passer à toute validation en bac à sable.
import { execFileSync } from 'child_process';

export type CandidateExistenceStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN_REPOSITORY_ACCESS';

export interface CandidateExistenceResult {
  coordinate: string;
  status: CandidateExistenceStatus;
  detail: string;
}

export interface CandidateExistenceChecker {
  /** Vérifie que la version candidate existe dans le dépôt Maven. */
  check(groupId: string, artifactId: string, version: string): CandidateExistenceResult;
}

const CREDENTIAL_LINE_RE = /(username|password|token|authorization)\s*[:=]/i;

// Nettoie la sortie de `mvn` : retire toute ligne ressemblant à un identifiant/secret
// et ne garde qu'une courte trace bornée.
function scrub(output: string): string {
  return output
    .split('\n')
    .filter(line => !CREDENTIAL_LINE_RE.test(line))
    .slice(-6)
    .join('\n')
    .slice(0, 800);
}

export class MavenDependencyGetExistenceChecker implements CandidateExistenceChecker {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly cwd: string, private readonly timeoutMs = 30000, private readonly offline = false) {}

  /** Lance un vrai mvn dependency:get pour la coordonnée donnée et classe le résultat en AVAILABLE/UNAVAILABLE/UNKNOWN_REPOSITORY_ACCESS selon le message d'erreur réel. */
  check(groupId: string, artifactId: string, version: string): CandidateExistenceResult {
    const coordinate = `${groupId}:${artifactId}:${version}`;
    const args = ['-q', '-B', 'dependency:get', `-Dartifact=${coordinate}`, '-Dtransitive=false'];
    if (this.offline) args.push('-o');
    try {
      execFileSync('mvn', args, { cwd: this.cwd, timeout: this.timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
      return { coordinate, status: 'AVAILABLE', detail: `mvn dependency:get succeeded for ${coordinate}.` };
    } catch (err: any) {
      const output = String(err?.stdout ?? '') + String(err?.stderr ?? '');
      if (err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT') {
        return { coordinate, status: 'UNKNOWN_REPOSITORY_ACCESS', detail: `mvn dependency:get timed out after ${this.timeoutMs}ms -- repository access could not be confirmed either way.` };
      }
      if (/Could not find artifact|was not found in|404|Failure to find .* was cached in the local repository/.test(output)) {
        return { coordinate, status: 'UNAVAILABLE', detail: `mvn dependency:get: artifact ${coordinate} not found in any configured repository.` };
      }
      if (/Could not transfer|Connection|UnknownHostException|repository metadata|I\/O error|in offline mode/i.test(output)) {
        return { coordinate, status: 'UNKNOWN_REPOSITORY_ACCESS', detail: `mvn dependency:get: repository access error (network/mirror) -- cannot confirm existence either way.\n${scrub(output)}` };
      }
      return { coordinate, status: 'UNKNOWN_REPOSITORY_ACCESS', detail: `mvn dependency:get failed for an unrecognized reason -- never assumed AVAILABLE or UNAVAILABLE without a clear signal.\n${scrub(output)}` };
    }
  }
}
