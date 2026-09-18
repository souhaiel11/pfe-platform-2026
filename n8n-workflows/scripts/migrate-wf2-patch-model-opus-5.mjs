import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url);
const document = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const workflow = document[0];
const node = name => {
  const found = workflow.nodes.find(item => item.name === name);
  assert.ok(found, `missing node: ${name}`);
  return found;
};

const prepare = node('Prepare - Code Patch Body');
const originalSchema = prepare.parameters.jsCode.match(/output_config:\{effort:'medium',format:(\{.*?\})\},system:/)?.[1];
assert.ok(originalSchema, 'patch JSON schema not found');
prepare.parameters.jsCode = prepare.parameters.jsCode.replace("model:'claude-sonnet-5'", "model:'claude-opus-5'");
assert.match(prepare.parameters.jsCode, /model:'claude-opus-5',max_tokens:32768,thinking:\{type:'adaptive'\},output_config:\{effort:'medium'/);
assert.equal(prepare.parameters.jsCode.match(/output_config:\{effort:'medium',format:(\{.*?\})\},system:/)?.[1], originalSchema);

const parser = node('Parse - Code Patch Output');
parser.parameters.jsCode = parser.parameters.jsCode.replace("response?.model||'claude-sonnet-5'", "response?.model||'claude-opus-5'");
assert.match(parser.parameters.jsCode, /PATCH_LLM_RESPONSE_TRUNCATED/);

assert.match(node('Prepare Generic Remediation Plan').parameters.jsCode, /model:'claude-sonnet-5'/);
assert.match(node('Generic Candidate Preflight').parameters.jsCode, /model:'claude-haiku-4-5-20251001'/);
assert.equal(workflow.nodes.length, 186);
fs.writeFileSync(workflowPath, `${JSON.stringify(document, null, 2)}\n`);
console.log('WF2 patch generation model migrated to claude-opus-5; other LLM calls unchanged');
