import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hardenGrounding,groundingInstruction} from './harden-wf2-relationship-source-grounding.mjs';
const wf=JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url)))[0];
const fixture=JSON.parse(readFileSync(new URL('./fixtures/wf2-relationship-source-grounding.json',import.meta.url)));
const node=name=>wf.nodes.find(n=>n.name===name);
// Mirrors the real n8n-nodes-base.github contents response: a BLOB sha plus urls
// echoing the ref actually requested. Provenance must come from that echo, never
// from the blob sha (a different identity), so items carry it exactly as produced.
const atRef=(path,ref)=>({url:'https://api.github.com/repos/souhaiel11/pfe-app-test/contents/'+path+'?ref='+ref,
  download_url:'https://raw.githubusercontent.com/souhaiel11/pfe-app-test/'+ref+'/'+path,
  html_url:'https://github.com/souhaiel11/pfe-app-test/blob/'+ref+'/'+path});
const toItemAt=(source,ref)=>({json:{path:source.path,sha:source.sha,
  content:Buffer.from(source.content).toString('base64'),...atRef(source.path,ref)}});
const toItem=source=>toItemAt(source,fixture.sourceCommitSha);
const ctx={repository_owner:'souhaiel11',repository_name:'pfe-app-test',baseSha:fixture.sourceCommitSha,
  repositoryPolicy:{existingFiles:fixture.repositoryTree},findings:[]};
function run(name,items,refs={}) {
  const values={'Build Independent Repository Policy':[ctx],'Prepare Batch Context':[ctx],'Lookup Remediation Branch':[{statusCode:404}],...refs};
  const $=key=>{assert.ok(values[key],'unexpected reference '+key);return {first:()=>({json:values[key][0]}),all:()=>values[key].map(json=>({json})),item:{json:values[key][0]}};};
  return new Function('$input','$json','$','Buffer',node(name).parameters.jsCode)({all:()=>items,first:()=>items[0]},items[0]?.json,$,Buffer);
}
const initial=fixture.sources.filter(s=>fixture.initialPaths.includes(s.path)).map(toItem);
const expanded=run('Expand Required Dependency Sources',initial);
const paths=expanded.map(item=>item.json.target_file_path);
// Exact expected filenames are grounded by the frozen fixture, not hardcoded in production.
assert.deepEqual([...paths].sort(),fixture.sources.map(s=>s.path).sort());
assert.equal(paths.length,6);
const repository=fixture.sources.find(s=>/interface UserRepository/.test(s.content));
const entity=fixture.sources.find(s=>/class User\s/.test(s.content));
const service=fixture.sources.find(s=>/class TaskService\s/.test(s.content));
assert.doesNotMatch(service.content,/import [\w.]*UserRepository|private (?:final )?UserRepository/);
assert.ok(paths.includes(repository.path));assert.ok(paths.includes(entity.path));
assert.equal(expanded.find(i=>i.json.target_file_path===repository.path).json.sourceGroundingRequest.reason,'RELATIONSHIP_REPOSITORY_CANDIDATE');
assert.ok(expanded.every(i=>i.json.sourceGroundingRequest.frozenSourceSha===fixture.sourceCommitSha));
assert.ok(expanded.every(i=>i.json.sourceGroundingRequest.expansionDepth===2));
const fetch=node('Fetch Required Dependency Sources');
assert.deepEqual(fetch.parameters,node('Fetch Referenced API Sources').parameters,'native exact-SHA fetch unchanged');
assert.equal(fetch.maxTries,3);assert.equal(fetch.retryOnFail,true);
const refExpression=fetch.parameters.additionalParameters.reference;
const evalRef=branch=>new Function('$','return ('+refExpression.slice(3,-2)+')')(name=>({first:()=>({json:name==='Lookup Remediation Branch'?branch:ctx})}));
assert.equal(evalRef({statusCode:404}),fixture.sourceCommitSha);
assert.equal(evalRef({statusCode:200,body:{object:{sha:'a'.repeat(40)}}}),fixture.sourceCommitSha,
  'dependency grounding remains pinned to frozen baseline even when a remediation branch exists');
