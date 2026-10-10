import {Observable} from 'rxjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadFrontend} from './security-lifecycle-test-loader.mjs';
const shared=loadFrontend('../src/app/shared/security-remediation-presentation.ts');
const eligibility=loadFrontend('../src/app/shared/cve-selection-eligibility.ts');
const view=loadFrontend('../src/app/shared/security-findings-view.ts');
const fingerprints=loadFrontend('../src/app/shared/security-finding-fingerprint.ts');
const {CveTableComponent}=loadFrontend('../src/app/features/projects/cve-table.component.ts');
const {ProjectDetailComponent}=loadFrontend('../src/app/features/projects/project-detail.component.ts');
const {ApiService}=loadFrontend('../src/app/core/services/api.service.ts',{'../../../environments/environment':{environment:{apiUrl:'/api'}}});
const cve={id:'CVE-A',pkg:'org:a',source:'TRIVY',installedVersion:'1',fixedVersion:'2'};
function task(overrides={}){return {id:'t',source:'TRIVY',status:'TODO',scannerStatus:'DETECTED',findingSnapshot:{ruleOrCve:'CVE-A',component:'org:a',fixedVersion:'2'},...overrides};}
function failed(overrides={}){return task({securityFindingRemediation:{status:'TECHNICAL_FAILURE',retryable:true,reasonCode:'RUNTIME_OPERATION_TIMEOUT',attemptId:'attempt-1',attemptNumber:1,...overrides}});}
function present(t,c=cve){return shared.getSecurityRemediationPresentation(t,eligibility.canSelectCveTask(t,true,c),c);}
function table(tasks=[task()],rows=[cve],source='TRIVY'){
 const t=new CveTableComponent();t.source=source;t.tasks=tasks;t.cves=rows;t.userRole='developer';t.selectionRule=(task,row)=>eligibility.canSelectCveTask(task,true,row);return t;
}
test('P1 AUTO_FIX_AVAILABLE offers Corriger',()=>{assert.equal(present(task()).state,'AUTO_FIX_AVAILABLE');assert.equal(present(task()).selectable,true);});
test('P2 DISPATCHING cannot launch or retry',()=>{const p=present(task({securityFindingRemediation:{status:'DISPATCHING',retryable:true}}));assert.equal(p.label,'Correction en cours');assert.equal(p.selectable,false);assert.equal(p.retryAllowed,false);});
test('P3 CANDIDATE_READY is proposed with PR',()=>{const p=present(task({securityFindingRemediation:{status:'CANDIDATE_READY',prUrl:'https://github.com/a/b/pull/1'}}));assert.equal(p.label,'Correction proposée');assert.ok(p.prUrl);});
test('P4 backend retryable failure displays failure and retry',()=>{const p=present(failed());assert.equal(p.label,'Échec de correction');assert.equal(p.retryAllowed,true);assert.equal(p.selectable,false);});
test('P5 non-retryable failure is manual',()=>{assert.equal(present(failed({retryable:false})).label,'Intervention manuelle requise');});
test('P6 WF6 CLOSED plus TODO/DETECTED is never corrected',()=>{for(const prUrl of [undefined,'https://github.com/a/b/pull/1'])assert.notEqual(present(task({securityFindingRemediation:{status:'CLOSED',prUrl}})).state,'PROJECT_FIX_VERIFIED');});
test('P7 VERIFIED plus NOT_DETECTED has highest priority and is grey/read-only',()=>{const t=task({status:'VERIFIED',scannerStatus:'NOT_DETECTED',securityFindingRemediation:{status:'DISPATCHING'}});const p=present(t);assert.equal(p.state,'PROJECT_FIX_VERIFIED');assert.equal(p.styleKey,'muted');assert.equal(p.selectable,false);assert.equal(table([t]).canComplete(t),false);});
test('P8 VERIFIED followed by STILL_DETECTED/DETECTED is no longer fixed',()=>{for(const scannerStatus of ['STILL_DETECTED','DETECTED'])assert.notEqual(present(task({status:'VERIFIED',scannerStatus})).state,'PROJECT_FIX_VERIFIED');});
test('P9 unknown failure has no retry; raw text is not exposed',()=>{for(const retryable of [undefined,false,true]){const p=present(failed({status:'UNKNOWN_FAILURE',retryable,reasonCode:'unknown secret',reasonMessage:'token=secret\nstack'}));assert.equal(p.retryAllowed,false);assert.equal(p.reasonCode,null);assert.doesNotMatch(p.explanation,/token|stack/);}});
test('P10 max attempts hides retry',()=>{assert.equal(present(failed({attemptNumber:3})).retryAllowed,false);});
const fixtures=[task({id:'available'}),task({id:'dispatch',securityFindingRemediation:{status:'DISPATCHING'}}),task({id:'candidate',securityFindingRemediation:{status:'CANDIDATE_READY'}}),{...failed(),id:'failed'},task({id:'fixed',status:'VERIFIED',scannerStatus:'NOT_DETECTED'}),{...failed({retryable:false}),id:'manual'}].map((t,i)=>({...t,findingSnapshot:{...t.findingSnapshot,ruleOrCve:`CVE-${i}`}}));
const rows=fixtures.map(t=>({...cve,id:t.findingSnapshot.ruleOrCve,findingTaskId:t.id}));
function filter(key){const t=table(fixtures,rows);t.owaspRemediationFilter.set(key);return Array.from(t.filtered(),c=>t.taskFor(c).id);}
test('F1 retryable failure appears in Échecs',()=>assert.deepEqual(filter('FAILED'),['failed']));
test('F2 retryable failure is not Manuel',()=>assert.ok(!filter('MANUAL').includes('failed')));
test('F3 candidate only in Proposées',()=>{assert.deepEqual(filter('PROPOSED'),['candidate']);assert.ok(!filter('IN_PROGRESS').includes('candidate'));});
test('F4 dispatching only in En cours',()=>assert.deepEqual(filter('IN_PROGRESS'),['dispatch']));
test('F5 verified fixed in Corrigées',()=>assert.deepEqual(filter('CLOSED'),['fixed']));
test('F6 verified fixed remains in Toutes',()=>assert.ok(filter('ALL').includes('fixed')));
test('F7 manual failure in Manuel',()=>assert.deepEqual(filter('MANUAL'),['manual']));
test('F8 counters equal visible categories for both scanners',()=>{for(const source of ['TRIVY','OWASP']){const ts=fixtures.map(t=>({...t,source,findingSnapshot:{...t.findingSnapshot,legacyPackage:'org:a',currentVersion:'1'}}));const t=table(ts,rows,source),s=t.owaspRemediationSummary();assert.equal(s.total,6);for(const key of ['autoFixAvailable','dispatching','candidateReady','failedRetryable','verifiedFixed','manualRequired'])assert.equal(s[key],1);assert.equal(Object.entries(s).filter(([k])=>k!=='total').reduce((n,[,v])=>n+v,0),s.total);}});
test('H1 current scan plus persisted task produces one row',()=>assert.equal(table().normalized().length,1));
test('H2 verified task absent from report remains visible without stale versions',()=>{const t=table([task({status:'VERIFIED',scannerStatus:'NOT_DETECTED'})],[]);const r=t.normalized()[0];assert.equal(r.historical,true);assert.equal(t.owaspPresentation(r).installedVersion,null);assert.equal(t.owaspPresentation(r).targetVersion,null);assert.equal(t.owaspPresentation(r).label,'Vulnérabilité corrigée');});
test('H3 duplicate scan rows and canonical task aliases deduplicate',()=>assert.equal(table([task()],[cve,cve]).normalized().length,1));
test('H4 Trivy historical fixed row persists',()=>assert.equal(table([task({status:'VERIFIED',scannerStatus:'NOT_DETECTED'})],[]).normalized().length,1));
test('H5 OWASP historical fixed row persists using backend fingerprint',()=>{const t=task({source:'OWASP',status:'VERIFIED',scannerStatus:'NOT_DETECTED',findingFingerprint:fingerprints.securityFindingFingerprint('OWASP','CVE-A','a.jar')});assert.equal(table([t],[],'OWASP').normalized().length,1);});
test('H6 reappearance replaces historical row and preserves attempts',()=>{const attempts=[{status:'CLOSED',attemptNumber:1}];const t=task({status:'VERIFIED',scannerStatus:'NOT_DETECTED',securityFindingRemediation:{status:'CLOSED',attempts}}),v=table([t],[]);assert.equal(v.owaspPresentation(v.normalized()[0]).state,'PROJECT_FIX_VERIFIED');v.tasks=[{...t,scannerStatus:'STILL_DETECTED'}];v.cves=[cve];assert.equal(v.normalized().length,1);assert.equal(v.normalized()[0].historical,false);assert.notEqual(v.owaspPresentation(v.normalized()[0]).state,'PROJECT_FIX_VERIFIED');assert.equal(v.tasks[0].securityFindingRemediation.attempts,attempts);});
function retryHarness(){
 let observer,refresh,requests=0,loaded=0,posted;
 const api={retrySecurityFindingRemediation:(...args)=>{requests++;posted=args;return {subscribe:o=>observer=o};},getManualRemediationTasks:()=>new Observable(o=>{loaded++;refresh=o;}),getManualRemediationSummary:()=>new Observable(()=>{})};
 const p=new ProjectDetailComponent(api,{error:()=>{}},{},{},{snapshot:{params:{id:'project'}}},{currentUser:{role:'developer'}});
 p.manualTasks=[failed()];p.syncBatchPolling=()=>{};
 return {p,get observer(){return observer;},get refresh(){return refresh;},get requests(){return requests;},get loaded(){return loaded;},get posted(){return posted;}};
}
test('R1 retry requires backend retryable true and appropriate user role',()=>{for(const retryable of [undefined,false,true]){const t=table([failed({retryable})]);assert.equal(t.canRetry(t.normalized()[0]),retryable===true);t.userRole='viewer';assert.equal(t.canRetry(t.normalized()[0]),false);}});
test('R2 actual API uses dedicated endpoint with server-owned fields excluded',()=>{let url,body;const a=new ApiService({post:(u,b)=>{url=u;body=b;}});a.retrySecurityFindingRemediation('task-id','attempt-id');assert.equal(url,'/api/manual-remediation/task-id/retry');assert.equal(JSON.stringify(body),JSON.stringify({expectedAttemptId:'attempt-id'}));a.retrySecurityFindingRemediation('task-id');assert.equal(JSON.stringify(body),'{}');});
test('R3 button disabled while pending, through server refresh',()=>{const h=retryHarness();h.p.retrySecurityFinding(h.p.manualTasks[0]);assert.ok(h.p.retryPendingIds.has('t'));h.observer.next({});assert.ok(h.p.retryPendingIds.has('t'));h.refresh.next([failed()]);assert.ok(!h.p.retryPendingIds.has('t'));});
test('R4 success reloads authoritative state',()=>{const h=retryHarness();h.p.retrySecurityFinding(h.p.manualTasks[0]);h.observer.next({});assert.equal(h.loaded,1);assert.equal(h.p.manualTasks[0].securityFindingRemediation.status,'TECHNICAL_FAILURE');h.refresh.next([task({securityFindingRemediation:{status:'DISPATCHING'}})]);assert.equal(h.p.manualTasks[0].securityFindingRemediation.status,'DISPATCHING');});
test('R5 backend 409 never fakes DISPATCHING and refreshes',()=>{const h=retryHarness();h.p.retrySecurityFinding(h.p.manualTasks[0]);h.observer.error({status:409});assert.equal(h.p.manualTasks[0].securityFindingRemediation.status,'TECHNICAL_FAILURE');assert.equal(h.loaded,1);h.refresh.error({});assert.ok(!h.p.retryPendingIds.has('t'));});
test('R6 simultaneous double click sends one client request',()=>{const h=retryHarness();h.p.retrySecurityFinding(h.p.manualTasks[0]);h.p.retrySecurityFinding(h.p.manualTasks[0]);assert.equal(h.requests,1);assert.equal(h.posted[1],'attempt-1');});
test('R7 current attempt X / 3 is bound in actual template',()=>{assert.equal(present(failed({attemptNumber:2})).attemptNumber,2);const source=readFileSync(new URL('../src/app/features/projects/cve-table.component.ts',import.meta.url),'utf8');assert.match(source,/Tentative {{ owaspPresentation\(c\)\?\.attemptNumber }} \/ 3/);assert.match(source,/\[disabled\]="retryPendingIds.has/);});
test('exact identity unavailable/ambiguous fails closed, never fuzzy-matched',()=>{const t=table([task({source:'OWASP'})],[cve],'OWASP');assert.equal(t.normalized().length,0);assert.match(t.identityError,/Identité exacte/);assert.throws(()=>view.mergeSecurityFindings([cve],[task(),task({id:'other'})],'TRIVY'),/ambiguë/);});
test('fingerprint bytes match backend algorithm and SHA-256 known vectors',()=>{for(const text of ['','abc','é👋','x'.repeat(1000)])assert.equal(fingerprints.sha256Identity(text),createHash('sha256').update(text).digest('hex'));assert.equal(fingerprints.securityFindingFingerprint('trivy',' CVE-A ','ORG:A'),createHash('sha256').update('TRIVY\ncve-a\norg:a').digest('hex'));});
test('real OWASP fixture retains 146 current and nine historical verified findings',()=>{const read=name=>JSON.parse(readFileSync(new URL(`../src/app/shared/fixtures/${name}.json`,import.meta.url)));const t=table(read('owasp-149-live-tasks').tasks,read('owasp-149-live-cves').cves,'OWASP');assert.equal(t.normalized().length,155);assert.equal(t.normalized().filter(r=>r.historical).length,9);assert.equal(t.owaspRemediationSummary().verifiedFixed,9);});
test('project banner counts distinct dispatch/failure/candidate states and sections retain empty-scan history',()=>{const h=retryHarness();h.p.manualTasks=fixtures;h.p.ed={trivy:{cves:rows}};assert.equal(h.p.dispatchingCount(),1);assert.equal(h.p.failedRetryableCount(),1);assert.equal(h.p.candidateReadyCount(),1);h.p.manualTasks=[failed()];assert.equal(h.p.dispatchingCount(),0);const html=readFileSync(new URL('../src/app/features/projects/project-detail.component.html',import.meta.url),'utf8');assert.match(html,/\*ngIf="dispatchingCount\(\) > 0"/);assert.match(html,/hasSecurityRows\('TRIVY'\)/);assert.match(html,/hasSecurityRows\('OWASP'\)/);});

test('backend canonical Maven aliases correlate exactly with raw OWASP identity',()=>{
 const t=task({source:'OWASP',findingFingerprint:fingerprints.securityFindingFingerprint('OWASP','CVE-A','a.jar'),findingSnapshot:{ruleOrCve:'CVE-A',component:'org:a',legacyPackage:'a.jar',packageType:'maven',pkg:'pkg:maven/org/a@1'}});
 for(const pkg of ['a.jar','pkg:maven/org/a@1']) {
   const v=table([t],[{...cve,pkg,findingTaskId:'t'}],'OWASP');assert.equal(v.normalized().length,1);assert.equal(v.taskFor(v.normalized()[0]).id,'t');
 }
});
test('wrong authoritative findingTaskId blocks identity rather than fuzzy fallback',()=>{
 const v=table([task()],[{...cve,findingTaskId:'wrong-task'}]);assert.equal(v.normalized().length,0);assert.match(v.identityError,/Identité exacte/);
});
test('PR, Git side effects, historical PR, and cap prevent retry without relaunch escape',()=>{
 for(const fields of [{prUrl:'https://github.com/a/b/pull/1'},{branchName:'security/fix/a'},{unresolvedGitSideEffect:true},{attempts:[{status:'TECHNICAL_FAILURE',attemptNumber:1,prUrl:'https://github.com/a/b/pull/1'}]}]) {
   const p=present(failed(fields));assert.equal(p.retryAllowed,false);assert.equal(p.selectable,false);
 }
});
