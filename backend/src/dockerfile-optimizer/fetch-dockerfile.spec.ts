// Vérifie que les erreurs réseau ne deviennent jamais des fichiers absents.
import * as assert from 'node:assert/strict';
import { fetchDockerfile } from './fetch-dockerfile';
(async () => {
  const input = { owner: 'test', repo: 'test', filePath: 'Dockerfile', ref: 'develop' };
  const call = (data: unknown, status=200) => fetchDockerfile('http://n8n', input, async (_url, options) => { assert.equal(JSON.parse(String(options?.body)).ref,'develop'); return new Response(JSON.stringify(data),{status}); });
  assert.equal((await call([{success:true,content:'FROM alpine'}])).success,true);
  assert.equal((await call({success:false,error:'Not Found'})).statusCode,404);
  assert.equal((await call({},404)).statusCode,502);
  assert.equal((await call({success:false,error:'connection closed unexpectedly'})).statusCode,502);
  assert.equal((await call({success:true})).statusCode,502);
  const timeout = await fetchDockerfile('http://n8n',input,async()=>{throw new DOMException('timeout','TimeoutError');});
  assert.equal(timeout.statusCode,504);assert.equal(timeout.code,'DOCKERFILE_FETCH_TIMEOUT');
  const bodyTimeout=await fetchDockerfile('http://n8n',input,async()=>({ok:true,json:async()=>{throw new DOMException('aborted','AbortError');}} as unknown as Response));
  assert.equal(bodyTimeout.statusCode,504);
  console.log('PASS Dockerfile : succès, absence réelle, réseau, réponse invalide et délais.');
})().catch(e=>{console.error(e);process.exitCode=1;});
