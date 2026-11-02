// Prépare extract WF2 r75 exécution donnée de test pour les workflows n8n.
import fs from 'node:fs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('usage: extract-wf2-r75-execution-fixture.mjs <execution.json> <fixture.json>');
const execution = JSON.parse(fs.readFileSync(inputPath));
if (String(execution.id) !== '2035') throw new Error('R75_EXPECTED_EXECUTION_2035');
const runData = execution.data?.resultData?.runData || {};
/** Renvoie le premier élément disponible. */
const first = name => runData[name]?.[0]?.data?.main?.[0]?.[0]?.json;
const fixture = {
  provenance: {
    executionId: String(execution.id),
    workflowId: execution.workflowId,
    workflowVersionId: execution.workflowVersionId,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
  },
  webhookPayload: first('Webhook'),
  adaptedPayload: first('Adapt Webhook Payload'),
  repositoryPolicyOutput: first('Build Independent Repository Policy'),
  repositoryTree: first('Fetch Repository Tree'),
  branchLookup: first('Lookup Remediation Branch'),
  preparePlannerOutput: first('Prepare Generic Remediation Plan'),
  plannerRawResponse: first('Generate Remediation Plan'),
  validatorInput: first('Generate Remediation Plan'),
  validatorFailure: runData['Validate Generic Remediation Plan']?.[0]?.data?.main?.[1]?.[0]?.json || null,
  plannerSourceItems: (runData['Validate Required Dependency Sources']?.[0]?.data?.main?.[0] || []).map(item => item.json),
  sourceFetches: Object.fromEntries([
    'Fetch Finding Source Context',
    'Fetch Referenced API Sources',
    'Fetch Required Dependency Sources',
  ].map(name => [name, (runData[name]?.[0]?.data?.main?.[0] || []).map(item => item.json)])),
};
fs.writeFileSync(outputPath, JSON.stringify(fixture, null, 2));
console.log(`Extracted immutable execution ${execution.id} fixture to ${outputPath}`);
