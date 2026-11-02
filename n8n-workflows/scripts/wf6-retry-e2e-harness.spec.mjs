// Vérifie les relances après échec dans WF6.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {buildHarnessTarget,targetUrl} from './build-wf6-retry-e2e-harness.mjs';
const {baseline,target:expected}=buildHarnessTarget();const [target]=JSON.parse(readFileSync(targetUrl));
/** Prépare les données nécessaires à ce scénario. */
const adj=(w,n)=>Object.values(w.connections[n]||{}).flat(2).map(e=>e.node);
/** Recherche les nœuds accessibles depuis le point de départ. */
function reachable(w,start,blocked){const seen=new Set(),q=[start];while(q.length){const n=q.pop();if(n===blocked||seen.has(n))continue;seen.add(n);q.push(...adj(w,n));}return seen;}
const writers=['Create Missing Branch','Write File To Branch','Create Pull Request','Close Drifted Created PR'];
for(const writer of writers)test(`gate dominates ${writer}`,()=>{assert.ok(reachable(target,'Webhook - Security Remediation Request').has(writer));assert.ok(!reachable(target,'Webhook - Security Remediation Request','Operator Test Barrier?').has(writer));});
test('G5 reused terminal cannot reach any writer or business callback',()=>{const seen=reachable(target,'Respond - Not Eligible');assert.equal(seen.size,1);for(const writer of writers)assert.ok(!seen.has(writer));});
test('gate trusts only backend evaluation response, never webhook input',()=>{const n=target.nodes.find(n=>n.name==='Operator Test Barrier?');const expr=n.parameters.conditions.conditions[0].leftValue;assert.match(expr,/Evaluate Security Remediation/);assert.doesNotMatch(expr,/Webhook|\$json/);assert.match(expr,/OPERATOR_TEST_STOPPED/);assert.match(expr,/=== true/);});
test('strict diff one gate, no existing node/credential/settings changes',()=>{assert.deepEqual(target,expected);assert.equal(target.nodes.length,baseline.nodes.length+1);for(const n of baseline.nodes)assert.deepEqual(target.nodes.find(x=>x.name===n.name),n);assert.deepEqual(target.settings,baseline.settings);for(const [name,c] of Object.entries(baseline.connections))if(name!=='Evaluation HTTP OK?')assert.deepEqual(target.connections[name],c);});
test('disabled normal branch rejoins original graph without writer changes',()=>{assert.equal(target.connections['Operator Test Barrier?'].main[1][0].node,'Evaluation Not Technical Failure?');assert.equal(target.connections['Operator Test Barrier?'].main[0][0].node,'Respond - Not Eligible');});
import vm from 'node:vm';
test('gate executes only for authoritative test-stop response; injected webhook fields cannot activate it',()=>{
 const n=target.nodes.find(n=>n.name==='Operator Test Barrier?');const expression=n.parameters.conditions.conditions[0].leftValue.slice(3,-2);
 /** Évalue les données et retourne la décision correspondante. */
 const evaluate=body=>vm.runInNewContext(expression,{
 /** Simule l’accès à un nœud n8n pour le scénario. */
 $:name=>{assert.equal(name,'Evaluate Security Remediation');return {
 /** Renvoie le premier élément disponible. */
 first:()=>({json:{body}})};},$json:{body:{operatorTestBarrier:true,status:'OPERATOR_TEST_STOPPED'}}});
 assert.equal(evaluate({status:'CANDIDATE_READY'}),false);
 assert.equal(evaluate({status:'OPERATOR_TEST_STOPPED',operatorTestBarrier:true}),true);
 assert.equal(evaluate({status:'OPERATOR_TEST_STOPPED',operatorTestBarrier:'true'}),false);
 assert.equal(evaluate({status:'CANDIDATE_READY',operatorTestBarrier:true}),false);
});
