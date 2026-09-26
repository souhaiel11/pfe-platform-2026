// V1.7 predeploy phase — minimal HTTP entry point for the dedicated
// builder/scanner worker. Plain Node `http`, no framework: exactly one
// business route (`POST /internal/build-scan`) for exactly one caller
// (candidate-verifier, over an isolated internal network). Network
// isolation was this route's ONLY trust boundary through the prior V1.7
// phase; the final predeploy phase adds application-level authentication
// on top of it (see internal-auth.ts) -- reusing the codebase's EXISTING
// shared-secret-header mechanism (backend/src/auth/internal-secret.guard.ts)
// rather than inventing a second kind of credential system, with its own
// dedicated secret so this trust boundary stays independent from the
// n8n->backend one.
//
// V1.7 final predeploy phase — this process now reads exactly ONE secret
// env var, BUILDER_INTERNAL_SECRET, used ONLY to authenticate the caller
// on /internal/build-scan (see internal-auth.ts). It still reads no
// DB_PASS, no JWT_SECRET, no N8N_INTERNAL_SECRET, no GitHub/Jenkins/Sonar
// credential of any kind. Its other env inputs are PORT, WORKSPACE_ROOT (a
// filesystem path it must share with candidate-verifier, read-only from
// its perspective -- it never creates or deletes workspaces, only builds/
// scans one it is pointed at) and SECURITY_TRIVY_CACHE_DIR. It makes NO
// remediation decision: it receives a workspace path and a time budget,
// and returns a structured build/scan result -- nothing else. This secret
// is NEVER forwarded into the podman/trivy subprocess environment (see
// security-artifact-validator.ts's own explicit env allowlist) and is
// never logged.
import * as http from 'http';
import { TrivyImageArtifactValidator } from './security-artifact-validator';
import { ArtifactRuntimeError } from '../../backend/src/security-remediation/security-artifact-scan';
import { checkTrivyCacheReadiness } from './trivy-readiness';
import { checkInternalAuth, INTERNAL_AUTH_HEADER } from './internal-auth';

const PORT = Number(process.env.PORT) || 4200;
const BUILDER_INTERNAL_SECRET = process.env.BUILDER_INTERNAL_SECRET;
const validator = new TrivyImageArtifactValidator();

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    // Phase B readiness gate: a container orchestrator (or a human, via
    // curl) can and should refuse to route real traffic here while this
    // reports unhealthy -- checked BEFORE worker readiness, exactly as
    // required, never silently bootstrapped by the first business call.
    const readiness = checkTrivyCacheReadiness(process.env.SECURITY_TRIVY_CACHE_DIR);
    sendJson(res, readiness.ready ? 200 : 503, readiness);
    return;
  }
  if (req.method === 'POST' && req.url === '/internal/build-scan') {
    // V1.7 final predeploy phase — Phase A: authenticate BEFORE reading the
    // request body at all (an unauthenticated caller's body is never even
    // buffered, let alone parsed or acted on) and BEFORE the Trivy
    // readiness check or anything else. Missing, wrong, and malformed
    // (non-string / array) credentials are all rejected the same way, by
    // the same fail-closed comparison used one hop up in the codebase.
    if (!checkInternalAuth(req.headers[INTERNAL_AUTH_HEADER], BUILDER_INTERNAL_SECRET)) {
      sendJson(res, 401, { ok: false, code: 'AUTH_REJECTED', stage: 'AUTH' });
      return;
    }
    try {
      const raw = await readBody(req);
      let body: any;
      try { body = JSON.parse(raw); }
      catch { sendJson(res, 400, { ok: false, code: 'MALFORMED_JSON_BODY', stage: 'REQUEST_PARSE' }); return; }
      // Narrow, structured input ONLY -- an identifier (a path this process
      // already has filesystem access to, via the SAME shared volume
      // candidate-verifier writes the already-authorized candidate into)
      // and a plain number. Never a command, never arbitrary shell text.
      if (!isNonEmptyString(body?.workspacePath)) {
        sendJson(res, 400, { ok: false, code: 'INVALID_REQUEST', stage: 'REQUEST_VALIDATE', reason: 'workspacePath is required.' });
        return;
      }
      if (body.budgetMs !== undefined && !(typeof body.budgetMs === 'number' && Number.isFinite(body.budgetMs) && body.budgetMs > 0)) {
        sendJson(res, 400, { ok: false, code: 'INVALID_REQUEST', stage: 'REQUEST_VALIDATE', reason: 'budgetMs must be a positive finite number when present.' });
        return;
      }
      // Fail closed, explicitly, BEFORE ever touching podman/trivy, rather
      // than letting the real scan hit Trivy's own confusing internal
      // FATAL error text -- "Do NOT allow first business evaluation to
      // perform implicit DB bootstrap" is enforced here, not just at
      // /healthz (defense in depth: this holds even if nothing ever polled
      // /healthz for this container).
      const readiness = checkTrivyCacheReadiness(process.env.SECURITY_TRIVY_CACHE_DIR);
      if (!readiness.ready) {
        sendJson(res, 200, { ok: false, code: 'TRIVY_DB_NOT_PROVISIONED', stage: 'TRIVY_READINESS', reason: readiness.reason });
        return;
      }
      const scan = validator.inspect(body.workspacePath, body.budgetMs);
      sendJson(res, 200, { ok: true, scan });
    } catch (err: any) {
      // Every failure this validator can throw is already an
      // ArtifactRuntimeError with a deterministic code/stage -- mapped
      // straight through, never collapsed into a generic 500 that would
      // lose the specific reason. Only a genuinely unanticipated exception
      // (a real bug) falls back to a generic infrastructure code.
      if (err instanceof ArtifactRuntimeError) {
        sendJson(res, 200, { ok: false, code: err.code, stage: err.stage, exitCode: err.exitCode });
      } else {
        sendJson(res, 200, { ok: false, code: 'RUNTIME_IO_FAILED', stage: 'BUILD_SCAN_HANDLER', reason: String(err?.message || err) });
      }
    }
    return;
  }
  sendJson(res, 404, { error: 'NOT_FOUND' });
});

server.listen(PORT, () => {
  console.log(`builder-scanner listening on port ${PORT}`);
});
