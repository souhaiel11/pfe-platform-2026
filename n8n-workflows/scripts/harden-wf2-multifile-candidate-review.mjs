// Local artifact transformation only. No imports into n8n or business actions.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export const relationshipContract = ' When replacing persistence entities with DTOs, preserve all semantically relevant entity relationships; never silently drop association fields. Inventory each association and explicitly distinguish create vs update semantics in requiredChanges and expectedBehaviorPreserved. Map relationship IDs only through APIs proven in supplied source context, including the actual repository declaration or existing service implementation. Preserve the existing entity relationship on update when the original update leaves it unchanged; do not introduce reassignment or clearing semantics. Resolve a supplied create-time relationship ID using the proven project API and handle missing IDs and unknown entities explicitly according to existing behavior. Do not instantiate fake/stub entities merely to satisfy a foreign key unless supplied project convention explicitly supports it. Never invent a repository/service method. If required relationship API evidence is absent, fail rather than guess: the planner must return MANUAL_OR_SPECIALIST with CONTEXT_REQUIRED, and the patch generator must stop without a speculative patch.';
export const batchReviewContract = ' Evaluate this entire candidate set atomically. All planned sibling files are supplied together: resolve imports, types and method signatures against these candidate files before falling back to original sources. A DTO supplied in this batch is not missing just because it is CREATE. Reject genuine cross-file defects: DTO/entity persistence coupling, incompatible method signatures, missing mappings, dropped relationships, enum conversion errors and controller/service/DTO semantic mismatches. Trace every original entity association through create and update paths. A DTO-to-entity mapping that silently drops a supplied association is REJECTED; updates must preserve relationships that the original update preserves. Accept relationship ID resolution only through APIs proven by original source context; fake/stub entities or invented methods are not proof. If source evidence is insufficient, return INCONCLUSIVE. Any rejected or inconclusive file or cross-file contract rejects the entire batch. Do not relax any existing semantic criterion; do not claim scanner resolution.';

