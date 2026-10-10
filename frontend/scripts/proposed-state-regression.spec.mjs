import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {loadFrontend} from './security-lifecycle-test-loader.mjs';
const shared=loadFrontend('../src/app/shared/security-remediation-presentation.ts');
const eligibility=loadFrontend('../src/app/shared/cve-selection-eligibility.ts');
const {CveTableComponent}=loadFrontend('../src/app/features/projects/cve-table.component.ts');
const {ProjectDetailComponent}=loadFrontend('../src/app/features/projects/project-detail.component.ts');
const fixture=JSON.parse(readFileSync(new URL('../src/app/shared/fixtures/proposed-state-live-regression.json',import.meta.url)));
function table(source,tasks=fixture.tasks,rows=[]){const t=new CveTableComponent();t.source=source;t.tasks=tasks;t.cves=rows;t.userRole='developer';t.selectionRule=(task,row)=>eligibility.canSelectCveTask(task,true,row);return t;}
test('live regression: 1 current candidate + 11 CLOSED with PR = exactly 1 proposed, 11 manual',()=>{
 let proposed=0,manual=0,total=0;
 for(const source of ['TRIVY','OWASP']){const t=table(source),s=t.owaspRemediationSummary();proposed+=s.candidateReady;manual+=s.manualRequired;total+=s.total;t.owaspRemediationFilter.set('PROPOSED');assert.equal(t.filtered().length,s.candidateReady);t.owaspRemediationFilter.set('MANUAL');assert.equal(t.filtered().length,s.manualRequired);for(const row of t.normalized())assert.equal(shared.remediationCategory(t.owaspPresentation(row).state),t.taskFor(row).securityFindingRemediation.status==='CANDIDATE_READY'?'PROPOSED':'MANUAL');assert.equal(s.autoFixAvailable+s.dispatching+s.candidateReady+s.failedRetryable+s.verifiedFixed+s.manualRequired,s.total);}
 assert.equal(proposed,1);assert.equal(manual,11);assert.equal(total,12);
});
const base=fixture.tasks[1];
function present(status='CLOSED',fields={},taskFields={}){const t={...base,...taskFields,securityFindingRemediation:{...base.securityFindingRemediation,status,...fields}};return shared.getSecurityRemediationPresentation(t,{selectable:true,reason:''});}
for(const [name,taskFields,fields] of [
 ['C1 CLOSED + PR + DETECTED',{scannerStatus:'DETECTED'},{}],
 ['C2 CLOSED + PR + STILL_DETECTED',{scannerStatus:'STILL_DETECTED'},{}],
 ['C3 CLOSED + PR + TODO',{status:'TODO'},{}],
 ['C5 CLOSED without PR + DETECTED',{scannerStatus:'DETECTED'},{prUrl:null}],
 ['CLOSED + NOT_DETECTED without VERIFIED',{status:'TODO',scannerStatus:'NOT_DETECTED'},{}],
])test(name,()=>{const p=present('CLOSED',fields,taskFields);assert.equal(p.state,'VERIFICATION_REQUIRED');assert.equal(p.label,'Correction à vérifier');assert.equal(shared.remediationCategory(p.state),'MANUAL');assert.equal(p.retryAllowed,false);assert.equal(p.selectable,false);});
test('C4 CLOSED + PR + VERIFIED + NOT_DETECTED is corrected with optional historical PR',()=>{const p=present('CLOSED',{}, {status:'VERIFIED',scannerStatus:'NOT_DETECTED'});assert.equal(p.state,'PROJECT_FIX_VERIFIED');assert.equal(shared.remediationCategory(p.state),'CLOSED');assert.ok(p.prUrl);assert.equal(p.styleKey,'muted');});
test('C6 CLOSED never derives CANDIDATE_READY, regardless of URL or retryability',()=>{for(const retryable of [undefined,false,true])for(const prUrl of [null,base.securityFindingRemediation.prUrl])assert.notEqual(present('CLOSED',{prUrl,retryable}).state,'CANDIDATE_READY');});
test('P1/P2 only current CANDIDATE_READY is proposed, with or without PR',()=>{for(const prUrl of [null,base.securityFindingRemediation.prUrl])assert.equal(present('CANDIDATE_READY',{prUrl}).state,'CANDIDATE_READY');});
test('P3 adding/removing a PR never changes lifecycle category',()=>{for(const status of ['CLOSED','TECHNICAL_FAILURE','DISPATCH_FAILED','FAILED','DISPATCHING','MANUAL','PR_CREATED','PR_REUSED','CANDIDATE_READY'])for(const retryable of [false,true]){const without=present(status,{prUrl:null,retryable}),withPr=present(status,{retryable});assert.equal(without.state,withPr.state);assert.equal(shared.remediationCategory(without.state),shared.remediationCategory(withPr.state));assert.equal(withPr.prUrl,base.securityFindingRemediation.prUrl);}});
test('P4 prior candidate attempts and historical PR cannot override current failure',()=>{const p=present('TECHNICAL_FAILURE',{retryable:false,attempts:[{status:'CANDIDATE_READY',prUrl:base.securityFindingRemediation.prUrl,attemptNumber:1}]});assert.equal(p.state,'NON_RETRYABLE_FAILURE');assert.equal(shared.remediationCategory(p.state),'MANUAL');});
test('row/filter/counter/project banner share the strict classification for the 12-record fixture',()=>{
 const p=new ProjectDetailComponent({}, {}, {}, {}, {snapshot:{params:{id:'project'}}},{currentUser:{role:'developer'}});p.manualTasks=fixture.tasks;p.ed={trivy:{cves:[]},owasp:{cves:[]}};assert.equal(p.candidateReadyCount(),1);assert.equal(p.dispatchingCount(),0);assert.equal(p.failedRetryableCount(),0);assert.equal(p.securityLifecycleSummary().manualRequired,11);
});
test('current scan row and current task reality win over old attempts without mutating history',()=>{
 const task={...base,status:'VERIFIED',scannerStatus:'STILL_DETECTED',securityFindingRemediation:{...base.securityFindingRemediation,attempts:[{status:'CLOSED',prUrl:base.securityFindingRemediation.prUrl,attemptNumber:1}]}};const snapshot=JSON.stringify(task);const row={id:task.ruleOrCve,pkg:task.findingSnapshot.component,source:'TRIVY',findingTaskId:task.id};const t=table('TRIVY',[task],[row]);assert.equal(t.normalized().length,1);assert.equal(t.normalized()[0].historical,false);assert.equal(t.owaspPresentation(t.normalized()[0]).state,'VERIFICATION_REQUIRED');assert.equal(JSON.stringify(task),snapshot);t.tasks=[{...task,securityFindingRemediation:{...task.securityFindingRemediation,status:'DISPATCHING'}}];assert.equal(t.owaspPresentation(t.normalized()[0]).state,'DISPATCHING');
});
test('neutral PR details and verification label share row presentation without a positive historical badge',()=>{const source=readFileSync(new URL('../src/app/features/projects/cve-table.component.ts',import.meta.url),'utf8');assert.match(source,/owaspPresentation\(c\)\?\.prUrl as prUrl/);assert.match(source,/PR associée/);assert.doesNotMatch(source,/wf6ProposedPr\(task/);});
