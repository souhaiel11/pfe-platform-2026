// Vérifie la restauration du rapport Dockerfile et du suivi après réouverture.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const signal=value=>Object.assign(()=>value,{set:v=>value=v});
// Le composant arme un minuteur de validation dans ngOnInit ; le bac a sable vm
// n'expose pas les minuteurs du navigateur, on les instrumente donc pour pouvoir
// AUSSI prouver que ngOnDestroy les libere (pas de fuite de minuteur).
const liveTimers=new Set();let timerSeq=0;
const setIntervalStub=()=>{const id=++timerSeq;liveTimers.add(id);return id;};
const clearIntervalStub=id=>{liveTimers.delete(id);};
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/features/projects/dockerfile-optimizer.component.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{exports,encodeURIComponent,setInterval:setIntervalStub,clearInterval:clearIntervalStub,require:name=>name==='@angular/core'?{Component:()=>x=>x,Input:()=>()=>{},signal}:name.includes('http-error-message')?{userHttpError:()=> 'Chargement impossible'}:{}});
const Component=exports.DockerfileOptimizerComponent;
function setup(){let observer,url,unsubscribed=false;const c=new Component({get:u=>{url=u;return {subscribe:o=>{observer=o;return {unsubscribe:()=>unsubscribed=true}}}}});c.projectId='project / 1';c.repo='owner/repo';let polling;c.startPolling=id=>polling=id;c.ngOnInit();return {c,send:rows=>observer.next(rows),fail:()=>observer.error({status:500}),url:()=>url,polling:()=>polling,unsubscribed:()=>unsubscribed};}
let t=setup();assert.match(t.url(),/project%20%2F%201/);assert.equal(t.c.checkingHistory(),true);const result={score:22,summary:'Rapport',issues:[{category:'CAT-SECURITY',description:'Secret'}]};t.send([{jobId:'done',status:'done',sourceDockerfile:'FROM alpine',result}]);assert.equal(t.c.result(),result);assert.equal(t.c.dockerfileSource(),'FROM alpine');assert.equal(t.c.groupedIssues()[0].items.length,1);assert.equal(t.c.checkingHistory(),false);
t=setup();t.send([{jobId:'running',status:'pending',sourceDockerfile:'FROM alpine'}]);assert.equal(t.polling(),'running');assert.equal(t.c.loading(),true);
t=setup();t.send([{status:'error',reason:'Agent indisponible'}]);assert.match(t.c.error(),/Agent indisponible/);
t=setup();t.send([]);assert.equal(t.c.result(),null);assert.equal(t.c.checkingHistory(),false);
t=setup();t.fail();assert.equal(t.c.error(),'Chargement impossible');assert.equal(t.c.checkingHistory(),false);
t=setup();t.c.ngOnDestroy();assert.equal(t.unsubscribed(),true);
t=setup();t.c.reset();assert.equal(t.unsubscribed(),true);assert.equal(t.c.checkingHistory(),false);assert.equal(t.c.loading(),false);
liveTimers.clear();t=setup();assert.equal(liveTimers.size,1,'ngOnInit doit armer exactement un minuteur de validation');t.c.ngOnDestroy();assert.equal(liveTimers.size,0,'ngOnDestroy doit liberer le minuteur de validation (sinon fuite a chaque reouverture)');
console.log('PASS : rapport restauré, source et constats affichables, suivi repris, erreurs et annulation.');
if(process.argv[2]){
  const rows=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  t=setup();t.send(rows);
  assert.equal(t.c.result().score,rows[0].result.score);
  assert.equal(t.c.groupedIssues().reduce((n,g)=>n+g.items.length,0),rows[0].result.issues.length);
  assert.equal(t.c.dockerfileSource(),rows[0].sourceDockerfile);
  console.log(`PASS : rapport réel restauré, score ${t.c.result().score}, ${t.c.groupedIssues().reduce((n,g)=>n+g.items.length,0)} constats affichables.`);
}