const gate=(items,requests=expanded)=>run('Validate Required Dependency Sources',items,{'Expand Required Dependency Sources':requests.map(i=>i.json)});
const fetched=fixture.sources.map(toItem);
const grounded=gate(fetched);
const grounding=grounded[0].json.sourceGrounding;
assert.deepEqual(grounding.initialPaths,fixture.initialPaths);
assert.deepEqual(grounding.requiredPaths,paths);
assert.equal(grounding.groundedRelationshipApis.length,1);
const proof=grounding.groundedRelationshipApis[0];
assert.equal(proof.repositoryType,'com.pfe.devsecops.repository.UserRepository');
assert.equal(proof.entityType,'com.pfe.devsecops.model.User');
assert.equal(proof.repositorySourcePath,repository.path);
assert.equal(proof.method,'findById');assert.equal(proof.idType,'Long');
assert.equal(proof.returnType,'java.util.Optional<com.pfe.devsecops.model.User>');
assert.equal(proof.inheritanceContext.signature,'java.util.Optional<T> findById(ID)');
assert.match(proof.repositoryDeclaration,/extends JpaRepository<User, Long>/);
assert.equal(proof.sourceCommitSha,fixture.sourceCommitSha);
// A required dependency's error cannot produce any planner input.
for (const failed of [fetched.filter(i=>i.json.path!==repository.path),
  fetched.map(i=>i.json.path===repository.path?{json:{error:'EAI_AGAIN',target_file_path:repository.path}}:i),
  [],fetched.map(i=>i.json.path===entity.path?{json:{...i.json,content:''}}:i)])
  assert.throws(()=>gate(failed),/SOURCE_API_CONTEXT_INCOMPLETE/);
const referencingService=initial.map(item=>item.json.path===service.path?toItem({...service,content:service.content
  .replace('public class TaskService {','public class TaskService {\n    private UserRepository userRepository;')
  .replace('import com.pfe.devsecops.model.User;','import com.pfe.devsecops.model.User;\nimport com.pfe.devsecops.repository.UserRepository;')}):item);
const explicitlyRequired=run('Expand Required Dependency Sources',referencingService);
assert.ok(explicitlyRequired.some(item=>item.json.target_file_path===repository.path));
assert.throws(()=>gate(fetched.filter(item=>item.json.path!==repository.path),explicitlyRequired),/SOURCE_API_CONTEXT_INCOMPLETE/,
  'a simulated explicit TaskService→UserRepository reference is required, never best-effort');
const changed=fetched.map(i=>i.json.path===repository.path?{json:{...i.json,sourceCommitSha:'b'.repeat(40)}}:i);
assert.throws(()=>gate(changed),/SOURCE_API_CONTEXT_INCOMPLETE/);
// A filename alone, an invented interface, incorrect generic ID, and commented
// declarations do not prove a User lookup API.
for(const content of [repository.content.replace('JpaRepository<User, Long>','UnprovenRepository<User, Long>'),
  repository.content.replace('JpaRepository<User, Long>','JpaRepository<User, String>'),
  '/* '+repository.content+' */']) {
  assert.throws(()=>gate(fetched.map(i=>i.json.path===repository.path?toItem({...repository,content}):i)),/SOURCE_API_CONTEXT_INCOMPLETE/);
}
// Third-party and unsafe tree entries are ignored even if present in the repository.
const extraTree=['src/main/java/org/springframework/Fake.java','src/main/java/java/util/Fake.java',
  'src/main/java/com/fasterxml/Fake.java','build/src/main/java/com/pfe/devsecops/repository/Secret.java',
  'src/main/resources/secrets.properties','src/main/java/com/pfe/devsecops/config/Secret.java'];
const hostile=structuredClone(initial);hostile[0].json.content=Buffer.from(fixture.sources[0].content+
  '\nimport org.springframework.Fake;\nimport java.util.Fake;\nimport com.fasterxml.Fake;\nimport com.pfe.devsecops.config.Secret;').toString('base64');
