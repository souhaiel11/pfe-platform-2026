import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Subject} from 'rxjs';
import {loadFrontend} from './security-lifecycle-test-loader.mjs';
const truth=loadFrontend('../src/app/shared/data-truth.ts');
const {ProjectDetailComponent}=loadFrontend('../src/app/features/projects/project-detail.component.ts');
const {IncidentDetailComponent}=loadFrontend('../src/app/features/incidents/incident-detail.component.ts');
test('missing, failed and unexecuted scanners cannot produce clean zero metrics',()=>{
 for(const b of [undefined,null,{}, {status:'FAILED',critical:0}, {status:'NOT_RUN',critical:0},{status:'COMPLETED',executed:false,critical:0}])assert.equal(truth.scannerMetric(b,'critical'),null);
 assert.equal(truth.scannerMetric({status:'COMPLETED',critical:0},'critical'),0);
 assert.equal(truth.scannerMetric({status:'COMPLETED'},'critical'),null);
 assert.equal(truth.scannerMetric({status:'COMPLETED',critical:'0'},'critical'),null);
 assert.equal(truth.scannerMetric({cves:[],critical:0},'critical'),0);
});
test('scanner missing states preserve semantics',()=>{
 for(const [status,label]of [['NOT_CONFIGURED','Non configuré'],['NOT_RUN','Non exécuté'],['FAILED','Indisponible'],['RUNNING','En attente']])assert.equal(truth.scannerState({status}),label);
});
test('late project A reads are cancelled before project B can render',()=>{
 const first=new Subject(),second=new Subject();let calls=0;
 const c=new ProjectDetailComponent({getProject:()=>++calls===1?first:second,getProjectSourceEvidence:()=>new Subject(),getIncidentSourceEvidence:()=>new Subject()},{error(){}},{},{},{},{currentUser:{role:'viewer'}});
 for(const k of ['loadIncidents','loadReports','loadJenkinsBuilds','loadJudgeStatus','loadDeployReadiness','loadConvergence','loadManualRemediation'])c[k]=()=>{};
 c.id='A';c.loadProject();c.latestReport={id:'A'};c.ed={sonar:{project:'A'}};c.lastScore=100;
 c.id='B';c.ngOnChanges({id:{firstChange:false}});
 assert.equal(first.observed,false);assert.equal(c.project,null);assert.equal(c.latestReport,null);assert.equal(c.lastScore,null);assert.equal(c.scoreUnavailable,true);assert.equal(JSON.stringify(c.ed),'{}');
 first.next({id:'A'});assert.equal(c.project,null);second.next({id:'B'});assert.equal(c.project.id,'B');c.ngOnDestroy();assert.equal(second.observed,false);
});
test('incident reuse clears previous evidence and cancels late callbacks',()=>{
 const old=new Subject(),fresh=new Subject();let calls=0;
 const c=new IncidentDetailComponent({getIncident:()=>++calls===1?old:fresh,getIncidentSourceEvidence:()=>new Subject()},{},{},{},{currentUser:{role:'viewer'}});
 c.id='A';c.load();c.incident={id:'A'};c.aiAnalysis={securityLevel:'LOW'};
 c.id='B';c.ngOnChanges({id:{firstChange:false}});
 assert.equal(old.observed,false);assert.equal(c.incident,null);assert.equal(c.aiAnalysis,null);old.next({id:'A'});assert.equal(c.incident,null);c.ngOnDestroy();assert.equal(fresh.observed,false);
});
test('an agent narrative cannot be inferred from a file name containing Security',()=>{
 const c=Object.create(ProjectDetailComponent.prototype);c.rp={agentActions:'ROOT CAUSE AGENT: SecurityConfig.java | REMEDIATION AGENT: recommendations'};
 assert.equal(c.getAgentText('security'),'');assert.match(c.getAgentText('root'),/ROOT CAUSE/);
});

