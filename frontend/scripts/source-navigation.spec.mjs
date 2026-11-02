// Teste le composant « source-navigation » et ses cas d’erreur.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {of} from 'rxjs';
import {loadFrontend} from './security-lifecycle-test-loader.mjs';
const origin='http://localhost:4200';
const types=loadFrontend('../src/app/shared/source-evidence/source-evidence.types.ts',{}, {URL,location:{origin}});
const id='11111111-2222-3333-4444-555555555555';
test('existing local report routes become complete same-origin URLs, no arbitrary path or URL is accepted',()=>{
 const raw={provider:'TRIVY',kind:'TRIVY_REPORT',sourcePath:'/run/local-scanner-reports/a/17/trivy-report.json',applicationPath:`/scanner-reports/${id}/trivy`};
 const normalized=types.normalizeEvidence(raw);
 assert.equal(normalized.url,`${origin}${raw.applicationPath}`);assert.equal(normalized.availability,'LINK');assert.equal(normalized.sourcePath,raw.sourcePath);
 for(const bad of ['//evil.example/x','/api/projects','/scanner-reports/../trivy',`/scanner-reports/${id}/trivy?token=bad`,`/scanner-reports/${id}/owasp/extra`])assert.equal(types.localScannerReportUrl(bad,origin),null);
 assert.equal(types.localScannerReportUrl(raw.applicationPath,'http://user:secret@localhost'),null);
 assert.equal(types.safeEvidenceUrl('http://sonarqube:9000/dashboard'),null);
});
test('report page refuses invalid scanner addresses and inconsistent responses',()=>{
 const {ScannerReportPageComponent}=loadFrontend('../src/app/shared/source-evidence/scanner-report-page.component.ts');
 let calls=0;const c=new ScannerReportPageComponent({}, {
 /** Simule la lecture des données demandées par le composant. */
 getLocalScannerReport:(incidentId,scanner)=>{calls++;return of({incidentId,scanner,content:'{}'})}});
 c.incidentId=id;c.scanner='../../etc/passwd';c.load();assert.equal(calls,0);assert.ok(c.error);
 c.scanner='trivy';c.load();assert.equal(calls,1);assert.equal(c.report.incidentId,id);
 /** Prépare les données nécessaires à ce scénario. */
 c.api.getLocalScannerReport=()=>of({incidentId:'other',scanner:'trivy'});c.load();assert.equal(c.report,null);assert.ok(c.error);
});
test('Jenkins history uses the backend public base and preserves its context path',()=>{
 const {ProjectDetailComponent}=loadFrontend('../src/app/features/projects/project-detail.component.ts',{'../../shared/source-evidence/source-evidence.types':types},{URL});
 const c=Object.create(ProjectDetailComponent.prototype);
 c.project={jenkinsUrl:'http://old.example:8082'};c.projectEvidence={jenkinsBaseUrl:'https://ci.example.org/jenkins'};
 assert.equal(c.buildUrl('http://jenkins:8080/job/a/17/'),'https://ci.example.org/jenkins/job/a/17/');
 assert.equal(c.buildUrl('http://jenkins:8080/jenkins/job/a/17/'),'https://ci.example.org/jenkins/job/a/17/');
 assert.equal(c.buildUrl('javascript:alert(1)'),null);
});
test('login returns to the requested report and refuses external return destinations',()=>{
 const {LoginComponent}=loadFrontend('../src/app/features/auth/login.component.ts');
 for(const [returnUrl,allowed] of [[`/scanner-reports/${id}/zap`,true],['//evil.example',false],['/\\evil.example',false],['https://evil.example',false],['/login',false]]){
  let result='';const c=new LoginComponent({
  /** Envoie les identifiants au backend pour ouvrir la session. */
  login:()=>of({})},{
  /** Prépare les données nécessaires à ce scénario. */
  navigate:()=>{result='dashboard'},
  /** Prépare les données nécessaires à ce scénario. */
  navigateByUrl:url=>{result=url}},{
  /** Prépare les données nécessaires à ce scénario. */
  success(){}},{snapshot:{queryParamMap:{
  /** Récupère les données demandées. */
  get:()=>returnUrl}}});
  c.email='a';c.password='b';c.login();assert.equal(result,allowed?returnUrl:'dashboard');
 }
});
