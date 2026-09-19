import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R72-PLANNER-OUTPUT-BUDGET.json', import.meta.url);
const priorArtifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R71-CORRECTIVE-SOURCE-AUTHORITY.json', import.meta.url);
const wf = JSON.parse(readFileSync(artifact))[0];
const prior = JSON.parse(readFileSync(priorArtifact))[0];
const node = name => wf.nodes.find(candidate => candidate.name === name);
const priorNode = name => prior.nodes.find(candidate => candidate.name === name);

function run(name, jsonInput, refs = {}) {
  const $ = key => {
    assert.ok(refs[key], `unexpected reference ${key}`);
    return { first: () => ({ json: refs[key][0] }), all: () => refs[key].map(json => ({ json })) };
  };
  return new Function('$input', '$json', '$', 'Buffer', node(name).parameters.jsCode)(
    { first: () => ({ json: jsonInput }), all: () => [{ json: jsonInput }] }, jsonInput, $, Buffer,
  );
}

// 1-3. Execution 2031 (attempt 7): claude-sonnet-5 stop_reason=max_tokens,
// output_tokens=8192 entirely thinking_tokens=8191, zero text blocks. The
// supported fix, already proven for the opus-5 patch call, is to raise the
// hard cap and bound thinking below it.
{
  const ctx = {
    findings: [{ findingId: 'f1', source: 'SONARQUBE', rule: 'java:S1', file: 'a.java', line: 1 }],
    batchId: 'r72-budget', repository_owner: 'o', repository_name: 'r', default_branch: 'main',
    correctiveAttempt: false, correctiveContext: null,
    sourceSha: 'dc1aa978719ca40e6339e075cfe52a79875b2342',
    candidateBaseSha: 'dc1aa978719ca40e6339e075cfe52a79875b2342',
    originalBaselineSha: '6ed56ff791acbf3e111431285bef7b30c8076084',
    baseSha: '6ed56ff791acbf3e111431285bef7b30c8076084',
  };
  const sourceItem = {
    path: 'a.java', sha: 'blob1', content: Buffer.from('class A {}').toString('base64'),
    sourceGrounding: { initialPaths: [], groundedRelationshipApis: [] },
  };
  const [out] = run('Prepare Generic Remediation Plan', sourceItem, { 'Build Independent Repository Policy': [ctx] });
  const request = out.json.llmRequestBody;
  assert.equal(request.model, 'claude-sonnet-5');
  assert.equal(request.max_tokens, 16384);
  assert.deepEqual(request.thinking, { type: 'adaptive' });
  assert.equal(request.output_config.effort, 'medium');
  assert.ok(request.max_tokens > 8192, 'max_tokens must exceed the exhausted 8192 cap observed in execution 2031');
  console.log('R72_PLANNER_OUTPUT_BUDGET_RAISED: PASS');
}

// 4. CLAUDE_EMPTY_TEXT_RESPONSE remains fail-closed and unweakened: replay
// the exact execution-2031 response shape (thinking-only, zero text blocks).
{
  const prepared = { repositoryPolicy: {}, findingIds: ['f1'] };
  const thinkingOnlyResponse = {
    model: 'claude-sonnet-5', stop_reason: 'max_tokens',
    content: [{ type: 'thinking', thinking: '' }],
    usage: { output_tokens: 8192, output_tokens_details: { thinking_tokens: 8191 } },
  };
  assert.throws(
    () => run('Validate Generic Remediation Plan', thinkingOnlyResponse, { 'Prepare Generic Remediation Plan': [prepared] }),
    /CLAUDE_EMPTY_TEXT_RESPONSE/,
  );
  console.log('R72_EMPTY_TEXT_GUARD_UNCHANGED: PASS');
}

// 5. Offline config verification only: no real Anthropic call is made from
// this local harness, so model behavior at the new budget remains unproven
// until the next governed attempt runs execution against the live API.
console.log('R72_OFFLINE_REPLAY: MODEL_CALL_COUNT=0 (config-only verification; real model behavior unproven until governed attempt)');

// 6-7. Syntax coverage and blast-radius: only this one node's code changed.
{
  const modifiedCodeNodes = wf.nodes.filter(candidate => {
    const before = priorNode(candidate.name);
    return candidate.type === 'n8n-nodes-base.code' && before && candidate.parameters?.jsCode !== before.parameters?.jsCode;
  });
  assert.deepEqual(modifiedCodeNodes.map(n => n.name), ['Prepare Generic Remediation Plan']);
  for (const candidate of modifiedCodeNodes) assert.doesNotThrow(() => new Function(candidate.parameters.jsCode), candidate.name);
  console.log('R72_SYNTAX_PASS = 1');
  console.log('R72_SYNTAX_FAIL = 0');
}

assert.equal(wf.nodes.length, 186);
assert.equal(wf.nodes.length, prior.nodes.length);
assert.equal(new Set(wf.nodes.map(n => n.id)).size, 186);
console.log('R72_NODE_COUNT_UNCHANGED: PASS');
console.log('wf2-r72-planner-output-budget: PASS');
