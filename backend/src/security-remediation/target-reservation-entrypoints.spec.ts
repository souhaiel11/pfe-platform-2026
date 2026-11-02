// Teste le composant « target-reservation-entrypoints » et ses cas d’erreur.
import 'reflect-metadata';
import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import { SecurityRemediationController } from './security-remediation.controller';
import { ManualRemediationService } from '../manual-remediation/manual-remediation.service';
const projectId='3aa1c9b9-e114-40e4-884b-ebc7aa32e002',id='83555b3a-efa1-45e1-90a8-008debddba92';
for(const method of ['evaluate','evaluateBatch','revalidate','revalidateBatch'] as const) test(`${method} cannot reach worker without target admission`,async()=>{
 let workers=0;
 const repo:any={
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>({id,projectId,findingSnapshot:{component:'com.h2database:h2'}}),manager:{
 /** Renvoie les termes de recherche courants. */
 query:async()=>[]}};
 const manual=new ManualRemediationService(repo,{} as any);
 const resolver:any={
 /** Retrouve les données fiables correspondant à la demande. */
 resolve:async()=>{throw Error('target guard must precede resolver');}};
 const worker:any={
 /** Prépare les données nécessaires à ce scénario. */
 evaluateSecurityRemediation:async()=>{workers++;},
 /** Prépare les données nécessaires à ce scénario. */
 evaluateSecurityRemediationBatch:async()=>{workers++;}};
 const controller=new SecurityRemediationController(resolver,worker,manual);
 await assert.rejects(()=>controller[method]({projectId,findingTaskId:id,findingTaskIds:[id],expectedCandidateIdentity:'a'.repeat(64)} as any),e=>(e as any).getResponse().code==='REMEDIATION_TARGET_OWNERSHIP_REQUIRED');
 assert.equal(workers,0);
});
