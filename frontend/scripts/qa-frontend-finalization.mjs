// Read-only visual checks. Supply QA_SESSION_FILE with a temporary {token,user} session.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.QA_OUTPUT_DIR || '/tmp/frontend-finalization-qa';fs.mkdirSync(out,{recursive:true});
const auth=JSON.parse(fs.readFileSync(process.env.QA_SESSION_FILE || '/tmp/frontend-qa-auth.json','utf8'));
const browser=await chromium.launch({headless:true});
const results={pages:[],counts:{},stages:[],errors:[],blockedWrites:[]};
const context=await browser.newContext();
await context.addInitScript(a=>{localStorage.setItem('token',a.token);localStorage.setItem('user',JSON.stringify(a.user));},auth);
await context.route('**/*',route=>{const req=route.request();if(!['GET','HEAD','OPTIONS'].includes(req.method())){results.blockedWrites.push({method:req.method(),url:req.url().replace(/token=[^&]+/g,'token=REDACTED')});return route.abort();}return route.continue();});
const page=await context.newPage();page.on('pageerror',e=>results.errors.push(e.message));page.on('response',async response=>{if(response.url().includes('/azure-deploy/ready/')&&response.ok()){try{const body=await response.json();results.actualStages=(body.requiredStages||[]).map(s=>({stage:s.stage,status:s.status}));}catch{}}});
const base=process.env.QA_BASE_URL || 'http://127.0.0.1:4200';const project='/projects/'+(process.env.QA_PROJECT_ID || '3aa1c9b9-e114-40e4-884b-ebc7aa32e002');
async function capture(name,path,width=1440){await page.setViewportSize({width,height:1000});if(path)await page.goto(base+path);await page.waitForTimeout(1800);await page.screenshot({path:`${out}/${name}.png`});const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));results.pages.push({name,...dimensions,url:page.url()});assert.ok(dimensions.scroll<=width+1,`${name} page overflow ${dimensions.scroll}/${width}`);assert.equal(await page.locator('a[href="/monitoring"]').count(),0);const body=await page.locator('body').innerText();const raw=body.match(/VALIDATED_RECOMMENDED|NO_COMPATIBLE_CANDIDATE|SECURITY_TARGET_UNKNOWN|MAJOR_UPGRADE_REQUIRES_REVIEW|VALIDATION_FAILED|No repo|No job|\bSKIPPED\b/);assert.ok(!raw, name+' raw token '+raw?.[0]);}
try{
 await capture('dashboard-desktop','/dashboard');await capture('dashboard-mobile',null,390);
 await capture('projects-desktop','/projects');await capture('projects-mobile',null,390);
 await capture('project-desktop',project);
 results.stages=await page.locator('.gate-label').allTextContents();console.log('stages',results.stages);
 assert.ok(results.stages.findIndex(s=>s.includes('ZAP'))>results.stages.findIndex(s=>s.includes('Déploiement de la cible')), 'ZAP follows target preparation');
 await page.locator('.rail-wrap').screenshot({path:`out/pipeline-desktop.png`.replace('out/',out+'/')});
 await capture('project-mobile',null,390);
 await capture('pipeline-history-desktop',project+'?tab=jenkins');await capture('pipeline-history-mobile',null,390);
 await capture('security-desktop',project+'?tab=securite');
 for(const source of ['Trivy','OWASP']){
  await page.locator('.sec-scanner-filter button').filter({hasText:source}).click();await page.waitForTimeout(500);
  const table=page.locator('app-cve-table');await table.waitFor();await table.scrollIntoViewIfNeeded();
  results.counts[source]=await table.locator('.owasp-filter-row').first().locator('button').allTextContents();
  console.log(source,results.counts[source]);
  for(const filter of ['Toutes','Corrections disponibles','Intervention manuelle','En cours','Corrigées']){
    const btn=table.locator('.owasp-filter-row').first().locator('button').filter({hasText:filter});
    const count=Number((await btn.innerText()).match(/\((\d+)\)/)[1]);await btn.click();
    assert.equal(await table.locator('.cve-row').count(),count,source+' '+filter);
  }
  await table.locator('.owasp-filter-row').first().locator('button').filter({hasText:'Toutes'}).click();
  await page.screenshot({path:`${out}/${source.toLowerCase()}-desktop.png`});
  await capture(source.toLowerCase()+'-mobile',null,390);
  assert.ok(await table.locator('.table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));
  await page.setViewportSize({width:1440,height:1000});
 }
 await capture('deployment-gates-desktop',project+'?tab=securite');
 const gates=page.locator('.stage-grid');if(await gates.count()){await gates.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/deployment-gates-desktop.png`});results.deploymentStages=await gates.locator('summary strong').allTextContents();assert.ok(await page.evaluate(()=>Boolean(document.querySelector('.stage-grid').compareDocumentPosition(document.querySelector('.deploy-azure-box')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'final Azure deployment follows gates');}
 await capture('incidents-desktop','/incidents');await capture('incidents-mobile',null,390);
 const incident=await page.locator('a[href*="/incidents/"]').first().getAttribute('href');if(incident){await capture('incident-desktop',incident);await capture('incident-mobile',null,390);}
 await capture('settings-desktop','/settings');assert.doesNotMatch(await page.locator('body').innerText(),/Grafana/);
 await page.goto(base+'/dashboard');await page.waitForTimeout(1000);if(!await page.locator('.chat-panel').evaluate(e=>e.classList.contains('open')))await page.locator('.chat-fab').click();await page.locator('.chat-panel').screenshot({path:`${out}/chat-desktop.png`});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);await page.screenshot({path:`${out}/chat-mobile.png`});
 const chat=await page.locator('.chat-panel').boundingBox();assert.ok(chat.x>=-1&&chat.x+chat.width<=391,'chat mobile overflow');
 await page.goto(base+'/monitoring');await page.waitForTimeout(700);assert.match(await page.locator('body').innerText(),/introuvable/i);
 assert.equal(results.errors.length,0,JSON.stringify(results.errors));results.pass=true;
}catch(e){results.pass=false;results.failure=e.message;console.error(e.message);await page.screenshot({path:`${out}/failure.png`});process.exitCode=1;}
finally{fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));await browser.close();console.log(JSON.stringify(results));}
