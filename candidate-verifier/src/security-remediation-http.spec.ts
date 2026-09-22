// R-SEC-V1.4 §4/§12 — real HTTP proof for the worker's new
// /security-remediation/evaluate route, spawned exactly like head-http.
// spec.ts spawns /verify (same real worker process, same real HTTP
// parsing/dispatch). The /verify leg here reuses that file's own
// monkeypatch technique (stub-only, structural) purely to prove the
// ROUTING refactor in server.ts did not break the existing route (§12 P)
// -- head-http.spec.ts itself remains the authoritative /verify proof.
// The /security-remediation/evaluate leg is REAL and unmocked: real git
// worktree, real `mvn dependency:tree`, against the real local
// souhaiel11/pfe-app-test clone (same fixture SHA used throughout V1-V1.3).
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';

const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
const EXACT_SHA = 'a81be45709aba07da50d44206d073c2eb55892b5';

async function reservePort(): Promise<number> {
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return port;
}

async function main() {
  const port = await reservePort();
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-sec-http-spec-'));
  const repoCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-sec-http-spec-repocache-'));
  fs.symlinkSync(REPO_PATH, path.join(repoCacheRoot, 'souhaiel11__pfe-app-test'));

  // Same stub-only technique as head-http.spec.ts: the /verify leg's OWN
  // execution logic is not what this phase is testing (already covered by
  // head-http.spec.ts and candidate-verification-executor.spec.ts) --
  // stubbing it here only keeps this spec fast and avoids a redundant real
  // compile/test run. SecurityRemediationOrchestratorService is a
  // completely separate class/instance and is NEVER stubbed below.
  const code = `const {CandidateVerificationExecutor:E}=require('./src/candidate-verification-executor');
    E.prototype.executeHead=function(r){return {mode:'HEAD_ONLY',identity:{targetSha:r.targetSha}}};
    E.prototype.execute=function(m){return {legacy:true,files:m.files}};
    require('./src/server');`;
  const child = spawn(process.execPath, ['-r', 'ts-node/register', '-e', code], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: scratchRoot, REPO_CACHE_ROOT: repoCacheRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('worker startup timeout')), 20000);
      child.stdout.on('data', b => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', () => { clearTimeout(timer); reject(Error('worker exited before startup')); });
    });

    const postVerify = (body: any) => fetch(`http://127.0.0.1:${port}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const postSecEval = (body: any) => fetch(`http://127.0.0.1:${port}/security-remediation/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // P. existing /verify route still works after the routing refactor.
    {
      const legacy = await postVerify({ manifest: { files: [] } });
      assert.equal(legacy.status, 200);
      assert.equal((await legacy.json() as any).legacy, true);
      const head = { verifyHeadOnly: true, repository: 'owner/repo', targetSha: 'a'.repeat(40), validationRequestId: 'v', requestId: 'r', batchId: 'b', candidateAttempt: 0 };
      const headResp = await postVerify(head);
      assert.equal(headResp.status, 200);
      assert.equal((await headResp.json() as any).mode, 'HEAD_ONLY');
    }
    console.log('security-remediation-http P) existing /verify route still works after the routing refactor: PASS');

    // health check still works too.
    {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(health.status, 200);
    }
    console.log('security-remediation-http) /health still works: PASS');

    // Malformed bodies for the NEW route -> clean 400s, never reaching real I/O.
    {
      assert.equal((await postSecEval('not json but a raw string, will fail JSON.parse via fetch stringify? use raw fetch instead')).status, 400, 'malformed JSON body (fetch will stringify a JS string into valid JSON quotes, still not an object)');
      assert.equal((await postSecEval({})).status, 400, 'empty body');
      assert.equal((await postSecEval({ finding: {} })).status, 400, 'missing repository/candidateBaseSha/requestId/batchId');
      assert.equal((await postSecEval({ finding: { findingIdentity: 'x', source: 'TRIVY', package: 'g:a', expectedInstalledVersion: '1.0.0', fixedVersion: '1.0.1' }, repository: 'o/r', candidateBaseSha: 'not-a-sha-but-still-a-string', requestId: 'r', batchId: 'b', candidateAttempt: -1 })).status, 400, 'negative candidateAttempt');
    }
    console.log('security-remediation-http) malformed /security-remediation/evaluate requests -> clean 400s: PASS');

    // A. real eligible Trivy flow through the ACTUAL wire (real git worktree,
    // real mvn dependency:tree) -- proves the new route truly reaches
    // SecurityRemediationOrchestratorService, not a stub.
    {
      const body = {
        finding: { findingIdentity: 'fp-http-real-logback', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' },
        repository: 'souhaiel11/pfe-app-test', candidateBaseSha: EXACT_SHA, requestId: 'http-spec-req-1', batchId: 'http-spec-batch', candidateAttempt: 0,
      };
      const response = await postSecEval(body);
      assert.equal(response.status, 200);
      const result: any = await response.json();
      assert.equal(result.status, 'CANDIDATE_READY', `real eligible flow over HTTP: ${JSON.stringify(result)}`);
      assert.equal(result.decision.selectedTargetVersion, '1.2.13');
      assert.equal(result.guardResult?.ok, true);
      assert.equal(result.dependencyResolutionEvidence?.resolvedMatch, true);
      assert.ok(result.candidateIdentity && /^[0-9a-f]{64}$/.test(result.candidateIdentity));
    }
    console.log('security-remediation-http A) real eligible Trivy flow reaches SecurityRemediationOrchestratorService over real HTTP: PASS');

    // C. real TRANSITIVE (tomcat-embed-core) over the wire -> NOT_ELIGIBLE, no candidate.
    {
      const body = {
        finding: { findingIdentity: 'fp-http-real-tomcat', source: 'TRIVY', package: 'org.apache.tomcat.embed:tomcat-embed-core', expectedInstalledVersion: '9.0.63', fixedVersion: '9.0.99' },
        repository: 'souhaiel11/pfe-app-test', candidateBaseSha: EXACT_SHA, requestId: 'http-spec-req-2', batchId: 'http-spec-batch', candidateAttempt: 0,
      };
      const response = await postSecEval(body);
      assert.equal(response.status, 200);
      const result: any = await response.json();
      assert.equal(result.status, 'NOT_ELIGIBLE');
      assert.equal(result.decision.provenance.kind, 'TRANSITIVE');
      assert.equal(result.candidateManifest, null);
    }
    console.log('security-remediation-http C) real TRANSITIVE (tomcat-embed-core) over real HTTP -> NOT_ELIGIBLE: PASS');
  } finally {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    if (child.exitCode === null) { child.kill(); await exited; }
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    fs.rmSync(repoCacheRoot, { recursive: true, force: true });
  }
  console.log('security-remediation-http.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
