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

console.log('WF1 source commit SHA threading: PASS');
