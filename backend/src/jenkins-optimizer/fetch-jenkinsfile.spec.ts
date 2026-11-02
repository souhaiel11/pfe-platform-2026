// Vérifie les réponses de WF4 et les erreurs de connexion à GitHub.
import * as assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { fetchJenkinsfile } from './fetch-jenkinsfile';

const input = { owner: 'example', repo: 'repository', ref: 'develop', filePath: 'ci/Jenkinsfile' };
/** Simule une réponse JSON du workflow. */
const reply = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });
/** Vérifie le code et le statut renvoyés à l’interface. */
async function rejects(transport: typeof fetch, code: string, status: number) {
  await assert.rejects(fetchJenkinsfile('http://n8n/webhook/test', input, transport), (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), status);
    assert.equal((error.getResponse() as any).code, code);
    return true;
  });
}
(async () => {
  const success = { success: true, jenkinsfile: 'pipeline { agent any }' };
  assert.deepEqual(await fetchJenkinsfile('http://n8n', input, reply(success)), success);
  assert.deepEqual(await fetchJenkinsfile('http://n8n', input, reply([success])), success);
  await fetchJenkinsfile('http://n8n', input, async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)), input);
    assert.ok(options?.signal);
    return new Response(JSON.stringify(success));
  });
  await rejects(reply({ success: false, error: 'The connection to the server was closed unexpectedly, perhaps it is offline.' }), 'JENKINSFILE_GIT_UNREACHABLE', 502);
  await rejects(reply({ success: false, error: 'Not Found' }), 'JENKINSFILE_NOT_FOUND', 404);
  await rejects(reply({ success: true }), 'JENKINSFILE_INVALID_RESPONSE', 502);
  await rejects(reply({ message: 'Workflow was started' }), 'JENKINSFILE_INVALID_RESPONSE', 502);
  await rejects(reply({}, 503), 'JENKINSFILE_WORKFLOW_UNAVAILABLE', 502);
  await rejects(async () => { throw new DOMException('timeout', 'TimeoutError'); }, 'JENKINSFILE_FETCH_TIMEOUT', 504);
  await rejects(async () => { throw new TypeError('fetch failed'); }, 'JENKINSFILE_GIT_UNREACHABLE', 502);
  // Le délai couvre aussi la lecture du corps, pas seulement les en-têtes.
  await rejects(async () => ({ ok: true, json: async () => { throw new DOMException('aborted', 'AbortError'); } } as unknown as Response), 'JENKINSFILE_FETCH_TIMEOUT', 504);
  console.log('Jenkinsfile : succès, contrat, délai et erreurs GitHub vérifiés.');
})().catch(error => { console.error(error); process.exitCode = 1; });
