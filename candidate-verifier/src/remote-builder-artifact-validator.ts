// V1.7 predeploy phase — candidate-verifier's own concrete
// SecurityArtifactValidator implementation, now an HTTP client to the
// dedicated builder/scanner service (builder-scanner/) instead of an
// in-process execFileSync of podman/trivy. This is the ONLY thing that
// changes for the orchestrator: same interface (`inspect(workspace,
// budgetMs)`), same SecurityArtifactScan return shape, same
// ArtifactRuntimeError vocabulary on failure -- every existing
// deadline-propagation / fail-closed / cleanup-ordering guarantee in
// security-remediation-orchestrator.service.ts is unchanged, because none
// of that logic lived in the removed TrivyImageArtifactValidator class
// itself; it lived in the orchestrator, which never knew or cared HOW
// inspect() was implemented.
//
// Trust model: network isolation (candidate-verifier and the builder share
// a dedicated internal Docker network no other service joins) was this
// call's ONLY trust boundary through the prior V1.7 phase. The final
// predeploy phase adds application-level authentication on top of it: a
// shared-secret `X-Internal-Secret` header, read from BUILDER_INTERNAL_SECRET
// -- the SAME mechanism the codebase already uses one hop up
// (backend/src/auth/internal-secret.guard.ts) rather than a second kind of
// credential system, but with its own dedicated secret value (never
// N8N_INTERNAL_SECRET itself) so the two trust domains stay independent.
// The header name 'x-internal-secret' is intentionally duplicated here
// rather than imported from builder-scanner/src/internal-auth.ts: this
// project's Docker image never bundles builder-scanner's source, exactly
// like backend's own two guards each already independently declare the
// same literal without a shared constants module.
import { SecurityArtifactScan, ArtifactRuntimeError, SecurityArtifactValidator } from './security-artifact-validator';
import { BACKEND_TRANSPORT_SLACK_MS, WORKER_DEADLINE_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

const DEFAULT_BUILDER_URL = 'http://builder-scanner:4200/internal/build-scan';
const INTERNAL_AUTH_HEADER = 'x-internal-secret';

// V1.7 final predeploy phase — Phase F: extracted to a pure, directly
// testable function (no HTTP round trip needed to exercise it). Same
// "never 0/negative, never silently unbounded" discipline as
// worker-deadline.ts's own budgetFor(): a budget that was actually PASSED
// (even one that floors to 0 or below, e.g. a caller entering with only
// microseconds left after its own expired() gate) is clamped to a floor of
// 1ms, NEVER silently upgraded to the full WORKER_DEADLINE_MS ceiling --
// only a budget that is genuinely ABSENT (undefined/NaN/non-finite) falls
// back to that default. Floored to an integer either way:
// deadline.remainingMs() is a sub-millisecond float by construction
// (hrtime-nanosecond-derived), and Node's execFileSync `timeout` option
// throws synchronously ("must be an unsigned integer") on a float.
export function effectiveBudgetMs(budgetMs: number | undefined): number {
  if (typeof budgetMs === 'number' && Number.isFinite(budgetMs)) {
    return Math.max(1, Math.floor(budgetMs));
  }
  return WORKER_DEADLINE_MS;
}

export class RemoteBuilderArtifactValidator implements SecurityArtifactValidator {
  constructor(
    private readonly builderUrl: string = process.env.BUILDER_SCANNER_URL || DEFAULT_BUILDER_URL,
    private readonly internalSecret: string | undefined = process.env.BUILDER_INTERNAL_SECRET,
  ) {}

  inspect(workspace: string, budgetMs?: number): SecurityArtifactScan {
    const effective = effectiveBudgetMs(budgetMs);
    const body = JSON.stringify({ workspacePath: workspace, budgetMs: effective });
    const result = syncPost(this.builderUrl, body, effective + BACKEND_TRANSPORT_SLACK_MS, this.internalSecret);
    if (result.ok !== true) {
      const code = result.code || 'RUNTIME_IO_FAILED';
      throw new ArtifactRuntimeError(code, result.stage || 'BUILDER_CALL', typeof result.exitCode === 'number' ? result.exitCode : undefined);
    }
    return result.scan as SecurityArtifactScan;
  }
}

// The orchestrator's whole call graph is deliberately synchronous
// (worker-deadline.ts's own header comment explains why: execFileSync
// blocks the event loop, and every deadline/cancellation guarantee in this
// codebase is built around that). Reaching the builder over HTTP from
// within that same synchronous call graph therefore needs a SYNCHRONOUS
// HTTP call -- Node has no built-in synchronous fetch, so this uses the
// same execFileSync-based approach every other subprocess call in this
// codebase already uses (maven-build-adapter.ts, the old
// TrivyImageArtifactValidator), here shelling out to curl rather than
// podman/trivy. curl's own --max-time enforces the timeout; a non-2xx or
// unreachable builder is reported the SAME ArtifactRuntimeError way any
// other runtime failure already is.
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
    // Deliberately NOT --fail-with-body: the builder always answers 200 for
    // a business-level build/scan failure, encoded IN the JSON body (`ok:
    // false`) -- the same convention candidate-verifier's own server.ts
    // already uses for /security-remediation/evaluate. An AUTH_REJECTED
    // (HTTP 401) response is parsed exactly the same way: curl has no
    // `--fail` flag here, so it still prints the JSON body regardless of
    // status code, and that body's `ok: false` maps to the same
    // ArtifactRuntimeError path as any other business-level failure below.
    // Only a genuinely unreachable/non-responding builder is a TRANSPORT
    // failure here.
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
