// Teste le composant « frontend-finalization » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const root = new URL('../src/app/', import.meta.url);
const angular = {
/** Simule le décorateur de composant Angular. */
Component: () => v => v,
/** Prépare les données nécessaires à ce scénario. */
Pipe: () => v => v,
/** Simule une entrée de composant Angular. */
Input: () => () => {},
/** Simule une sortie de composant Angular. */
Output: () => () => {}, EventEmitter: class {},
/** Prépare une valeur réactive pour le scénario. */
signal: value => {
/** Renvoie les contrôles du formulaire. */
const f = () => value;
/** Affecte la valeur prévue au champ. */
f.set = v => value = v; return f; },
/** Prépare le calcul réactif du scénario. */
computed: f => f };
/** Charge les données nécessaires au composant. */
function load(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText, {exports, console, Intl, Date, TextEncoder,
  /** Charge la dépendance prévue pour le scénario. */
  require: name => name === '@angular/core' ? angular : name === '@angular/common/http' ? {HttpErrorResponse:class{}} : name.startsWith('.') ? load(new URL(name+'.ts', new URL(path, root)).href) : {}});
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
  table.cves = Array.from({length:9},(_,i)=>({id:`CVE-${i}`,pkg:`a:p${i}`,installedVersion:'1.0',fixedVersion:'1.1',severity:'HIGH'}));
  table.tasks = table.normalized().map((c,i)=>({id:`t${i}`,source,findingSnapshot:{component:c.pkg,legacyPackage:c.pkg,ruleOrCve:c.id,currentVersion:'1.0',fixedVersion:'1.1'}, ...(i>=5?{v1_8Decision:{state:blocked[i-5],recommendedVersion:'2'}}:{}),...(i===1?{securityFindingRemediation:{status:'DISPATCHING'}}:i===2?{securityFindingRemediation:{status:'CANDIDATE_READY'}}:i===3?{securityFindingRemediation:{status:'CLOSED'}}:i===4?{findingSnapshot:{component:c.pkg,legacyPackage:c.pkg,ruleOrCve:c.id,currentVersion:'1.0'}}:{})}));
  /** Décrit la règle de sélection appliquée à la tâche. */
  table.selectionRule=(task,c)=>eligibility.canSelectCveTask(task,true,c);
  // CVE-4 has no reliable target in either source.
  table.cves=table.normalized().map(c=>({...c,fixedVersion:c.id==='CVE-4'?'':c.fixedVersion}));
  for(const [filter,count] of [['ALL',9],['AVAILABLE',1],['MANUAL',6],['IN_PROGRESS',1],['PROPOSED',1],['CLOSED',0]]){
    table.owaspRemediationFilter.set(filter);assert.equal(table.filtered().length,count,`${source} ${filter}`);
  }
  assert.equal(table.owaspRemediationSummary().autoFixAvailable,1);
  table.tasks[0].securityFindingRemediation={status:'CLOSED'};
  assert.equal(table.owaspRemediationSummary().verifiedFixed,0);assert.equal(table.owaspRemediationSummary().autoFixAvailable,0);
  table.owaspRemediationFilter.set('AVAILABLE');assert.equal(table.filtered().length,0);
  for(const state of blocked){const pres=getV1_8Presentation({state},'1');assert.ok(!pres.label.includes(state));assert.ok(pres.reason.length>40);}
  table.tasks[0].securityFindingRemediation=null;
  table.tasks[0].v1_8Decision={state:'VALIDATED_RECOMMENDED',sandboxValidated:true,targetCveClosed:true,recommendedVersion:'2'};
  assert.equal(table.filtered().length,1);assert.equal(table.owaspPresentation(table.normalized()[0]).label,'Correction automatique disponible');
  // Le filtre d'eligibilite ne parle plus le vocabulaire des decisions V1.8
  // (VALIDATED / BLOCKED) : il est desormais derive de la version corrigee
  // reelle et n'accepte que ALL | AUTO | MAJOR_UPGRADE | MANUAL. On fige donc
  // la partition complete sur ce meme jeu de donnees, ce qui interdit aussi
  // qu'une puce devienne silencieusement morte.
  assert.equal(table.v18Count('AUTO'),1,`${source} : une seule ligne auto-corrigeable`);
  assert.equal(table.v18Count('MANUAL'),5,`${source} : cinq lignes sans cible exploitable`);
  assert.equal(table.v18Count('MAJOR_UPGRADE'),0,`${source} : aucune migration majeure dans ce jeu`);
  assert.equal(table.v18Count('ALL'),9,`${source} : le filtre « Toutes » ne doit jamais retirer de ligne`);
  table.owaspRemediationFilter.set('ALL');table.v18Filter.set('AUTO');
  assert.equal(table.filtered().map(c=>c.id).join(','),'CVE-0',`${source} : le filtre AUTO isole la ligne auto-corrigeable`);
  table.v18Filter.set('MANUAL');assert.equal(table.filtered().length,5,`${source} : le filtre MANUAL isole les lignes sans cible`);
  table.v18Filter.set('ALL'); table.owaspRemediationFilter.set('CLOSED');
  table.tasks[0].v1_8Decision = null; table.tasks[0].status = 'VERIFIED'; table.tasks[0].scannerStatus = 'NOT_DETECTED';
  assert.equal(table.filtered().length, 1, 'only scanner-confirmed correction is fixed');
  table.tasks[0].status = 'TODO'; table.tasks[0].scannerStatus = 'DETECTED';
  // Controle negatif : une cible qui franchit la majeure installee (1.0 -> 2.0)
  // sort de « Corrections disponibles » et passe en revue manuelle.
  table.cves = table.normalized().map(c => ({...c, fixedVersion: c.id === 'CVE-0' ? '2.0' : c.fixedVersion}));
  table.owaspRemediationFilter.set('AVAILABLE'); assert.equal(table.filtered().length, 0, 'a cross-major target is never automatically available');
  table.owaspRemediationFilter.set('MANUAL'); assert.ok(table.filtered().some(c => c.id === 'CVE-0'), 'a cross-major target belongs to manual review');
  // La puce « Migration majeure requise » doit capter exactement cette ligne.
  table.owaspRemediationFilter.set('ALL'); table.v18Filter.set('MAJOR_UPGRADE');
  assert.equal(table.filtered().map(c=>c.id).join(','),'CVE-0',`${source} : le filtre MAJOR_UPGRADE capte la cible cross-majeure`);
  table.v18Filter.set('AUTO'); assert.equal(table.filtered().length,0,`${source} : une cible cross-majeure quitte le filtre AUTO`);
  table.v18Filter.set('ALL'); table.owaspRemediationFilter.set('AVAILABLE');
  table.cves = table.normalized().map(c => ({...c, fixedVersion: c.id === 'CVE-0' ? '1.1' : c.fixedVersion}));
  table.owaspRemediationFilter.set('AVAILABLE'); assert.equal(table.filtered().length, 1, 'the same-major target is available again once restored');
  table.cves = table.normalized().map(c => ({...c, fixedVersion: c.id === 'CVE-0' ? '1.1, 1.2' : c.fixedVersion}));
  table.owaspRemediationFilter.set('AVAILABLE'); assert.equal(table.filtered().length, 0, 'multiple Trivy target versions are not automatically available');
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

// Phase 2B.3 — the legacy inline "Déploiement final — Azure" box was
// replaced by <app-deployment-governance> (see deployment-governance.component.ts);
// the ordering invariant itself (deploy section after security gates) still holds.
assert.ok(template.indexOf('orderedStages()') < template.indexOf('<app-deployment-governance'), 'final Azure deployment is presented after security gates');

assert.equal(presentationText('OWASP Dependency-Check'), 'OWASP Dependency-Check');
assert.equal(presentationLabel('NOT_ATTEMPTED'), 'Non tenté');

assert.equal(frenchNumber(9.8), '9,8');
assert.equal(zapAlertLabel('Weak Authentication Method'), 'Méthode d’authentification insuffisante');
assert.match(zapAlertLabel('Spring Actuator Information Leak'), /Spring Actuator/);
assert.equal(zapAlertLabel('Unrecognized English Title'), 'Alerte de sécurité ZAP');
