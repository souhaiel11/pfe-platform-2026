#!/usr/bin/env node
// Vérifie l'absence d'activité concurrente pertinente avant l'opération legacy.
'use strict';
const {Client}=require('pg'),fs=require('fs'),assert=require('assert/strict');
/** Exécute les étapes principales de ce programme. */
async function main(){
  assert.equal(process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,'false','EFFECTIVE_RUNTIME_FREEZE_MUST_BE_SEPARATELY_VERIFIED');
  const evidence=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  assert.equal(evidence.version,1);assert(evidence.operator&&evidence.evidenceReference&&evidence.liveRuntimeManifestHash);
  const age=Date.now()-Date.parse(evidence.reviewedAt);assert(Number.isFinite(age)&&age>=0&&age<900000,'STALE_WRITER_EVIDENCE');
  assert.equal(evidence.allWriterEntryPointsFrozen,true);assert.equal(evidence.activeWorkerJobs,0);assert.equal(evidence.activeGitWriters,0);
  assert.equal(evidence.unknownActivity,false,'AMBIGUOUS_ACTIVITY');
  const c=new Client({connectionString:process.env.LEGACY_RECONCILIATION_DATABASE_URL});
  let dispatches;await c.connect();try{await c.query('BEGIN READ ONLY');dispatches=(await c.query(`SELECT id,"projectId",source FROM manual_remediation_tasks WHERE source IN ('TRIVY','OWASP') AND "securityFindingRemediation"->>'status'='DISPATCHING' ORDER BY id`)).rows;await c.query('COMMIT');}finally{await c.end();}
  const api=process.env.N8N_API_URL||process.env.N8N_URL,key=process.env.N8N_API_KEY;assert(api&&key,'N8N_ACCESS_REQUIRED');
  const executions=[];let cursor;
  for(let i=0;i<10;i++){
    const r=await fetch(api.replace(/\/$/,'')+'/api/v1/executions?limit=250'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{headers:{'X-N8N-API-KEY':key},signal:AbortSignal.timeout(10000),redirect:'error'});assert(r.ok,'N8N_INVENTORY_UNAVAILABLE');
    const body=await r.json();assert(Array.isArray(body.data));for(const e of body.data){assert(typeof e.workflowId==='string'&&typeof e.status==='string');if(e.workflowId==='RdYyfjVpOm2LxS95'&&!['success','error','canceled','crashed'].includes(e.status))executions.push({id:e.id,status:e.status});}
    cursor=body.nextCursor;if(!cursor)break;assert(i<9,'INCOMPLETE_EXECUTION_INVENTORY');
  }
  const result={checkedAt:new Date().toISOString(),activeRemediationDispatches:dispatches.length,activeWF6Executions:executions,activeWorkerJobs:evidence.activeWorkerJobs,activeGitWriters:evidence.activeGitWriters,evidenceReference:evidence.evidenceReference,quiescent:dispatches.length===0&&executions.length===0};
  console.log(JSON.stringify(result));if(!result.quiescent)process.exitCode=1;
}
main().catch(()=>{console.error(JSON.stringify({quiescent:false,error:'QUIESCENCE_UNPROVEN; STOP_WITHOUT_KILLING_JOBS'}));process.exitCode=1;});
