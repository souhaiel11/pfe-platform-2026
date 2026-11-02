// Teste le composant « security-remediation-bridge » et ses cas d’erreur.
import { targetReservationTestQuery } from './target-reservation-test-query';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { ManualRemediationService } from './manual-remediation.service';
import { ManualRemediationTask } from './manual-remediation.entity';
import { Project } from '../projects/project.entity';
import { Wf6BatchRemediationResultDto } from '../security-remediation/wf6-batch-remediation-result.dto';
import { Wf6RemediationResultDto } from '../security-remediation/wf6-remediation-result.dto';
import { callbackContract, isLegacyCurrentAttempt, normalizeSecurityRemediation, reserveAttempt } from './security-remediation-lifecycle';
const projectId='3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
const taskId='83555b3a-efa1-45e1-90a8-008debddba92';
const user={id:'dev',role:'developer'};
const batchId='sec-batch-r95';
/** Prépare les données nécessaires à ce scénario. */
const legacyRemediation=()=>({status:'DISPATCHING',attemptCount:1,batchId,
  attempts:[{attempt:1,status:'DISPATCHING',batchId,at:'2026-10-05T12:00:00Z'}]});
/** Prépare les données initiales prévues par ce service. */
const seed=(extra:any={})=>({id:taskId,projectId,source:'TRIVY',ruleOrCve:'CVE-2022-38749',findingFingerprint:'fp',
  findingSnapshot:{component:'a:b',currentVersion:'1.0',fixedVersion:'1.1'},remediationType:'DEVELOPER_ACTION_REQUIRED',
  status:'TODO',scannerStatus:'DETECTED',securityRemediationBatchId:batchId,securityFindingRemediation:legacyRemediation(),...extra});
/** Vérifie les résultats attendus dans ce scénario. */
function harness(extra:any={}) {
  let rows=[seed(extra)],tail=Promise.resolve();
  const calls={transactions:0,saves:0,dispatches:0,reads:0};
  /** Recherche les éléments correspondants. */
  const find=(where:any)=>rows.find(t=>Object.entries(where).every(([k,v])=>t[k]===v));
  const repo:any={
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne:async({where}:any)=>{calls.reads++;return structuredClone(find(where)||null);},
    /** Compte les éléments correspondants. */
    count:async()=>rows.length,
    /** Recherche les éléments correspondants. */
    find:async()=>structuredClone(rows),manager:{}};
  /** Exécute les opérations dans le cadre transactionnel prévu. */
  repo.manager.transaction=async(fn:any)=>{
    calls.transactions++;const previous=tail;let release:any;tail=new Promise<void>(r=>release=r);await previous;
    const before=structuredClone(rows);
    const txRepo={
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne:async({where,lock}:any)=>{if(lock)assert.equal(lock.mode,'pessimistic_write');return structuredClone(find(where)||null);},
      /** Enregistre les données fournies. */
      save:async(value:any)=>{calls.saves++;for(const row of Array.isArray(value)?value:[value])rows[rows.findIndex(r=>r.id===row.id)]=structuredClone(row);return value;}};
    try{return await fn({query: targetReservationTestQuery(), 
    /** Simule la lecture des données demandées par le composant. */
    getRepository:(entity:any)=>entity===Project?{
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne:async()=>({id:projectId,githubRepo:'trusted/repo'})}:txRepo});}
    catch(e){rows=before;throw e;}finally{release();}
  };
  const service=new ManualRemediationService(repo,{
  /** Recherche les éléments correspondants. */
  find:async()=>[],
  // ManualRemediationService.list() a gagné une branche de
  // re-synchronisation du DERNIER incident (via findOne) en plus du
  // rattrapage historique initial (via find). Ce faux dépôt n'exposait que
  // `find` et provoquait « this.incidents.findOne is not a function »,
  // sans qu'aucun défaut produit n'existe.
  // `null` n'est pas un choix de confort : c'est la SEULE valeur cohérente
  // avec `find` qui renvoie [] -- ce harnais modélise un projet sans aucun
  // incident, et un dépôt où find()=[] ne peut pas rendre un findOne non nul.
  /** Recherche le dernier élément correspondant (aucun ici, cohérent avec find()=[]). */
  findOne:async()=>null} as any,{
  /** Transmet la demande au service chargé de l’exécuter. */
  dispatch:async()=>{calls.dispatches++;}});
  return {service,calls,
  /** Prépare les données nécessaires à ce scénario. */
  row:()=>structuredClone(rows[0]),
  /** Prépare les données nécessaires à ce scénario. */
  replace:(row:any)=>rows=[structuredClone(row)]};
}
/** Prépare les données nécessaires à ce scénario. */
const legacyCallback=(extra:any={})=>({projectId,batchId,status:'TECHNICAL_FAILURE',reason:'RUNTIME_OPERATION_TIMEOUT',
  findings:[{findingTaskId:taskId,cveId:'CVE-2022-38749',status:'TECHNICAL_FAILURE',reason:'RUNTIME_OPERATION_TIMEOUT'}],...extra});
