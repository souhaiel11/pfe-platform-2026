// Vérifie les opérations de réconciliation legacy avec PostgreSQL et des scénarios concurrents.
require('reflect-metadata');require('ts-node').register({transpileOnly:true,project:require('path').resolve(__dirname,'../tsconfig.json')});
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{fork}=require('child_process');
const {DataSource,EntitySchema}=require('typeorm'),{Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {ManualRemediationTask}=require('../src/manual-remediation/manual-remediation.entity'),{Project}=require('../src/projects/project.entity'),{Incident}=require('../src/incidents/incident.entity');
const {LegacyReconciliationService}=require('../src/manual-remediation/legacy-reconciliation.service'),{LegacyRemoteSettlement}=require('../src/manual-remediation/legacy-remote-settlement'),{LegacyReconciliationController}=require('../src/manual-remediation/legacy-reconciliation.controller');
const {JwtAuthGuard}=require('../src/auth/jwt-auth.guard');
const {legacyCatalog,legacyDigest,legacySnapshot,legacyArchive,assertLegacyReadmission}=require('../src/manual-remediation/legacy-reconciliation');
const {assertRetryAllowed,assertLegacyCallback}=require('../src/manual-remediation/security-remediation-lifecycle');
const {reserveTarget,canonicalTarget,bindTargetAttempt}=require('../src/manual-remediation/remediation-target-reservation');
const {reserveAttempt}=require('../src/manual-remediation/security-remediation-lifecycle');
const database='chain2b_disposable';if(process.env.LEGACY_RECONCILIATION_DISPOSABLE_DATABASE!==database)throw Error('Disposable marker required');
const root=process.env.LEGACY_AUDIT_DIR||'/audit',seed=JSON.parse(fs.readFileSync(root+'/seed.json'));
const taskColumns={createdAt:{type:'timestamp'},updatedAt:{type:'timestamp',updateDate:true},id:{type:'uuid',primary:true},projectId:{type:'uuid'},incidentId:{type:'uuid',nullable:true},source:{type:'text'},findingId:{type:'text',nullable:true},findingFingerprint:{type:'text'},ruleOrCve:{type:'text'},status:{type:'text'},scannerStatus:{type:'text'},findingSnapshot:{type:'jsonb'},securityFindingRemediation:{type:'jsonb',nullable:true},securityRemediationBatchId:{type:'text',nullable:true},events:{type:'jsonb'},verifiedAt:{type:'timestamp',nullable:true},verifiedBuild:{type:'integer',nullable:true}};
/** Prépare la connexion de base utilisée par ce scénario. */
function db(){return new DataSource({type:'postgres',host:'127.0.0.1',username:'postgres',database,synchronize:false,entities:[new EntitySchema({name:'ManualRemediationTask',target:ManualRemediationTask,tableName:'manual_remediation_tasks',columns:taskColumns}),new EntitySchema({name:'Project',target:Project,tableName:'projects',columns:{id:{type:'uuid',primary:true},githubRepo:{type:'text'}}}),new EntitySchema({name:'Incident',target:Incident,tableName:'incidents',columns:{id:{type:'uuid',primary:true},projectId:{type:'uuid'},metadata:{type:'jsonb'},createdAt:{type:'timestamp'}}})]});}
const originalFetch=global.fetch;let remoteMode='SETTLED';
/** Prépare les PR considérées comme terminées par le scénario. */
const settledPRs=()=>legacyCatalog.remoteReferences.map(r=>({number:r.prNumber,state:'closed',head:{sha:r.headSha,ref:r.branch},closed_at:'2026-10-07T00:00:00Z',merged_at:null}));
const branches=[{name:'main',commit:{sha:'a'.repeat(40)}}];
/** Prépare l’adaptateur des contrôles distants. */
function remoteAdapter(){
/** Envoie la requête et lit la réponse distante. */
global.fetch=async(url,options)=>{url=String(url);if(url.startsWith('http://127.0.0.1:'))return originalFetch(url,options);
 if(remoteMode==='UNAVAILABLE')return new Response('{}',{status:503});
 if(url.includes('/api/v1/executions'))return Response.json({data:remoteMode==='INFLIGHT'?[{workflowId:'RdYyfjVpOm2LxS95',status:'running'}]:[],nextCursor:null});
 if(url.includes('/branches'))return Response.json(remoteMode==='BRANCH_PRESENT'?[...branches,{name:legacyCatalog.remoteReferences[0].branch,commit:{sha:'a'.repeat(40)}}]:branches);
 if(url.includes('/pulls?')){let prs=settledPRs();if(remoteMode==='OPEN')prs[0].state='open';if(remoteMode==='MISSING')prs.shift();if(remoteMode==='DRIFT')prs[0].head.sha='b'.repeat(40);return Response.json(prs);}
 throw Error('Unexpected remote URL '+url);};}
/** Prépare les paramètres d’environnement du scénario. */
function environment(){process.env.SECURITY_LEGACY_RECONCILIATION_ENABLED='true';process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED='false';process.env.N8N_API_URL='http://controlled-n8n.invalid';process.env.N8N_API_KEY='DISPOSABLE_ONLY';process.env.SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE=root+'/receipts.json';remoteAdapter();}
/** Vérifie la condition liée à api. */
async function api(data){
 class TestModule{};Module({controllers:[LegacyReconciliationController],providers:[{provide:LegacyReconciliationService,useValue:new LegacyReconciliationService(data,new LegacyRemoteSettlement())}]})(TestModule);
 // Authentication adapter only: production controller and service remain real.
 // Service's actual admin check is exercised with admin/developer requests.
 const original=JwtAuthGuard.prototype.canActivate;
 /** Autorise ou refuse l’accès à la route. */
 JwtAuthGuard.prototype.canActivate=function(ctx){ctx.switchToHttp().getRequest().user={id:'operator',role:ctx.switchToHttp().getRequest().headers['x-test-role']||'admin'};return true;};
 const app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');JwtAuthGuard.prototype.canActivate=original;
 /** Autorise ou refuse l’accès à la route. */
 JwtAuthGuard.prototype.canActivate=function(ctx){const r=ctx.switchToHttp().getRequest();r.user={id:'operator',role:r.headers['x-test-role']||'admin'};return true;};
 return {app,base:await app.getUrl(),
 /** Restaure l’état sauvegardé par le scénario. */
 restore:()=>JwtAuthGuard.prototype.canActivate=original};
}
/** Appelle le service avec les paramètres du scénario. */
async function call(base,g,action,body,role='admin'){const r=await originalFetch(base+'/api/manual-remediation/legacy-reconciliation/'+g+'/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-test-role':role},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
/** Exécute le traitement dans un processus séparé. */
async function worker(){environment();const data=await db().initialize(),a=await api(data);process.send({ready:true,pid:process.pid,pgPid:(await data.query('SELECT pg_backend_pid() AS pid'))[0].pid});process.once('message',async m=>{try{process.send(await call(a.base,m.group,'reconcile',{expectedGroupDigest:m.digest}));}catch(e){process.send({error:e.message});}finally{await a.app.close();a.restore();await data.destroy();process.exit(0);}});}
/** Prépare deux opérations pour tester leur concurrence. */
async function pair(group,digest){const cs=[fork(__filename,['worker'],{stdio:['ignore','ignore','pipe','ipc']}),fork(__filename,['worker'],{stdio:['ignore','ignore','pipe','ipc']})];const ready=await Promise.all(cs.map(c=>new Promise((r,j)=>{c.once('message',r);c.once('error',j);c.stderr.on('data',d=>process.stderr.write(d));c.once('exit',x=>{if(x)j(Error('worker failed'))});})));const results=await Promise.all(cs.map(c=>new Promise((r,j)=>{c.once('message',r);c.once('error',j);c.send({group,digest});})));await Promise.all(cs.map(c=>c.exitCode===null?new Promise(r=>c.once('exit',r)):Promise.resolve()));assert.notEqual(ready[0].pid,ready[1].pid);assert.notEqual(ready[0].pgPid,ready[1].pgPid);return {ready,results};}
/** Exécute les étapes principales de ce programme. */
async function main(){environment();const data=await db().initialize();let a;const report={database,productionAccess:false,remoteMode:'CONTROLLED_HTTP_ADAPTER; real remote settlement logic, no GitHub calls',checks:{}};
 try{
 assert.equal((await data.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))[0].n,0);await data.synchronize();const tasks=data.getRepository(ManualRemediationTask),projects=data.getRepository(Project),incidents=data.getRepository(Incident);
 await projects.save({id:seed[0].projectId,githubRepo:legacyCatalog.repository});for(const t of seed){await incidents.save({id:t.incidentId,projectId:t.projectId,metadata:{sourceCommitSha:'7ae0f954f99628b69ce9b42f42c1e2acc8568d99'},createdAt:new Date('2026-10-01T00:00:00Z')});await tasks.save({...t,createdAt:t.createdAt||'2026-10-01T00:00:00Z',updatedAt:t.updatedAt||'2026-10-01T00:00:00Z'});}
 const svc=new LegacyReconciliationService(data,new LegacyRemoteSettlement()),groups=Object.keys(legacyCatalog.groups);
 const inventory={references:settledPRs().map(pr=>({prNumber:pr.number,headSha:pr.head.sha,state:'CLOSED_UNMERGED',branch:'MISSING'})),branches:branches.map(b=>({name:b.name,sha:b.commit.sha}))};
 const receipts={receipts:groups.map(groupId=>({groupId,groupDigest:svc.groupDigest(groupId),repository:legacyCatalog.repository,targetFile:'pom.xml',approvedBy:'operator',evidenceReference:'DISPOSABLE_REMOTE_SETTLEMENT',unrecordedEffectsReviewed:true,writerFreezeConfirmed:true,reviewedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),inventoryDigest:legacyDigest(inventory)}))};fs.writeFileSync(root+'/receipts.json',JSON.stringify(receipts));
 a=await api(data);const g=groups[0],body={expectedGroupDigest:svc.groupDigest(g)};
 const baseline=await tasks.find({order:{id:'ASC'}});
 for(const mode of ['OPEN','MISSING','DRIFT','BRANCH_PRESENT','INFLIGHT','UNAVAILABLE']){remoteMode=mode;const r=await call(a.base,g,'reconcile',body);assert(r.status>=400,mode);assert.deepEqual(await tasks.find({order:{id:'ASC'}}),baseline);report.checks['reject_'+mode]=true;}remoteMode='SETTLED';
 assert.equal((await call(a.base,g,'reconcile',body,'developer')).status,403);assert.equal((await call(a.base,g,'reconcile',{...body,attemptId:'fabricated'})).status,400);
 process.env.SECURITY_LEGACY_RECONCILIATION_ENABLED='false';assert.equal((await call(a.base,g,'reconcile',body)).status,404);process.env.SECURITY_LEGACY_RECONCILIATION_ENABLED='true';
 process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED='true';assert.equal((await call(a.base,g,'reconcile',body)).status,409);process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED='false';
 const t=await tasks.findOneByOrFail({id:legacyCatalog.groups[g].at(-1).taskId});const old=structuredClone(t.securityFindingRemediation);t.securityFindingRemediation={...old,contractVersion:2,attemptId:null};await tasks.save(t);const invalidBaseline=await tasks.find({order:{id:'ASC'}});assert.equal((await call(a.base,g,'reconcile',body)).status,409);assert.deepEqual(await tasks.find({order:{id:'ASC'}}),invalidBaseline);t.securityFindingRemediation=old;await tasks.save(t);report.checks.corruptedModernRejectedAndWholeGroupUnchanged=true;
 // Failure AFTER an earlier member save must roll back every archive.
 const failId=legacyCatalog.groups[g].map(e=>e.taskId).sort().at(-1);
 await data.query(`CREATE FUNCTION reject_partial_legacy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${failId}'::uuid AND NEW."securityFindingRemediation" IS NULL THEN RAISE EXCEPTION 'controlled archive write failure'; END IF; RETURN NEW; END $$`);
 await data.query('CREATE TRIGGER reject_partial BEFORE UPDATE ON manual_remediation_tasks FOR EACH ROW EXECUTE FUNCTION reject_partial_legacy()');
 const preFailure=await tasks.find({order:{id:'ASC'}});assert.equal((await call(a.base,g,'reconcile',body)).status,500);assert.deepEqual(await tasks.find({order:{id:'ASC'}}),preFailure);
 await data.query('DROP TRIGGER reject_partial ON manual_remediation_tasks');await data.query('DROP FUNCTION reject_partial_legacy()');report.checks.failureAfterFirstWriteRollsBackWholeGroup=true;
 const race=await pair(g,body.expectedGroupDigest);console.log('RECONCILIATION_RACE',JSON.stringify(race));assert(race.results.every(r=>r.status===201));assert.equal(race.results.filter(r=>r.body.idempotent).length,1);assert.equal(race.results.filter(r=>r.body.reconciled>0).length,1);report.race=race;report.checks.twoProcessesOneEffectiveArchive=true;
 for(const group of groups){const r=await call(a.base,group,'reconcile',{expectedGroupDigest:svc.groupDigest(group)});assert.equal(r.status,201);}
 const reconciled=await tasks.find({order:{id:'ASC'}});for(const t of reconciled){const original=seed.find(s=>s.id===t.id);const archive=legacyArchive(t);assert.deepEqual(archive.original,legacySnapshot(original));assert.deepEqual(t.events.slice(0,-1),original.events);assert.equal(t.events.filter(e=>e.legacyReconciliation?.action==='RETIRE').length,1);assert.equal(t.securityFindingRemediation,null);assert.equal(t.securityRemediationBatchId,null);assert.equal(t.status,original.status);assert.equal(t.scannerStatus,'DETECTED');assert.equal(t.verifiedAt?new Date(t.verifiedAt).getTime():null,original.verifiedAt?new Date(original.verifiedAt).getTime():null);assert.equal(t.verifiedBuild,original.verifiedBuild);assert.equal(t.createdAt.getTime(),preFailure.find(p=>p.id===t.id).createdAt.getTime());assert.equal(t.updatedAt.getTime(),preFailure.find(p=>p.id===t.id).updatedAt.getTime());assert.throws(()=>assertRetryAllowed(t));assert.throws(()=>assertLegacyCallback(t,original.securityRemediationBatchId,{status:'CLOSED'}));assert.throws(()=>assertLegacyReadmission(t));}
 report.reconciliation={groups:8,tasks:14,activeLegacyClaims:0,activeLegacyWriters:0,findingsFixed:0,findingsVerified:0,newAttempts:0,counterChanges:0};report.checks.historyAndCountersAndFindingSemantics=true;
 // No edits between real API reconciliation and exact migration execution.
 await data.query(fs.readFileSync(path.resolve(__dirname,'../migrations/20261006_add_remediation_target_reservations.sql'),'utf8'));assert.equal((await data.query("SELECT count(*)::int AS n FROM remediation_target_reservations WHERE state='ACTIVE'"))[0].n,0);report.checks.exactMigrationImmediatelyAfterApi=true;
 const A=reconciled.find(t=>t.source==='TRIVY'),B=reconciled.find(t=>t.source==='OWASP');const group=groups.find(g=>legacyCatalog.groups[g].some(e=>e.taskId===A.id));
 const eligibility=await call(a.base,group,'eligibility',{taskId:A.id,expectedArchiveDigest:legacyArchive(A).snapshotDigest});assert.equal(eligibility.status,201);assert.equal(eligibility.body.evaluable,true);assert.equal(eligibility.body.authorized,false);assert.deepEqual(await tasks.find({order:{id:'ASC'}}),reconciled);report.eligibility=eligibility.body;report.checks.actualFreshEligibilityReadOnly=true;
 assert.equal(eligibility.body.decision,'BLOCK');assert.equal(eligibility.body.reason,'FRESH_POST_RECONCILIATION_SCAN_REQUIRED');
 const staleAuth=await call(a.base,group,'authorize-modern',{taskId:A.id,expectedArchiveDigest:legacyArchive(A).snapshotDigest});assert.equal(staleAuth.status,409);
 // Controlled NEW scan binding fixture, after guard qualification; never a live scanner write.
 const freshIncidentId=require('crypto').randomUUID();await incidents.save({id:freshIncidentId,projectId:A.projectId,createdAt:new Date(),metadata:{sourceCommitSha:'7ae0f954f99628b69ce9b42f42c1e2acc8568d99'}});A.incidentId=freshIncidentId;await tasks.save(A);
 const auth=await call(a.base,group,'authorize-modern',{taskId:A.id,expectedArchiveDigest:legacyArchive(A).snapshotDigest});assert.equal(auth.status,201);assert.equal(auth.body.authorized,true);
 const authorized=await tasks.findOneByOrFail({id:A.id});assertLegacyReadmission(authorized,eligibility.body.sourceCommitSha);assert.throws(()=>assertLegacyReadmission(authorized,'b'.repeat(40)));assert.equal(authorized.securityFindingRemediation,null);assert.equal(authorized.securityRemediationBatchId,null);assert.deepEqual(legacyArchive(authorized).original,legacyArchive(A).original);A.events=authorized.events;report.checks.explicitAuthorizationWithoutAttemptOrDispatch=true;
 // Separate admission-boundary proof only: bypasses neither service dispatch nor real eligibility.
 // Reservation/attempt primitives are invoked under DB transactions; no dispatcher exists here.
 await data.transaction(async tx=>{const id=await reserveTarget(tx,canonicalTarget(A.projectId,'pom.xml',A.findingSnapshot.component),[A.id]);reserveAttempt(A,'sec-batch-disposable-only',new Date().toISOString());await bindTargetAttempt(tx,id,A);await tx.getRepository(ManualRemediationTask).save(A);});
 const bBefore=await tasks.findOneByOrFail({id:B.id});await assert.rejects(()=>data.transaction(async tx=>{await reserveTarget(tx,canonicalTarget(B.projectId,'pom.xml',B.findingSnapshot.component),[B.id]);reserveAttempt(B,'NEVER','NEVER');}),e=>e.getResponse().code==='REMEDIATION_TARGET_ALREADY_IN_PROGRESS');assert.deepEqual(await tasks.findOneByOrFail({id:B.id}),bBefore);assert.equal((await data.query("SELECT count(*)::int AS n FROM remediation_target_reservations WHERE state='ACTIVE'"))[0].n,1);report.checks.post4GSingleWriterNoSiblingAttempt=true;
 report.checks.noWF6OrGitDispatch=true;report.pass=true;fs.writeFileSync(root+'/postgres-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(a){await a.app.close();a.restore();}await data.destroy();}}
(process.argv[2]==='worker'?worker():main()).catch(e=>{console.error(e.stack);process.exitCode=1});
