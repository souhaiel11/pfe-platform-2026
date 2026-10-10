import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const rxjs = require('rxjs');
const source = readFileSync(new URL('../src/app/core/services/chat.service.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
}).outputText, { exports, require: name => {
  if (name === 'rxjs') return rxjs;
  if (name.includes('environment')) return { environment: { apiUrl: '/api' } };
  return { Injectable: () => target => target };
}, console });

let response;
const calls = [];
const http = { post: (url, body) => { calls.push({ url, body }); return response; } };
const service = new exports.ChatService(http);
let messages, loading;
service.messages$.subscribe(value => messages = value);
service.loading$.subscribe(value => loading = value);
response = rxjs.of({ ok: true, answer: ' Bonjour ' });
service.sendMessage(' Bonjour ', 'project-1');
assert.equal(messages.at(-1).content, 'Bonjour');
assert.equal(messages.at(-1).isError, false, 'une vraie réponse ne doit jamais être marquée isError');
assert.equal(loading, false);
assert.equal(calls[0].url, '/api/chat/ask');
assert.equal(JSON.stringify(calls[0].body), JSON.stringify({ question: 'Bonjour', projectId: 'project-1' }));
for (const body of [null, undefined, '', {}, [], { ok: true, answer: 12 }, { ok: true, answer: ' ' }, { ok: false, answer: 'invalid' }]) {
  response = rxjs.of(body);
  service.sendMessage('Test');
  assert.match(messages.at(-1).content, /Réponse indisponible/);
  assert.equal(messages.at(-1).isError, true, `repli "Réponse indisponible" doit être marqué isError pour body=${JSON.stringify(body)}`);
  assert.equal(loading, false);
}
response = rxjs.throwError(() => new Error('private upstream details'));
service.sendMessage('Test erreur');
assert.match(messages.at(-1).content, /Vous pouvez réessayer/);
assert.ok(!messages.at(-1).content.includes('private'));
assert.equal(messages.at(-1).isError, true, "l'échec HTTP doit être marqué isError");
assert.equal(loading, false);
const before = calls.length;
response = rxjs.of({ ok: true, answer: 'Après erreur' });
service.sendMessage('Encore');
assert.equal(calls.length, before + 1);
assert.equal(messages.at(-1).content, 'Après erreur');
assert.equal(messages.at(-1).isError, false, 'une réponse réussie après une erreur ne doit plus être marquée isError');
assert.equal(loading, false);
const pending = new rxjs.Subject();
response = pending;
service.sendMessage('En cours');
assert.equal(loading, true);
const pendingCalls = calls.length;
service.sendMessage('Double clic');
assert.equal(calls.length, pendingCalls);
pending.error(new Error('failed'));
assert.equal(loading, false);
const throwing = new exports.ChatService({ post: () => { throw new Error('sync failure'); } });
let throwingLoading;
throwing.loading$.subscribe(v => throwingLoading = v);
throwing.sendMessage('Test');
assert.equal(throwingLoading, false);
console.log('PASS frontend chat: success/null/invalid/error, isError flag, cleanup, next message and double-submit protection');