const pipe=new ValidationPipe({whitelist:true,transform:true});
/** Lit les données et les convertit au format attendu. */
const parse=(body:any)=>pipe.transform(body,{type:'body',metatype:Wf6BatchRemediationResultDto});
/** Prépare les données nécessaires à ce scénario. */
async function modernHarness(){const h=harness({securityFindingRemediation:null,securityRemediationBatchId:null});const p=await h.service.launchBatchRemediation(projectId,[taskId],user);const dto={...legacyCallback(),batchId:p.batchId,findings:[{...legacyCallback().findings[0],...p.attempts[0]}]};return {h,p,dto};}
/** Vérifie les résultats attendus dans ce scénario. */
async function rejectsUnchanged(h:ReturnType<typeof harness>,dto:any){const before=h.row();await assert.rejects(h.service.recordWf6BatchResult(dto));assert.deepEqual(h.row(),before);}
/** Prépare les données nécessaires à ce scénario. */
async function disabled(fn:()=>Promise<void>){const previous=process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED='false';try{await fn();}finally{if(previous===undefined)delete process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;else process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED=previous;}}
/** Prépare les données nécessaires à ce scénario. */
const maintenance=(error:any)=>error.getStatus()===503 && error.getResponse().code==='SECURITY_REMEDIATION_TEMPORARILY_DISABLED';

test('L1 real R95 shape parses and completes only current legacy attempt',async()=>{const h=harness();await h.service.recordWf6BatchResult(await parse(legacyCallback()));assert.equal(h.row().securityFindingRemediation.contractVersion,1);assert.equal(h.row().securityFindingRemediation.status,'TECHNICAL_FAILURE');});
test('L2 matching batch completes legacy entry without increment or append',async()=>{const h=harness();const before=h.row();await h.service.recordWf6BatchResult(await parse(legacyCallback()));const r=h.row().securityFindingRemediation;assert.equal(r.attemptCount,1);assert.equal(r.attempts.length,1);assert.equal(r.attempts[0].attempt,1);assert.equal(r.attempts[0].legacyAttempt,true);assert.ok(r.attempts[0].finishedAt);assert.equal(r.attemptId,undefined);assert.equal(before.securityFindingRemediation.attempts[0].finishedAt,undefined);});
test('L3 legacy callback rejects modern current attempt',async()=>{const {h,p}=await modernHarness();await rejectsUnchanged(h,legacyCallback({batchId:p.batchId}));});
test('L4 wrong legacy batch rejects unchanged',async()=>{const h=harness();await rejectsUnchanged(h,legacyCallback({batchId:'wrong'}));});
test('L5 any modern historical identity excludes legacy current completion',async()=>{const h=harness();const row=h.row();row.securityFindingRemediation.attempts.unshift({attemptId:'aa2835e8-e5ac-4918-b4b2-17cdc206414d',attemptNumber:2,status:'TECHNICAL_FAILURE',batchId:'modern'} as any);h.replace(row);assert.equal(isLegacyCurrentAttempt(row),false);await rejectsUnchanged(h,legacyCallback());});
test('L6 identical legacy duplicate is idempotent; conflicting duplicate rejects',async()=>{const h=harness();await h.service.recordWf6BatchResult(await parse(legacyCallback()));const before=h.row(),saves=h.calls.saves;await h.service.recordWf6BatchResult(await parse(legacyCallback()));assert.deepEqual(h.row(),before);assert.equal(h.calls.saves,saves);await rejectsUnchanged(h,legacyCallback({findings:[{...legacyCallback().findings[0],reason:'different outcome'}]}));});
test('L7 legacy callback after modern retry cannot change state even if batch is forged current',async()=>{const h=harness();await h.service.recordWf6BatchResult(await parse(legacyCallback()));const p=await h.service.retrySecurityRemediation(taskId,{},user);assert.equal(p.attempts[0].attemptNumber,2);await rejectsUnchanged(h,legacyCallback());await rejectsUnchanged(h,legacyCallback({batchId:p.batchId}));assert.equal(h.row().securityFindingRemediation.attempts.length,2);});

