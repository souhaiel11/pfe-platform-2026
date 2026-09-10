// BRIQUE 3 CLOSEOUT — proves the "Prepare Final Report" node in the
// repo-tracked WF1 export (n8n-workflows/active/wf1-incident-intake-
// analysis-v5-1-vNOQiEgnXg9Zqn2q.json) threads the source commit SHA
// already computed by "Normalize Incident Payload" (commitSha: body.after
// || head_commit.id || body.commit || body.revision.sha) into
// rawData.sourceCommitSha -- which becomes incident.metadata.sourceCommitSha
// once "Save Final Decision to Backend" PUTs { metadata: rawData }. Before
// this change the field was computed and then silently discarded: never
// forwarded past "Extract Project Config". This is a REPO-ONLY change:
// nothing here imports/publishes to the live n8n instance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(here, '..', 'active', 'wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json');
const workflow = JSON.parse(readFileSync(wfPath, 'utf8'))[0];
const node = workflow.nodes.find(n => n.name === 'Prepare Final Report');
assert.ok(node, 'Prepare Final Report node must exist in the repo-tracked WF1 export');
const code = node.parameters.jsCode;

function run(mockData) {
  const mock = name => ({ first: () => ({ json: mockData[name] }) });
  const fn = new Function('$', code);
  return fn(mock)[0].json;
}

const baseMocks = {
  'Judge - Parse Output': { decision: 'FIX_PROPOSED', securityLevel: 'LOW' },
  'Extract Project Config': { projectId: 'proj-1', commitSha: 'a'.repeat(40) },
  'Merge All Fetched Data': { enrichedData: { build: { number: 1, job: 'job', status: 'SUCCESS' } } },
  'Prepare - Judge Body': { judgeInput: JSON.stringify({ securityScore: 80, riskLevel: 'low' }) },
  'Parse - Dev Guide Output': { issues: [], summaryForDeveloper: '', quickWins: [], fixOrder: [], totalEstimatedMinutes: 0, confidence: 0 },
  'Prepare Fetch URLs': { incidentUUID: 'incident-1' },
  'Parse - Root Cause Output': {},
  'Parse - Security Output': {},
  'Parse - Remediation Output': {},
};

// Case 1: a normal Jenkins/GitHub-shaped event carried a resolvable commit
// SHA all the way through "Normalize Incident Payload" -> "Extract Project
// Config" -> here.
{
  const out = run(baseMocks);
  assert.equal(
    out.rawData.sourceCommitSha, baseMocks['Extract Project Config'].commitSha,
    'sourceCommitSha is threaded from Extract Project Config.commitSha into rawData (-> incident.metadata.sourceCommitSha on the PUT)',
  );
}

// Case 2: no commit SHA anywhere in the incoming event -- must stay null,
// never fabricated (e.g. never falling back to a build number or branch name).
{
  const out = run({ ...baseMocks, 'Extract Project Config': { projectId: 'proj-1' } });
  assert.equal(out.rawData.sourceCommitSha, null, 'absent commitSha is never fabricated -- stays null');
}

// Execute the actual input boundary, config propagation, report and backend
// body expression. No workflow engine, network or backend call is involved.
const byName = name => workflow.nodes.find(n => n.name === name);
const normalize = new Function('$input', byName('Normalize Incident Payload').parameters.jsCode);
const extract = new Function('$', '$input', byName('Extract Project Config').parameters.jsCode);
const expression = value => new Function('$json', '$', `return (${value.slice(3, -2)});`);
const route = expression(byName('Is PR Validation').parameters.conditions.conditions[0].leftValue);
const persist = expression(byName('Save Final Decision to Backend').parameters.jsonBody);
const shaA = 'a'.repeat(40), shaB = 'b'.repeat(40);
for (const [label, input, expected] of [
  ['root explicit', { commitSha: shaA }, shaA],
  ['body explicit', { body: { commitSha: shaA } }, shaA],
  ['root explicit with body envelope', { commitSha: shaA, body: { commit: shaB } }, shaA],
  ['body precedence over root and legacy', { commitSha: shaB, body: { commitSha: shaA, commit: shaB, after: shaB } }, shaA],
  ['root precedence over legacy', { commitSha: shaA, commit: shaB, after: shaB }, shaA],
  ['legacy commit', { commit: shaA }, shaA],
  ['legacy after', { body: { after: shaA } }, shaA],
  ['legacy head_commit', { head_commit: { id: shaA } }, shaA],
  ['legacy revision', { body: { revision: { sha: shaA } } }, shaA],
  ['empty explicit falls back', { body: { commitSha: '', commit: shaA } }, shaA],
  ['null explicit falls back', { commitSha: null, after: shaA }, shaA],
  ['missing', {}, null],
  ['all empty', { commitSha: '', body: { commitSha: null, after: '' } }, null],
  ['preserve non-empty malformed value for backend rejection', { commitSha: 'not-a-sha', commit: shaB }, 'not-a-sha'],
]) {
  const normalized = normalize({ all: () => [{ json: input }] })[0].json;
  assert.equal(normalized.commitSha, expected, label);
  const config = extract(name => ({
    first: () => ({ json: normalized }),
    all: () => [{ json: { id: 'proj-1' } }],
  }), { first: () => ({ json: normalized }) })[0].json;
  const report = run({ ...baseMocks, 'Extract Project Config': config });
  assert.equal(report.rawData.sourceCommitSha, expected, label);
  const body = JSON.parse(persist({}, () => ({ first: () => ({ json: report }) })));
  assert.equal(body.metadata.sourceCommitSha, expected, `${label}: backend metadata`);
}
assert.equal(route({ body: { event: 'pr_validation' }, event: 'pipeline_failed' }), 'pr_validation');
assert.equal(route({ body: {}, event: 'pipeline_failed' }), 'pipeline_failed');
assert.equal(route({ body: { event: null }, event: 'pr_validation' }), 'pr_validation');
assert.equal(route({ body: { event: '' }, event: 'pr_validation' }), '', 'nullish fallback preserves an explicit empty event');
assert.equal(route({}), undefined, 'never invent an event');
assert.equal(byName('Incident Webhook').parameters.path, 'jenkins-event');
assert.equal(workflow.nodes.length, 49);
assert.equal(workflow.connections['Is PR Validation'].main[0][0].node, 'Validate PR Validation Contract');
assert.equal(workflow.connections['Is PR Validation'].main[1][0].node, 'Switch3');
assert.ok(!workflow.nodes.some(n => /findingResults\s*[:=]/.test(n.parameters.jsCode || '')));

console.log('WF1 explicit/root/body SHA, precedence, legacy aliases, event routing and end-to-end persistence: PASS');
