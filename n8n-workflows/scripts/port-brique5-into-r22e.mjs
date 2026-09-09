#!/usr/bin/env node
// BRIQUE 5 FINAL CLOSEOUT — MISSION 2/3/4/5: ports the proven Brique 5
// causal same-PR convergence semantics INTO the hardened R22E two-pass
// candidate (the safety baseline), producing exactly one new,
// clearly-named, inactive, non-colliding LOCAL canonical artifact for
// later promotion. ALSO fixes a real, demonstrated failure-persistence
// defect discovered while auditing this exact artifact (Mission 5) --
// see Patch 4 below.
//
// This never touches n8n-workflows/active/*, never imports/publishes
// anything, and is a REPO-ONLY generator (mirrors the existing convention
// of harden-wf2-r22e-two-pass.mjs: read one artifact, write another).
//
// MISSION 5 FINDING (proven by reading the real jsCode + connections
// graph, not assumed): "Prepare WF2 Failure Status" itself is correctly
// designed -- it unwraps `input.correlationEnvelope` into a top-level
// `incidentId` that "Persist WF2 Failure Status" reads. BUT two nodes,
// "Persist Verification Failure" (fed by "Write Guard Passed?"=false) and
// "Persist Base Moved Failure" (fed by "Remote Head Drift Passed?"=false),
// connect DIRECTLY to "Persist WF2 Failure Status", bypassing "Prepare"
// entirely. Both output `correlationEnvelope` nested (not a top-level
// `incidentId`), so for exactly these two failure paths --
// CANDIDATE_VERIFICATION_* and CANDIDATE_BASE_MOVED, i.e. a Write Guard or
// Remote Head Drift Guard rejection -- `$json.incidentId` at the Persist
// HTTP node resolves to nothing, producing exactly the
// `POST /api/incidents//workflow-status` defect this closeout's Mission 5
// describes. This is a REAL, reproducible defect in this exact artifact
// (not "disproven" by the absence of the bug in the unrelated active/
// file's simpler failure path), proven by static analysis of the
// connections graph and the two nodes' own jsCode (n8n-workflows/scripts/
// wf2-canonical-final.spec.mjs Cases I2/I3 assert the pre-fix shape would
// fail, then assert the fix routes both through "Prepare" correctly).
//
// FIX (Patch 4, pure rewiring, zero logic change): route both nodes' output
// edge to "Prepare WF2 Failure Status" instead of directly to "Persist WF2
// Failure Status". "Prepare" already reads exactly the field names both
// nodes already produce (correlationEnvelope, failureCode, failedNode,
// failureSummary, executionId) -- so no node's own jsCode needs to change,
// and the primary failure information (failedNode/failureCode/
// failureSummary) survives unmodified, exactly as Mission 5 requires.
// Applies exactly three targeted, generic (no rule/project-specific
// branches) patches on top of the R22E-TWO-PASS-CANDIDATE.json source:
//
//  1. "Select Existing PR"      -> MISSION 2/Phase 5: EXPECTED_PR_NOT_OPEN
//                                  fail-closed when a corrective attempt
//                                  finds no matching OPEN PR (never a
//                                  replacement PR). Normal/initial behavior
//                                  (correctiveAttempt absent/false) is
//                                  byte-for-byte unchanged.
//  2. "Use Existing Branch"     -> MISSION 4: an explicit, corrective-only
//                                  freeze check -- the freshly-resolved
//                                  candidateBaseSha (the real branch HEAD at
//                                  generation time, already computed here in
//                                  R22E) must equal the backend-frozen
//                                  previousValidatedSha/blockedSha carried in
//                                  correctiveContext. This is the FIRST of
//                                  two independent checks (the second is the
//                                  existing, unmodified Remote Head Drift
//                                  Guard right before any write) -- neither
//                                  replaces the other. Initial mode
//                                  (correctiveAttempt absent/false) is
//                                  unaffected.
//  3. "Prepare Generic Remediation Plan" -> MISSION 3: when
//                                  correctiveAttempt===true, the LLM
//                                  request's structured `contract` gains an
//                                  additive `correctiveContext` block, and
//                                  the user-message instructions gain a
//                                  GENERIC corrective-mode addendum (the
//                                  exact 8 numbered rules). When
//                                  correctiveAttempt is absent/false, the
//                                  produced contract/llmRequestBody is
//                                  BYTE-IDENTICAL to before (the additive
//                                  spread contributes nothing, the addendum
//                                  string is empty) -- proven by
//                                  wf2-causal-prompt.spec.mjs Case A.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, '..', 'pending-live-update', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R22E-TWO-PASS-CANDIDATE.json');
const outputPath = path.join(here, '..', 'pending-live-update', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.CANONICAL-FINAL.json');

const data = JSON.parse(readFileSync(sourcePath, 'utf8'));
const workflow = Array.isArray(data) ? data[0] : data;
const byName = new Map(workflow.nodes.map(n => [n.name, n]));

function patchNode(name, matcher, replacer, label) {
  const node = byName.get(name);
  if (!node) throw new Error(`PORT_FAILED: node not found: ${name}`);
  const code = node.parameters.jsCode;
  if (typeof code !== 'string' || !matcher.test(code)) {
    throw new Error(`PORT_FAILED: expected pattern not found in "${name}" (${label}) -- source artifact may have drifted`);
  }
  node.parameters.jsCode = code.replace(matcher, replacer);
}

// --- Patch 1: Select Existing PR -----------------------------------------
patchNode(
  'Select Existing PR',
  /if\(matching\.length>1\)throw new Error\('DUPLICATE_BATCH_PR'\);return \[\{json:\{existingPr:matching\[0\]\|\|null,createRequired:matching\.length===0,candidateCount:candidates\.length,matchingCount:matching\.length\}\}\];/,
  "if(matching.length>1)throw new Error('DUPLICATE_BATCH_PR');const createRequired=matching.length===0;if(createRequired&&ctx.correctiveAttempt===true)throw new Error('EXPECTED_PR_NOT_OPEN');return [{json:{existingPr:matching[0]||null,createRequired,candidateCount:candidates.length,matchingCount:matching.length}}];",
  'Mission 2 same-PR guarantee',
);

// --- Patch 2: Use Existing Branch (corrective base-freeze check) --------
patchNode(
  'Use Existing Branch',
  /const candidateBaseSha=String\(response\.body\?\.object\?\.sha\|\|''\)\.toLowerCase\(\);if\(!\/\^\[a-f0-9\]\{40\}\$\/\.test\(candidateBaseSha\)\)throw new Error\('EXISTING_BRANCH_HEAD_SHA_UNAVAILABLE'\);return \[\{json:\{\.\.\.ctx,branchExists:true,candidateBaseSha\}\}\];/,
  "const candidateBaseSha=String(response.body?.object?.sha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(candidateBaseSha))throw new Error('EXISTING_BRANCH_HEAD_SHA_UNAVAILABLE');if(ctx.correctiveAttempt===true){const expectedBase=String(ctx.correctiveContext?.previousValidatedSha||ctx.correctiveContext?.blockedSha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(expectedBase))throw new Error('CORRECTIVE_BASE_SHA_MISSING');if(candidateBaseSha!==expectedBase)throw new Error('CORRECTIVE_BASE_SHA_MISMATCH');}return [{json:{...ctx,branchExists:true,candidateBaseSha}}];",
  'Mission 4 candidate-base freeze (first of two independent checks)',
);

// --- Patch 3: Prepare Generic Remediation Plan (causal prompt consumption) --
patchNode(
  'Prepare Generic Remediation Plan',
  /const contract=\{schemaVersion:'1\.0',batchId:ctx\.batchId,repository:\{owner:ctx\.repository_owner,name:ctx\.repository_name,defaultBranch:ctx\.default_branch,technology:ctx\.projectTechnology\|\|ctx\.technology\|\|ctx\.repositoryMetadata\|\|\{\}\},findings:findings\.map\(f=>\(\{findingId:String\(f\.findingId\|\|f\.id\|\|f\.key\),source:String\(f\.source\|\|'SONARQUBE'\),rule:String\(f\.rule\|\|f\.ruleKey\|\|''\),severity:String\(f\.severity\|\|''\),type:String\(f\.type\|\|''\),message:String\(f\.message\|\|''\),target:\{file:String\(f\.file\|\|f\.component\|\|''\),line:Number\(f\.line\)\|\|null\},scannerEvidence:f\.evidence\|\|f\.scannerEvidence\|\|f\}\)\),sourceSnapshots,forbiddenChanges:forbidden\};/,
  "const correctiveContext=ctx.correctiveAttempt===true&&ctx.correctiveContext?ctx.correctiveContext:null;\n"
  + "const contract={schemaVersion:'1.0',batchId:ctx.batchId,repository:{owner:ctx.repository_owner,name:ctx.repository_name,defaultBranch:ctx.default_branch,technology:ctx.projectTechnology||ctx.technology||ctx.repositoryMetadata||{}},findings:findings.map(f=>({findingId:String(f.findingId||f.id||f.key),source:String(f.source||'SONARQUBE'),rule:String(f.rule||f.ruleKey||''),severity:String(f.severity||''),type:String(f.type||''),message:String(f.message||''),target:{file:String(f.file||f.component||''),line:Number(f.line)||null},scannerEvidence:f.evidence||f.scannerEvidence||f})),sourceSnapshots,forbiddenChanges:forbidden,"
  // Additive only: absent entirely for initial mode (correctiveContext===null),
  // so the serialized contract is byte-identical to before in that case.
  + "...(correctiveContext?{correctiveContext:{previousAttempt:correctiveContext.previousAttempt,previousValidatedSha:correctiveContext.previousValidatedSha,candidateBaseSha:String(ctx.candidateBaseSha||''),originalBaselineSha:String(ctx.baselineSha||''),reasonCodes:correctiveContext.reasonCodes,blockingCauses:correctiveContext.blockingCauses,originalFindingResults:correctiveContext.originalFindingResults}}:{})};\n"
  // GENERIC corrective-mode instruction addendum -- the exact 8 rules from
  // Mission 3, no scanner-rule-specific or project-specific wording. Empty
  // string when not corrective, so the message content is unchanged.
  + "const correctiveInstruction=correctiveContext?' CORRECTIVE MODE: this is a corrective continuation of an ALREADY-OPEN Pull Request, not a fresh remediation. (1) Preserve every previously valid change in the existing branch exactly as-is. (2) Fix ONLY the proven blocker(s) described in contract.correctiveContext.blockingCauses -- nothing else. (3) Do NOT restart remediation from contract.correctiveContext.originalBaselineSha; that commit is historical context only. (4) Do NOT revert or modify any unrelated existing change already on the branch. (5) Do NOT invent a root cause, file, or line that is not already present in contract.correctiveContext.blockingCauses or contract.findings[].scannerEvidence. (6) If the available evidence is insufficient to fix a blocker with confidence, set that plan\\'s rootCause to \"CONTEXT_REQUIRED\" and its disposition to MANUAL_OR_SPECIALIST rather than guessing. (7) Every proposed change must be expressed against the CURRENT candidate base, contract.correctiveContext.candidateBaseSha -- never against originalBaselineSha.':'';\n",
  'Mission 3 causal prompt consumption',
);
patchNode(
  'Prepare Generic Remediation Plan',
  /messages:\[\{role:'user',content:'Create one plan per finding using this generic schema: \{findingId,source,rule,target:\{file,line\},rootCause,remediationIntent,filesToModify,filesToCreate,proposedPaths,requiredChanges,forbiddenChanges,expectedBehaviorPreserved,validationStrategy:\{compile,tests,scanner\},confidence\}\. Paths must be repository-relative and minimal\. Route high-risk\/infra\/admin\/Jenkins\/Docker work with disposition MANUAL_OR_SPECIALIST; otherwise disposition AUTO_CANDIDATE\. Input: '\+JSON\.stringify\(contract\)\}\]\};/,
  "messages:[{role:'user',content:'Create one plan per finding using this generic schema: {findingId,source,rule,target:{file,line},rootCause,remediationIntent,filesToModify,filesToCreate,proposedPaths,requiredChanges,forbiddenChanges,expectedBehaviorPreserved,validationStrategy:{compile,tests,scanner},confidence}. Paths must be repository-relative and minimal. Route high-risk/infra/admin/Jenkins/Docker work with disposition MANUAL_OR_SPECIALIST; otherwise disposition AUTO_CANDIDATE.'+correctiveInstruction+' Input: '+JSON.stringify(contract)}]};",
  'Mission 3 causal prompt consumption (message content)',
);

