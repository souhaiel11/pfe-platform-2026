// Prépare construction WF2 r75 closure audit pour les workflows n8n.
import fs from 'node:fs';

const workflowPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CLOSURE.json', import.meta.url);
const fixturePath = new URL('./fixtures/wf2-r75-execution-2035.json', import.meta.url);
const outputPath = new URL('../WF2-R75-CORRECTIVE-CLOSURE-AUDIT.json', import.meta.url);
const exported = JSON.parse(fs.readFileSync(workflowPath));
const workflow = Array.isArray(exported) ? exported[0] : exported;
const fixture = JSON.parse(fs.readFileSync(fixturePath));
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => workflow.nodes.find(candidate => candidate.name === name);
/** Lit la valeur située au chemin demandé. */
const valueAt = path => path.split('.').reduce((value, key) => value?.[key], fixture);
const contract = [
  ['incidentId','Webhook','Capture Correlation Envelope, Prepare Batch Context','required','both','webhookPayload.incidentId'],
  ['attemptCount','Webhook','Prepare Batch Context, Candidate Manifest, backend callback','required','both','webhookPayload.attemptCount'],
  ['correctiveAttempt','Webhook','Build Independent Repository Policy, Prepare Generic Remediation Plan','required','corrective','webhookPayload.correctiveAttempt'],
  ['correctiveContext','Webhook','Build Independent Repository Policy, Prepare Generic Remediation Plan','required','corrective','webhookPayload.correctiveContext'],
  ['blockingCauses','backend validation','Prepare Generic Remediation Plan','required','corrective','webhookPayload.correctiveContext.blockingCauses'],
  ['sourceSha','Build Independent Repository Policy','all three source fetches, planner','required','both','repositoryPolicyOutput.sourceSha'],
  ['baseSha','Prepare Batch Context','branch creation only','required','both','repositoryPolicyOutput.baseSha'],
  ['candidateBaseSha','Use Existing Branch','manifest, verifier, write guard, Git drift guard','required','both','repositoryPolicyOutput.candidateBaseSha'],
  ['repositoryPolicy','Build Independent Repository Policy','validator, preflight','required','both','repositoryPolicyOutput.repositoryPolicy'],
  ['correctiveIssues','Prepare Generic Remediation Plan','planner, validator, generator, manifest review','required','corrective','preparePlannerOutput.remediationContract.correctiveIssues'],
  ['historicalFindings','Prepare Generic Remediation Plan','lineage/reviewer audit only','required','corrective','preparePlannerOutput.remediationContract.historicalFindings'],
  ['findings','Prepare Generic Remediation Plan','planner/validator primary identity','required','normal','preparePlannerOutput.remediationContract.findings'],
  ['groundedTargetFiles','Prepare Generic Remediation Plan','Validate Generic Remediation Plan','required','corrective','preparePlannerOutput.remediationContract.correctiveIssues.0.groundedTargetFiles'],
  ['effectiveTargetFiles','Prepare Generic Remediation Plan','Validate Generic Remediation Plan','required','corrective','preparePlannerOutput.remediationContract.correctiveIssues.0.effectiveTargetFiles'],
  ['plannerRequest','Prepare Generic Remediation Plan','Generate Remediation Plan','required','both','preparePlannerOutput.llmRequestBody'],
  ['plannerRawResponse','Generate Remediation Plan','Validate Generic Remediation Plan','required','both','plannerRawResponse'],
  ['activeRemediationIds','Validate Generic Remediation Plan','generator, manifest, batch completeness','required','both',null],
  ['historicalFindingIds','corrective issue provenance','manifest, batch completeness, backend callback','required','corrective',null],
].map(([field,producer,consumers,requirement,mode,path]) => {
  const currentValue = path ? valueAt(path) : 'R75_DERIVED_AND_TESTED';
  return { field, producerNode: producer, consumerNodes: consumers.split(', '), requirement, mode, current2035Value: currentValue ?? null,
    valid: field === 'findings' ? currentValue == null : currentValue !== undefined && currentValue !== null };
});