export function harden(workflow) {
  const node = name => { const n = workflow.nodes.find(n => n.name === name); assert.ok(n, name); return n; };
  if (node('Prepare Candidate Manifest').parameters.jsCode.includes('failCandidateSet')) return workflow;
  const edge = name => ({node: name, type: 'main', index: 0});
  const connect = (from, to) => { workflow.connections[from].main[0] = [edge(to)]; };
  connect('Generic Candidate Preflight', 'Hash Candidate File Content');
  connect('Prepare Candidate Manifest', 'Independent Semantic Review');
  connect('Enforce Independent Review', 'Hash Candidate Manifest');
  node('Accumulate Candidate File').parameters.jsCode = node('Accumulate Candidate File').parameters.jsCode
    .replace("$('Enforce Independent Review').item.json", "$('Generic Candidate Preflight').item.json");

  const prepare = node('Prepare Candidate Manifest');
  let code = prepare.parameters.jsCode;
  const firstLine = code.indexOf('\n');
  code = code.slice(0, firstLine + 1) + readFileSync(new URL('./lib/wf2-candidate-set-guard.js', import.meta.url), 'utf8') + '\n' + code.slice(firstLine + 1);
  code = code.replace("path:String(it.target_file_path||it.file_path||'')", "path:canonicalPath(it.targetFile||it.target_file_path||it.file_path)");
  code = code.replace('validationEvidence:it.validationEvidence', "validationEvidence:{genericPreflight:it.preflightEvidence,buildTest:it.buildTestEvidence,scannerResolution:'UNKNOWN_UNTIL_WF3'}");
  const request = `
const prepared = $('Prepare Generic Remediation Plan').first().json;
const sourceSnapshots = prepared.remediationContract?.sourceSnapshots || [];
if (sourceSnapshots.length > 12 || sourceSnapshots.reduce((sum, source) => sum + String(source.content || '').length, 0) > 65536)
  throw new Error('SOURCE_API_CONTEXT_LIMIT_EXCEEDED');
const template = items[0].llmRequestBody;
if (!template?.system || !template?.model) throw new Error('LLM_REQUEST_BODY_INVALID');
const reviewContext = {
  fullRemediationPlan: validatedPlan[0].remediationPlans,
  plannedFiles: expected,
  sourceSnapshots,
  originalFindings: prepared.remediationContract?.findings || [],
  forbiddenChanges: prepared.remediationContract?.forbiddenChanges || [],
  candidateFiles: files.map((file, index) => ({path: file.path, operation: file.operation,
    originalCode: file.sourceContent, candidateCode: file.content,
    applicablePlans: items[index].applicablePlans, preflightEvidence: items[index].preflightEvidence,
    buildTestEvidence: items[index].buildTestEvidence})),
  completeness: {plannedCount: expected.length, generatedCount: items.length}
};
const llmRequestBody = {...template, system: template.system + ${JSON.stringify(batchReviewContract)},
  messages: [{role: 'user', content: JSON.stringify(reviewContext)}]};
return [{json:{...manifest,_canonicalJson:JSON.stringify(canonical),candidateSetComplete:true,
  llmRequestBody,reviewBodyString:JSON.stringify(llmRequestBody)}}];`;
  code = code.replace('return [{json:{...manifest,_canonicalJson:JSON.stringify(canonical)}}];', request);
  prepare.parameters.jsCode = code;
  prepare.onError = 'continueErrorOutput';
  workflow.connections[prepare.name].main[1] = [edge('Failure Envelope - Assemble Candidate Manifest')];
  const envelope = node('Failure Envelope - Assemble Candidate Manifest');
  envelope.parameters.jsCode = envelope.parameters.jsCode.replace('failedNode:"Assemble Candidate Manifest"',
    'failedNode:rawSummary.startsWith("CANDIDATE_SET_")||rawSummary.startsWith("SOURCE_API_CONTEXT_")||rawSummary.startsWith("LLM_REQUEST_")?"Prepare Candidate Manifest":"Assemble Candidate Manifest"');

  const enforce = node('Enforce Independent Review');
  enforce.parameters.jsCode = enforce.parameters.jsCode.replace("const candidate=$('Generic Candidate Preflight').item.json;", "const candidate=$('Prepare Candidate Manifest').first().json;if(candidate.candidateSetComplete!==true)throw new Error('CANDIDATE_SET_INCOMPLETE');");
  const returnStart = enforce.parameters.jsCode.indexOf('return {json:{...candidate,candidateDecision:');
  assert.ok(returnStart > 0);
  enforce.parameters.jsCode = enforce.parameters.jsCode.slice(0, returnStart) + `
const {llmRequestBody,reviewBodyString,candidateSetComplete,...manifest}=candidate;
return {json:{...manifest,files:manifest.files.map(file=>({...file,
  candidateAcceptedFindingIds:file.approvedFindingIds,
  validationEvidence:{...file.validationEvidence,independentReview:review.evidence||[],
    reviewGranularity:'BATCH',reviewedCandidatePaths:manifest.files.map(sibling=>sibling.path)}}))}};`;
  for (const name of ['Prepare Generic Remediation Plan', 'Prepare - Code Patch Body']) {
    const parameters = node(name).parameters;
    parameters.jsCode = parameters.jsCode.replace("if(!llmRequestBody||typeof llmRequestBody!=='object')", 'llmRequestBody.system += ' + JSON.stringify(relationshipContract) + ";\nif(!llmRequestBody||typeof llmRequestBody!=='object')");
  }
  assert.equal(workflow.nodes.length, 152);
  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const artifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url);
  const data = JSON.parse(readFileSync(artifact, 'utf8'));
  harden(data[0]);
  writeFileSync(artifact, JSON.stringify(data, null, 2) + '\n');
  console.log('Local WF2 atomic batch review artifact updated; 152 nodes.');
}