// --- Patch 4: MISSION 5 fix -- route the two direct-to-Persist failure ---
// nodes through "Prepare WF2 Failure Status" instead (pure rewiring, see
// header comment above for the full proof). Verifies the exact pre-fix
// edges exist first, so this throws loudly if the source artifact ever
// drifts, rather than silently doing nothing.
for (const nodeName of ['Persist Verification Failure', 'Persist Base Moved Failure']) {
  const edges = workflow.connections[nodeName]?.main?.[0];
  if (!Array.isArray(edges) || edges.length !== 1 || edges[0].node !== 'Persist WF2 Failure Status') {
    throw new Error(`PORT_FAILED: expected "${nodeName}" to feed directly into "Persist WF2 Failure Status" -- source artifact may have drifted`);
  }
  edges[0].node = 'Prepare WF2 Failure Status';
}

// --- Identity: distinct, clearly-named, inactive, non-colliding ---------
workflow.name = 'WF2 - Git Patch & PR v5 CANONICAL (R22E + Brique 5)';
workflow.active = false;
const webhookNode = workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
if (webhookNode) webhookNode.parameters.path = 'wf2-canonical-final-test';

writeFileSync(outputPath, JSON.stringify([workflow], null, 2) + '\n');
console.log('Wrote', outputPath, `(${workflow.nodes.length} nodes, inactive, webhook path "${webhookNode?.parameters.path}")`);
