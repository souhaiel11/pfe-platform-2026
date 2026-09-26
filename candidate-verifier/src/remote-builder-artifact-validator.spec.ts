// V1.7 predeploy phase — real HTTP proof for RemoteBuilderArtifactValidator
// against the REAL builder-scanner server.ts (spawned, same technique
// candidate-verifier's own security-remediation-http.spec.ts already uses
// for its own server). Podman is not installed on this host (a separate,
// already-documented environmental fact), so this proves the CLIENT<->
// SERVER wiring itself -- request shape, timeout/budget forwarding,
// deterministic ArtifactRuntimeError mapping on failure -- not a real
// Podman build.
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactRuntimeError } from './security-artifact-validator';
import { RemoteBuilderArtifactValidator } from './remote-builder-artifact-validator';

async function reservePort(): Promise<number> {
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return port;
}

const TEST_SECRET = 'v17-final-predeploy-client-test-secret-do-not-reuse';

async function main() {
  const port = await reservePort();
  const serverPath = path.join(__dirname, '../../builder-scanner/src/server.ts');
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', serverPath], {
    cwd: path.join(serverPath, '../..'),
    env: { ...process.env, PORT: String(port), BUILDER_INTERNAL_SECRET: TEST_SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));
  try {
    const deadline = Date.now() + 15_000;
    let up = false;
    while (Date.now() < deadline && !up) {
      try { await fetch(`http://127.0.0.1:${port}/healthz`); up = true; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, 'builder-scanner server must start listening within 15s. Logs:\n' + logs.join(''));

    const client = new RemoteBuilderArtifactValidator(`http://127.0.0.1:${port}/internal/build-scan`, TEST_SECRET);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-builder-client-spec-'));
    try {
      // 0a. NO_AUTH: a client constructed with no secret at all (undefined)
      // must be rejected by the real server -- AUTH_REJECTED, never
      // reaching TrivyImageArtifactValidator.
      {
        const noAuthClient = new RemoteBuilderArtifactValidator(`http://127.0.0.1:${port}/internal/build-scan`, undefined);
        let threwNoAuth: ArtifactRuntimeError | undefined;
        try { noAuthClient.inspect(workspace, 30_000); }
        catch (err) { threwNoAuth = err as ArtifactRuntimeError; }
        assert.ok(threwNoAuth instanceof ArtifactRuntimeError);
        assert.equal(threwNoAuth!.code, 'AUTH_REJECTED');
      }
      // 0b. BAD_AUTH: a client constructed with the wrong secret must ALSO
      // be rejected the same way, over a real HTTP call.
      {
        const badAuthClient = new RemoteBuilderArtifactValidator(`http://127.0.0.1:${port}/internal/build-scan`, 'wrong-secret');
        let threwBadAuth: ArtifactRuntimeError | undefined;
        try { badAuthClient.inspect(workspace, 30_000); }
        catch (err) { threwBadAuth = err as ArtifactRuntimeError; }
        assert.ok(threwBadAuth instanceof ArtifactRuntimeError);
        assert.equal(threwBadAuth!.code, 'AUTH_REJECTED');
      }

      // 1. A real end-to-end call with VALID_AUTH: client -> real HTTP
      // (with the correct X-Internal-Secret header) -> real server, past
      // the auth gate -> real TrivyImageArtifactValidator.inspect() (no
      // Podman on this host, so this fails deterministically -- but every
      // hop, including authentication, is real). The code must NOT be
      // AUTH_REJECTED -- proving the auth gate was reached and passed, not
      // merely that some code came back.
      let threw: ArtifactRuntimeError | undefined;
      try { client.inspect(workspace, 30_000); }
      catch (err) { threw = err as ArtifactRuntimeError; }
      assert.ok(threw instanceof ArtifactRuntimeError, 'a real failure surfaces as the SAME ArtifactRuntimeError type the orchestrator already knows how to map to TECHNICAL_FAILURE');
      assert.ok(typeof threw!.code === 'string' && threw!.code.length > 0);
      assert.notEqual(threw!.code, 'AUTH_REJECTED', 'VALID_AUTH must reach past the auth gate, not be rejected by it');

      // 1b. Regression: a REAL, monotonic-clock-derived budgetMs (e.g.
      // WorkerDeadline.remainingMs(), always a sub-millisecond float by
      // construction) must not be misclassified as RUNTIME_EXECUTABLE_
      // UNAVAILABLE -- Node's execFileSync `timeout` option throws
      // synchronously on a non-integer, which this codebase's own real
      // orchestrator run against this exact separated architecture caught
      // for real. A float budget must still reach the real server exactly
      // like an integer one does (same ArtifactRuntimeError, same code as
      // the integer-budget call above, never a spurious "unavailable").
      let threwFloat: ArtifactRuntimeError | undefined;
      try { client.inspect(workspace, 30_000.789); }
      catch (err) { threwFloat = err as ArtifactRuntimeError; }
      assert.ok(threwFloat instanceof ArtifactRuntimeError);
      assert.equal(threwFloat!.code, threw!.code, 'a float budget must reach the real server and fail the SAME way an integer budget does, not a spurious client-side RUNTIME_EXECUTABLE_UNAVAILABLE');

      // 2. An unreachable builder (wrong port) must ALSO map to a
      // deterministic ArtifactRuntimeError, never an uncaught exception or
      // a silently-swallowed success.
      const unreachable = new RemoteBuilderArtifactValidator('http://127.0.0.1:1/internal/build-scan');
      let unreachableThrew: ArtifactRuntimeError | undefined;
      try { unreachable.inspect(workspace, 5_000); }
      catch (err) { unreachableThrew = err as ArtifactRuntimeError; }
      assert.ok(unreachableThrew instanceof ArtifactRuntimeError);
      assert.equal(unreachableThrew!.code, 'RUNTIME_EXECUTABLE_UNAVAILABLE');
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }

    console.log('RemoteBuilderArtifactValidator: PASS (NO_AUTH/BAD_AUTH rejected over a real HTTP call, VALID_AUTH reaches the real validator; real client->HTTP->server->validator wiring; unreachable builder maps to a deterministic ArtifactRuntimeError)');
  } finally {
    child.kill('SIGKILL');
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
