import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const root = new URL('../src/app/', import.meta.url);
const angular = { Component: () => v => v, Pipe: () => v => v, Input: () => () => {}, Output: () => () => {}, EventEmitter: class {}, signal: value => { const f = () => value; f.set = v => value = v; return f; }, computed: f => f };
function load(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText, {exports, console, Intl, Date, require: name => name === '@angular/core' ? angular : name === '@angular/common/http' ? {HttpErrorResponse:class{}} : name.startsWith('.') ? load(new URL(name+'.ts', new URL(path, root)).href) : {}});
  return exports;
}
const {CveTableComponent} = load('features/projects/cve-table.component.ts');
const eligibility = load('shared/cve-selection-eligibility.ts');
const {getV1_8Presentation} = load('shared/v1-8-compatibility-presentation.ts');
const {sortPipelineStages,pipelineStageLabel} = load('shared/pipeline-stage-presentation.ts');
const {userHttpError} = load('core/http-error-message.ts');
const {presentationLabel,presentationText,zapAlertLabel} = load('shared/status-labels.ts');
const {frenchDuration,frenchDate,frenchNumber} = load('shared/french-format.ts');
const blocked = ['SECURITY_TARGET_UNKNOWN','NO_COMPATIBLE_CANDIDATE','VALIDATION_FAILED','MAJOR_UPGRADE_REQUIRES_REVIEW'];
for (const source of ['TRIVY','OWASP']) {
  const table = new CveTableComponent(); table.source = source;
  table.cves = Array.from({length:9},(_,i)=>({id:`CVE-${i}`,pkg:`a:p${i}`,installedVersion:'1',fixedVersion:'2',severity:'HIGH'}));
  table.tasks = table.normalized().map((c,i)=>({id:`t${i}`,source,findingSnapshot:{component:c.pkg,legacyPackage:c.pkg,ruleOrCve:c.id,currentVersion:'1',fixedVersion:'2'}, ...(i>=5?{v1_8Decision:{state:blocked[i-5],recommendedVersion:'2'}}:{}),...(i===1?{securityFindingRemediation:{status:'DISPATCHING'}}:i===2?{securityFindingRemediation:{status:'CANDIDATE_READY'}}:i===3?{securityFindingRemediation:{status:'CLOSED'}}:i===4?{findingSnapshot:{component:c.pkg,legacyPackage:c.pkg,ruleOrCve:c.id,currentVersion:'1'}}:{})}));
  table.selectionRule=(task,c)=>eligibility.canSelectCveTask(task,true,c);
  // CVE-4 has no reliable target in either source.
  table.cves=table.normalized().map(c=>({...c,fixedVersion:c.id==='CVE-4'?'':c.fixedVersion}));
  for(const [filter,count] of [['ALL',9],['AUTO_FIX_AVAILABLE',1],['MANUAL_REVIEW',5],['IN_PROGRESS',2],['CLOSED',1]]){
    table.owaspRemediationFilter.set(filter);assert.equal(table.filtered().length,count,`${source} ${filter}`);
  }
  assert.equal(table.owaspRemediationSummary().autoFixAvailable,1);
  table.tasks[0].securityFindingRemediation={status:'CLOSED'};
  assert.equal(table.owaspRemediationSummary().closed,2);assert.equal(table.owaspRemediationSummary().autoFixAvailable,0);
  table.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE');assert.equal(table.filtered().length,0);
  for(const state of blocked){const pres=getV1_8Presentation({state},'1');assert.ok(!pres.label.includes(state));assert.ok(pres.reason.length>40);}
  table.tasks[0].securityFindingRemediation=null;
  table.tasks[0].v1_8Decision={state:'VALIDATED_RECOMMENDED',sandboxValidated:true,targetCveClosed:true,recommendedVersion:'2'};
  assert.equal(table.filtered().length,1);assert.equal(table.owaspPresentation(table.normalized()[0]).label,'Correction validée');
  assert.equal(table.v18Count('VALIDATED'),1);
  table.owaspRemediationFilter.set('ALL');table.v18Filter.set('BLOCKED');assert.equal(table.filtered().length,2);
  table.v18Filter.set('ALL'); table.owaspRemediationFilter.set('CLOSED');
  table.tasks[0].v1_8Decision = null; table.tasks[0].status = 'VERIFIED'; table.tasks[0].scannerStatus = 'NOT_DETECTED';
  assert.equal(table.filtered().length, 2, 'scanner-confirmed manual correction is closed too');
  table.tasks[0].status = 'TODO'; table.tasks[0].scannerStatus = 'DETECTED';
  table.cves = table.normalized().map(c => ({...c, fixedVersion: c.id === 'CVE-0' ? '2, 3' : c.fixedVersion}));
  table.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE'); assert.equal(table.filtered().length, 0, 'multiple Trivy target versions are not automatically available');
  console.log(`${source}: five filters, counts, V1.8 blockers and validation PASS`);
}
const ids=['zap','trivy','deploy','sonar','tests','build','owasp','docker','future'];
const expected=['build','tests','sonar','owasp','docker','trivy','deploy','zap','future'];
for(const status of ['FAILED','PASSED','RUNNING','NOT_RUN']) {
 const input=ids.map(stage=>({stage,status})); const sorted=sortPipelineStages(input);
 assert.equal(sorted.map(s=>s.stage).join(','),expected.join(','));
 assert.equal(sortPipelineStages([...input].reverse()).map(s=>s.stage).join(','),expected.join(','));
 assert.equal(input[0].stage,'zap');
}
assert.match(pipelineStageLabel('deploy'),/validation/);
assert.equal(pipelineStageLabel('future'),'Autre étape');
const owner=getV1_8Presentation({state:'VALIDATED_RECOMMENDED',installedVersion:'5.3.20',ownerType:'PARENT',ownerCoordinate:'org.springframework.boot:spring-boot-starter-parent',fromVersion:'2.7.0',recommendedVersion:'2.7.18',sandboxValidated:true,targetCveClosed:true},'2.7.0');
assert.equal(owner.installedVersion,'5.3.20');assert.match(owner.recommendation,/Spring Boot Parent : 2.7.0 → 2.7.18/);
assert.match(userHttpError({status:409,error:{message:'V1_8_EVIDENCE_STALE'}}),/preuves de validation/);
assert.doesNotMatch(userHttpError({status:409,error:{message:'Request failed'}}),/Request failed/);
assert.doesNotMatch(userHttpError({status:500,error:{message:'Internal Server Error'}}),/Internal Server Error/);
for(const name of ['Trivy','Jenkins','OWASP Dependency-Check','SonarQube','ZAP','GitHub','Maven','Spring Boot','Docker','Kubernetes']) assert.equal(presentationLabel(name),name);
assert.equal(frenchDuration(134),'2 min 14 s');assert.equal(frenchDate('invalid'),'Non disponible');assert.match(frenchDate('2026-09-30',false),/30 septembre 2026/);
const template=readFileSync(new URL('features/projects/project-detail.component.html',root),'utf8');
assert.ok(template.indexOf('orderedStages()')<template.indexOf('Historique corrélé des cycles'));
assert.ok(template.indexOf('Déploiement')>=0);
console.log('Ordering, owner versions, French errors, dates and product names PASS');

assert.equal(presentationText('Corriger l’étape Tests: SKIPPED'), 'Corriger l’étape Tests: Non exécuté');
assert.equal(getV1_8Presentation({state:'FUTURE_INTERNAL_ENUM'},'1').label,'Intervention manuelle requise');

assert.ok(template.indexOf('orderedStages()') < template.indexOf('Déploiement final — Azure'), 'final Azure deployment is presented after security gates');

assert.equal(presentationText('OWASP Dependency-Check'), 'OWASP Dependency-Check');
assert.equal(presentationLabel('NOT_ATTEMPTED'), 'Non tenté');

assert.equal(frenchNumber(9.8), '9,8');
assert.equal(zapAlertLabel('Weak Authentication Method'), 'Méthode d’authentification insuffisante');
assert.match(zapAlertLabel('Spring Actuator Information Leak'), /Spring Actuator/);
assert.equal(zapAlertLabel('Unrecognized English Title'), 'Alerte de sécurité ZAP');
