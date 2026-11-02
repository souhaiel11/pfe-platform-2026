const {createRequire}=require('module');const r=createRequire('/app/package.json');r('reflect-metadata');
const assert=require('node:assert/strict');const {DataSource}=r('typeorm');
const {ManualRemediationService}=r('/app/dist/manual-remediation/manual-remediation.service.js');
const {ManualRemediationTask}=r('/app/dist/manual-remediation/manual-remediation.entity.js');
const {Incident}=r('/app/dist/incidents/incident.entity.js');
const projectId='cd0efa6d-ac13-4dd8-a117-4933527d9c86';
const ds=new DataSource({type:'postgres',host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),username:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME,entities:['/app/dist/**/*.entity.js'],synchronize:false,logging:false});
async function main(){
 await ds.initialize();const repo=ds.getRepository(ManualRemediationTask);let dispatches=0;
 const service=new ManualRemediationService(repo,ds.getRepository(Incident),{dispatch:async()=>{dispatches++;throw Error('Unexpected dispatch');}});
 const originalTransaction=ds.manager.transaction.bind(ds.manager);
 const stop=Error('VERIFY_ROLLBACK_BEFORE_DISPATCH');let checkedPayload;
 ds.manager.transaction=async callback=>originalTransaction(async manager=>{checkedPayload=await callback(manager);throw stop;});
 try{
  for(const source of ['OWASP','TRIVY']){
   const task=await repo.createQueryBuilder('t').where('t."projectId"=:projectId',{projectId}).andWhere('t.source=:source',{source}).andWhere('t."securityFindingRemediation" IS NULL').andWhere("t.\"findingSnapshot\"->>'component' ~ '^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$'").andWhere("t.\"findingSnapshot\"->>'fixedVersion' IS NOT NULL").getOne();
   assert.ok(task,`No ${source} task available`);
   const before=JSON.stringify(await repo.findOneBy({id:task.id}));
   checkedPayload=undefined;
   await assert.rejects(service.launchBatchRemediation(projectId,[task.id],{role:'admin'}),e=>e===stop);
   assert.equal(checkedPayload.payload.findingTaskIds[0],task.id);assert.ok(checkedPayload.payload.attempts[0].attemptId);
   assert.equal(JSON.stringify(await repo.findOneBy({id:task.id})),before);
   const reservation=await ds.query('SELECT id FROM remediation_target_reservations WHERE state=\'ACTIVE\' AND claims ? $1',[task.id]);assert.equal(reservation.length,0);
   console.log(JSON.stringify({source,taskId:task.id,cve:task.ruleOrCve,reservation:'PASS',attemptBinding:'PASS',rollback:'PASS',dispatches}));
  }
 }finally{ds.manager.transaction=originalTransaction;await ds.destroy();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