const filtered=run('Expand Required Dependency Sources',hostile,{'Build Independent Repository Policy':[{...ctx,repositoryPolicy:{existingFiles:[...fixture.repositoryTree,...extraTree]}}]});
assert.deepEqual(filtered.map(i=>i.json.target_file_path),paths);
// No third hop: an import added to newly-fetched User is not traversed.
const beyond=fixture.sources.map(s=>s.path===entity.path?{...s,content:s.content+'\nimport com.pfe.devsecops.service.ThirdHop;'}:s).map(toItem);
assert.equal(gate(beyond).length,6);
const repositoryExtras=Array.from({length:13},(_,i)=>'src/main/java/com/pfe/devsecops/repository/Extra'+i+'.java');
assert.throws(()=>run('Expand Required Dependency Sources',initial,{'Build Independent Repository Policy':[{...ctx,repositoryPolicy:{existingFiles:[...fixture.repositoryTree,...repositoryExtras]}}]}),/SOURCE_API_CONTEXT_LIMIT_EXCEEDED/);
const huge=structuredClone(initial);huge[0].json.content=Buffer.from('x'.repeat(65537)).toString('base64');
assert.throws(()=>run('Expand Required Dependency Sources',huge),/SOURCE_API_CONTEXT_LIMIT_EXCEEDED/);
const hugeFetched=structuredClone(fetched);hugeFetched[0].json.content=Buffer.from('x'.repeat(65537)).toString('base64');
assert.throws(()=>gate(hugeFetched),/SOURCE_API_CONTEXT_LIMIT_EXCEEDED/);
const exactChars=fixture.sources.reduce((sum,s)=>sum+s.content.length,0);
const boundarySources=fixture.sources.map((s,i)=>i===0?{...s,content:s.content+' '.repeat(65536-exactChars)}:s);
assert.equal(gate(boundarySources.map(toItem)).length,6,'exactly 65536 decoded source characters remain supported');
const overflowRequests=structuredClone(expanded);
overflowRequests[0].json.sourceGroundingRequest.requiredPaths=Array.from({length:13},(_,i)=>'src/main/java/app/X'+i+'.java');
assert.throws(()=>gate(fetched,overflowRequests),/SOURCE_API_CONTEXT_LIMIT_EXCEEDED/);
// Association completeness counts ONLY single-valued owning relationships, the
// same categories relationFields extracts and the grounding contract can prove.
// Fail-closed is retained where it matters: a real @ManyToOne/@OneToOne whose
// declaration the conservative parser cannot represent must still stop planning.
const withTask=body=>{const c=structuredClone(initial);
  c[1].json.content=Buffer.from(body).toString('base64');return c;};
const taskSource=fixture.sources[1].content;
assert.match(taskSource,/@ManyToOne\b/,'fixture still declares the owning association it grounds');
// Access modifier absent (package-private JPA field): annotation seen, field unparseable.
const packagePrivate=withTask(taskSource.replace('private User user;','User user;'));
assert.throws(()=>run('Expand Required Dependency Sources',packagePrivate),/SOURCE_API_CONTEXT_INCOMPLETE/,
  'unparseable @ManyToOne declaration cannot silently lose evidence');
// Parameterized field type the conservative adapter deliberately does not resolve.
const genericField=withTask(taskSource.replace('private User user;','private Optional<User> user;'));
assert.throws(()=>run('Expand Required Dependency Sources',genericField),/SOURCE_API_CONTEXT_INCOMPLETE/,
  'unparseable parameterized owning relationship cannot silently lose evidence');
// Collection-valued associations are outside the single-valued evidence contract
// and must not manufacture a mismatch. They are not "ignored" elsewhere -- only
// excluded from THIS invariant, which has no findById proof to demand for them.
for (const collection of ['@OneToMany(mappedBy = "task")','@ManyToMany']) {
  const items=withTask(taskSource.replace('@ManyToOne',collection));
  const expandedCollection=run('Expand Required Dependency Sources',items);
  assert.ok(expandedCollection.length>0,collection+' must not false-block source expansion');
  assert.ok(expandedCollection.every(item=>item.json.sourceGroundingRequest.requiredRelationships.length===0),
    collection+' declares no single-valued relationship to ground');
}
// A parseable @OneToOne owning side is grounded exactly like @ManyToOne.
const oneToOne=withTask(taskSource.replace('@ManyToOne','@OneToOne'));
const expandedOneToOne=run('Expand Required Dependency Sources',oneToOne);
assert.equal(expandedOneToOne[0].json.sourceGroundingRequest.requiredRelationships.length,1,
  '@OneToOne owning relationship is still required evidence');

// Actual planner request includes fetched proofs and structured API requirements.
const plannedRequest=run('Prepare Generic Remediation Plan',grounded)[0].json;
assert.deepEqual(plannedRequest.remediationContract.sourceGrounding,grounding);
assert.ok(plannedRequest.llmRequestBody.system.includes(groundingInstruction));
assert.ok(plannedRequest.llmRequestBody.output_config.format.schema.properties.plans.items.required.includes('requiredRelationshipApis'));
const plan={findingId:'f',target:{file:fixture.initialPaths[0]},filesToModify:[fixture.initialPaths[0]],filesToCreate:[],
  requiredChanges:['DTO mapping'],requiredRelationshipApis:[proof]};
