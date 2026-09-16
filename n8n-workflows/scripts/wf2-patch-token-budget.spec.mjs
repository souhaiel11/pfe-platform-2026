import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = JSON.parse(fs.readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const node = name => workflow.nodes.find(item => item.name === name);
const prepare = node('Prepare - Code Patch Body');
const parser = node('Parse - Code Patch Output');
assert.ok(prepare && parser);

const targetFile = 'src/main/java/com/pfe/devsecops/service/TaskService.java';
const findingId = 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef';
const sourceFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/wf2-attempt-1999-atomic-review.json', import.meta.url)));
const baseline = sourceFixture.sources.find(source => source.file === targetFile)?.content;
assert.ok(baseline?.length >= 9000);
const plan = { findingId, target: { file: targetFile, line: 34 }, filesToModify: [targetFile], filesToCreate: [], requiredChanges: ['Use a DTO at the controller boundary.'] };
const planned = { target_file_path: targetFile, fileOperation: 'MODIFY', remediationPlans: [plan], plannedFiles: [targetFile], repositoryPolicy: {} };
const gate = { batchId: 'token-budget', targetBranchName: 'fix/token-budget' };
const sourceSnapshots = sourceFixture.sources.map(source => ({ file: source.file, content: source.content }));
const lookup = name => name === 'Prepare Batch Context'
  ? { first: () => ({ json: gate }) }
  : name === 'Prepare Generic Remediation Plan'
    ? { first: () => ({ json: { remediationContract: { sourceSnapshots, sourceGrounding: { initialPaths: [], groundedRelationshipApis: [] } } } }) }
    : { all: () => [{ json: planned }] };
const request = new Function('$json', '$', 'Buffer', prepare.parameters.jsCode)(
  { path: targetFile, content: Buffer.from(baseline).toString('base64'), sha: 'baseline-blob' }, lookup, Buffer).json;

// 1-3. Explicit supported controls and deterministic observed-workload headroom.
assert.equal(request.llmRequestBody.max_tokens, 32768);
assert.equal(request.llmRequestBody.model, 'claude-opus-5');
assert.deepEqual(request.llmRequestBody.thinking, { type: 'adaptive' });
assert.equal(request.llmRequestBody.output_config.effort, 'medium');
assert.equal(JSON.parse(request.claudeBodyString).max_tokens, 32768);
const observedThinkingTokens = 12636;
const observedVisibleHeadroom = request.llmRequestBody.max_tokens - observedThinkingTokens;
assert.equal(observedVisibleHeadroom, 20132);
assert.ok(observedVisibleHeadroom >= 8192, 'must reserve at least 8k visible tokens at observed thinking usage');

const parse = response => new Function('$json', '$', parser.parameters.jsCode)(response,
  name => { assert.equal(name, 'Prepare - Code Patch Body'); return { item: { json: request } }; }).json;
const response = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

// 4-5. Both provider and structural truncation remain fail-closed.
assert.throws(() => parse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }] }), /PATCH_LLM_RESPONSE_TRUNCATED/);
assert.throws(() => parse(response('{"targetFile":"unterminated')), /PATCH_RESPONSE_INVALID_JSON/);

// 6. A deterministic 305-line, >=11,520-character TaskService-style whole-file candidate passes.
let candidate = baseline;
let index = 0;
while (candidate.split(/\r?\n/).length < 305 || candidate.length < 11520) {
  candidate = candidate.replace(/\n}\s*$/, `\n    private static final String TOKEN_BUDGET_EVIDENCE_${index} = "complete-${index}";\n}`);
  index += 1;
}
const patch = { targetFile, processedFindingIds: [findingId], patchedCode: candidate,
  patchDescription: 'Preserve behavior while applying the authorized DTO boundary remediation.',
  conformanceEvidence: ['Complete TaskService candidate retained.'] };
const serialized = JSON.stringify(patch);
const parsed = parse(response(serialized));
assert.equal(parsed.patchedCode, candidate);
assert.ok(candidate.length >= 11520);
assert.ok(candidate.split(/\r?\n/).length >= 305);
assert.ok(serialized.length > candidate.length, 'JSON wrapper and escaping overhead must be represented');

// 7. HTTP retries feed the same strict parser; they never authorize partial content.
assert.equal(node('de Patch - HTTP Request').retryOnFail, true);
assert.equal(node('de Patch - HTTP Request').maxTries, 3);
assert.throws(() => parse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: serialized.slice(0, -200) }] }), /PATCH_LLM_RESPONSE_TRUNCATED/);
assert.equal(workflow.nodes.length, 155);
console.log(`wf2-patch-token-budget: PASS (${candidate.split(/\r?\n/).length} lines, ${candidate.length} chars, ${serialized.length - candidate.length} JSON/wrapper chars)`);
