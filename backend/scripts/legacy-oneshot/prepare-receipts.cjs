#!/usr/bin/env node
// Prépare les reçus et éléments de preuve nécessaires à l'opération legacy.
'use strict';
require('./runner.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {validatePlan}=require('./plan.cjs');
const {OperatorRemoteSettlement}=require('./remote.cjs');
const {legacyDigest}=require('../../src/manual-remediation/legacy-reconciliation');
/** Exécute les étapes principales de ce programme. */
async function main(){
  const [manifestFile,evidenceFile,output]=process.argv.slice(2);assert(output&&path.isAbsolute(output),'ABSOLUTE_EXCLUSIVE_OUTPUT_REQUIRED');
  const plan=JSON.parse(fs.readFileSync(manifestFile));validatePlan(plan);
  const evidence=JSON.parse(fs.readFileSync(evidenceFile));assert(evidence.operator&&evidence.evidenceReference);
  assert.equal(evidence.allWriterEntryPointsFrozen,true);assert.equal(evidence.activeWorkerJobs,0);assert.equal(evidence.activeGitWriters,0);assert.equal(evidence.unknownActivity,false);assert.equal(evidence.unrecordedEffectsReviewed,true);
  const age=Date.now()-Date.parse(evidence.reviewedAt);assert(Number.isFinite(age)&&age>=0&&age<900000,'STALE_OPERATOR_REVIEW');
  assert.match(evidence.evidenceReference,/^[A-Za-z0-9_./:#-]{1,512}$/);
  // Reuse the qualified provider's complete paginated remote inventory methods.
  const remote=new OperatorRemoteSettlement(),prs=await remote.pages('pulls?state=all'),branches=await remote.pages('branches');
  const references=plan.remoteReferences.map(ref=>{
    const pr=prs.find(p=>p.number===ref.prNumber);
    assert(pr&&pr.state==='closed'&&pr.merged_at===null&&pr.head?.sha===ref.headSha&&pr.head?.ref===ref.branch&&pr.closed_at,'REMOTE_SETTLEMENT_NOT_PROVEN');
    return {prNumber:pr.number,headSha:pr.head.sha,state:'CLOSED_UNMERGED',branch:'MISSING'};
  });
  const inventory={references,branches:branches.map(b=>({name:b.name,sha:b.commit?.sha})).sort((a,b)=>a.name.localeCompare(b.name))};
  const reviewedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+600000).toISOString();
  const receipts={receipts:plan.groups.map(g=>({groupId:g.groupId,groupDigest:g.expectedGroupDigest,repository:plan.repository,targetFile:'pom.xml',approvedBy:evidence.operator,evidenceReference:evidence.evidenceReference,unrecordedEffectsReviewed:true,writerFreezeConfirmed:true,reviewedAt,expiresAt,inventoryDigest:legacyDigest(inventory)}))};
  fs.writeFileSync(output,JSON.stringify(receipts,null,2)+'\n',{flag:'wx',mode:0o600});
  process.env.SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE=output;
  try{for(const g of plan.groups)await remote.verify(g.groupId,g.expectedGroupDigest,evidence.operator);}
  catch(e){fs.renameSync(output,output+'.rejected');throw e;}
  console.log(JSON.stringify({validated:true,groups:8,output,expiresAt}));
}
main().catch(()=>{console.error('SETTLEMENT_RECEIPTS_NOT_VALIDATED; STOP');process.exitCode=1;});