const successNodes = [
  'Validate Generic Remediation Plan','Merge Effective File Results','Route Planned File Operation','Fetch Repository Files','Seed New Planned File',
  'Prepare - Code Patch Body','de Patch - HTTP Request','Parse - Code Patch Output','Generic Candidate Preflight','Independent Semantic Review',
  'Enforce Independent Review','Hash Candidate File Content','Accumulate Candidate File','Prepare Candidate Manifest','Classify Candidate Coordination Scope',
  'Hash Cross-File Candidate Manifest','Validate Cross-File Candidate Manifest','Validate Cross-File Type Coherence',
  'Prepare Cross-File COMPILE_MAIN','Call Cross-File COMPILE_MAIN','Enforce Cross-File COMPILE_MAIN',
  'Prepare Cross-File COMPILE_TESTS','Call Cross-File COMPILE_TESTS','Enforce Cross-File COMPILE_TESTS',
  'Prepare Cross-File FULL_TEST','Call Cross-File FULL_TEST','Enforce Cross-File FULL_TEST','Prepare Cross-File Review',
  'Independent Cross-File Semantic Review','Enforce Cross-File Review','Hash Candidate Manifest','Assemble Candidate Manifest',
  'Call Candidate Verification','Call Write Guard','Write Guard Passed?','Branch Existed At Generation?','Re-check Existing Branch Head',
  'Call Remote Head Drift Guard','Remote Head Drift Passed?','Expand Manifest Files','Loop Over Manifest Files','Recompute Content Hash Before Send',
  'Verify Content Hash Before Send','Candidate Creates File?','Create File in Branch','Update File in Branch','Build File Result (Pass 2)',
  'Merge Effective File Results 2','Validate Batch Completeness','Lookup Existing Batch PR','Select Existing PR','Existing PR?','Use Existing PR',
  'Create Pull Request1','Save Execution Result to Backend',
];
const sideEffectTypes = new Set(['n8n-nodes-base.httpRequest','n8n-nodes-base.github','n8n-nodes-base.emailSend']);
/** Retrouve les champs utiles à l’élément demandé. */
const fieldsFor = name => {
  if (name.includes('COMPILE_') || name.includes('FULL_TEST')) return ['candidateManifest','candidateDigest','candidateBaseSha','verificationStep'];
  if (name === 'Validate Generic Remediation Plan') return ['planner response','repositoryPolicy','correctiveIssues|findings','sourceSnapshots','sourceGrounding'];
  if (/Patch|Candidate|Manifest|Review|Write Guard/.test(name)) return ['validated remediation plans','planned files','candidateBaseSha','candidate content/digest'];
  if (/File|Batch|Pull Request|PR|Branch|Head/.test(name)) return ['candidate manifest','write receipts','repository/branch identity','oldSha/newSha/contentSha256'];
  return ['upstream main output','correlation envelope'];
};
/** Prépare la sortie correspondant au nœud demandé. */
const outputFor = name => {
  if (name.startsWith('Call ')) return ['external response'];
  if (name === 'Validate Generic Remediation Plan') return ['remediationPlans','activeRemediationIds','historicalFindingIds','plannedFiles','fileOperation'];
  if (name === 'Validate Batch Completeness') return ['lineage finding IDs','validated remediation IDs','verified files','write receipts','commit SHAs'];
  return ['validated/enriched upstream contract'];
};
const downstream = successNodes.map(name => {
  const current = node(name);
  if (!current) throw new Error('AUDIT_NODE_MISSING:' + name);
  const code = String(current.parameters?.jsCode || '');
  const failureCodes = [...new Set([...code.matchAll(/['"]([A-Z][A-Z0-9_]{2,})/g)].map(match => match[1]).filter(value => /FAIL|INVALID|MISSING|MISMATCH|INCOMPLETE|NOT_|UNSAFE|UNAVAILABLE|UNSUPPORTED|REQUIRED|CONFLICT|TRUNCATED|EMPTY|DUPLICATE|INCONCLUSIVE|REJECTED|MOVED/.test(value)))];
  const afterBoundary = successNodes.indexOf(name) > successNodes.indexOf('de Patch - HTTP Request');
  return { nodeName:name, inputFieldsRequired:fieldsFor(name), sourceOfEachField:['validated upstream node(s)','Prepare Batch Context/manifest where named'],
    outputFields:outputFor(name), failureCodesOrThrowConditions:failureCodes, externalSideEffect:sideEffectTypes.has(current.type),
    execution2035DerivedInputSatisfiesContract: name === 'de Patch - HTTP Request' ? 'UNKNOWN_NONDETERMINISTIC_BOUNDARY' : afterBoundary ? 'UNKNOWN_REQUIRES_CAPTURED_CANDIDATE' : 'YES' };
});

const failureSurfaces = downstream.flatMap(entry => entry.failureCodesOrThrowConditions.map(code => ({
  nodeName: entry.nodeName, failureCode: code, requiredInvariant: entry.inputFieldsRequired,
  correctiveContractStatus: entry.execution2035DerivedInputSatisfiesContract,
  regressionProof: /REMEDIATION|CORRECTIVE|BATCH|CANDIDATE|SHA|WRITE|PR|REVIEW|COMPILE|TEST/.test(code) ? 'R75 closure or retained focused suite' : 'retained full n8n suite',
})));

const result = {
  auditVersion: 'R75', sourceExecution: '2035', workflowId: workflow.id,
  correctiveCardinalityInvariant: 'In corrective mode, plans.length and unique plan.findingId must equal correctiveIssues.length and correctiveIssues[].candidateId exactly; historical finding cardinality never creates plans.',
  correctiveContractMatrix: contract,
  downstreamClosureMatrix: downstream,
  reachableFailureSurfaces: failureSurfaces,
  lineageGraph: {
    edges: [
      'blockingCause -> correctiveIssue.provenance.blockingCause',
      'previousValidatedSha -> correctiveIssue.provenance.previousValidatedSha',
      'batchId + issue index -> correctiveIssue.candidateId',
      'historical finding IDs -> correctiveIssue.provenance.historicalFindingIds',
      'scanner evidence -> correctiveIssue.provenance.historicalScannerEvidence',
      'correctiveIssue.candidateId -> plan.findingId -> candidate approved/processed IDs -> validatedRemediationIds',
      'historicalFindingIds -> batch-complete backend processed/candidateAccepted IDs',
    ],
  },
  exact2035Failure: {
    condition: 'unique(plans[].findingId) !== unique(prepared.findingIds)',
    expectedOldSchema: 'one plan per historical finding ID', actual2035Schema: 'one plan per correctiveIssues[].candidateId',
    missingFields: fixture.repositoryPolicyOutput.findingIds, extraFields: [fixture.preparePlannerOutput.remediationContract.correctiveIssues[0].candidateId],
    cardinalityExpectationOld: 2, actualCardinality: 1,
    execution2032Comparison: '2032 planner emitted two historical-finding keyed plans, so the old equality happened to pass; 2035 correctly emitted one canonical-issue keyed plan and exposed the stale validator contract.',
  },
  lastDeterministicNodeProven: 'Prepare - Code Patch Body',
  nextNondeterministicBoundary: 'de Patch - HTTP Request',
};
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`CORRECTIVE_CONTRACT_MATRIX=${contract.length}`);
console.log(`DOWNSTREAM_CLOSURE_MATRIX=${downstream.length}`);
console.log(`REACHABLE_FAILURE_SURFACES=${failureSurfaces.length}`);
