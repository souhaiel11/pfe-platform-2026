import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as net from 'node:net';

async function main() {
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  // Stub execution only: exercise the real worker HTTP parsing and dispatch.
  const code = `const {CandidateVerificationExecutor:E}=require('./src/candidate-verification-executor');
    E.prototype.executeHead=function(r){return {mode:'HEAD_ONLY',identity:{targetSha:r.targetSha}}};
    E.prototype.execute=function(m){return {legacy:true,files:m.files}};
    require('./src/server');`;
  const child = spawn(process.execPath, ['-r', 'ts-node/register', '-e', code], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('worker startup timeout')), 20000);
      child.stdout.on('data', b => { if (String(b).includes('listening')) { clearTimeout(timer); resolve(); } });
      child.on('exit', () => { clearTimeout(timer); reject(Error('worker exited before startup')); });
    });
    const post = (body: any) => fetch(`http://127.0.0.1:${port}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const head = { verifyHeadOnly: true, repository: 'owner/repo', targetSha: 'a'.repeat(40), validationRequestId: 'v', requestId: 'r', batchId: 'b', candidateAttempt: 0 };
    const response = await post(head); assert.equal(response.status, 200); assert.equal((await response.json() as any).mode, 'HEAD_ONLY');
    assert.equal((await post({ ...head, manifest: { files: [] } })).status, 400);
    assert.equal((await post({ ...head, targetSha: 'main' })).status, 400);
    assert.equal((await post({})).status, 400);
    const legacy = await post({ manifest: { files: [] } }); assert.equal(legacy.status, 200); assert.equal((await legacy.json() as any).legacy, true);
    console.log('Worker HTTP: PASS (HEAD dispatch, mixed request rejected, legacy dispatch preserved)');
  } finally {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    if (child.exitCode === null) { child.kill(); await exited; }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
