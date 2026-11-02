// Teste le composant « n8n-execution-client » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { stopN8nExecution } from './n8n-execution-client';

/** Exécute les étapes principales de ce programme. */
async function main() {
  const saved = { url: process.env.N8N_API_URL, key: process.env.N8N_API_KEY, fetch: globalThis.fetch };
  try {
    process.env.N8N_API_URL = 'http://offline.invalid/';
    process.env.N8N_API_KEY = 'offline-secret';
    for (const [status, body, expected] of [
      [200, '{}', 'STOP_SUCCEEDED'], [401, '', 'AUTH_ERROR'], [403, '', 'AUTH_ERROR'],
      [404, '', 'NOT_FOUND'],
      [400, 'Only running or waiting executions can be stopped and 123 is currently canceled', 'ALREADY_STOPPED'],
      [400, JSON.stringify({ message: 'Only running or waiting executions can be stopped and 123 is currently canceled' }), 'ALREADY_STOPPED'],
      [400, 'Only running or waiting executions can be stopped and 123 is currently success', 'NOT_STOPPABLE'],
      [400, 'Only running or waiting executions can be stopped and 456 is currently canceled', 'NOT_STOPPABLE'],
      [500, 'arbitrary upstream error offline-secret', 'NOT_STOPPABLE'],
    ] as const) {
      /** Envoie la requête et lit la réponse distante. */
      (globalThis as any).fetch = async (url: string, opts: any) => {
        assert.equal(url, 'http://offline.invalid/api/v1/executions/123/stop');
        assert.equal(opts.method, 'POST');
        assert.equal(opts.redirect, 'error');
        assert.equal(opts.headers['X-N8N-API-KEY'], 'offline-secret');
        assert.ok(opts.signal instanceof AbortSignal);
        return new Response(body, { status });
      };
      const result = await stopN8nExecution('123');
      assert.equal(result.outcome, expected);
      assert.ok(!JSON.stringify(result).includes('offline-secret'));
    }
    /** Envoie la requête et lit la réponse distante. */
    (globalThis as any).fetch = (_url: string, opts: any) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('deadline did not abort')), 100);
      opts.signal.addEventListener('abort', () => { clearTimeout(timer); reject(opts.signal.reason); }, { once: true });
    });
    assert.equal((await stopN8nExecution('123', 5)).outcome, 'NETWORK_ERROR');
    delete process.env.N8N_API_KEY;
    assert.equal((await stopN8nExecution('123')).outcome, 'NOT_CONFIGURED');
    console.log('n8n stop classification, timeout, no secret exposure: ALL PASS');
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.N8N_API_URL; else process.env.N8N_API_URL = saved.url;
    if (saved.key === undefined) delete process.env.N8N_API_KEY; else process.env.N8N_API_KEY = saved.key;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
