// Offline contract tests for WF1's remediationType classification policy.
//
// Root cause (incident 754328c4-4351-4f44-985b-34b9a031dfb2, fixRequest
// 88d58fc8-6056-43a5-a3de-28c1e1a9575c): java:S3305 was classified
// AUTO_FIX_ELIGIBLE by severity alone, but WF2's own planner independently
// and correctly scored it disposition=MANUAL_OR_SPECIALIST (confidence 0.4)
// -- fixing it means changing a Spring bean-wiring method signature, a
// structural risk the coarse severity-only classifier cannot see. This adds
// an explicit rule denylist that overrides severity for known-unsafe rules,
// reusing the existing DEVELOPER_ACTION_REQUIRED value (no new enum).
//
// No n8n execution, network or business action.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json', import.meta.url)))[0];
const mergeNode = wf.nodes.find(n => n.name === 'Merge All Fetched Data');
const code = mergeNode.parameters.jsCode;

// ── Static contract: the rule denylist exists and overrides severity ───────
assert.match(code, /UNSAFE_AUTO_FIX_RULES\s*=\s*new Set\(\[[^\]]*'java:S3305'[^\]]*\]\)/,
  'java:S3305 must be present in an explicit rule denylist');
assert.match(code, /ruleExcluded/, 'classification must consult the rule denylist, not severity alone');

// ── Harness: execute the real node code with a mocked $(nodeName) ──────────
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function dollar(overrides) {
  return (nodeName) => ({
    first: () => {
      if (!(nodeName in overrides)) throw new Error(`unmocked node reference: ${nodeName}`);
      return { json: overrides[nodeName] };
    },
  });
}
const baseFixture = () => ({
  'Extract Project Config': { projectConfig: { sonarqubeKey: 'test-project' }, jenkins: {}, reports: {}, build_number: 1 },
  'Incident Webhook': { body: {} },
  'Prepare Fetch URLs': { incidentUUID: 'incident-test-uuid' },
  'Resolve Exact Sonar Correlation': { qualityGate: 'OK', ceTaskId: 'ce-task-test', analysisId: 'analysis-test', correlationVerified: true },
});
async function runMerge(sonarConsolidated) {
  const fn = new AsyncFunction('$', code);
  const overrides = { ...baseFixture(), 'Consolidate Baseline Sonar Snapshot': sonarConsolidated };
  const sonar = (await fn(dollar(overrides)))[0].json.enrichedData.sonar;
  return sonar.issues;
}
const sonarIssue = (key, rule, severity, type, component = 'proj:src/main/java/com/pfe/devsecops/config/SecurityConfig.java', line = 28) =>
  ({ key, rule, severity, type, component, line, message: `${rule} finding` });
const consolidated = (issues) => ({ issues, total: issues.length, collectedCount: issues.length, pageSize: 500, complete: true, snapshotError: null });

// ── A. java:S3305 is NOT AUTO_FIX_ELIGIBLE ──────────────────────────────────
{
  const issues = await runMerge(consolidated([sonarIssue('k1', 'java:S3305', 'CRITICAL', 'CODE_SMELL')]));
  assert.equal(issues[0].remediationType, 'DEVELOPER_ACTION_REQUIRED', 'java:S3305 must never be AUTO_FIX_ELIGIBLE');
}

// ── B. previous safe rule java:S125 remains AUTO_FIX_ELIGIBLE ──────────────
{
  const issues = await runMerge(consolidated([sonarIssue('k2', 'java:S125', 'MAJOR', 'CODE_SMELL', 'proj:src/main/java/com/pfe/devsecops/controller/TaskController.java', 29)]));
  assert.equal(issues[0].remediationType, 'AUTO_FIX_ELIGIBLE', 'java:S125 must remain auto-fix eligible (unaffected by the S3305 denylist)');
}

// ── C. severity alone does not override explicit unsafe-rule policy ────────
{
  // Same shape that would previously have qualified purely on severity+type+source.
  const issuesCritical = await runMerge(consolidated([sonarIssue('k3', 'java:S3305', 'CRITICAL', 'CODE_SMELL')]));
  const issuesBlocker = await runMerge(consolidated([sonarIssue('k4', 'java:S3305', 'BLOCKER', 'VULNERABILITY')]));
  assert.equal(issuesCritical[0].remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(issuesBlocker[0].remediationType, 'DEVELOPER_ACTION_REQUIRED', 'no severity value may override the rule denylist');
}

// ── D. existing UI/backend classification contract remains valid ───────────
{
  // A generic, non-denylisted CRITICAL/MAJOR SonarQube finding must still be
  // eligible exactly as before -- the fix must not broaden or narrow the
  // existing severity-based contract for any other rule.
  const issues = await runMerge(consolidated([
    sonarIssue('k5', 'java:S4684', 'CRITICAL', 'VULNERABILITY', 'proj:src/main/java/com/pfe/devsecops/controller/TaskController.java', 34),
    sonarIssue('k6', 'java:S1234', 'MINOR', 'CODE_SMELL'),
  ]));
  assert.equal(issues[0].remediationType, 'AUTO_FIX_ELIGIBLE', 'unrelated CRITICAL/MAJOR findings remain eligible');
  assert.equal(issues[1].remediationType, 'DEVELOPER_ACTION_REQUIRED', 'MINOR severity remains ineligible exactly as before, independent of the denylist');
}

console.log('WF1 remediationType policy (java:S3305 rule denylist overrides severity), cases A-D: PASS');