test('global scanner totals exclude failed, missing and source-less project observations',()=>{
 const s=truth.securitySummaryForDisplay({summary:{totalCriticalCves:99},projectsWithoutData:['empty'],byProject:[{projectName:'ok',missingScanners:[],trivy:{critical:2,high:3},owasp:{critical:1,high:4},zap:{high:0,medium:0}},{projectName:'failed',missingScanners:['trivy','owasp','zap'],trivy:{critical:90},owasp:{critical:6}},{projectName:'empty',missingScanners:[],trivy:{critical:0},owasp:{critical:0}}]});
 assert.equal(s.totalCriticalCves,3);assert.equal(s.totalHighCves,7);assert.equal(s.totalMediumCves,null);assert.equal(s.zapHighAlerts,0);
 assert.equal(truth.securitySummaryForDisplay({summary:{},byProject:[]}).totalCriticalCves,null);
});

test('unknown quality gates are neutral, and explicit scanner errors cannot inherit a past pass',()=>{assert.equal(truth.qualityGatePresentation({}).label,'Non disponible');assert.equal(truth.qualityGatePresentation({status:'FAILED',quality_gate:'OK'}).color,'var(--text-muted)');assert.equal(truth.qualityGatePresentation({status:'COMPLETED',quality_gate:'ERROR'}).label,'Échec');assert.equal(truth.qualityGatePresentation({quality_gate:'OK'}).label,'Réussi');});

// ════════════════════════════════════════════════════════════════════════════
// R46 — « mesure disponible » et « contrôle qualité résolu » sont deux faits
// distincts. WF1 reporte la résolution du contrôle qualité dans
// `resultAvailable` du bloc Sonar : sur un build de BRANCHE il vaut false
// (l'analysisId n'est résolu que sur les builds de PR), alors que les mesures
// sont bien présentes et réelles. Les masquer revenait à afficher « Non
// disponible » sur des chiffres mesurés.
// Constaté en réel sur app-test-pfe-vermeg build #2 : status COMPLETED,
// code_smells 7, bugs 0, coverage mesurée, et resultAvailable false.
// ════════════════════════════════════════════════════════════════════════════
test('R46 les mesures Sonar restent lisibles quand seul le contrôle qualité est non résolu',()=>{
 const sonarBranchBuild={status:'COMPLETED',executed:true,resultAvailable:false,
   qualityGateResolved:false,quality_gate:'QUALITY_GATE_UNAVAILABLE',
   bugs:0,vulnerabilities:0,code_smells:7,coverage:92.4};
 assert.equal(truth.scannerHasResult(sonarBranchBuild),true,'le bloc porte des mesures réelles');
 assert.equal(truth.scannerMetric(sonarBranchBuild,'code_smells'),7);
 assert.equal(truth.scannerMetric(sonarBranchBuild,'bugs'),0);
 assert.equal(truth.scannerMetric(sonarBranchBuild,'vulnerabilities'),0);
 assert.equal(truth.scannerMetric(sonarBranchBuild,'coverage'),92.4);
 // ... mais le contrôle qualité reste non résolu, et ne devient pas un verdict.
 assert.equal(truth.sonarQualityGate(sonarBranchBuild),null);
 assert.equal(truth.qualityGatePresentation(sonarBranchBuild).label,'Non disponible');
});

test('R46 un scanner sans suivi de contrôle qualité garde l\'ancienne sémantique',()=>{
 // Trivy/OWASP/ZAP : `resultAvailable:false` veut toujours dire « pas de
 // rapport exploitable ». Rien ne change pour eux.
 const trivyNoReport={status:'COMPLETED',executed:true,resultAvailable:false,critical:0,high:3};
 assert.equal(truth.scannerHasResult(trivyNoReport),false);
 assert.equal(truth.scannerMetric(trivyNoReport,'high'),null,'un rapport absent ne devient jamais un comptage');
 const trivyWithReport={status:'COMPLETED',executed:true,resultAvailable:true,critical:1,high:3};
 assert.equal(truth.scannerMetric(trivyWithReport,'high'),3);
});

test('R46 un contrôle qualité réellement résolu s\'affiche comme verdict',()=>{
 const ok={status:'COMPLETED',executed:true,resultAvailable:true,qualityGateResolved:true,quality_gate:'OK'};
 assert.equal(truth.sonarQualityGate(ok),'OK');
 assert.equal(truth.qualityGatePresentation(ok).label,'Réussi');
 const ko={...ok,quality_gate:'ERROR'};
 assert.equal(truth.sonarQualityGate(ko),'ERROR');
 assert.equal(truth.qualityGatePresentation(ko).label,'Échec');
});

