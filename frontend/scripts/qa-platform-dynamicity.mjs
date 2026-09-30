import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const auth=JSON.parse(fs.readFileSync(process.env.QA_SESSION_FILE,'utf8'));
const base=process.env.QA_BASE_URL || 'http://127.0.0.1:4200';
const out=process.env.QA_OUTPUT_DIR || '/tmp/settings-dynamicity-visual';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();const results={pages:[],errors:[],blockedWrites:[],scenarios:[]};
await context.addInitScript(a=>{localStorage.setItem('token',a.token);localStorage.setItem('user',JSON.stringify(a.user));},auth);
await context.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():(results.blockedWrites.push({method:route.request().method(),path:new URL(route.request().url()).pathname}),route.abort()));
const page=await context.newPage();page.on('pageerror',e=>results.errors.push(e.message));
async function capture(name,url,width){await page.setViewportSize({width,height:1000});if(url)await page.goto(base+url);await page.waitForTimeout(1100);const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=width+1,name+' overflow');await page.screenshot({path:out+'/'+name+'.png',fullPage:true});results.pages.push({name,...size});}
try {
 const response=await context.request.get(base+'/api/dashboard/capabilities',{headers:{Authorization:'Bearer '+auth.token}});assert.equal(response.status(),200);const capabilities=await response.json();results.capabilities=capabilities;
 const projectsResponse=await context.request.get(base+'/api/projects',{headers:{Authorization:'Bearer '+auth.token}});assert.equal(projectsResponse.status(),200);const projects=await projectsResponse.json();
 await capture('settings-desktop','/settings',1440);let text=await page.locator('body').innerText();assert.doesNotMatch(text,/Grafana|WSL Ubuntu|llama3\.2|Version Angular|Version n8n/);assert.match(text,/Mode de correction/);assert.match(text,/Types d’édition/i);
 const mode=capabilities.remediation.enforcementMode==='SHADOW'?'Observation (Shadow)':'Contrôle appliqué';assert.ok(text.includes(mode));
 await capture('settings-mobile',null,390);
 if(await page.locator('.tool-name').count()){const name=await page.locator('.tool-name').first().boundingBox();assert.ok(name.width>150 && name.height<50,'mobile integration name must remain readable');}
 await capture('dashboard-desktop','/dashboard',1440);await capture('dashboard-mobile',null,390);
 await capture('projects-desktop','/projects',1440);await capture('projects-mobile',null,390);
 if(projects.length){const project=projects[0];await capture('project-security-desktop','/projects/'+project.id+'?tab=securite',1440);await capture('project-security-mobile',null,390);await capture('project-config-desktop','/projects/'+project.id+'?tab=config',1440);await capture('project-config-mobile',null,390);await capture('project-edit-desktop','/projects/'+project.id+'/edit',1440);assert.equal(await page.locator('input[formcontrolname="emailEnabled"],input[formcontrolname="slackEnabled"]').count(),0);await capture('project-edit-mobile',null,390);for(const button of await page.locator('.pf-header button').all()){const box=await button.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=391,'project header action must remain visible on mobile');}}
 await capture('analysis-desktop','/analysis',1440);await capture('risk-desktop','/prediction',1440);await capture('security-desktop','/security',1440);
 // Synthetic backend responses validate empty/error/unavailable/change cases;
 // no project or configuration is created or changed in the database.
 let scenario='empty';
 await page.route('**/api/integrations',r=>r.fulfill({status:scenario==='error'?503:200,contentType:'application/json',body:scenario==='error'?'{}':'[]'}));
 await page.route('**/api/dashboard/capabilities',r=>r.fulfill({status:scenario==='error'?503:200,contentType:'application/json',body:JSON.stringify({security:scenario==='changed'?[{id:'trivy',projectsReported:2,projectsCompleted:1}]:[],remediation:{enforcementMode:scenario==='changed'?'ENFORCED':'SHADOW',supportedEditTypes:scenario==='changed'?['PROPERTY_VERSION']:[]},ci:{configuredProjects:scenario==='changed'?2:0},deployment:{configuredProjects:0,agentConfigured:false}})}));
 await capture('settings-empty','/settings',1440);text=await page.locator('body').innerText();assert.match(text,/Aucune intégration/);assert.match(text,/Aucune étape de scanner/);assert.equal(await page.locator('.settings-layout input').count(),0);results.scenarios.push('EMPTY/UNAVAILABLE PASS');
 scenario='error';await capture('settings-api-error','/settings',1440);text=await page.locator('body').innerText();assert.match(text,/Impossible de récupérer les capacités/);assert.match(text,/Impossible de récupérer les intégrations/);assert.doesNotMatch(text,/Observation \(Shadow\)/);results.scenarios.push('ERROR without fake defaults PASS');
 scenario='changed';await capture('settings-changed-data','/settings',1440);text=await page.locator('body').innerText();assert.match(text,/Contrôle appliqué/);assert.match(text,/Propriété Maven/);assert.doesNotMatch(text,/Version de dépendance|Parent Maven/);assert.match(text,/1 \/ 2 projet/);results.scenarios.push('Changed backend mode/edit types/scanner data PASS');
 // Two project names, repositories and environments are supplied by the API.
 await page.route('**/api/projects',r=>r.fulfill({contentType:'application/json',body:JSON.stringify([{id:'fixture-one',name:'Projet Alpha',githubRepo:'team/alpha',environment:'dev'},{id:'fixture-two',name:'Projet Bêta',githubRepo:'other/beta',environment:'prod'}])}));
 await page.route('**/api/dashboard/security-global',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({byProject:[],summary:{},projectsWithoutData:[]})}));
 await capture('projects-two-fixtures','/projects',1440);text=await page.locator('body').innerText();assert.match(text,/Projet Alpha/);assert.match(text,/Projet Bêta/);await page.route('**/api/**',r=>{
 const url=new URL(r.request().url());
 if(url.pathname==='/api/projects/fixture-two')return r.fulfill({contentType:'application/json',body:JSON.stringify({id:'fixture-two',name:'Projet Bêta',githubRepo:'other/beta',environment:'prod',cicdTool:'jenkins',jenkinsJobName:'other-job'})});
 if(url.pathname.includes('fixture-two') || url.searchParams.get('projectId')==='fixture-two') {
   const body=url.pathname.includes('jenkins-status')?{_liveData:false,message:'Jenkins non configuré',builds:[]}:url.pathname.includes('/ready/')?{ready:false,requiredStages:[],reasons:[],deploymentConfigured:false}:url.pathname.includes('convergence')?{cycles:[]}:url.pathname.includes('/summary')?{}:[];
   return r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 }
 return r.fallback();
});
await capture('second-project-config','/projects/fixture-two?tab=config',1440);text=await page.locator('body').innerText();assert.match(text,/Projet Bêta/);assert.match(text,/other\/beta/);assert.doesNotMatch(text,/pfe-app-test/);results.scenarios.push('SECOND PROJECT/REPOSITORY PASS');
 assert.equal(results.errors.length,0);assert.equal(results.blockedWrites.length,0);results.pass=true;
} catch(error){results.pass=false;results.failure=error.message;process.exitCode=1;await page.screenshot({path:out+'/failure.png',fullPage:true});}
finally {fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));await browser.close();console.log(JSON.stringify(results));}