const validationCode=node('Validate Generic Remediation Plan').parameters.jsCode;
const validation=validationCode.slice(validationCode.indexOf('const groundedApis='),validationCode.indexOf('const fileMap=new Map();'));
const validate=plans=>new Function('prepared','normalized',validation)(plannedRequest,plans);
validate([plan]);
assert.throws(()=>validate([{...plan,requiredRelationshipApis:[]}]),/SOURCE_API_CONTEXT_INCOMPLETE/);
assert.throws(()=>validate([{...plan,requiredRelationshipApis:[{...proof,method:'findUserById'}]}]),/SOURCE_API_CONTEXT_INCOMPLETE/);
const planned={target_file_path:fixture.initialPaths[0],fileOperation:'MODIFY',remediationPlans:[plan],plannedFiles:[{path:fixture.initialPaths[0],operation:'MODIFY'}]};
const patchRequest=run('Prepare - Code Patch Body',[fetched[0]],{'Prepare Generic Remediation Plan':[plannedRequest],'Validate Generic Remediation Plan':[planned]}).json;
assert.deepEqual(patchRequest.completePlan.sourceGrounding,grounding);
const ungrounded=structuredClone(plannedRequest);delete ungrounded.remediationContract.sourceGrounding;
assert.throws(()=>run('Prepare - Code Patch Body',[fetched[0]],{'Prepare Generic Remediation Plan':[ungrounded],'Validate Generic Remediation Plan':[planned]}),/SOURCE_API_CONTEXT_INCOMPLETE/);
assert.equal(patchRequest.llmRequestBody.model,'claude-opus-5');assert.equal(patchRequest.llmRequestBody.max_tokens,32768);
assert.deepEqual(patchRequest.llmRequestBody.thinking,{type:'adaptive'});assert.equal(patchRequest.llmRequestBody.output_config.effort,'medium');
assert.ok(patchRequest.llmRequestBody.system.includes('No new User(userId)'));

const targets=(name,port=0)=>(wf.connections[name]?.main[port]||[]).map(e=>e.node);
assert.deepEqual(targets('Validate Source Context Completeness'),['Expand Required Dependency Sources']);
for(const port of [0,1]) assert.deepEqual(targets('Fetch Required Dependency Sources',port),['Validate Required Dependency Sources']);
assert.deepEqual(targets('Validate Required Dependency Sources'),['Prepare Generic Remediation Plan']);
assert.deepEqual(targets('Validate Required Dependency Sources',1),['Failure Envelope - Fetch Referenced API Sources']);
const reach=(start,stop)=>{const seen=new Set(),todo=[start];while(todo.length){const name=todo.pop();if(seen.has(name)||name===stop)continue;seen.add(name);todo.push(...(wf.connections[name]?.main||[]).flat().map(e=>e.node));}return seen;};
for(const stop of ['Validate Source Context Completeness','Validate Required Dependency Sources']) {
  const reached=reach('Expand Referenced API Sources',stop);
  for(const blocked of ['Prepare Generic Remediation Plan','Prepare - Code Patch Body','Independent Semantic Review','Call Candidate Verification','Create Missing Branch','Update File in Branch']) assert.ok(!reached.has(blocked),blocked+' bypasses '+stop);
}
for(const blocked of ['Prepare Generic Remediation Plan','Independent Semantic Review','Call Candidate Verification','Update File in Branch'])
  assert.ok(!reach('Failure Envelope - Fetch Referenced API Sources').has(blocked));
assert.deepEqual(targets('Generic Candidate Preflight'),['Hash Candidate File Content']);
assert.deepEqual(targets('Prepare Candidate Manifest'),['Independent Semantic Review']);
assert.match(node('Prepare Candidate Manifest').parameters.jsCode,/failCandidateSet/);
assert.equal(wf.nodes.length,155);
assert.deepEqual(hardenGrounding(structuredClone(wf)),wf);
console.log('PASS relationship source grounding: real 3→6 source chain, audited findById proof, exact SHA, required failures, bounds, no third-party crawl, planner/patch grounding, atomic review and Git barriers');