test('R46 les marqueurs d\'indisponibilité ne sont jamais présentés comme un verdict',()=>{
 for(const marker of ['QUALITY_GATE_UNAVAILABLE','QUALITY_GATE_NOT_COMPUTED','API_ERROR',
                      'SONAR_ANALYSIS_FAILED','SONAR_ANALYSIS_CANCELED','SONAR_ANALYSIS_TIMEOUT']){
  assert.equal(truth.sonarQualityGate({status:'COMPLETED',quality_gate:marker}),null,marker);
  assert.equal(truth.qualityGatePresentation({status:'COMPLETED',quality_gate:marker}).label,'Non disponible',marker);
 }
 // Une exécution en échec reste annoncée comme telle, jamais comme un gate.
 assert.equal(truth.qualityGatePresentation({status:'FAILED',quality_gate:'OK'}).label,'Indisponible');
});

test('R46 une couverture non mesurée ne se confond pas avec une couverture nulle',()=>{
 const measured={status:'COMPLETED',executed:true,qualityGateResolved:false,coverage:0};
 const notMeasured={status:'COMPLETED',executed:true,qualityGateResolved:false};
 assert.equal(truth.scannerMetric(measured,'coverage'),0,'0 % mesuré est une donnée');
 assert.equal(truth.scannerMetric(notMeasured,'coverage'),null,'absence de mesure reste absence');
});

// ════════════════════════════════════════════════════════════════════════════
// R46 — la couverture affichée doit venir d'UNE seule source autoritaire :
// le rapport de couverture du build (`tests.coverage`), que la bibliothèque
// partagée remplit depuis le XML de JaCoCo.
//
// Le bloc Sonar expose aussi un champ `coverage`, mais WF1 le lit sur la
// réponse de l'API /issues, qui ne porte pas ce champ : il vaut 0 par
// construction pour TOUS les projets. L'afficher revenait à montrer 0 % à des
// projets dont la couverture réelle est de 88,9 %.
// ════════════════════════════════════════════════════════════════════════════
test('R46 la couverture affichée vient du rapport de build, pas du bloc Sonar',()=>{
 const c=new ProjectDetailComponent({getProject:()=>({subscribe(){}})},{error(){}},{},{},{},{currentUser:{role:'viewer'}});
 // Cas réel : Sonar porte 0 par construction, le build porte la vraie mesure.
 c.ed={sonar:{status:'COMPLETED',coverage:0},tests:{total:24,failures:0,coverage:92}};
 assert.equal(c.authoritativeCoverage(),92,'la mesure du build gagne');
 // Pas de rapport de couverture -> absence, jamais 0.
 c.ed={sonar:{status:'COMPLETED',coverage:0},tests:{total:24,failures:0,coverage:null}};
 assert.equal(c.authoritativeCoverage(),null,'absence de mesure reste absence');
 // Une couverture réellement nulle reste 0, et se distingue de null.
 c.ed={sonar:{status:'COMPLETED',coverage:0},tests:{total:24,failures:0,coverage:0}};
 assert.equal(c.authoritativeCoverage(),0,'0 % réellement mesuré est une donnée');
 // Bloc de tests absent -> absence.
 c.ed={sonar:{status:'COMPLETED',coverage:0}};
 assert.equal(c.authoritativeCoverage(),null);
 // Valeur non numérique -> absence, jamais une coercition.
 c.ed={tests:{coverage:'92'}};
 assert.equal(c.authoritativeCoverage(),null,'une chaîne n\'est pas une mesure');
});

test('R46 une seule source de couverture : le gabarit ne lit plus ed.sonar.coverage',()=>{
 const tpl=readFileSync(new URL('../src/app/features/projects/project-detail.component.html',import.meta.url),'utf8');
 assert.ok(tpl.includes('authoritativeCoverage()'),'le gabarit lit la source autoritaire');
 assert.ok(!/ed\.sonar\.coverage/.test(tpl),'le gabarit ne lit plus le champ Sonar, nul par construction');
});
