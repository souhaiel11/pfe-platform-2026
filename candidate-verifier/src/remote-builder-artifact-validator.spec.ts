// Teste le composant « remote-builder-artifact-validator » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactRuntimeError } from './security-artifact-validator';
import { RemoteBuilderArtifactValidator } from './remote-builder-artifact-validator';

/** Prépare les données nécessaires à ce scénario. */
async function reservePort(): Promise<number> {
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return port;
}

const TEST_SECRET = 'v17-final-predeploy-client-test-secret-do-not-reuse';

/** Exécute les étapes principales de ce programme. */
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

      let threw: ArtifactRuntimeError | undefined;
      try { client.inspect(workspace, 30_000); }
      catch (err) { threw = err as ArtifactRuntimeError; }
      assert.ok(threw instanceof ArtifactRuntimeError, 'a real failure surfaces as the SAME ArtifactRuntimeError type the orchestrator already knows how to map to TECHNICAL_FAILURE');
      assert.ok(typeof threw!.code === 'string' && threw!.code.length > 0);
      assert.notEqual(threw!.code, 'AUTH_REJECTED', 'VALID_AUTH must reach past the auth gate, not be rejected by it');

      // Un délai nul supprimerait la limite : conserver au moins 1 ms et vérifier le budget avant l’appel.
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
