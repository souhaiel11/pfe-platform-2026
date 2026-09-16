import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const read = name => readFileSync(new URL('./lib/'+name,import.meta.url),'utf8');
export const groundingInstruction = ' Relationship source grounding is mandatory. Declare requiredRelationshipApis for each DTO/entity remediation plan, with repositoryType, repositorySourcePath, entityType, method and idType copied exactly from sourceGrounding.groundedRelationshipApis. Only fetched declarations plus the supplied audited inheritanceContext prove inherited APIs; repository filenames and framework naming conventions do not. Do not invent UserService or repository methods. No new User(userId), fake/stub entities or speculative API calls unless fetched project convention explicitly proves support. Preserve create/update semantics and existing update associations. If a required API is absent or ambiguous, return MANUAL_OR_SPECIALIST/CONTEXT_REQUIRED rather than guess.';
export function hardenGrounding(w) {
  const node=name=>{const n=w.nodes.find(n=>n.name===name);assert.ok(n,name);return n;};
  const helper=read('wf2-java-source-grounding.js');
  if(w.nodes.some(n=>n.name==='Expand Required Dependency Sources')) {
    node('Validate Required Dependency Sources').parameters.jsCode=helper+read('wf2-validate-required-dependencies.js');
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
  const schemaCode=`
const planSchema=llmRequestBody.output_config.format.schema.properties.plans.items;
planSchema.required.push('requiredRelationshipApis');
planSchema.properties.requiredRelationshipApis={type:'array',items:{type:'object',additionalProperties:false,
  required:['repositoryType','repositorySourcePath','entityType','method','idType'],properties:{
    repositoryType:{type:'string'},repositorySourcePath:{type:'string'},entityType:{type:'string'},method:{type:'string'},idType:{type:'string'}}}};
llmRequestBody.system+=${JSON.stringify(groundingInstruction)};
`;
  planner.jsCode=planner.jsCode.replace("if(!llmRequestBody||typeof llmRequestBody!=='object')",schemaCode+"if(!llmRequestBody||typeof llmRequestBody!=='object')");
  const validation=`
const groundedApis=prepared.remediationContract?.sourceGrounding?.groundedRelationshipApis||[];
for(const plan of normalized) {
  const requiresMapping=/\\b(dto|entity|mapping)\\b/i.test(JSON.stringify(plan));
  const required=plan.requiredRelationshipApis||[];
  const proven=api=>groundedApis.some(proof=>['repositoryType','repositorySourcePath','entityType','method','idType'].every(key=>api[key]===proof[key]));
  if(!Array.isArray(required)||required.some(api=>!api||!proven(api)) ||
    (requiresMapping&&groundedApis.some(proof=>!required.some(api=>api.entityType===proof.entityType&&proven(api)))))
    throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: planned relationship API is not grounded');
}
`;
  node('Validate Generic Remediation Plan').parameters.jsCode=node('Validate Generic Remediation Plan').parameters.jsCode.replace('const fileMap=new Map();',validation+'\nconst fileMap=new Map();');
  const patch=node('Prepare - Code Patch Body').parameters;
  const patchGuard=`
const sourceGrounding=$('Prepare Generic Remediation Plan').first().json.remediationContract.sourceGrounding;
const relationships=sourceApiContext.flatMap(source=>relationFields(javaInfo(source.file,source.content)));
if(mappingRequired&&relationships.length) {
  const proofs=sourceGrounding?.groundedRelationshipApis||[];
  const required=plans.flatMap(plan=>plan.requiredRelationshipApis||[]);
  for(const relation of relationships.filter(relation=>sourceGrounding?.initialPaths?.includes(relation.ownerPath))) {
    const proof=proofs.find(proof=>proof.entityType===relation.entityType);
    if(!proof||!sourceApiContext.some(s=>s.file===proof.repositorySourcePath)||
      !required.some(api=>['repositoryType','repositorySourcePath','entityType','method','idType'].every(key=>api[key]===proof[key])))
      throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: patch relationship API is not grounded');
  }
  if(!sourceGrounding)throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: patch grounding evidence missing');
}
`;
  patch.jsCode=helper+patch.jsCode.replace('const approvedFindingIds=',patchGuard+'\nconst approvedFindingIds=')
    .replace('const completePlan={sourceApiContext,','const completePlan={sourceApiContext,sourceGrounding,');
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
