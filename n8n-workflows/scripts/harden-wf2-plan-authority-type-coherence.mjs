import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {crossFileTypeCoherenceNodeCode} from './wf2-cross-file-type-coherence.mjs';

export const planAuthorityContract = ` PLAN CONTRACT IS AUTHORITATIVE. When the validated remediation plan explicitly specifies a field type, API type, or boundary representation, that explicit contract overrides generic generation preferences. A generic preference for a DTO-owned closed-domain type MUST NOT replace an explicit String contract. When the plan requires String with explicit validation or conversion semantics, generate String and preserve those semantics. When the plan explicitly requires an independent DTO enum, generate that enum and every corresponding type-safe mapping. Never mix representations across sibling candidate files.`;

export function hardenPlanAuthorityAndTypeCoherence(workflow){
  const node=name=>{const found=workflow.nodes.find(item=>item.name===name);assert.ok(found,`missing node ${name}`);return found};
  const prepare=node('Prepare - Code Patch Body');
  if(!prepare.parameters.jsCode.includes(planAuthorityContract)){
    const anchor="if(!llmRequestBody||typeof llmRequestBody!=='object')";
    assert.ok(prepare.parameters.jsCode.includes(anchor),'generator validation anchor missing');
    prepare.parameters.jsCode=prepare.parameters.jsCode.replace(anchor,`llmRequestBody.system+=${JSON.stringify(planAuthorityContract)};\n${anchor}`);
  }
  const manifest=node('Prepare Candidate Manifest');
  if(!manifest.parameters.jsCode.includes('typeResolutionSources')){
    const anchor="const template = items[0].llmRequestBody;";
    assert.ok(manifest.parameters.jsCode.includes(anchor),'manifest source snapshot anchor missing');
    manifest.parameters.jsCode=manifest.parameters.jsCode.replace(anchor,"manifest.typeResolutionSources=sourceSnapshots.map(source=>({path:source.path||source.file||'',content:String(source.content||source.source||'')}));\n"+anchor);
  }
  const validate=node('Validate Cross-File Candidate Manifest');
  const prepareCompile=node('Prepare Cross-File COMPILE_MAIN');
  let gate=workflow.nodes.find(item=>item.name==='Validate Cross-File Type Coherence');
  if(!gate){
    gate={parameters:{mode:'runOnceForAllItems',jsCode:crossFileTypeCoherenceNodeCode},id:'wf2-cross-file-type-coherence',name:'Validate Cross-File Type Coherence',type:'n8n-nodes-base.code',typeVersion:2,position:[7950,1780],onError:'continueErrorOutput'};
    workflow.nodes.push(gate);
  }else gate.parameters.jsCode=crossFileTypeCoherenceNodeCode;
  prepareCompile.position=[8000,1780];
  workflow.connections[validate.name].main[0]=[{node:gate.name,type:'main',index:0}];
  workflow.connections[gate.name]={main:[[{node:prepareCompile.name,type:'main',index:0}],[{node:'Failure Envelope - Validate Cross-File Type Coherence',type:'main',index:0}]]};
  if(!workflow.nodes.some(item=>item.name==='Failure Envelope - Validate Cross-File Type Coherence')){
    const template=structuredClone(node('Failure Envelope - Validate Cross-File Candidate Manifest'));
    template.id='wf2-cross-file-type-coherence-failure';template.name='Failure Envelope - Validate Cross-File Type Coherence';template.position=[10600,2340];
    template.parameters.jsCode=template.parameters.jsCode.replaceAll('Validate Cross-File Candidate Manifest','Validate Cross-File Type Coherence');
    workflow.nodes.push(template);
  }
  return workflow;
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const input=process.argv[2],output=process.argv[3]||input;if(!input)throw new Error('usage: node harden-wf2-plan-authority-type-coherence.mjs <input.json> [output.json]');
  const root=JSON.parse(readFileSync(input,'utf8')),workflow=Array.isArray(root)?root[0]:root;
  hardenPlanAuthorityAndTypeCoherence(workflow);writeFileSync(output,JSON.stringify(root,null,2)+'\n');
  console.log(`WF2 plan authority and cross-file type coherence added; ${workflow.nodes.length} nodes.`);
}