test('M1 exact modern identity parses and completes reserved attempt',async()=>{const {h,dto}=await modernHarness();await h.service.recordWf6BatchResult(await parse(dto));assert.equal(h.row().securityFindingRemediation.status,'TECHNICAL_FAILURE');assert.equal(h.row().securityFindingRemediation.contractVersion,2);});
test('M2 missing modern attemptId selects v2 and rejects without fallback',async()=>{const {h,dto}=await modernHarness();delete dto.findings[0].attemptId;assert.equal(callbackContract(dto),2);await rejectsUnchanged(h,await parse(dto));});
test('M3 wrong attemptId rejects',async()=>{const {h,dto}=await modernHarness();dto.findings[0].attemptId='aa2835e8-e5ac-4918-b4b2-17cdc206414d';await rejectsUnchanged(h,await parse(dto));});
test('M4 wrong attemptNumber rejects',async()=>{const {h,dto}=await modernHarness();dto.findings[0].attemptNumber++;await rejectsUnchanged(h,await parse(dto));});
test('M5 wrong modern batchId rejects',async()=>{const {h,dto}=await modernHarness();dto.batchId='wrong';await rejectsUnchanged(h,await parse(dto));});
test('M6 identical modern duplicate remains idempotent',async()=>{const {h,dto}=await modernHarness();await h.service.recordWf6BatchResult(await parse(dto));const before=h.row(),saves=h.calls.saves;await h.service.recordWf6BatchResult(await parse(dto));assert.deepEqual(h.row(),before);assert.equal(h.calls.saves,saves);});
test('M7 callback N cannot complete N+1',async()=>{const {h,dto}=await modernHarness();await h.service.recordWf6BatchResult(await parse(dto));await h.service.retrySecurityRemediation(taskId,{},user);await rejectsUnchanged(h,await parse(dto));});

test('G1 disabled launch rejects before transaction/reservation',async()=>{await disabled(async()=>{const h=harness({securityFindingRemediation:null});const before=h.row();await assert.rejects(h.service.launchBatchRemediation(projectId,[taskId],user),maintenance);assert.deepEqual(h.row(),before);assert.equal(h.calls.transactions,0);assert.equal(h.calls.dispatches,0);});});
test('G2 disabled retry rejects before reading task/reserving',async()=>{await disabled(async()=>{const h=harness();await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user),maintenance);assert.equal(h.calls.reads,0);assert.equal(h.calls.transactions,0);assert.equal(h.calls.dispatches,0);});});
test('G3 maintenance still allows a valid legacy callback',async()=>{await disabled(async()=>{const h=harness();await h.service.recordWf6BatchResult(await parse(legacyCallback()));assert.equal(h.row().securityFindingRemediation.status,'TECHNICAL_FAILURE');});});
test('G4 read list/summary remain available without writes in maintenance',async()=>{await disabled(async()=>{const h=harness();const before=h.row();assert.equal((await h.service.list(projectId)).length,1);assert.equal((await h.service.summary(projectId)).total,1);assert.deepEqual(h.row(),before);assert.equal(h.calls.transactions,0);assert.equal(h.calls.saves,0);});});
test('G5 blocked launch does not increment attemptCount or history',async()=>{await disabled(async()=>{const h=harness();const before=h.row();await assert.rejects(h.service.launchBatchRemediation(projectId,[taskId],user),maintenance);assert.deepEqual(h.row(),before);assert.equal(h.row().securityFindingRemediation.attemptCount,1);});});
test('G6 blocked launch generates no batchId or attemptId',async()=>{await disabled(async()=>{const crypto=require('crypto'),original=crypto.randomUUID;let calls=0;
/** Prépare les données nécessaires à ce scénario. */
crypto.randomUUID=()=>{calls++;return original();};try{const h=harness({securityFindingRemediation:null});await assert.rejects(h.service.launchBatchRemediation(projectId,[taskId],user),maintenance);assert.equal(calls,0);}finally{crypto.randomUUID=original;}});});

