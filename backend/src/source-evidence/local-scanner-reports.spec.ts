// Teste le composant « local-scanner-reports » et ses cas d’erreur.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalScannerReportStore, LocalReportContext } from './local-scanner-reports';
const base: LocalReportContext = { projectId:'project-a', incidentId:'incident-a', projectName:'A', job:'a', buildNumber:42, commitSha:'a'.repeat(40) };
/** Prépare les données nécessaires à ce scénario. */
async function fixture(work: (root: string, store: LocalScannerReportStore) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), 'local-scanner-reports-test-'));
  try { await work(root, new LocalScannerReportStore(root)); } finally { await fs.rm(root,{recursive:true,force:true}); }
}
/** Enregistre les données à leur destination. */
async function write(root: string, dir: string, name = 'trivy-report.json', content = '{"Results":[]}') {
  await fs.mkdir(join(root,dir),{recursive:true}); await fs.writeFile(join(root,dir,name),content);
}
test('reads exact job/build, retains raw bytes and derives digest',()=>fixture(async(root,store)=>{
  const content='{"Results":[],"note":"é <script>alert(1)</script>"}\n';
  await write(root,'a/42','trivy-report.json',content);const info=await store.list(base);
  assert.equal(info[0].sourcePath,join(root,'a/42/trivy-report.json'));assert.equal(info[0].relativePath,'a/42/trivy-report.json');assert.equal(info[1].available,false);
  const report=await store.read(base,'trivy');assert.equal(report.content,content);assert.equal(report.bytes,Buffer.byteLength(content));assert.match(report.sha256,/^[a-f0-9]{64}$/);
}));
test('isolates projects, builds and missing files',()=>fixture(async(root,store)=>{
  await write(root,'other/42');await write(root,'a/41');assert.ok((await store.list(base)).every(r=>!r.available));
  await assert.rejects(store.read(base,'trivy'),/REPORT_NOT_FOUND/);
}));
test('rejects request traversal and scanners outside the allow-list',()=>fixture(async(root,store)=>{
  await write(root,'a/42');for(const job of ['../a','a/..','/../a','a/evil?key=x'])assert.ok((await store.list({...base,job})).every(r=>!r.available));
  await assert.rejects(store.read(base,'../../etc/passwd'),/INVALID_SCANNER/);
}));
test('rejects symlink escapes',()=>fixture(async(root,store)=>{
  const outside=await fs.mkdtemp(join(tmpdir(),'local-scanner-outside-'));
  try { await write(outside,'a/42');await fs.symlink(join(outside,'a'),join(root,'a'));assert.ok((await store.list(base)).every(r=>!r.available)); }
  finally { await fs.rm(outside,{recursive:true,force:true}); }
}));
test('legacy branch lookup requires matching payload, build and commit',()=>fixture(async(root,store)=>{
  await write(root,'a/main/42');assert.ok((await store.list(base)).every(r=>!r.available));
  const payload={job:'a',build_number:42,commit:base.commitSha};await write(root,'a/main/42','payload.json',JSON.stringify(payload));assert.equal((await store.list(base))[0].available,true);
  for(const patch of [{job:'b'},{build_number:41},{commit:'bbbbbbb'}]){await write(root,'a/main/42','payload.json',JSON.stringify({...payload,...patch}));assert.ok((await store.list(base)).every(r=>!r.available));}
}));
test('refuses ambiguous branches and contradictory exact-path payload',()=>fixture(async(root,store)=>{
  const payload=JSON.stringify({job:'a',build_number:42,commit:base.commitSha});
  for(const branch of ['main','feature']){await write(root,`a/${branch}/42`);await write(root,`a/${branch}/42`,'payload.json',payload)}
  assert.ok((await store.list(base)).every(r=>!r.available));
  await write(root,'a/42');await write(root,'a/42','payload.json',JSON.stringify({job:'a',build_number:43}));assert.ok((await store.list(base)).every(r=>!r.available));
}));
test('explicit multibranch job selects only its branch',()=>fixture(async(root,store)=>{
  await write(root,'a/main/42');await write(root,'a/feature/42','trivy-report.json','{"other":true}');
  const r=await store.read({...base,job:'a/job/main'},'trivy');assert.equal(r.sourcePath,join(root,'a/main/42/trivy-report.json'));
}));
test('invalid JSON, oversized and empty reports never become readable reports',()=>fixture(async(root,store)=>{
  await write(root,'a/42','trivy-report.json','<html>bad upstream</html>');await assert.rejects(store.read(base,'trivy'));
  await write(root,'a/42','trivy-report.json','');assert.equal((await store.list(base))[0].available,false);
  const f=await fs.open(join(root,'a/42/trivy-report.json'),'w');await f.truncate(25*1024*1024+1);await f.close();assert.equal((await store.list(base))[0].available,false);
}));

test('rejects symlinks to another project within the share',()=>fixture(async(root,store)=>{
  await write(root,'other/42');await fs.symlink(join(root,'other'),join(root,'a'));assert.ok((await store.list(base)).every(r=>!r.available));
}));
