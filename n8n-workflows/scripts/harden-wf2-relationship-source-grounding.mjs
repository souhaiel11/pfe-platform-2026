import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const read = name => readFileSync(new URL('./lib/'+name,import.meta.url),'utf8');
export const groundingInstruction = ' Relationship source grounding is mandatory. relationshipOperations describes ONLY relationships touched by this plan; do not list unrelated relationships merely because they exist in source context. For every operation, copy the exact grounded relationship identity tuple verbatim from sourceGrounding.groundedRelationshipApis: ownerPath is the exact owner source path, field is the exact relationship field, and relatedEntityType is the exact fully-qualified TARGET entity type from evidence (the proof entityType), NOT the owner entity. Do not invent or shorten fully-qualified types. For the supplied Task.user evidence this means ownerPath=src/main/java/com/pfe/devsecops/model/Task.java, field=user, relatedEntityType=com.pfe.devsecops.model.User; DO NOT output Task as relatedEntityType. Use RESOLVE_BY_ID only when the plan will perform a repository lookup, with a non-null requiredApi copied exactly from sourceGrounding.groundedRelationshipApis and whose entityType equals relatedEntityType. Use PRESERVE when the existing association remains unchanged without a lookup, with requiredApi null. For CREATE S4684 use RESOLVE_BY_ID with the exact UserRepository.findById(Long) proof; for UPDATE S4684 use PRESERVE with requiredApi null. requiredRelationshipApis must equal exactly the deduplicated non-null requiredApi values used by this plan\'s API-consuming relationshipOperations. Only fetched declarations plus the supplied audited inheritanceContext prove inherited APIs; repository filenames and framework naming conventions do not. Do not invent UserService or repository methods. No new User(userId), fake/stub entities or speculative API calls unless fetched project convention explicitly proves support. If a required relationship or API is absent or ambiguous, return MANUAL_OR_SPECIALIST/CONTEXT_REQUIRED rather than guess.';
const apiProofSchema = `{type:'object',additionalProperties:false,required:['repositoryType','repositorySourcePath','entityType','method','idType'],properties:{repositoryType:{type:'string'},repositorySourcePath:{type:'string'},entityType:{type:'string'},method:{type:'string'},idType:{type:'string'}}}`;
export const relationshipPlanSchema = String.raw`
const planSchema=llmRequestBody.output_config.format.schema.properties.plans.items;
planSchema.required.push('requiredRelationshipApis','relationshipOperations');
planSchema.properties.requiredRelationshipApis={type:'array',items:${apiProofSchema}};
planSchema.properties.relationshipOperations={type:'array',items:{type:'object',additionalProperties:false,
  required:['ownerPath','field','relatedEntityType','operation','requiredApi'],properties:{
    ownerPath:{type:'string',description:'Exact owner source path copied from supplied grounded relationship evidence.'},
    field:{type:'string',description:'Exact relationship field copied from supplied grounded relationship evidence.'},
    relatedEntityType:{type:'string',description:'Exact fully-qualified TARGET entity type copied from supplied grounded relationship evidence; never the owner entity or a simple type name.'},
    operation:{type:'string',enum:['RESOLVE_BY_ID','PRESERVE']},requiredApi:{anyOf:[${apiProofSchema},{type:'null'}]}}}};
llmRequestBody.system+=${JSON.stringify(groundingInstruction)};
`;
export const relationshipPlanValidation = String.raw`
const groundedApis=prepared.remediationContract?.sourceGrounding?.groundedRelationshipApis||[];
const proofKeys=['repositoryType','repositorySourcePath','entityType','method','idType'];
const proven=api=>groundedApis.some(proof=>proofKeys.every(key=>api[key]===proof[key]));
const apiKey=api=>proofKeys.map(key=>String(api?.[key]||'')).join('\u0000');
for(const plan of normalized) {
  const required=plan.requiredRelationshipApis||[];
  const operations=plan.relationshipOperations;
  if(!Array.isArray(required)||!Array.isArray(operations)||required.some(api=>!api||!proven(api)))
    throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: planned relationship API is not grounded');
  const used=[];
  for(const operation of operations) {
    const relationship=operation&&groundedApis.find(proof=>proof.ownerPath===operation.ownerPath&&proof.field===operation.field&&proof.entityType===operation.relatedEntityType);
    if(!relationship||!['RESOLVE_BY_ID','PRESERVE'].includes(operation.operation))
      throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: planned relationship operation is not grounded');
    if(operation.operation==='RESOLVE_BY_ID') {
      if(!operation.requiredApi||!proven(operation.requiredApi)||operation.requiredApi.entityType!==operation.relatedEntityType||
        !proofKeys.every(key=>operation.requiredApi[key]===relationship[key]))
        throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: planned relationship API is not grounded');
      used.push(operation.requiredApi);
    } else if(operation.requiredApi!==null) {
      throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: preserved relationship must not require an API');
    }
  }
  const declaredKeys=[...new Set(required.map(apiKey))].sort();
  const usedKeys=[...new Set(used.map(apiKey))].sort();
  if(JSON.stringify(declaredKeys)!==JSON.stringify(usedKeys))
    throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: required relationship APIs do not match relationship operations');
}
`;
export const relationshipPatchGuard = String.raw`
const sourceGrounding=$('Prepare Generic Remediation Plan').first().json.remediationContract.sourceGrounding;
const relationships=sourceApiContext.flatMap(source=>relationFields(javaInfo(source.file,source.content)));
const proofs=sourceGrounding?.groundedRelationshipApis||[];
const proofKeys=['repositoryType','repositorySourcePath','entityType','method','idType'];
const proven=api=>proofs.some(proof=>proofKeys.every(key=>api[key]===proof[key]));
if(plans.some(plan=>!Array.isArray(plan.relationshipOperations)||!Array.isArray(plan.requiredRelationshipApis)))
  throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: patch relationship operations missing');
const relationshipOperations=plans.flatMap(plan=>plan.relationshipOperations||[]);
for(const operation of relationshipOperations) {
  const relationship=relationships.find(relation=>relation.ownerPath===operation.ownerPath&&relation.field===operation.field&&relation.entityType===operation.relatedEntityType);
  if(!relationship)throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: patch relationship operation is not grounded');
  if(operation.operation==='RESOLVE_BY_ID') {
    const proof=proofs.find(proof=>proof.ownerPath===operation.ownerPath&&proof.field===operation.field&&proof.entityType===operation.relatedEntityType);
    if(!operation.requiredApi||!proof||!proven(operation.requiredApi)||
      operation.requiredApi.entityType!==operation.relatedEntityType||
      !proofKeys.every(key=>operation.requiredApi[key]===proof[key])||
      !sourceApiContext.some(source=>source.file===proof.repositorySourcePath))
      throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: patch relationship API is not grounded');
  } else if(operation.operation==='PRESERVE') {
    if(operation.requiredApi!==null)throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: preserved patch relationship must not require an API');
  } else throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: patch relationship operation is not grounded');
}
if(!sourceGrounding)throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: patch grounding evidence missing');
`;
export function hardenGrounding(w) {
  const node=name=>{const n=w.nodes.find(n=>n.name===name);assert.ok(n,name);return n;};
  const helper=read('wf2-java-source-grounding.js');
  if(w.nodes.some(n=>n.name==='Expand Required Dependency Sources')) {
    node('Validate Required Dependency Sources').parameters.jsCode=helper+read('wf2-validate-required-dependencies.js');
    const planner=node('Prepare Generic Remediation Plan').parameters;
    const plannerStart=planner.jsCode.indexOf('const planSchema=');
    const plannerEnd=planner.jsCode.indexOf("if(!llmRequestBody||typeof llmRequestBody!=='object')",plannerStart);
    assert.ok(plannerStart>=0&&plannerEnd>plannerStart,'relationship planner schema block missing');
    planner.jsCode=planner.jsCode.slice(0,plannerStart)+relationshipPlanSchema.trim()+'\n'+planner.jsCode.slice(plannerEnd);
    const validator=node('Validate Generic Remediation Plan').parameters;
    const start=validator.jsCode.indexOf('const groundedApis=');
    const end=validator.jsCode.indexOf('const fileMap=new Map();',start);
    assert.ok(start>=0&&end>start,'relationship plan validation block missing');
    validator.jsCode=validator.jsCode.slice(0,start)+relationshipPlanValidation.trim()+'\n\n'+validator.jsCode.slice(end);
    const patch=node('Prepare - Code Patch Body').parameters;
    const patchStart=patch.jsCode.indexOf("const sourceGrounding=$('Prepare Generic Remediation Plan')");
    const patchEnd=patch.jsCode.indexOf('const approvedFindingIds=',patchStart);
    assert.ok(patchStart>=0&&patchEnd>patchStart,'relationship patch guard missing');
    patch.jsCode=patch.jsCode.slice(0,patchStart)+relationshipPatchGuard.trim()+'\n\n'+patch.jsCode.slice(patchEnd);
    if(!patch.jsCode.includes('relationshipOperations:plans.flatMap'))
      patch.jsCode=patch.jsCode.replace('const completePlan={sourceApiContext,sourceGrounding,','const completePlan={sourceApiContext,sourceGrounding,relationshipOperations:plans.flatMap(plan=>plan.relationshipOperations||[]),');
    const requestGuard=patch.jsCode.indexOf("if(!llmRequestBody||typeof llmRequestBody!=='object')");
    const instructionStart=patch.jsCode.lastIndexOf('llmRequestBody.system+=',requestGuard);
    assert.ok(instructionStart>=0&&requestGuard>instructionStart,'patch grounding instruction missing');
    patch.jsCode=patch.jsCode.slice(0,instructionStart)+'llmRequestBody.system+='+JSON.stringify(groundingInstruction)+';\n'+patch.jsCode.slice(requestGuard);
    assert.equal(w.nodes.length,155);
    return w;
  }
  assert.equal(w.nodes.length,152);
  const edge=name=>({node:name,type:'main',index:0});
  const expand={id:randomUUID(),name:'Expand Required Dependency Sources',type:'n8n-nodes-base.code',typeVersion:2,
    position:[6840,1220],onError:'continueErrorOutput',parameters:{mode:'runOnceForAllItems',jsCode:helper+read('wf2-expand-required-dependencies.js')}};
  const fetch=structuredClone(node('Fetch Referenced API Sources'));
  Object.assign(fetch,{id:randomUUID(),name:'Fetch Required Dependency Sources',position:[7060,1220]});
  delete fetch.webhookId;
  const gate={id:randomUUID(),name:'Validate Required Dependency Sources',type:'n8n-nodes-base.code',typeVersion:2,
    position:[7280,1220],onError:'continueErrorOutput',parameters:{mode:'runOnceForAllItems',jsCode:helper+read('wf2-validate-required-dependencies.js')}};
  w.nodes.push(expand,fetch,gate);
  w.connections['Validate Source Context Completeness'].main[0]=[edge(expand.name)];
  w.connections[expand.name]={main:[[edge(fetch.name)],[edge('Failure Envelope - Fetch Referenced API Sources')]]};
  w.connections[fetch.name]={main:[[edge(gate.name)],[edge(gate.name)]]};
  w.connections[gate.name]={main:[[edge('Prepare Generic Remediation Plan')],[edge('Failure Envelope - Fetch Referenced API Sources')]]};

  // Prevent initial import expansion from selecting mirrored third-party/config sources.
  const initial=node('Expand Referenced API Sources').parameters;
  initial.jsCode=helper+initial.jsCode.replace('if(existing.has(candidate))',"if(!excludedImport(match[1])&&match[1].startsWith((source.match(/\\bpackage\\s+([\\w.]+)\\s*;/)?.[1]||'').split('.').slice(0,-1).join('.')+'.')&&safeJavaPath(candidate)&&existing.has(candidate))");
  const planner=node('Prepare Generic Remediation Plan').parameters;
  planner.jsCode=planner.jsCode.replace('const correctiveContext=', "const sourceGrounding=$input.all()[0]?.json.sourceGrounding;\nif(!sourceGrounding)throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: grounding gate evidence missing');\nconst correctiveContext=")
    .replace('sourceSnapshots,forbiddenChanges:forbidden','sourceSnapshots,sourceGrounding,forbiddenChanges:forbidden');
  planner.jsCode=planner.jsCode.replace("if(!llmRequestBody||typeof llmRequestBody!=='object')",relationshipPlanSchema.trim()+"\nif(!llmRequestBody||typeof llmRequestBody!=='object')");
  node('Validate Generic Remediation Plan').parameters.jsCode=node('Validate Generic Remediation Plan').parameters.jsCode.replace('const fileMap=new Map();',relationshipPlanValidation.trim()+'\n\nconst fileMap=new Map();');
  const patch=node('Prepare - Code Patch Body').parameters;
  patch.jsCode=helper+patch.jsCode.replace('const approvedFindingIds=',relationshipPatchGuard.trim()+'\n\nconst approvedFindingIds=')
    .replace('const completePlan={sourceApiContext,','const completePlan={sourceApiContext,sourceGrounding,relationshipOperations:plans.flatMap(plan=>plan.relationshipOperations||[]),');
  patch.jsCode=patch.jsCode.replace("if(!llmRequestBody||typeof llmRequestBody!=='object')",'llmRequestBody.system+='+JSON.stringify(groundingInstruction)+";\nif(!llmRequestBody||typeof llmRequestBody!=='object')");
  node('Prepare Candidate Manifest').parameters.jsCode=node('Prepare Candidate Manifest').parameters.jsCode.replace('  sourceSnapshots,','  sourceSnapshots,\n  sourceGrounding: prepared.remediationContract?.sourceGrounding,');
  assert.equal(w.nodes.length,155);
  return w;
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]) {
  const path=new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url);
  const data=JSON.parse(readFileSync(path,'utf8'));hardenGrounding(data[0]);writeFileSync(path,JSON.stringify(data,null,2)+'\n');
  console.log('Local bounded relationship source grounding: 155 nodes; no live actions.');
}
