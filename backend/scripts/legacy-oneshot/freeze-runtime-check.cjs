// Vérifie que le périmètre et le runtime attendus sont figés avant l'opération legacy.
'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
require('/app/node_modules/reflect-metadata');
const {ManualRemediationService}=require('/app/dist/manual-remediation/manual-remediation.service');
const {assertSecurityRemediationDispatchEnabled}=require('/app/dist/manual-remediation/security-remediation-lifecycle');
/** Exécute les étapes principales de ce programme. */
async function main(){
  assert.equal(process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,'false');
  let dispatches=0,transactions=0,lookups=0;const rows=[];
  const repo={manager:{
  /** Exécute les opérations dans le cadre transactionnel prévu. */
  transaction(){transactions++;throw Error('DISPATCH_REACHED_DATABASE');}},
    /** Recherche l’élément correspondant à l’identifiant. */
    async findOne(){lookups++;throw Error('RETRY_REACHED_LOOKUP');},
    /** Compte les éléments correspondants. */
    async count(){return rows.length;},
    /** Recherche les éléments correspondants. */
    async find({where}={}){return rows.filter(t=>!where||Object.entries(where).every(([k,v])=>t[k]===v));},
    /** Crée et enregistre un nouvel élément. */
    create(t){return {...t,id:crypto.randomUUID()};},
    /** Enregistre les données fournies. */
    async save(t){const i=rows.findIndex(r=>r.id===t.id);if(i<0)rows.push(t);else rows[i]=t;return t;},
    /** Applique les modifications autorisées à l’élément. */
    async update(){}};
  const svc=new ManualRemediationService(repo,{
  /** Recherche les éléments correspondants. */
  async find(){return [];}},{
  /** Transmet la demande au service chargé de l’exécuter. */
  async dispatch(){dispatches++;throw Error('WF6_FORBIDDEN');}});
  assert.throws(()=>assertSecurityRemediationDispatchEnabled(),e=>e.getResponse().code==='SECURITY_REMEDIATION_TEMPORARILY_DISABLED');
  await assert.rejects(()=>svc.launchBatchRemediation('disposable-project',['no-new-test-task'],{id:'operator',role:'admin'}),e=>e.getResponse().code==='SECURITY_REMEDIATION_TEMPORARILY_DISABLED');
  await assert.rejects(()=>svc.retrySecurityRemediation('no-new-test-task',{}, {id:'operator',role:'admin'}),e=>e.getResponse().code==='SECURITY_REMEDIATION_TEMPORARILY_DISABLED');
  assert.equal(transactions,0);assert.equal(lookups,0);
  await svc.syncIncident({id:'disposable-incident',projectId:'disposable-project',buildNumber:1,metadata:{enrichedData:{trivy:{status:'COMPLETED',completed:true,resultAvailable:true,cves:[{id:'CVE-2023-6378',pkg:'ch.qos.logback:logback-classic',installedVersion:'1.2.11',fixedVersion:'1.2.13',title:'Disposable ingestion',severity:'HIGH',source:'TRIVY'}],cves_count:1,critical:0,high:1},owasp:{status:'NOT_RUN',cves:[]},zap:{status:'NOT_RUN',alerts:[]},sonar:{status:'NOT_RUN',issues:[]}}}});
  assert.equal(rows.length,1);assert.equal(rows[0].scannerStatus,'DETECTED');assert.equal(rows[0].status,'TODO');assert.equal(dispatches,0);
  assert.equal((await svc.list('disposable-project')).length,1);
  const files=[];
  /** Parcourt les données pour en extraire les éléments utiles. */
  function walk(p){if(!fs.existsSync(p))return;const s=fs.lstatSync(p);if(s.isDirectory())for(const n of fs.readdirSync(p).sort())walk(path.join(p,n));else if(s.isFile())files.push({path:p.slice(5),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}
  for(const p of ['dist','migrations','package.json','package-lock.json','tsconfig.json','nest-cli.json','Dockerfile'])walk('/app/'+p);
  fs.writeFileSync('/audit/freeze-runtime.json',JSON.stringify({pass:true,runtime:'captured-current-live-artifact',dispatchFlag:'false',newDispatchBlocked:true,retryBlocked:true,findingIngestionAvailable:true,modernReadAvailable:true,transactionsBeforeBlock:transactions,lookupsBeforeBlock:lookups,wf6Dispatches:dispatches,repository:'isolated in-memory fixture; actual live compiled service methods',files},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
