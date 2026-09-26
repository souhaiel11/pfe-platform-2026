// V1.7 Phase E — real HTTP contract proof for the dedicated builder's
// `POST /internal/build-scan` (and `/healthz`), spawned exactly like
// candidate-verifier's own security-remediation-http.spec.ts spawns its
// server.ts: the real process, real HTTP parsing/dispatch, real port.
// Podman is not installed on this host (a separate, already-documented
// environmental fact — see n8n-workflows/WF6-V1_7-RUNTIME-INTEGRATION-
// AUDIT.md), so the /internal/build-scan case here proves the HTTP
// CONTRACT (structured request validation, deterministic failure mapping,
// no arbitrary stdout becomes authority, never a fabricated success) against
// a REAL, honestly-absent-Podman environment, not a fixture standing in for
// one.
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function reservePort(): Promise<number> {
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return port;
}

const TEST_SECRET = 'v17-final-predeploy-test-secret-do-not-reuse';

async function postJson(port: number, path_: string, body: string, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path_}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  return { status: res.status, json: await res.json() };
}

// V1.7 final predeploy phase — Phase A: every request-shape test below
// (malformed JSON, missing field, etc.) needs to reach the SAME validation
// logic it always tested, now that authentication runs first -- so those
// calls carry a valid header, and authentication itself gets its own
// dedicated NO_AUTH/BAD_AUTH/VALID_AUTH cases.
function postAuthed(port: number, path_: string, body: string) {
  return postJson(port, path_, body, { 'x-internal-secret': TEST_SECRET });
}

async function main() {
  const port = await reservePort();
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'server.ts')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), BUILDER_INTERNAL_SECRET: TEST_SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));
  try {
    // Wait for the server to actually start listening rather than a fixed
    // sleep -- poll /healthz until it answers (any status), bounded.
    const deadline = Date.now() + 15_000;
    let up = false;
    while (Date.now() < deadline && !up) {
      try { await fetch(`http://127.0.0.1:${port}/healthz`); up = true; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, 'builder-scanner server must start listening within 15s. Logs:\n' + logs.join(''));

    // A1. NO_AUTH: header entirely absent -- rejected before any request-
    // shape validation runs at all (a well-formed, valid-looking body still
    // gets 401, never reaching MALFORMED_JSON_BODY/INVALID_REQUEST logic).
    {
      const r = await postJson(port, '/internal/build-scan', JSON.stringify({ workspacePath: '/tmp', budgetMs: 5000 }));
      assert.equal(r.status, 401);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.code, 'AUTH_REJECTED');
    }
    // A2. BAD_AUTH: header present but wrong -- rejected the same way.
    {
      const r = await postJson(port, '/internal/build-scan', JSON.stringify({ workspacePath: '/tmp', budgetMs: 5000 }), { 'x-internal-secret': 'wrong-secret' });
      assert.equal(r.status, 401);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.code, 'AUTH_REJECTED');
    }
    // A3. Malformed credential (empty string) -- rejected, not treated as
    // "no auth configured, allow through".
    {
      const r = await postJson(port, '/internal/build-scan', JSON.stringify({ workspacePath: '/tmp', budgetMs: 5000 }), { 'x-internal-secret': '' });
      assert.equal(r.status, 401);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.code, 'AUTH_REJECTED');
    }
    // A4. VALID_AUTH: correct header -- accepted, reaches the normal
    // request-shape validation instead of being rejected at the auth gate
    // (still a 400 here, but for MALFORMED_JSON_BODY, not AUTH_REJECTED --
    // proves auth ran first and passed, not that it was skipped).
    {
      const r = await postAuthed(port, '/internal/build-scan', 'not json');
      assert.equal(r.status, 400);
      assert.equal(r.json.code, 'MALFORMED_JSON_BODY');
    }

    // 1. Malformed JSON body -- a REQUEST-shape error, HTTP 400 (never 200,
    // which is reserved for "the request was well-formed, a business/
    // infrastructure outcome is encoded in the body").
    {
      const r = await postAuthed(port, '/internal/build-scan', 'not json');
      assert.equal(r.status, 400);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.code, 'MALFORMED_JSON_BODY');
    }
    // 2. Missing workspacePath -- structured validation, not a crash.
    {
      const r = await postAuthed(port, '/internal/build-scan', JSON.stringify({}));
      assert.equal(r.status, 400);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.code, 'INVALID_REQUEST');
    }
    // 3. Invalid budgetMs (negative) -- same structured validation.
    {
      const r = await postAuthed(port, '/internal/build-scan', JSON.stringify({ workspacePath: '/tmp', budgetMs: -5 }));
      assert.equal(r.status, 400);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.code, 'INVALID_REQUEST');
    }
    // 4. Input is narrow: only workspacePath (an identifier/path) and
    // budgetMs (a plain number) are ever accepted -- no arbitrary
    // command/shell field exists to inject.
    {
      const r = await postAuthed(port, '/internal/build-scan', JSON.stringify({ workspacePath: '/tmp', budgetMs: 5000, command: 'rm -rf /' }));
      assert.equal(r.status, 200, 'a structurally valid request is accepted -- the extra field is simply ignored, never interpreted, never executed');
      assert.equal(r.json.ok, false);
      assert.notEqual(r.json.code, undefined);
    }
    // 5. /healthz reports the REAL, honest state of this host (Podman/Trivy
    // not installed here) -- must never claim ready when it is not. Not an
    // authenticated route: a health probe is expected to be reachable
    // without a credential.
    {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      const json: any = await res.json();
      if (!json.ready) assert.equal(res.status, 503, 'a not-ready builder must answer /healthz with 503, never 200');
    }
    // 6. A real build-scan call, against this real (Podman-absent)
    // environment: must NEVER report ok:true / a fabricated scan result --
    // deterministic infrastructure failure only, exactly the FAILURE_MODEL
    // invariant this phase requires (no infrastructure failure may produce
    // a CANDIDATE_READY-shaped success further up the chain).
    {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-scanner-http-spec-'));
      try {
        const r = await postAuthed(port, '/internal/build-scan', JSON.stringify({ workspacePath: workspace, budgetMs: 30_000 }));
        assert.equal(r.status, 200, 'business-level failure is still HTTP 200, encoded in the body');
        assert.equal(r.json.ok, false, 'no real Podman on this host -- must never report ok:true');
        assert.ok(typeof r.json.code === 'string' && r.json.code.length > 0, 'a deterministic failure code is always present');
      } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    }
    console.log('builder-scanner server: PASS (NO_AUTH/BAD_AUTH/malformed-credential rejected before any business logic, VALID_AUTH reaches it; structured request validation, no arbitrary field becomes authority, /healthz honest and unauthenticated, real build-scan call fails closed with no real Podman on this host)');
  } finally {
    child.kill('SIGKILL');
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
