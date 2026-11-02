// Teste le composant « remediation-target-conflict » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { loadFrontend } from './security-lifecycle-test-loader.mjs';
const evidence=loadFrontend('../src/app/shared/source-evidence/source-evidence.types.ts',{}, {URL});
const {userHttpError}=loadFrontend('../src/app/core/http-error-message.ts',{'@angular/common/http':{HttpErrorResponse:class {}}});
const error=userHttpError({status:409,error:{code:'REMEDIATION_TARGET_ALREADY_IN_PROGRESS',message:'Correction déjà en cours sur le même fichier de dépendances.'}});
assert.match(error,/même fichier/);assert.match(error,/Aucune nouvelle correction/);assert.ok(!error.includes('code technique'));
const {ProjectDetailComponent}=loadFrontend('../src/app/features/projects/project-detail.component.ts',{'../../shared/source-evidence/source-evidence.types':evidence});
const p=Object.create(ProjectDetailComponent.prototype);p.id='project-a';
const task={projectId:'project-a',ruleOrCve:'CVE-2022-42889',securityFindingRemediation:{status:'CANDIDATE_READY',prUrl:'https://github.com/owner/repo/pull/1',prNumber:1,reservationTarget:{projectId:'project-a',targetFile:'pom.xml'}}};
p.manualTasks=[task];assert.equal(p.pendingFileCorrection.cve,'CVE-2022-42889');assert.equal(p.pendingFileCorrection.targetFile,'pom.xml');assert.equal(p.pendingFileCorrection.prNumber,1);
for(const patch of [{targetFinalizedAt:'2026-10-15'}, {status:'DISPATCHING'}, {status:'TECHNICAL_FAILURE'}, {prUrl:'javascript:alert(1)'}, {prUrl:'https://user:password@example.org'}, {reservationTarget:{projectId:'other',targetFile:'pom.xml'}}]){
 p.manualTasks=[{...task,securityFindingRemediation:{...task.securityFindingRemediation,...patch}}];assert.equal(p.pendingFileCorrection,null);
}
p.manualTasks=[{...task,projectId:'other'}];assert.equal(p.pendingFileCorrection,null);
p.manualTasks=[];assert.equal(p.pendingFileCorrection,null);
console.log('PASS: readable target conflict, correct project proposal, safe links, finalized/failed proposals excluded; no reservation mutation.');
