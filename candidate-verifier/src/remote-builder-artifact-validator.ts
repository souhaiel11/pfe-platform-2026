// Délègue la construction et le scan au service builder-scanner.
import { SecurityArtifactScan, ArtifactRuntimeError, SecurityArtifactValidator } from './security-artifact-validator';
import { OwaspRescanner } from './owasp-rescan';
import { BACKEND_TRANSPORT_SLACK_MS, WORKER_DEADLINE_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

const DEFAULT_BUILDER_URL = 'http://builder-scanner:4200/internal/build-scan';
const INTERNAL_AUTH_HEADER = 'x-internal-secret';

/** Renvoie effectif budget de temps millisecondes pour le traitement ou l’affichage. */
export function effectiveBudgetMs(budgetMs: number | undefined): number {
  if (typeof budgetMs === 'number' && Number.isFinite(budgetMs)) {
    return Math.max(1, Math.floor(budgetMs));
  }
  return WORKER_DEADLINE_MS;
}

export class RemoteBuilderArtifactValidator implements SecurityArtifactValidator {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private readonly builderUrl: string = process.env.BUILDER_SCANNER_URL || DEFAULT_BUILDER_URL,
    private readonly internalSecret: string | undefined = process.env.BUILDER_INTERNAL_SECRET,
    private readonly owaspScanner: OwaspRescanner = new OwaspRescanner(),
  ) {}

  /** Inspecte les données ou l’artefact pour en tirer des preuves. */
  inspect(workspace: string, budgetMs?: number, targetCves?: string[]): SecurityArtifactScan {
    const started = Date.now();
    const effective = effectiveBudgetMs(budgetMs);
    const body = JSON.stringify({ workspacePath: workspace, budgetMs: effective });
    const result = syncPost(this.builderUrl, body, effective + BACKEND_TRANSPORT_SLACK_MS, this.internalSecret);
    if (result.ok !== true) {
      const code = result.code || 'RUNTIME_IO_FAILED';
      throw new ArtifactRuntimeError(code, result.stage || 'BUILDER_CALL', typeof result.exitCode === 'number' ? result.exitCode : undefined);
    }
    const scan = result.scan as SecurityArtifactScan;
    if (targetCves !== undefined) {
      const owasp = this.owaspScanner.inspect(workspace, targetCves, effective - (Date.now() - started));
      if (owasp.sourceDigest !== scan.sourceDigest) throw new ArtifactRuntimeError('SCANNER_MUTATED_SOURCE', 'OWASP_SOURCE_CHECK');
      return Object.assign(scan, {owasp});
    }
    return scan;
  }
}

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

interface BuilderCallResult {
  ok: boolean;
  scan?: unknown;
  code?: string;
  stage?: string;
  exitCode?: number;
}

/** Envoie une requête interne synchrone et lit son résultat. */
function syncPost(url: string, body: string, timeoutMs: number, internalSecret: string | undefined): BuilderCallResult {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  // The auth header value is written to a mode-0600 temp file and handed to
  // curl via its own -K/--config option rather than as a `-H` argv entry:
  // argv is visible to any other process on the host (via `ps` or
  // /proc/<pid>/cmdline), and unlike BUILDER_SCANNER_URL this is a secret,
  // never logged and never belonging on a command line. The config file is
  // removed in `finally`, whether the call succeeds, fails, or throws.
  const configDir = mkdtempSync(path.join(tmpdir(), 'builder-auth-'));
  const configPath = path.join(configDir, 'curl.conf');
  try {
    const headerLines = ['header = "Content-Type: application/json"'];
    if (internalSecret) headerLines.push(`header = "${INTERNAL_AUTH_HEADER}: ${internalSecret}"`);
    writeFileSync(configPath, headerLines.join('\n') + '\n', { mode: 0o600 });
    const stdout = execFileSync('curl', [
      '--silent', '--show-error',
      '--max-time', String(timeoutSeconds),
      '-X', 'POST', '-K', configPath,
      '--data-binary', '@-',
      url,
    ], {
      input: body, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
      // Node's own timeout/killSignal as a second, independent enforcement
      // on top of curl's --max-time -- the same belt-and-suspenders
      // discipline every other subprocess call in this codebase already
      // uses (maven-build-adapter.ts, the former in-process Trivy adapter).
      timeout: timeoutMs, killSignal: 'SIGKILL',
    });
    try { return JSON.parse(stdout); }
    catch { return { ok: false, code: 'RUNTIME_COMMAND_FAILED', stage: 'BUILDER_RESPONSE_PARSE' }; }
  } catch (error: any) {
    const timedOut = error?.signal === 'SIGTERM' || error?.status === 28;
    return { ok: false, code: timedOut ? 'RUNTIME_OPERATION_TIMEOUT' : 'RUNTIME_EXECUTABLE_UNAVAILABLE', stage: 'BUILDER_CALL' };
  } finally {
    try { rmSync(configDir, { recursive: true, force: true }); } catch { /* best-effort cleanup only */ }
  }
}
