// Vérifie les messages et réponses du chat dans N8N.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchChatWorkflow, fetchContextCode, parseResponseCode, errorResponseCode } from './patch-wf-chat-v4.mjs';

const source = JSON.parse(readFileSync(process.argv[2] || new URL('../active/wf-chat-v4-6BVXqAsePEPAjiIQ.json', import.meta.url)));
const original = JSON.stringify(source);
const patched = patchChatWorkflow(source);
assert.equal(JSON.stringify(source), original, 'patch must not mutate the backup');
assert.equal(patched.id, source.id);
assert.equal(patched.nodes.length, source.nodes.length + (source.nodes.some(n => n.name === 'Chat Error Response') ? 0 : 1));
assert.deepEqual(patchChatWorkflow(patched), patched, 'patch is idempotent');
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => patched.nodes.find(n => n.name === name);
/** Exécute le traitement et collecte son résultat. */
const run = (code, json, lookup = () => {}) => vm.runInNewContext(`(function(){${code}\n})()`, {
  $input: { 
  /** Renvoie le premier élément disponible. */
  first: () => ({ json }) }, $: lookup,
});
assert.equal(node('Webhook').parameters.responseMode, 'responseNode');
assert.equal(node('Get Incidents').parameters.headerParameters.parameters.find(h => h.name.toLowerCase() === 'x-internal-secret').value,
  '={{ $env.N8N_INTERNAL_SECRET }}');
assert.deepEqual(node('Get Incidents1').parameters, source.nodes.find(n => n.name === 'Get Incidents1').parameters,
  'provider/model/timeout must stay unchanged');
for (const name of ['Fetch Context', 'Get Incidents', 'Build Prompt', 'Prepare Claude Body', 'Get Incidents1', 'Parse Response']) {
  assert.equal(node(name).onError, 'continueErrorOutput');
  assert.equal(patched.connections[name].main[1][0].node, 'Chat Error Response');
  assert.deepEqual(patched.connections[name].main[0], source.connections[name].main[0]);
}
assert.equal(patched.connections['Chat Error Response'].main[0][0].node, 'Respond to Webhook');
const badHistory = [null, 4, {}, { role: 'user', content: null }, { role: 'user', content: 12 }, { role: 'user', content: 'safe' }];
for (const history of [null, {}, 'bad', badHistory]) {
  const context = run(fetchContextCode, { body: { question: 'Bonjour', history } })[0].json;
  assert.equal(context.question, 'Bonjour');
  assert.ok(Array.isArray(context.history));
  const result = run(node('Build Prompt').parameters.jsCode, {}, name => name === 'Fetch Context'
    ? { 
    /** Renvoie le premier élément disponible. */
    first: () => ({ json: { question: 'Bonjour', history } }) }
    : { 
    /** Renvoie tous les éléments disponibles. */
    all: () => [] });
  assert.equal(typeof result[0].json.prompt, 'string');
}
assert.throws(() => run(fetchContextCode, null), /CHAT_INVALID_REQUEST/);
for (const value of [null, {}, { content: null }, { content: [] }, { content: [null] },
  { content: [{ type: 'text', text: null }] }, { content: [{ type: 'text', text: ' ' }] },
  { content: [{ type: 'tool_use', text: 'wrong' }] }]) {
  assert.throws(() => run(parseResponseCode, value), /CHAT_INVALID_PROVIDER_RESPONSE/);
  const error = run(errorResponseCode, value)[0].json;
  assert.equal(error.ok, false);
  assert.equal(error.answer, null);
  assert.equal(error.error.code, 'CHAT_WORKFLOW_ERROR');
}
const good = run(parseResponseCode, { content: [{ type: 'text', text: ' Bonjour ' }, { type: 'text', text: 'Suite' }] })[0].json;
assert.equal(good.ok, true);
assert.equal(good.answer, 'Bonjour\nSuite');
const statusCode = node('Respond to Webhook').parameters.options.responseCode.slice(3, -3).trim();
assert.equal(vm.runInNewContext(statusCode, { $json: good }), 200);
assert.equal(vm.runInNewContext(statusCode, { $json: { ok: false } }), 502);
for (const [from, types] of Object.entries(patched.connections)) {
  assert.ok(node(from));
  for (const branches of Object.values(types)) for (const edges of branches) for (const edge of edges) assert.ok(node(edge.node));
}
console.log('PASS workflow chat: auth reference, preserved chain, error branches, history and Claude parser');
