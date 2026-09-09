// R22-E2C2 — minimal HTTP entry point for the candidate-verifier worker.
// Deliberately plain Node `http`, no framework: this worker exposes exactly
// one route to exactly one caller (the backend, over an isolated internal
// network per R22-E2C1 Phase 5/7 -- network isolation IS the trust boundary
// here, not a shared secret), so a full web framework would be
// "unnecessary packages" for what this is.
//
// This process reads NO secret env vars. Its only env inputs are PORT and
// WORKSPACE_ROOT/REPO_CACHE_ROOT (plain configuration, never a credential).
import 'reflect-metadata';
import * as http from 'http';
import { CandidateVerificationExecutor } from './candidate-verification-executor';
import { WorkspaceManager } from './workspace-manager.service';
import { CandidateMaterializer } from './candidate-materializer.service';
import { RepoCacheService } from './repo-cache.service';
import { VerificationRequest, assertHeadVerificationRequest } from '../../backend/src/candidate-verification/candidate-verification.types';

const PORT = Number(process.env.PORT) || 4100;
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || undefined;
const REPO_CACHE_ROOT = process.env.REPO_CACHE_ROOT || undefined;

const executor = new CandidateVerificationExecutor(
  new WorkspaceManager(WORKSPACE_ROOT as any),
  new CandidateMaterializer(),
  new RepoCacheService(REPO_CACHE_ROOT as any),
);

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

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/verify') {
    sendJson(res, 404, { error: 'NOT_FOUND' });
    return;
  }
  try {
    const raw = await readBody(req);
    let body: VerificationRequest;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'MALFORMED_JSON_BODY' });
      return;
    }
    if (body?.verifyHeadOnly === true) {
      try { assertHeadVerificationRequest(body); } catch {
        sendJson(res, 400, { error: 'INVALID_HEAD_VERIFICATION_REQUEST' });
        return;
      }
      sendJson(res, 200, executor.executeHead(body));
      return;
    }
    if (!body?.manifest || !Array.isArray(body.manifest.files)) {
      sendJson(res, 400, { error: 'MANIFEST_REQUIRED' });
      return;
    }
    const result = executor.execute(body.manifest, { allowedPaths: body.allowedPaths, timeoutMs: body.options?.timeoutMs });
    sendJson(res, 200, result);
  } catch (err: any) {
    // A truly unexpected internal error (bug, not a candidate defect) --
    // reported as a 500 so the backend's client classifies it as
    // VERIFIER_PROTOCOL_ERROR, never as a candidate FAIL.
    sendJson(res, 500, { error: 'INTERNAL_WORKER_ERROR', message: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`candidate-verifier listening on port ${PORT}`);
});
