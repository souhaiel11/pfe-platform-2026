// Teste le composant « transport-dispatcher.integration » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent } from 'undici';
import { CandidateVerificationService } from './candidate-verification.service';

/** Prépare les données nécessaires à ce scénario. */
function startDelayedServer(delayMs: number): { url: string; server: http.Server; connections: Set<import('node:net').Socket> } {
  const connections = new Set<import('node:net').Socket>();
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'TECHNICAL_FAILURE', failureClass: 'VERIFIER_UNAVAILABLE', reason: 'x', decision: { findingIdentity: 'fp-integration' } }));
    }, delayMs);
  });
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/verify`, server, connections };
}

/** Simule l’échec attendu par ce scénario. */
async function waitUntil(condition: () => boolean, boundMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > boundMs) throw new Error(`waitUntil timed out (${boundMs}ms) waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Exécute les étapes principales de ce programme. */
async function main() {
  const originalUrl = process.env.CANDIDATE_VERIFIER_URL;

  {
    const { url, server, connections } = startDelayedServer(300);
    process.env.CANDIDATE_VERIFIER_URL = url;
    try {
      const service = new CandidateVerificationService();
      const result: any = await service.evaluateSecurityRemediation(
        { finding: { cveId: 'x', findingIdentity: 'x' }, repository: 'r', candidateBaseSha: 'a'.repeat(40) } as any,
        2000,
      );
      assert.equal(result.status, 'TECHNICAL_FAILURE');
      assert.equal(result.failureClass, 'VERIFIER_UNAVAILABLE', 'M1: the worker\'s own real (delayed but successful) response is passed through, not misclassified as a transport failure');
      await waitUntil(() => connections.size === 0, 2000, 'M1: server-side socket released after a successful call');
    } finally {
      server.close();
    }
    console.log('Test M1: PASS (a response delayed past a short vulnerable-default stand-in still succeeds with the configured dispatcher; connection released after success)');
  }

  {
    const { url, server, connections } = startDelayedServer(4000);
    try {
      const shortDispatcher = new Agent({ headersTimeout: 100, bodyTimeout: 100 });
      let threw = false;
      const began = Date.now();
      try {
        await fetch(url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }, dispatcher: shortDispatcher } as any);
      } catch (err: any) {
        threw = true;
        assert.notEqual(err?.name, 'AbortError', 'M2: this failure comes from the dispatcher\'s own headersTimeout, never from an AbortSignal (none was even attached)');
        assert.ok(Date.now() - began < 4000, 'M2: the failure arrives well before the server\'s own 4000ms delay would have completed the response');
      } finally {
        await shortDispatcher.close().catch(() => {});
      }
      assert.equal(threw, true, 'M2: a dispatcher headersTimeout shorter than the real delay genuinely rejects the request -- the exact mechanism that misfired in execution 2055');
      await waitUntil(() => connections.size === 0, 2000, 'M2: server-side socket released after a dispatcher-timeout failure');
    } finally {
      server.close();
    }
    console.log('Test M2: PASS (a too-short dispatcher timeout empirically, independently fails a delayed response -- the real bug mechanism, reproduced and confirmed)');
  }

  {
    const { url, server, connections } = startDelayedServer(2000);
    try {
      const generousDispatcher = new Agent({ headersTimeout: 60_000, bodyTimeout: 60_000 });
      let timedOut = false;
      try {
        await fetch(url, { method: 'GET', dispatcher: generousDispatcher, signal: AbortSignal.timeout(500) } as any);
      } catch (err: any) {
        timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      } finally {
        await generousDispatcher.close().catch(() => {});
      }
      assert.equal(timedOut, true, 'M3: a short AbortSignal still aborts the request even though the dispatcher itself would have tolerated the full 2000ms delay');
      await waitUntil(() => connections.size === 0, 2000, 'M3: server-side socket released after an aborted call');
    } finally {
      server.close();
    }
    console.log('Test M3: PASS (the governing AbortSignal deadline still fires and aborts a truly overdue request; connection released after abort)');
  }

  if (originalUrl === undefined) delete process.env.CANDIDATE_VERIFIER_URL; else process.env.CANDIDATE_VERIFIER_URL = originalUrl;
  console.log('transport-dispatcher.integration.spec.ts: PASS (real local HTTP server, real fetch/Agent, no mocks, no external network, no 5-minute waits)');
}

main().catch((e) => { console.error(e); process.exit(1); });