test('structural legacy predicate is read-only and fail-closed for incomplete/malformed rows',()=>{const row=seed(),before=structuredClone(row);assert.equal(isLegacyCurrentAttempt(row),true);assert.deepEqual(row,before);assert.equal(isLegacyCurrentAttempt({...row,securityFindingRemediation:normalizeSecurityRemediation(row.securityFindingRemediation)}),true);for(const mutate of [(r:any)=>r.securityFindingRemediation.attemptId='',(r:any)=>r.securityFindingRemediation.contractVersion=2,(r:any)=>r.securityRemediationBatchId=null,(r:any)=>r.securityFindingRemediation.attempts=[],(r:any)=>r.securityFindingRemediation.attempts[0].batchId='wrong',(r:any)=>r.securityFindingRemediation.attempts.push({...r.securityFindingRemediation.attempts[0]})]){const t=structuredClone(row);mutate(t);assert.equal(isLegacyCurrentAttempt(t),false);}});
test('legacy terminal predating bridge cannot accept a first callback',async()=>{const r=legacyRemediation();r.status='TECHNICAL_FAILURE';r.attempts[0].status='TECHNICAL_FAILURE';await rejectsUnchanged(harness({securityFindingRemediation:r}),legacyCallback());});
test('legacy ownership, finding identity and task-row batch column must all match',async()=>{for(const dto of [legacyCallback({projectId:'wrong'}),{...legacyCallback(),findings:[{...legacyCallback().findings[0],cveId:'wrong'}]}])await rejectsUnchanged(harness(),dto);await rejectsUnchanged(harness({securityRemediationBatchId:'wrong'}),legacyCallback());});
test('partial modern identity cannot masquerade as legacy even against a legacy row',async()=>{for(const identity of [{attemptNumber:1},{attemptId:'aa2835e8-e5ac-4918-b4b2-17cdc206414d'}]){const dto={...legacyCallback(),findings:[{...legacyCallback().findings[0],...identity}]};assert.equal(callbackContract(dto),2);await rejectsUnchanged(harness(),await parse(dto));}});
test('null or invalid modern identity rejected at parser; omitted fields accepted only for service classification',async()=>{for(const identity of [{attemptId:null},{attemptNumber:null},{attemptId:''},{attemptNumber:0},{attemptNumber:'1'}])await assert.rejects(parse({...legacyCallback(),findings:[{...legacyCallback().findings[0],...identity}]}));assert.equal(callbackContract(await parse(legacyCallback())),1);});
test('missing modern attemptNumber/batchId and complete identity removal still reject',async()=>{const {h,dto}=await modernHarness();const missingNumber=structuredClone(dto);delete missingNumber.findings[0].attemptNumber;await rejectsUnchanged(h,await parse(missingNumber));const missingBoth=structuredClone(dto);delete missingBoth.findings[0].attemptId;delete missingBoth.findings[0].attemptNumber;await rejectsUnchanged(h,await parse(missingBoth));const missingBatch=structuredClone(dto);delete missingBatch.batchId;await assert.rejects(parse(missingBatch));await rejectsUnchanged(h,missingBatch);});
test('singular callback follows same legacy and modern service contracts',async()=>{const h=harness();const dto={projectId,findingTaskId:taskId,batchId,status:'TECHNICAL_FAILURE',reason:'RUNTIME_OPERATION_TIMEOUT'};const parsed=await pipe.transform(dto,{type:'body',metatype:Wf6RemediationResultDto});await h.service.recordWf6Result(parsed);assert.equal(h.row().securityFindingRemediation.contractVersion,1);await h.service.recordWf6Result(parsed);const p=await h.service.retrySecurityRemediation(taskId,{},user);const before=h.row();await assert.rejects(h.service.recordWf6Result(parsed));assert.deepEqual(h.row(),before);await h.service.recordWf6Result({...dto,batchId:p.batchId,...p.attempts[0]} as any);assert.equal(h.row().securityFindingRemediation.contractVersion,2);});
test('invalid maintenance flag fails closed; default and explicit true retain modern launches only',async()=>{const previous=process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;try{process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED='typo';await assert.rejects(harness().service.launchBatchRemediation(projectId,[taskId],user),maintenance);for(const value of [undefined,'true']){if(value===undefined)delete process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;else process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED=value;const h=harness({securityFindingRemediation:null,securityRemediationBatchId:null});const p=await h.service.launchBatchRemediation(projectId,[taskId],user);assert.ok(p.attempts[0].attemptId);assert.equal(h.row().securityFindingRemediation.contractVersion,2);}}finally{if(previous===undefined)delete process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;else process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED=previous;}});
test('two simultaneous valid legacy callbacks complete once',async()=>{const h=harness();await Promise.all([h.service.recordWf6BatchResult(await parse(legacyCallback())),h.service.recordWf6BatchResult(await parse(legacyCallback()))]);assert.equal(h.calls.saves,1);assert.equal(h.row().securityFindingRemediation.attempts.length,1);});
test('existing unresolved Git evidence survives legacy completion and prevents retry',async()=>{const r:any=legacyRemediation();r.unresolvedGitSideEffect=true;const h=harness({securityFindingRemediation:r});await h.service.recordWf6BatchResult(await parse(legacyCallback()));assert.equal(h.row().securityFindingRemediation.unresolvedGitSideEffect,true);await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));});

