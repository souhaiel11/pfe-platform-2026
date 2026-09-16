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
let code = prepare.parameters.jsCode;
code = code.replace(
  /\/\/ Sonnet 5 supports 128k output tokens\.[\s\S]*?const llmRequestBody=\{model:'claude-sonnet-5',max_tokens:16384,output_config:\{format:/,
  `// Opus 5 supports 128k total output tokens (thinking plus response text).\n// Execution 2006 used 12,636 thinking tokens inside a 16,384-token cap, leaving only\n// about 3,748 tokens for the required whole-file JSON response. Use a 32k hard cap and\n// medium adaptive effort: at the observed thinking usage this leaves 20,132 visible tokens.\nconst llmRequestBody={model:'claude-opus-5',max_tokens:32768,thinking:{type:'adaptive'},output_config:{effort:'medium',format:`
);
assert.match(code, /max_tokens:32768/);
assert.match(code, /thinking:\{type:'adaptive'\}/);
assert.match(code, /output_config:\{effort:'medium',format:/);
assert.doesNotMatch(code, /max_tokens:16384/);
prepare.parameters.jsCode = code;

assert.equal(workflow.nodes.length, 155);
fs.writeFileSync(workflowPath, `${JSON.stringify(document, null, 2)}\n`);
console.log('WF2 patch generation budget: 32768 total, adaptive thinking, medium effort; node count 155');
