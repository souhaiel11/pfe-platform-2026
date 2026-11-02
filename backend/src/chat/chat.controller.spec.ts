// Teste le composant « chat.controller » et ses cas d’erreur.
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { of, throwError } from 'rxjs';
import { ChatController } from './chat.controller';

/** Exécute les étapes principales de ce programme. */
async function main() {
  const calls: any[] = [];
  let result: any = of({ data: { ok: true, answer: ' Bonjour ', model: 'private' } });
  const http = { 
  /** Prépare les données nécessaires à ce scénario. */
  post: (...args: any[]) => { calls.push(args); return result; } };
  const controller = new ChatController(http as any, { 
  /** Récupère les données demandées. */
  get: () => 'http://n8n:5678' } as any);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, controller.ask), 200);
  assert.deepEqual(await controller.ask({ question: ' Bonjour ', projectId: 'project-1' }), { ok: true, answer: 'Bonjour' });
  assert.deepEqual(calls[0], ['http://n8n:5678/webhook/chat-agent', { question: 'Bonjour', projectId: 'project-1' }]);
  const expected = { ok: false, answer: null, error: {
    code: 'CHAT_UPSTREAM_FAILED', message: "Le service de discussion n'a pas pu répondre.",
  } };
  /** Vérifie que le scénario est refusé. */
  const rejected = async () => {
    await assert.rejects(() => controller.ask({ question: 'Bonjour' }), (e: any) => {
      assert.ok(e instanceof BadGatewayException);
      assert.equal(e.getStatus(), 502);
      assert.deepEqual(e.getResponse(), expected);
      assert.ok(!JSON.stringify(e.getResponse()).includes('private-provider-error'));
      return true;
    });
  };
  for (const data of ['', undefined, null, {}, [], { ok: true }, { ok: true, answer: null },
    { ok: true, answer: 42 }, { ok: true, answer: '' }, { ok: true, answer: '   ' },
    { answer: 'missing ok' }, { ok: false, answer: 'misleading', error: { message: 'private-provider-error' } }]) {
    result = of({ data });
    await rejected();
  }
  for (const status of [401, 429, 500, 502]) {
    result = throwError(() => Object.assign(new Error('private-provider-error'), { response: { status } }));
    await rejected();
  }
  for (const question of [null, undefined, 42, '', ' ']) {
    await assert.rejects(() => controller.ask({ question } as any), BadRequestException);
  }
  console.log('PASS backend chat: valid/empty/null/malformed/upstream errors; HTTP 200/502 contracts');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
