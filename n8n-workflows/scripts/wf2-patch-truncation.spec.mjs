// Offline regression for execution 1993's failure shape, using synthetic source/IDs.
// No HTTP, generation, verification service, n8n execution or Git write.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url), 'utf8'))[0];
const node = name => wf.nodes.find(n => n.name === name);
const targetFile = 'src/TaskService.java';
const prepared = { targetFile, approvedFindingIdsForFile: ['finding-a', 'finding-b'], file_sha: 'blob-sha', branchName: 'fix/example' };
const parse = response => new Function('$json', '$', node('Parse - Code Patch Output').parameters.jsCode)(response,
  name => { assert.equal(name, 'Prepare - Code Patch Body'); return { item: { json: prepared } }; }).json;
const response = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const patch = { targetFile, processedFindingIds: ['finding-a', 'finding-b'], patchedCode: 'class TaskService {}',
  patchDescription: 'Preserve behavior.', conformanceEvidence: ['mapping retained'] };
const truncated = JSON.parse(readFileSync(new URL('./fixtures/wf2-patch-truncated.json', import.meta.url), 'utf8'));
assert.throws(() => JSON.parse(truncated.content[0].text));
assert.throws(() => parse(truncated), error => error.message.startsWith('PATCH_LLM_RESPONSE_TRUNCATED:')
  && !error.message.includes('PATCH_TARGET_FILE_MISMATCH'));
// Truncation takes precedence even with empty content or coincidentally complete JSON.
assert.throws(() => parse({ stop_reason: 'max_tokens', content: [] }), /PATCH_LLM_RESPONSE_TRUNCATED/);
assert.throws(() => parse({ ...response(JSON.stringify(patch)), stop_reason: 'max_tokens' }), /PATCH_LLM_RESPONSE_TRUNCATED/);

for (const text of [truncated.content[0].text, '{"inner":{"complete":true},',
  'prefix ' + JSON.stringify(patch), JSON.stringify(patch) + ' trailing',
  JSON.stringify(patch) + JSON.stringify(patch), '```json\n' + JSON.stringify(patch) + '\n```']) {
  assert.throws(() => parse(response(text)), /^Error: PATCH_RESPONSE_INVALID_JSON:/);
}
for (const value of [null, [], [patch], 'text', 3, {}, { ...patch, targetFile: '' },
  { ...patch, targetFile: 3 }, { ...patch, processedFindingIds: 'finding-a' },
  { ...patch, processedFindingIds: [42] }, { ...patch, patchedCode: null },
  { ...patch, conformanceEvidence: {} }, { ...patch, patchDescription: null },
  { ...patch, extraField: 'unexpected' }]) {
  assert.throws(() => parse(response(JSON.stringify(value))), /PATCH_RESPONSE_INVALID_SHAPE/);
}
for (const key of Object.keys(patch)) {
  const missing = { ...patch }; delete missing[key];
  assert.throws(() => parse(response(JSON.stringify(missing))), /PATCH_RESPONSE_INVALID_SHAPE/);
}
assert.throws(() => parse(response(JSON.stringify({ ...patch, patchedCode: ' \n' }))), /PATCH_EMPTY_CANDIDATE/);
assert.throws(() => parse(response(JSON.stringify({ ...patch, targetFile: 'src/OtherService.java' }))), /PATCH_TARGET_FILE_MISMATCH/);
assert.throws(() => parse(response(JSON.stringify({ ...patch, processedFindingIds: ['other'] }))), /PATCH_FINDING_SET_MISMATCH/);
const valid = parse(response(JSON.stringify(patch)));
assert.equal(valid.targetFile, targetFile);
assert.equal(valid.patchedCode, patch.patchedCode);
assert.equal(valid.oldSha, prepared.file_sha);
assert.equal(valid.branchName, prepared.branchName);
assert.deepEqual(valid.processedFindingIds, prepared.approvedFindingIdsForFile);
assert.equal(parse(response('\uFEFF  ' + JSON.stringify(patch) + '\n')).patchedCode, patch.patchedCode);
assert.throws(() => parse({ stop_reason: 'refusal', content: [] }), /WF2_LLM_REFUSAL/);
assert.throws(() => parse({ stop_reason: 'end_turn', content: [] }), /CLAUDE_EMPTY_TEXT_RESPONSE/);
assert.doesNotMatch(node('Parse - Code Patch Output').parameters.jsCode, /parseFirstBalancedJson/);
assert.throws(() => parse(response('{"internal":["TEST_SECRET_SENTINEL"],')),
  error => !error.message.includes('TEST_SECRET_SENTINEL') && error.message.startsWith('PATCH_RESPONSE_INVALID_JSON'));

// Real request constructor: one authorized full file, unchanged plan and JSON schema.
const plan = { findingId: 'finding-a', target: { file: targetFile, line: 1 }, filesToModify: [targetFile], filesToCreate: [], requiredRelationshipApis: [], relationshipOperations: [] };
const gate = { batchId: 'b', targetBranchName: 'fix/example' };
const planned = { target_file_path: targetFile, fileOperation: 'MODIFY', remediationPlans: [plan], plannedFiles: [targetFile] };
const makeRequest = new Function('$json', '$', 'Buffer', node('Prepare - Code Patch Body').parameters.jsCode);
const input = { path: targetFile, content: Buffer.from('class TaskService {}').toString('base64') };
const out = makeRequest(input, name => name === 'Prepare Batch Context'
  ? { first: () => ({ json: gate }) } : name === 'Prepare Generic Remediation Plan'
    ? {first:()=>({json:{remediationContract:{sourceSnapshots:[],sourceGrounding:{initialPaths:[],groundedRelationshipApis:[]}}}})}
    : { all: () => [{ json: planned }] }, Buffer).json;
assert.equal(out.llmRequestBody.model, 'claude-opus-5');
assert.equal(out.llmRequestBody.max_tokens, 32768);
assert.deepEqual(out.llmRequestBody.thinking, { type: 'adaptive' });
assert.equal(out.llmRequestBody.output_config.effort, 'medium');
assert.ok(out.llmRequestBody.max_tokens < 128000, 'bounded below documented Sonnet 5 output maximum');
assert.equal(JSON.parse(out.claudeBodyString).max_tokens, 32768);
assert.equal(out.completePlan.file.path, targetFile);
assert.deepEqual(out.completePlan.plans, [plan]);
assert.match(out.llmRequestBody.system, /COMPLETE patched file/);
assert.match(out.llmRequestBody.system, /one concise sentence/);
assert.deepEqual(out.llmRequestBody.output_config.format.schema.required, Object.keys(patch));
assert.equal(node('de Patch - HTTP Request').retryOnFail, true);
assert.equal(node('de Patch - HTTP Request').maxTries, 3);
// New deterministic failure is retained by the existing canonical failure funnel.
const envelope = new Function('$input', '$items', '$execution', node('Failure Envelope - Parse - Code Patch Output').parameters.jsCode)(
  { first: () => ({ json: { error: { message: 'PATCH_LLM_RESPONSE_TRUNCATED:Patch generation response was truncated because the model reached its output token limit.' } } }) },
  () => [{ json: { correlationEnvelope: { incidentId: 'i', requestId: 'r', batchId: 'b', batchKey: 'b', attemptCount: 4, workflowId: wf.id } } }],
  { id: 'offline' })[0].json;
assert.equal(envelope.failureCode, 'PATCH_LLM_RESPONSE_TRUNCATED');
assert.match(envelope.failureSummary, /output token limit/);
console.log('WF2 patch truncation, strict complete JSON/schema, target/finding guards, bounded budget and failure funnel: PASS');