test('reused deterministic legacy batch is ambiguous and must reject completion',async()=>{const h=harness();const r=h.row();r.securityFindingRemediation.attemptCount=3;r.securityFindingRemediation.attempts=[{attempt:1,status:'DISPATCHING',batchId},{attempt:2,status:'TECHNICAL_FAILURE',batchId},{attempt:3,status:'DISPATCHING',batchId}];h.replace(r);assert.equal(isLegacyCurrentAttempt(r),false);await rejectsUnchanged(h,legacyCallback());});
test('unnumbered legacy history must not acquire callback authority through normalization',async()=>{const h=harness();const r=h.row();delete r.securityFindingRemediation.attempts[0].attempt;h.replace(r);assert.equal(isLegacyCurrentAttempt(r),false);await rejectsUnchanged(h,legacyCallback());});
test('legacy current attempt with distinct older batches preserves all earlier history',async()=>{const h=harness();const r=h.row();r.securityFindingRemediation.attemptCount=2;r.securityFindingRemediation.attempts=[{attempt:1,status:'TECHNICAL_FAILURE',batchId:'older-batch',evidence:'retained'},{attempt:2,status:'DISPATCHING',batchId}];h.replace(r);await h.service.recordWf6BatchResult(await parse(legacyCallback()));const done=h.row().securityFindingRemediation;assert.equal(done.attemptCount,2);assert.equal(done.attempts.length,2);assert.equal(done.attempts[0].evidence,'retained');assert.equal(done.attempts[1].attemptNumber,2);});

test('parser retains misplaced modern identity and service cannot fall back to v1',async()=>{for(const identity of [{attemptId:'aa2835e8-e5ac-4918-b4b2-17cdc206414d'},{attemptNumber:1},{attemptId:'aa2835e8-e5ac-4918-b4b2-17cdc206414d',attemptNumber:1}]){const dto=await parse({...legacyCallback(),...identity});assert.equal(callbackContract(dto),2);await rejectsUnchanged(harness(),dto);}});

test('maintenance permits completion of already reserved modern attempts too',async()=>{const {h,dto}=await modernHarness();await disabled(async()=>{await h.service.recordWf6BatchResult(await parse(dto));assert.equal(h.row().securityFindingRemediation.status,'TECHNICAL_FAILURE');});});
test('maintenance does not bypass or disable independently guarded stale reconciliation',async()=>{await disabled(async()=>{const h=harness();const row=h.row();row.securityFindingRemediation.attempts[0].at='2020-01-01T00:00:00Z';h.replace(row);const result=await h.service.reconcileStaleWf6Dispatch(taskId,{batchId,attemptCount:1},{role:'admin'});assert.equal(result.applied,true);assert.equal(h.row().securityFindingRemediation.reasonCode,'WF6_STALE_DISPATCH_RECONCILED');assert.equal(h.row().securityFindingRemediation.attemptCount,1);});});
