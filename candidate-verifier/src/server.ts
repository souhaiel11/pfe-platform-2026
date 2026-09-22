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
import { MavenBuildAdapter } from './maven-build-adapter';
import { GroundedMavenProvenanceService } from './grounded-maven-provenance.service';
import { SecurityFindingDecisionService } from './security-finding-decision.service';
import { SecurityRemediationOrchestratorService } from './security-remediation-orchestrator.service';
import { VerificationRequest, assertHeadVerificationRequest, assertVerificationStep } from '../../backend/src/candidate-verification/candidate-verification.types';
import { assertSecurityRemediationOrchestrationInput, SecurityRemediationRequestValidationError } from '../../backend/src/security-remediation/security-remediation-orchestration.types';

const PORT = Number(process.env.PORT) || 4100;
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || undefined;
const REPO_CACHE_ROOT = process.env.REPO_CACHE_ROOT || undefined;

// R-SEC-V1.4 §4 — the security-remediation orchestrator reuses the SAME
// WorkspaceManager/RepoCacheService instances (same WORKSPACE_ROOT/
// REPO_CACHE_ROOT config, no new env var) as the existing candidate-
// verification executor above. No collision risk: workspace identities are
// namespaced by requestId/batchId/candidateAttempt/verificationStep, and
// the two flows never share those values -- if they ever did,
// createWorkspace() fails loudly (WORKSPACE_CREATION_FAILED), never
// silently corrupts state.
const workspaceManager = new WorkspaceManager(WORKSPACE_ROOT as any);
const repoCache = new RepoCacheService(REPO_CACHE_ROOT as any);
const mavenAdapter = new MavenBuildAdapter();

const executor = new CandidateVerificationExecutor(
  workspaceManager,
  new CandidateMaterializer(),
  repoCache,
);

const securityOrchestrator = new SecurityRemediationOrchestratorService(
  new SecurityFindingDecisionService(new GroundedMavenProvenanceService(workspaceManager, repoCache, mavenAdapter)),
  workspaceManager,
  repoCache,
  mavenAdapter,
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
  if (req.method === 'POST' && req.url === '/verify') {
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
      try { assertVerificationStep(body.verificationStep, body.options?.mode); } catch {
        sendJson(res, 400, { error: 'INVALID_PROGRESSIVE_VERIFICATION_REQUEST' });
        return;
      }
      const result = executor.execute(body.manifest, { allowedPaths: body.allowedPaths, timeoutMs: body.options?.timeoutMs,
        mode: body.options?.mode, verificationStep: body.verificationStep });
      sendJson(res, 200, result);
    } catch (err: any) {
      // A truly unexpected internal error (bug, not a candidate defect) --
      // reported as a 500 so the backend's client classifies it as
      // VERIFIER_PROTOCOL_ERROR, never as a candidate FAIL.
      sendJson(res, 500, { error: 'INTERNAL_WORKER_ERROR', message: String(err?.message || err) });
    }
    return;
  }

  // R-SEC-V1.4 §4 — the ONE new worker route this phase adds. Input comes
  // ONLY from the backend's own trusted resolution (SecurityRemediationController
  // over the same isolated internal network as /verify) -- this route does
  // no business-trust decision itself, it only validates SHAPE and forwards
  // to SecurityRemediationOrchestratorService, unmodified, per §4's own
  // instruction not to duplicate orchestration logic here.
  if (req.method === 'POST' && req.url === '/security-remediation/evaluate') {
    try {
      const raw = await readBody(req);
      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: 'MALFORMED_JSON_BODY' });
        return;
      }
      try {
        assertSecurityRemediationOrchestrationInput(body);
      } catch (err) {
        if (err instanceof SecurityRemediationRequestValidationError) {
          sendJson(res, 400, { error: 'INVALID_SECURITY_REMEDIATION_REQUEST', message: err.message });
          return;
        }
        throw err;
      }
      const result = securityOrchestrator.orchestrate(body);
      sendJson(res, 200, result);
    } catch (err: any) {
      sendJson(res, 500, { error: 'INTERNAL_WORKER_ERROR', message: String(err?.message || err) });
    }
    return;
  }

  sendJson(res, 404, { error: 'NOT_FOUND' });
});

server.listen(PORT, () => {
  console.log(`candidate-verifier listening on port ${PORT}`);
});
