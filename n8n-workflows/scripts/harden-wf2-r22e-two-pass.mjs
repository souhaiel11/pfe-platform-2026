// R22-E — WF2 two-pass restructuring: generate-all -> freeze -> verify -> write-all.
//
// Loads the LIVE canonical WF2 export (not a stale backup, per R22-B/R22-E
// Phase 1) and produces a `pending-live-update` artifact. NOT imported or
// published to the live n8n instance by this script -- deployment is a
// separate, explicitly-authorized step this phase does not take.
//
// Preserves unchanged: planner, generic remediation generation, CREATE/
// MODIFY routing, the Loop Over Items (SplitInBatches) mechanism itself,
// semantic reviewer, error envelope conventions (onError:'continueErrorOutput'
// + a paired Failure Envelope node, same as every existing node in this
// workflow), GitHub write reconciliation logic, PR lookup/create, backend
// persistence, retry/idempotency (none of Prepare Batch Context / Validate
// Generic Remediation Plan / the LLM planner+generator+reviewer chain /
// Lookup Existing Batch PR / Select Existing PR / Save Execution Result to
// Backend are touched).
//
// Restructures only the candidate generation/write boundary:
//   - Branch creation moves from "first thing that happens" to "only after
//     CandidateVerification PASS" (R22-B's proven gap).
//   - The per-file loop no longer writes to GitHub during generation --
//     Create/Update File in Branch become PASS 2 only, fed by the frozen
//     CandidateManifest instead of fresh per-item generation.
import fs from 'fs';
import crypto from 'node:crypto';

const liveExportPath = process.argv[2];
if (!liveExportPath) {
  console.error('Usage: node harden-wf2-r22e-two-pass.mjs <path-to-fresh-live-export.json>');
  process.exit(2);
}
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R22E-TWO-PASS-CANDIDATE.json', import.meta.url);

const exported = JSON.parse(fs.readFileSync(liveExportPath));
const workflow = Array.isArray(exported) ? exported[0] : exported;
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const conns = workflow.connections;

function assertNode(name) {
  if (!node(name)) throw new Error(`R22-E generator: expected node '${name}' to exist in the live export -- refusing to guess/skip.`);
  return node(name);
}

// ---------------------------------------------------------------------
// Node factories. `withErrorOutput: true` (the default for code/http/github
// factories below) mirrors the existing convention used throughout this
// workflow: onError:'continueErrorOutput' gives the node a 2nd output, and
// the caller MUST wire both outputs via setMainTwoOutputs -- a bare
// setMain() on such a node would incorrectly merge success+error targets
// into a single output array.
// ---------------------------------------------------------------------
let positionCounter = 0;
const nextPosition = () => { positionCounter += 1; return [900 + (positionCounter % 6) * 260, 4200 + Math.floor(positionCounter / 6) * 160]; };

const codeNode = (name, jsCode, { withErrorOutput = true } = {}) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.code', typeVersion: 2,
  position: nextPosition(), parameters: { mode: 'runOnceForAllItems', jsCode },
  ...(withErrorOutput ? { onError: 'continueErrorOutput' } : {}),
});

const ifNode = (name, leftValueExpr, rightValue, operationType = 'boolean', operation = 'true') => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.if', typeVersion: 2.2,
  position: nextPosition(),
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [{ id: 'cond', leftValue: leftValueExpr, rightValue, operator: { type: operationType, operation } }],
      combinator: 'and',
    },
    options: {},
  },
});

const githubReadRefNode = (name, ownerExpr, repoExpr, refExpr) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
  position: nextPosition(), onError: 'continueErrorOutput',
  parameters: {
    url: `=https://api.github.com/repos/${ownerExpr}/${repoExpr}/git/ref/heads/${refExpr}`,
    authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
    options: { response: { response: { fullResponse: true, neverError: true } } },
  },
});

const backendPostNode = (name, urlExpr, jsonBodyExpr, timeoutMs) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
  position: nextPosition(), onError: 'continueErrorOutput',
  parameters: {
    method: 'POST', url: urlExpr,
    sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Internal-Secret', value: '={{ $env.N8N_INTERNAL_SECRET }}' }] },
    sendBody: true, specifyBody: 'json', jsonBody: jsonBodyExpr,
    options: timeoutMs ? { timeout: timeoutMs } : {},
  },
});

const githubFileNode = (name, operation, ownerExpr, repoExpr, filePathExpr, referenceExpr) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.github', typeVersion: 1,
  position: nextPosition(), onError: 'continueErrorOutput',
  parameters: {
    resource: 'file', operation,
    owner: { __rl: true, mode: 'name', value: ownerExpr },
    repository: { __rl: true, mode: 'name', value: repoExpr },
    filePath: filePathExpr,
    asBinaryProperty: false,
    additionalParameters: { reference: referenceExpr },
  },
});

// R22-E2Q — SHA-256 in the n8n Code-node sandbox: `require('crypto')` is
// disallowed here (task-runner `allowedBuiltInModules` is empty; there is no
// `crypto`/WebCrypto global; n8n expressions additionally block `Buffer`).
// The installed native `n8n-nodes-base.crypto` v2 hash action runs in the
// main process and is `createHash('SHA256').update(value).digest('hex')` —
// byte-identical to the backend canonical `candidate-digest.ts`
// (`computeContentSha256` / `computeCandidateDigest`). No sandbox policy is
// widened. `value` is an n8n expression; `dataPropertyName` receives the hex
// digest; all other item fields pass through.
const cryptoHashNode = (name, valueExpr, dataPropertyName) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.crypto', typeVersion: 2,
  position: nextPosition(),
  parameters: { action: 'hash', type: 'SHA256', binaryData: false, value: valueExpr, dataPropertyName, encoding: 'hex' },
});

const failureEnvelope = (failedNodeName) => codeNode(
  `Failure Envelope - ${failedNodeName}`,
  String.raw`const input=$input.first().json||{};const raw=input.error??input;const err=typeof raw==='string'?{message:raw}:raw||{};const rawSummary=String(input.failureSummary||err.message||input.message||input.reason||raw||'workflow execution error');const failureSummary=rawSummary.replace(/[\r\n]+/g,' ').replace(/(?:token|password|secret|authorization)\s*[=:]\s*[^ ,;]+/ig,'$1=[REDACTED]').slice(0,500);const embedded=rawSummary.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)?.[1];const failureCode=String(input.failureCode||embedded||'WF2_EXECUTION_ERROR').slice(0,120);const captured=$items('Capture Correlation Envelope',0,0);const correlationEnvelope=captured?.[0]?.json?.correlationEnvelope||{};return [{json:{correlationEnvelope,executionId:String($execution.id),failedNode:${JSON.stringify(failedNodeName)},failureCode,failureSummary}}];`,
  { withErrorOutput: false },
);

function setMain(fromName, targets) {
  conns[fromName] = { main: [targets.map(t => ({ node: t, type: 'main', index: 0 }))] };
}
function setMainTwoOutputs(fromName, outputsArr) {
  conns[fromName] = { main: outputsArr.map(targets => targets.map(t => ({ node: t, type: 'main', index: 0 }))) };
}
/** Wires a node that has onError:'continueErrorOutput' — success target(s) on output 0, its own Failure Envelope on output 1. */
function wireWithErrorOutput(fromName, successTargets) {
  setMainTwoOutputs(fromName, [successTargets, [`Failure Envelope - ${fromName}`]]);
}

// ---------------------------------------------------------------------
// PHASE 2 — branch creation deferred. NO-branch path now records context
// instead of creating the branch immediately.
// ---------------------------------------------------------------------
const recordNewBranchBaseline = codeNode('Record New Branch Baseline', String.raw`const ctx=$('Prepare Batch Context').first().json;return [{json:{...ctx,branchExists:false,candidateBaseSha:String(ctx.baseSha||'').toLowerCase()}}];`);

// Use Existing Branch: ENHANCED in place (see mutateExistingNodes) to
// capture the branch's real HEAD as candidateBaseSha, distinct from
// ctx.baseSha (main's SHA) -- Critical Invariant 1.

// ---------------------------------------------------------------------
// PHASE 3 — PASS 1: accumulate instead of write.
// ---------------------------------------------------------------------
// R22-E2Q FIX A.1 — the per-file contentSha256 is produced by the native
// Crypto node just upstream (see 'Hash Candidate File Content'); this node
// only asserts it arrived.
// R22-E2Q FIX C — `candidateBaseSha` + `branchExists`, set by
// 'Record New Branch Baseline' / 'Use Existing Branch', are dropped when
// 'Fetch Repository Tree' (an httpRequest) replaces the item JSON, so they
// never reach 'Assemble Candidate Manifest'. Re-derive them here from the
// two nodes that always run and always carry the authoritative values —
// exactly the same rule the two baseline nodes use (and the same rule as
// the R22-E2P authoritative-ref fix): branch present (lookup 200) ⇒ its
// HEAD sha; else ⇒ Prepare Batch Context.baseSha. Deterministic, generic,
// no project/finding/rule/language branch.
const accumulateCandidateFile = codeNode('Accumulate Candidate File', String.raw`const candidate=$('Enforce Independent Review').item.json;const contentSha256=String($json.contentSha256||'');if(!/^[a-f0-9]{64}$/.test(contentSha256))throw new Error('CANDIDATE_CONTENT_SHA256_UNAVAILABLE');const lookup=$('Lookup Remediation Branch').first().json;const branchExists=Number(lookup.statusCode)===200;const candidateBaseSha=String(branchExists?(lookup.body?.object?.sha||''):$('Prepare Batch Context').first().json.baseSha).toLowerCase();if(!/^[a-f0-9]{40}$/.test(candidateBaseSha))throw new Error('CANDIDATE_BASE_SHA_UNAVAILABLE');return {json:{...candidate,contentSha256,branchExists,candidateBaseSha}};`);
const hashCandidateFileContent = cryptoHashNode('Hash Candidate File Content', "={{ String($json.patchedCode ?? '') }}", 'contentSha256');

// ---------------------------------------------------------------------
// PHASE 4 — assemble the immutable CandidateManifest once Pass 1 is done.
// Mirrors backend/src/candidate-verification/candidate-digest.ts exactly
// (same key order in JSON.stringify) -- cross-checked in
// wf2-r22e-two-pass.spec.mjs against the real compiled backend module.
// ---------------------------------------------------------------------
// R22-E2Q FIX A.2 — the candidateDigest was computed here with
// `require('crypto')` (sandbox-disallowed). Split into three:
//   'Prepare Candidate Manifest' (this, renamed) builds the manifest and
//       emits `_canonicalJson` — the EXACT string the old code hashed:
//       JSON.stringify({candidateBaseSha, files:[{path,operation,contentSha256}] sorted}).
//   'Hash Candidate Manifest' (native Crypto) hashes it → candidateDigest.
//   'Assemble Candidate Manifest' (KEPT NAME so every downstream
//       `$('Assemble Candidate Manifest')` reference is unchanged) strips
//       the helper field and validates the frozen manifest.
// The canonical serialization contract is preserved byte-for-byte and still
// matches backend computeCandidateDigest.
const prepareCandidateManifest = codeNode('Prepare Candidate Manifest', String.raw`const ctx=$('Prepare Batch Context').first().json;const items=$input.all().map(i=>i.json);const branchExists=Boolean(items[0]&&items[0].branchExists);const candidateBaseSha=String((items[0]&&items[0].candidateBaseSha)||'').toLowerCase();
const files=items.map(it=>({path:String(it.target_file_path||it.file_path||''),operation:String(it.fileOperation||''),originalBlobSha:it.oldSha||null,content:String(it.patchedCode||''),contentSha256:String(it.contentSha256||''),file_path:it.file_path,repository_owner:it.repository_owner,repository_name:it.repository_name,branchName:it.branchName,commitMessage:it.commitMessage,sourceContent:it.sourceContent,approvedFindingIds:it.approvedFindingIds,processedFindingIds:it.processedFindingIds,candidateAcceptedFindingIds:it.candidateAcceptedFindingIds,validationEvidence:it.validationEvidence}));
const canonicalFiles=files.map(f=>({path:f.path,operation:f.operation,contentSha256:f.contentSha256})).sort((a,b)=>a.path.localeCompare(b.path));const canonical={candidateBaseSha,files:canonicalFiles};
const manifest={candidateId:ctx.batchId+'-attempt-'+String(ctx.attemptCount),requestId:ctx.requestId,batchId:ctx.batchId,candidateAttempt:Number(ctx.attemptCount)||0,repository:ctx.repository_owner+'/'+ctx.repository_name,candidateBaseSha,branchExists,targetBranchName:ctx.targetBranchName,baseBranch:ctx.baseBranch,files};
return [{json:{...manifest,_canonicalJson:JSON.stringify(canonical)}}];`, { withErrorOutput: false });
const hashCandidateManifest = cryptoHashNode('Hash Candidate Manifest', "={{ $json._canonicalJson }}", 'candidateDigest');
const assembleCandidateManifest = codeNode('Assemble Candidate Manifest', String.raw`const m={...$json};delete m._canonicalJson;if(!Array.isArray(m.files)||!m.files.length)throw new Error('CANDIDATE_MANIFEST_INVALID:no accumulated files');if(!/^[a-f0-9]{40}$/.test(String(m.candidateBaseSha||'')))throw new Error('CANDIDATE_MANIFEST_INVALID:candidateBaseSha missing/invalid');if(!/^[a-f0-9]{64}$/.test(String(m.candidateDigest||'')))throw new Error('CANDIDATE_MANIFEST_INVALID:candidateDigest missing/invalid');return [{json:m}];`);

// ---------------------------------------------------------------------
// PHASE 5 — call the backend CandidateVerification engine exactly once.
// ---------------------------------------------------------------------
const callCandidateVerification = backendPostNode(
  'Call Candidate Verification',
  '=http://backend:3001/api/candidate-verification/verify',
  '={{ JSON.stringify({ manifest: $json, allowedPaths: $json.files.map(f => f.path) }) }}',
  300000,
);

// ---------------------------------------------------------------------
// PHASE 6 — write guard (reuses the backend's own assertCandidateStillValidForWrite,
// never a duplicated n8n-side comparison that could drift).
// ---------------------------------------------------------------------
const callWriteGuard = backendPostNode(
  'Call Write Guard',
  '=http://backend:3001/api/candidate-verification/write-guard',
  '={{ JSON.stringify({ verification: $json, candidateManifest: $(\'Assemble Candidate Manifest\').first().json }) }}',
  15000,
);
const writeGuardPassed = ifNode('Write Guard Passed?', '={{ $json.ok }}', true, 'boolean', 'true');
const persistVerificationFailure = codeNode('Persist Verification Failure', String.raw`const manifest=$('Assemble Candidate Manifest').first().json;const guard=$json;const captured=$items('Capture Correlation Envelope',0,0);const correlationEnvelope=captured?.[0]?.json?.correlationEnvelope||{};return [{json:{correlationEnvelope,executionId:String($execution.id),failedNode:'Call Write Guard',failureCode:'CANDIDATE_VERIFICATION_'+String(guard.reason||'FAILED'),failureSummary:'Candidate verification did not pass: '+String(guard.reason||'unknown'),candidateDigest:manifest.candidateDigest,candidateBaseSha:manifest.candidateBaseSha}}];`, { withErrorOutput: false });

// ---------------------------------------------------------------------
// PHASE 7 — remote head drift check, immediately before any Git mutation.
// ---------------------------------------------------------------------
const branchExistedAtGeneration = ifNode('Branch Existed At Generation?', "={{ $('Assemble Candidate Manifest').first().json.branchExists }}", true, 'boolean', 'true');
const repoOwnerExpr = "{{ $('Assemble Candidate Manifest').first().json.repository.split('/')[0] }}";
const repoNameExpr = "{{ $('Assemble Candidate Manifest').first().json.repository.split('/')[1] }}";
const recheckExistingBranchHead = githubReadRefNode(
  'Re-check Existing Branch Head', repoOwnerExpr, repoNameExpr,
  "{{ encodeURIComponent($('Assemble Candidate Manifest').first().json.targetBranchName) }}",
);
const relookupBaselineRefBeforeCreation = githubReadRefNode(
  'Re-lookup Baseline Ref Before Creation', repoOwnerExpr, repoNameExpr,
  "{{ $('Assemble Candidate Manifest').first().json.baseBranch }}",
);
const callRemoteHeadDriftGuard = backendPostNode(
  'Call Remote Head Drift Guard',
  '=http://backend:3001/api/candidate-verification/remote-head-drift',
  '={{ JSON.stringify({ remoteHeadSha: $json.body?.object?.sha || null, candidateBaseSha: $(\'Assemble Candidate Manifest\').first().json.candidateBaseSha }) }}',
  15000,
);
const remoteHeadDriftPassed = ifNode('Remote Head Drift Passed?', '={{ $json.ok }}', true, 'boolean', 'true');
const persistBaseMovedFailure = codeNode('Persist Base Moved Failure', String.raw`const manifest=$('Assemble Candidate Manifest').first().json;const captured=$items('Capture Correlation Envelope',0,0);const correlationEnvelope=captured?.[0]?.json?.correlationEnvelope||{};return [{json:{correlationEnvelope,executionId:String($execution.id),failedNode:'Call Remote Head Drift Guard',failureCode:'CANDIDATE_BASE_MOVED',failureSummary:'Remote branch/baseline HEAD moved since candidate generation -- candidate must be reconstructed, no write attempted, no force.',candidateBaseSha:manifest.candidateBaseSha}}];`, { withErrorOutput: false });
// Second branchExists check, AFTER drift-check passes, decides whether Pass
// 2 must still create the branch (kept as its own node rather than reusing
// `Branch Existed At Generation?` a second time, purely so the graph stays
// a DAG the n8n editor can render sensibly — same boolean, evaluated twice).
const branchExistedAtGeneration2 = ifNode('Branch Existed At Generation? (Pass 2 Entry)', "={{ $('Assemble Candidate Manifest').first().json.branchExists }}", true, 'boolean', 'true');

// ---------------------------------------------------------------------
// PHASE 8/9 — re-confirm remediation branch absence (TOCTOU guard, reuses
// existing Prepare Branch Creation/Create Missing Branch UNCHANGED) then
// PASS 2: controlled write from the frozen manifest, never regenerated.
// ---------------------------------------------------------------------
const relookupRemediationBranchBeforeCreate = githubReadRefNode(
  'Re-lookup Remediation Branch Before Create', repoOwnerExpr, repoNameExpr,
  "{{ encodeURIComponent($('Assemble Candidate Manifest').first().json.targetBranchName) }}",
);

const expandManifestFiles = codeNode('Expand Manifest Files', String.raw`const manifest=$json;return manifest.files.map(f=>({json:{target_file_path:f.path,file_path:f.file_path||f.path,fileOperation:f.operation,patchedCode:f.content,contentSha256:f.contentSha256,oldSha:f.originalBlobSha,repository_owner:f.repository_owner,repository_name:f.repository_name,branchName:f.branchName,commitMessage:f.commitMessage,sourceContent:f.sourceContent,approvedFindingIds:f.approvedFindingIds,processedFindingIds:f.processedFindingIds,candidateAcceptedFindingIds:f.candidateAcceptedFindingIds,validationEvidence:f.validationEvidence}}));`);

const loopOverManifestFiles = { id: crypto.randomUUID(), name: 'Loop Over Manifest Files', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: nextPosition(), parameters: { batchSize: 1, options: {} } };

// R22-E2Q FIX A.3 — recompute via native Crypto node upstream
// ('Recompute Content Hash Before Send'); this node only compares.
const recomputeContentHashBeforeSend = cryptoHashNode('Recompute Content Hash Before Send', "={{ String($json.patchedCode ?? '') }}", '_recomputedContentSha256');
const verifyContentHashBeforeSend = codeNode('Verify Content Hash Before Send', String.raw`const item=$json;const actual=String(item._recomputedContentSha256||'');if(actual!==String(item.contentSha256||''))throw new Error('CANDIDATE_CONTENT_MISMATCH:'+JSON.stringify({path:item.target_file_path,expected:item.contentSha256,actual}));const {_recomputedContentSha256,...rest}=item;return {json:rest};`);

// Pass-2 twins of the write-result/reconciliation nodes: identical logic to
// their Pass-1 originals, re-pointed at 'Expand Manifest Files' instead of
// 'Enforce Independent Review' for the candidate-metadata lookup, since
// Pass 2 items have no pairedItem lineage back to a node that never ran in
// this execution branch. No other logic changed -- this IS the "preserve
// existing GitHub reconciliation behavior" requirement, just re-anchored.
const buildFileResultPass2 = codeNode('Build File Result (Pass 2)', String.raw`const update=$json;const candidate=$('Expand Manifest Files').item.json;const commitSha=String(update.commit?.sha||'');const newSha=String(update.content?.sha||'');if(!commitSha||!newSha)throw new Error('FILE_UPDATE_EVIDENCE_MISSING');return {json:{targetFile:candidate.target_file_path,approvedFindingIds:candidate.approvedFindingIds,processedFindingIds:candidate.processedFindingIds,candidateAcceptedFindingIds:candidate.candidateAcceptedFindingIds,validationEvidence:candidate.validationEvidence,outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateStateVerified:true,updateApplied:true,fileOperation:candidate.fileOperation,oldSha:candidate.oldSha,newSha,commitSha,contentSha256:candidate.contentSha256}};`);

const classifyGitHubWriteErrorPass2 = codeNode('Classify GitHub Write Error (Pass 2)', String.raw`const patch=$('Expand Manifest Files').item.json;const raw=$json.error||$json;const message=String(raw.message||$json.message||raw.description||'GitHub write transport failure').replace(/[\r\n]+/g,' ').slice(0,500);const code=String(raw.code||raw.errorCode||'');const dns=/EAI_AGAIN|ENOTFOUND|DNS server|name resolution|getaddrinfo/i.test(code+' '+message);return {json:{...patch,transportError:{code,message},requiresReadBack:!dns,failureCode:dns?'GITHUB_DNS_UNAVAILABLE':'GITHUB_WRITE_UNCERTAIN',failureNode:'Update File in Branch',failureSummary:message}};`, { withErrorOutput: false });

const readBackFileAfterWriteErrorPass2 = githubFileNode(
  'Read Back File After Write Error (Pass 2)', 'get',
  "={{ $('Expand Manifest Files').item.json.repository_owner }}",
  "={{ $('Expand Manifest Files').item.json.repository_name }}",
  "={{ $('Expand Manifest Files').item.json.file_path }}",
  "={{ $('Expand Manifest Files').item.json.branchName }}",
);

// Phase 10: reconciliation now ALSO checks the readback content's hash
// against the manifest's expected contentSha256, not merely "file exists"/
// matches patchedCode by string-equality (kept) -- the hash check is the
// same proof CandidateMaterializer already uses locally (R22-C), applied
// here to the remote readback.
// R22-E2Q FIX A.4 — the base64 decode stays in a Code node (`Buffer` is
// allowed in Code nodes, blocked only in n8n expressions), and the SHA-256
// of the decoded bytes is produced by the native Crypto node in between
// ('Hash Reconciled Remote Content'). Reconciliation logic is otherwise
// unchanged — same string-equality checks, same hash check, same outcomes.
const decodeReconciledRemoteContent = codeNode('Decode Reconciled Remote Content', String.raw`const decoded=Buffer.from(String($json.content||'').replace(/\n/g,''),'base64').toString('utf8');return {json:{...$json,_reconciledRemoteContent:decoded}};`, { withErrorOutput: false });
const hashReconciledRemoteContent = cryptoHashNode('Hash Reconciled Remote Content', "={{ String($json._reconciledRemoteContent ?? '') }}", '_reconciledRemoteSha256');
const evaluateGitHubWriteReconciliationPass2 = codeNode('Evaluate GitHub Write Reconciliation (Pass 2)', String.raw`const patch=$('Expand Manifest Files').item.json;const decoded=String($json._reconciledRemoteContent||'');const normalize=value=>String(value).replace(/\r\n/g,'\n');const actualSha256=String($json._reconciledRemoteSha256||'');if(normalize(decoded)===normalize(patch.patchedCode)&&actualSha256===String(patch.contentSha256))return {json:{...patch,reconciledWrite:true,newSha:String($json.sha||''),remoteState:'EXPECTED_CANDIDATE'}};if(normalize(decoded)===normalize(patch.sourceContent))return {json:{...patch,reconciledWrite:false,failureCode:'GITHUB_WRITE_UNCONFIRMED',failureNode:'Update File in Branch',failureSummary:'GitHub write failed and remote content is unchanged',remoteState:'UNCHANGED'}};if(normalize(decoded)===normalize(patch.patchedCode)&&actualSha256!==String(patch.contentSha256))return {json:{...patch,reconciledWrite:false,failureCode:'CANDIDATE_CONTENT_MISMATCH',failureNode:'Update File in Branch',failureSummary:'Remote content matches patchedCode string but hash differs from the verified candidateDigest input -- refusing to trust it',remoteState:'HASH_MISMATCH'}};return {json:{...patch,reconciledWrite:false,failureCode:'GITHUB_REMOTE_STATE_UNEXPECTED',failureNode:'Update File in Branch',failureSummary:'GitHub write failed and remote content differs from source and candidate',remoteState:'UNEXPECTED'}};`, { withErrorOutput: false });

const lookupHeadAfterReconciledWritePass2 = githubReadRefNode(
  'Lookup Head After Reconciled Write (Pass 2)',
  "{{ $('Expand Manifest Files').item.json.repository_owner }}",
  "{{ $('Expand Manifest Files').item.json.repository_name }}",
  "{{ encodeURIComponent($('Expand Manifest Files').item.json.branchName) }}",
);

const transportRequiresReadBackPass2 = ifNode('Transport Requires Read Back? (Pass 2)', '={{ $json.requiresReadBack }}', true, 'boolean', 'true');
const remoteCandidatePresentPass2 = ifNode('Remote Candidate Present? (Pass 2)', '={{ $json.reconciledWrite }}', true, 'boolean', 'true');

const mergePass2 = { id: crypto.randomUUID(), name: 'Merge Effective File Results 2', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: nextPosition(), parameters: {} };

// ---------------------------------------------------------------------
// PHASE 12 — batch completeness now driven by the FROZEN manifest (not
// the live plan), plus an explicit PARTIAL_REMOTE_WRITE classification
// (Phase 11) distinct from the pre-existing failure categories.
// ---------------------------------------------------------------------
const validateBatchCompletenessV2Code = String.raw`
const ctx=$('Prepare Batch Context').first().json;const manifest=$('Assemble Candidate Manifest').first().json;const planned=manifest.files;const incoming=$input.all().map(i=>i.json);const norm=v=>[...new Set((v||[]).map(String))].sort();const expectedFindingIds=norm(ctx.findingIds);const expectedFiles=norm(planned.map(f=>f.path));const expectedContentByFile=new Map(planned.map(f=>[f.path,f.contentSha256]));const expectedSet=new Set(expectedFiles);const required=['targetFile','approvedFindingIds','processedFindingIds','candidateAcceptedFindingIds','validationEvidence','outcome','candidateStateVerified','updateApplied','fileOperation','oldSha','newSha','commitSha'];const byFile=new Map();for(const result of incoming){const path=String(result.targetFile||'');if(!path||!expectedSet.has(path))throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({unexpectedFiles:path?[path]:[],category:'UNEXPECTED_OR_EMPTY_FILE'}));const missingContract=required.filter(key=>result[key]===undefined||result[key]===null);if(missingContract.length)throw new Error('WF2_EFFECTIVE_RESULT_INVALID:'+JSON.stringify({path,missingFields:missingContract}));if(result.contentSha256&&expectedContentByFile.get(path)&&result.contentSha256!==expectedContentByFile.get(path))throw new Error('CANDIDATE_CONTENT_MISMATCH:'+JSON.stringify({path,expected:expectedContentByFile.get(path),actual:result.contentSha256}));const previous=byFile.get(path);if(previous){const same=String(previous.newSha)===String(result.newSha)&&String(previous.commitSha)===String(result.commitSha)&&String(previous.outcome)===String(result.outcome)&&Boolean(previous.candidateStateVerified)===Boolean(result.candidateStateVerified);if(!same)throw new Error('WF2_EFFECTIVE_RESULT_CONFLICT:'+JSON.stringify({path,category:'CONTRADICTORY_WRITE_EVIDENCE'}));continue}byFile.set(path,result)}const results=[...byFile.values()].sort((a,b)=>String(a.targetFile).localeCompare(String(b.targetFile)));const resultFiles=norm(results.map(r=>r.targetFile));const acceptedFindingIds=norm(results.flatMap(r=>r.candidateAcceptedFindingIds||[]));const missingFindingIds=expectedFindingIds.filter(id=>!acceptedFindingIds.includes(id));const unexpectedFindingIds=acceptedFindingIds.filter(id=>!expectedFindingIds.includes(id));const missingFiles=expectedFiles.filter(file=>!byFile.has(file));const failed=results.filter(r=>!r.candidateStateVerified||r.outcome!=='CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION'||r.updateApplied!==true).map(r=>r.targetFile);
if(missingFiles.length&&!failed.length&&!missingFindingIds.length&&!unexpectedFindingIds.length){throw new Error('PARTIAL_REMOTE_WRITE:'+JSON.stringify({missingFiles,expectedCount:expectedFiles.length,actualCount:results.length,note:'PR creation forbidden -- not every CandidateManifest file is confirmed remotely with its expected contentSha256'}));}
if(missingFindingIds.length||unexpectedFindingIds.length||missingFiles.length||failed.length||results.length!==expectedFiles.length)throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({missingFindingIds,unexpectedFindingIds,missingFiles,failed,expectedCount:expectedFiles.length,actualCount:results.length}));
return [{json:{completenessPassed:true,candidateDecision:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',scannerResolution:'UNKNOWN_UNTIL_WF3',expectedFindingIds,expectedTargetFiles:expectedFiles,processedFindingIds:acceptedFindingIds,candidateAcceptedFindingIds:acceptedFindingIds,candidateVerifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results,candidateDigest:manifest.candidateDigest}}];`;

// ---------------------------------------------------------------------
// Assemble the new-node list. Every node that has onError:'continueErrorOutput'
// gets exactly one paired Failure Envelope (mirroring the pre-existing
// convention exactly); IF nodes do not, unless their own FALSE branch is
// itself the meaningful failure path (Transport Requires Read Back?/
// Remote Candidate Present? — both wired below to their OWN Failure
// Envelope on the FALSE output, same as the pre-existing originals).
// ---------------------------------------------------------------------
const codeAndHttpNodesNeedingEnvelopes = [
  recordNewBranchBaseline, accumulateCandidateFile, assembleCandidateManifest,
  callCandidateVerification, callWriteGuard,
  recheckExistingBranchHead, relookupBaselineRefBeforeCreation, callRemoteHeadDriftGuard,
  relookupRemediationBranchBeforeCreate, expandManifestFiles, verifyContentHashBeforeSend,
  buildFileResultPass2, readBackFileAfterWriteErrorPass2, lookupHeadAfterReconciledWritePass2,
];
const nodesWithoutEnvelopes = [
  persistVerificationFailure, branchExistedAtGeneration, remoteHeadDriftPassed, persistBaseMovedFailure,
  branchExistedAtGeneration2, loopOverManifestFiles, classifyGitHubWriteErrorPass2,
  evaluateGitHubWriteReconciliationPass2, transportRequiresReadBackPass2, remoteCandidatePresentPass2,
  mergePass2, writeGuardPassed,
];
const newFailureEnvelopes = codeAndHttpNodesNeedingEnvelopes.map(n => failureEnvelope(n.name));
const ownFailureEnvelopeIf = [
  failureEnvelope('Transport Requires Read Back? (Pass 2)'),
  failureEnvelope('Remote Candidate Present? (Pass 2)'),
];

// R22-E2Q FIX A — the 6 native SHA-256 nodes replacing the disallowed
// `require('crypto')`. The two Code nodes here are non-throwing pure
// transforms (build/decode), so they carry no error output/envelope; the
// Crypto nodes hash a string and cannot fail. Net +6, 141 → 147.
const newDigestNodes = [
  hashCandidateFileContent,          // A.1  Crypto  — per-file contentSha256
  prepareCandidateManifest,          // A.2  Code    — build manifest + _canonicalJson
  hashCandidateManifest,             // A.2  Crypto  — candidateDigest
  recomputeContentHashBeforeSend,    // A.3  Crypto  — Pass-2 pre-send recheck
  decodeReconciledRemoteContent,     // A.4  Code    — base64 decode (Buffer-safe)
  hashReconciledRemoteContent,       // A.4  Crypto  — Pass-2 reconciliation hash
];

workflow.nodes.push(...codeAndHttpNodesNeedingEnvelopes, ...nodesWithoutEnvelopes, ...newFailureEnvelopes, ...ownFailureEnvelopeIf, ...newDigestNodes);

// ---------------------------------------------------------------------
// R22-E2B Phase 4 — credential references for the 5 new GitHub-calling
// nodes, copied verbatim (reference only, never a secret value) from their
// proven live siblings. httpRequest-type GitHub reads reuse the same
// githubApi reference as the existing 'Lookup Remediation Branch'; the one
// native n8n-nodes-base.github node reuses the same reference as the
// existing 'Create File in Branch'. Fails loudly if either sibling's
// credential is somehow absent, rather than silently shipping an unbound
// node a second time.
// ---------------------------------------------------------------------
function requireCredential(siblingName, credentialType) {
  const cred = assertNode(siblingName).credentials?.[credentialType];
  if (!cred) throw new Error(`R22-E2B generator: sibling node '${siblingName}' has no '${credentialType}' credential reference to copy -- refusing to ship an unbound node.`);
  return { [credentialType]: { id: cred.id, name: cred.name } };
}
const httpGithubCredential = requireCredential('Lookup Remediation Branch', 'githubApi');
const nativeGithubCredential = requireCredential('Create File in Branch', 'githubApi');
for (const n of [recheckExistingBranchHead, relookupBaselineRefBeforeCreation, relookupRemediationBranchBeforeCreate, lookupHeadAfterReconciledWritePass2]) {
  n.credentials = httpGithubCredential;
}
readBackFileAfterWriteErrorPass2.credentials = nativeGithubCredential;

// ---------------------------------------------------------------------
// R22-E2G — bounded LLM request latency. These three pre-existing
// httpRequest nodes call api.anthropic.com directly with no explicit
// `options.timeout`, which per the installed HttpRequestV3 node
// (n8n-nodes-base, typeVersion 4.4) means each falls back to the node's
// own code-level default of 300_000ms (5 minutes) -- not literally
// unbounded, but long enough to leave a stalled/slow LLM call
// indistinguishable from a hung workflow for a very long time, and it
// is not an explicit, deliberate, reviewable policy. 180000ms (3
// minutes) is deliberately below CandidateVerification's own 300000ms
// timeout and gives a single LLM turn ample time while still failing
// fast into the existing onError:'continueErrorOutput' -> Failure
// Envelope path (proven: HttpRequestV3 catches request errors,
// including a client-side timeout, in the same try/catch gated by
// continueOnFail() that onError:'continueErrorOutput' controls -- a
// timeout becomes an ordinary routed node error, not a hang, not a
// retry, and not a fabricated success).
const LLM_TIMEOUT_MS = 180000;
const LLM_HTTP_REQUEST_NODES = ['Generate Remediation Plan', 'de Patch - HTTP Request', 'Independent Semantic Review'];

// R22-E2P — the one authoritative reference every Pass-1 repository read must
// use. Pass 1 defers creation of a missing remediation branch until after
// CandidateVerification, so a Pass-1 read must resolve to an IMMUTABLE SHA:
// the existing remediation branch HEAD when `Lookup Remediation Branch`
// returned 200, otherwise the authoritative base SHA. A branch NAME is never
// an acceptable Pass-1 file-read reference. This is repository-reference
// lifecycle logic only -- no project/finding/rule/language/test-mode branch.
// Shared verbatim by 'Fetch Finding Source Context' and 'Fetch Repository
// Files' so the two Pass-1 github file:get reads can never diverge again.
const PASS1_AUTHORITATIVE_REF = "={{ Number($('Lookup Remediation Branch').first().json.statusCode) === 200 ? $('Lookup Remediation Branch').first().json.body?.object?.sha : $('Prepare Batch Context').first().json.baseSha }}";

// ---------------------------------------------------------------------
// Mutate existing nodes in place (Phase 2/4/12). No other existing node's
// jsCode/parameters are touched.
// ---------------------------------------------------------------------
function mutateExistingNodes() {
  const useExistingBranch = assertNode('Use Existing Branch');
  useExistingBranch.parameters.jsCode = String.raw`const ctx=$('Prepare Batch Context').first().json;const response=$json;if(response.statusCode!==200||response.body?.ref!=='refs/heads/'+ctx.targetBranchName)throw new Error('EXISTING_BRANCH_IDENTITY_MISMATCH');const candidateBaseSha=String(response.body?.object?.sha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(candidateBaseSha))throw new Error('EXISTING_BRANCH_HEAD_SHA_UNAVAILABLE');return [{json:{...ctx,branchExists:true,candidateBaseSha}}];`;

  const fetchRepositoryTree = assertNode('Fetch Repository Tree');
  fetchRepositoryTree.parameters.url = "=https://api.github.com/repos/{{ $('Prepare Batch Context').first().json.repository_owner }}/{{ $('Prepare Batch Context').first().json.repository_name }}/git/trees/{{ encodeURIComponent($json.branchExists ? $json.targetBranchName : $json.baseBranch) }}";

  // R22-E2J / R22-E2P — every Pass-1 github file:get read resolves to the
  // immutable SHA that actually supplied the repository tree (existing
  // remediation branch HEAD when lookup returned 200, otherwise the
  // authoritative base SHA). Never dereference a not-yet-created branch.
  //   - Fetch Finding Source Context: planner input read      (R22-E2J)
  //   - Fetch Repository Files:        Pass-1 patch-target read (R22-E2P,
  //     proven root cause of execution 1950's GitHub 404 -- it still
  //     referenced $('Prepare Batch Context').targetBranchName, a branch
  //     that does not exist on a first remediation attempt).
  for (const nodeName of ['Fetch Finding Source Context', 'Fetch Repository Files']) {
    assertNode(nodeName).parameters.additionalParameters.reference = PASS1_AUTHORITATIVE_REF;
  }

  const validateBatchCompleteness = assertNode('Validate Batch Completeness');
  validateBatchCompleteness.parameters.jsCode = validateBatchCompletenessV2Code;

  for (const name of LLM_HTTP_REQUEST_NODES) {
    const llmNode = assertNode(name);
    llmNode.parameters.options = { ...llmNode.parameters.options, timeout: LLM_TIMEOUT_MS };
  }
}
mutateExistingNodes();

// ---------------------------------------------------------------------
// Rewire connections.
// ---------------------------------------------------------------------

// Branch Exists?: YES -> Use Existing Branch (unchanged target), NO ->
// Record New Branch Baseline (was Prepare Branch Creation).
setMainTwoOutputs('Branch Exists?', [['Use Existing Branch'], ['Record New Branch Baseline']]);
wireWithErrorOutput('Record New Branch Baseline', ['Fetch Repository Tree']);
// Use Existing Branch keeps its existing 2-output error wiring, target unchanged.
wireWithErrorOutput('Use Existing Branch', ['Fetch Repository Tree']);

// Pass 1 write path removed: Enforce Independent Review now feeds
// Accumulate Candidate File instead of Candidate Creates File? directly.
// (Enforce Independent Review already has onError wiring to its own
// pre-existing Failure Envelope -- only its SUCCESS target changes.)
// R22-E2Q FIX A.1 — native Crypto node between Enforce Independent Review
// and Accumulate Candidate File (per-file contentSha256).
setMainTwoOutputs('Enforce Independent Review', [['Hash Candidate File Content'], ['Failure Envelope - Enforce Independent Review']]);
setMain('Hash Candidate File Content', ['Accumulate Candidate File']);
wireWithErrorOutput('Accumulate Candidate File', ['Merge Effective File Results']);

// Merge Effective File Results ("done" output, index 0) now feeds manifest
// assembly instead of Validate Batch Completeness directly. ("loop" output,
// index 1, unchanged: still routes back into Route Planned File Operation.)
// R22-E2Q FIX A.2 — manifest digest now: Prepare Candidate Manifest (build)
// -> Hash Candidate Manifest (native Crypto) -> Assemble Candidate Manifest
// (KEPT NAME: freeze + validate; every downstream reference unchanged).
setMainTwoOutputs('Merge Effective File Results', [['Prepare Candidate Manifest'], ['Route Planned File Operation']]);
setMain('Prepare Candidate Manifest', ['Hash Candidate Manifest']);
setMain('Hash Candidate Manifest', ['Assemble Candidate Manifest']);

wireWithErrorOutput('Assemble Candidate Manifest', ['Call Candidate Verification']);
wireWithErrorOutput('Call Candidate Verification', ['Call Write Guard']);
wireWithErrorOutput('Call Write Guard', ['Write Guard Passed?']);
setMainTwoOutputs('Write Guard Passed?', [['Branch Existed At Generation?'], ['Persist Verification Failure']]);
setMain('Persist Verification Failure', ['Persist WF2 Failure Status']);

setMainTwoOutputs('Branch Existed At Generation?', [['Re-check Existing Branch Head'], ['Re-lookup Baseline Ref Before Creation']]);
wireWithErrorOutput('Re-check Existing Branch Head', ['Call Remote Head Drift Guard']);
wireWithErrorOutput('Re-lookup Baseline Ref Before Creation', ['Call Remote Head Drift Guard']);
wireWithErrorOutput('Call Remote Head Drift Guard', ['Remote Head Drift Passed?']);
setMainTwoOutputs('Remote Head Drift Passed?', [['Branch Existed At Generation? (Pass 2 Entry)'], ['Persist Base Moved Failure']]);
setMain('Persist Base Moved Failure', ['Persist WF2 Failure Status']);

setMainTwoOutputs('Branch Existed At Generation? (Pass 2 Entry)', [['Expand Manifest Files'], ['Re-lookup Remediation Branch Before Create']]);
wireWithErrorOutput('Re-lookup Remediation Branch Before Create', ['Prepare Branch Creation']);
// Prepare Branch Creation -> Create Missing Branch: UNCHANGED existing
// connection (kept as-is); only its upstream trigger changed (above).
setMainTwoOutputs('Create Missing Branch', [['Expand Manifest Files'], ['Failure Envelope - Create Missing Branch']]);

wireWithErrorOutput('Expand Manifest Files', ['Loop Over Manifest Files']);
// R22-E2Q FIX A.3 — native Crypto recompute between the loop and the verify.
setMainTwoOutputs('Loop Over Manifest Files', [['Validate Batch Completeness'], ['Recompute Content Hash Before Send']]);
setMain('Recompute Content Hash Before Send', ['Verify Content Hash Before Send']);
wireWithErrorOutput('Verify Content Hash Before Send', ['Candidate Creates File?']);

// Candidate Creates File? -> Create/Update File in Branch: UNCHANGED
// existing connection (now reachable only from Pass 2 -- no upstream
// connection into Candidate Creates File? survives from Pass 1 after the
// Enforce Independent Review rewire above).
setMainTwoOutputs('Create File in Branch', [['Build File Result (Pass 2)'], ['Failure Envelope - Create File in Branch']]);
setMainTwoOutputs('Update File in Branch', [['Build File Result (Pass 2)'], ['Classify GitHub Write Error (Pass 2)']]);
wireWithErrorOutput('Build File Result (Pass 2)', ['Merge Effective File Results 2']);
setMain('Merge Effective File Results 2', ['Loop Over Manifest Files']);

setMain('Classify GitHub Write Error (Pass 2)', ['Transport Requires Read Back? (Pass 2)']);
setMainTwoOutputs('Transport Requires Read Back? (Pass 2)', [['Read Back File After Write Error (Pass 2)'], ['Failure Envelope - Transport Requires Read Back? (Pass 2)']]);
// R22-E2Q FIX A.4 — Decode (Buffer-safe Code) -> Hash (native Crypto) ->
// Evaluate (unchanged reconciliation logic, now reads the pre-decoded
// content and pre-computed hash).
wireWithErrorOutput('Read Back File After Write Error (Pass 2)', ['Decode Reconciled Remote Content']);
setMain('Decode Reconciled Remote Content', ['Hash Reconciled Remote Content']);
setMain('Hash Reconciled Remote Content', ['Evaluate GitHub Write Reconciliation (Pass 2)']);
setMain('Evaluate GitHub Write Reconciliation (Pass 2)', ['Remote Candidate Present? (Pass 2)']);
setMainTwoOutputs('Remote Candidate Present? (Pass 2)', [['Lookup Head After Reconciled Write (Pass 2)'], ['Failure Envelope - Remote Candidate Present? (Pass 2)']]);
wireWithErrorOutput('Lookup Head After Reconciled Write (Pass 2)', ['Build Reconciled File Result']);
// Build Reconciled File Result is $json-based (no pinned node reference) --
// reused as-is; its onError wiring/Failure Envelope are pre-existing and
// untouched. Only its success target changes.
setMainTwoOutputs('Build Reconciled File Result', [['Merge Effective File Results 2'], ['Failure Envelope - Build Reconciled File Result']]);

// ---------------------------------------------------------------------
// R22-E2Q FIX B — "every terminal state calls back". `wireWithErrorOutput`
// (and the two `ownFailureEnvelopeIf` IF-nodes) route a failed node to its
// paired `Failure Envelope - <node>`, but never wired those envelopes
// onward, so all 16 R22-E two-pass failure envelopes dead-ended: a Pass-1/
// Pass-2 failure never reached 'Prepare WF2 Failure Status' →
// 'Persist WF2 Failure Status' and the incident never became FIX_FAILED
// (proven by R22-E2O-R3 execution 1952). The 57 pre-existing envelopes are
// already wired to persistence by the base workflow; here we complete the
// same, single, generic edge for the R22-E ones. The envelope payload
// ({correlationEnvelope, executionId, failedNode, failureCode,
// failureSummary}) is exactly what 'Prepare WF2 Failure Status' consumes.
// 'Prepare WF2 Failure Status' → 'Persist WF2 Failure Status' already
// exists; neither has an error output, so no cycle and no double persist.
const r22eFailureEnvelopeSources = [
  ...codeAndHttpNodesNeedingEnvelopes.map(n => n.name),
  'Transport Requires Read Back? (Pass 2)',
  'Remote Candidate Present? (Pass 2)',
];
for (const failedNodeName of r22eFailureEnvelopeSources) {
  setMain(`Failure Envelope - ${failedNodeName}`, ['Prepare WF2 Failure Status']);
}

// ---------------------------------------------------------------------
// R22-E2B Phases 1-3 — make this an independent, inactive, non-colliding
// TEST workflow. This is the ONLY place the production identity
// (id/name/active/webhook) is touched, and only in THIS generated
// artifact's in-memory object -- the live export loaded above is never
// written back anywhere.
// ---------------------------------------------------------------------
const PRODUCTION_WORKFLOW_ID = '9adcV31eaIgJyMR0';
const PRODUCTION_WEBHOOK_PATH = 'wf2-approve';
// R22-E2H — the Webhook node is copied verbatim from the live export
// (only `parameters.path` was previously rewritten below), so its
// `webhookId` GUID silently stayed identical to production's. That GUID
// is inert for static-path routing today (n8n's webhookId-keyed lookup
// only applies to parameterized `:id`-style paths, confirmed by reading
// active-workflow-manager.js), but two workflows sharing one node-level
// identity is still a latent hazard worth removing on principle -- not
// claimed as the R22-E2F-RO stale-registration root cause (that was
// proven separately: unpublish:workflow never calls clearWebhooks).
const PRODUCTION_WEBHOOK_ID = '6155a0ff-9dea-4479-a1c8-96c827797354';
const TEST_WORKFLOW_NAME = 'WF2 - Git Patch & PR R22E TEST';
const TEST_WEBHOOK_PATH = 'wf2-r22e-test';

// R22-E2Q — always drop the source workflow id, not only the production
// one: the canonical generator input is the R19.3E trusted-source artifact
// (id e96d6ee1-…, "MUST NOT be activated"), so a `=== PRODUCTION_WORKFLOW_ID`
// check let that id ride through into the portable TEST artifact. The
// portable artifact must carry NO id (n8n assigns a fresh non-colliding one
// on import; an existing-id upsert supplies u3eeMwTuhCsetfcS at import time).
delete workflow.id;
workflow.name = TEST_WORKFLOW_NAME;
workflow.active = false;

const webhookNode = assertNode('Webhook');
if (webhookNode.parameters.path === PRODUCTION_WEBHOOK_PATH) webhookNode.parameters.path = TEST_WEBHOOK_PATH;
if (webhookNode.webhookId === PRODUCTION_WEBHOOK_ID) webhookNode.webhookId = crypto.randomUUID();

// Defense in depth: refuse to write an artifact that still carries the
// production identity/settings, even if a future edit to this script
// accidentally reintroduces one of them above.
const guardFailures = [];
if (workflow.id !== undefined) guardFailures.push(`workflow.id is ${JSON.stringify(workflow.id)}, portable TEST artifact must carry no id`);
if (workflow.active !== false) guardFailures.push(`workflow.active is ${JSON.stringify(workflow.active)}, must be false`);
if (workflow.name !== TEST_WORKFLOW_NAME) guardFailures.push(`workflow.name is ${JSON.stringify(workflow.name)}, must be ${JSON.stringify(TEST_WORKFLOW_NAME)}`);
if (assertNode('Webhook').parameters.path !== TEST_WEBHOOK_PATH) guardFailures.push(`Webhook path is not ${JSON.stringify(TEST_WEBHOOK_PATH)}`);
if (workflow.nodes.some(n => n.name === 'Webhook' && n.parameters.path === PRODUCTION_WEBHOOK_PATH)) guardFailures.push('a node still exposes the production webhook path');
if (assertNode('Webhook').webhookId === PRODUCTION_WEBHOOK_ID) guardFailures.push('Webhook node still carries the production webhookId');
if (guardFailures.length) {
  throw new Error('R22-E2B safety guard refused to write an unsafe artifact:\n' + guardFailures.join('\n'));
}

// ---------------------------------------------------------------------
// R22-E2Q-SCOPE-CLEANUP — diff hygiene against the accepted baseline.
//
// The canonical two-pass input (the R19.3E trusted-source artifact) has
// since been re-opened/re-exported by the n8n editor, which materialises
// n8n's own implicit parameter defaults (`mode:"runOnceForAllItems"`,
// `method:"GET"`, `operation:"create"`) as explicit keys on many
// pre-existing nodes. The previously reviewed & committed TEST artifact
// predates that and carries those keys only inconsistently, so a fresh
// regeneration otherwise shows ~47 "default became explicit" changes on
// nodes that are NOT part of this change.
//
// To keep the reviewable diff to exactly the authorised R22-E2Q delta,
// restore each unchanged node's `parameters` from the accepted baseline
// artifact. This is representational only — n8n applies the identical
// default whether the key is present or not, so runtime behaviour is
// unaffected — and it is generator-driven and deterministic, not a hand
// edit of the output. Only nodes OUTSIDE the authorised R22-E2Q set are
// reconciled; the 4 changed nodes and 6 new nodes keep the generator's
// definition. Connections, ids and positions are the generator's.
const R22EQ_AUTHORISED_NODES = new Set([
  // 4 semantic parameter changes
  'Accumulate Candidate File', 'Assemble Candidate Manifest',
  'Verify Content Hash Before Send', 'Evaluate GitHub Write Reconciliation (Pass 2)',
  // 6 added nodes
  'Hash Candidate File Content', 'Prepare Candidate Manifest', 'Hash Candidate Manifest',
  'Recompute Content Hash Before Send', 'Decode Reconciled Remote Content', 'Hash Reconciled Remote Content',
]);
const baselineArtifactPath = new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R22E-TWO-PASS-CANDIDATE.baseline.json', import.meta.url);
if (fs.existsSync(baselineArtifactPath)) {
  const baseline = JSON.parse(fs.readFileSync(baselineArtifactPath));
  const baselineWorkflow = Array.isArray(baseline) ? baseline[0] : baseline;
  const baselineParamsByName = new Map(baselineWorkflow.nodes.map(n => [n.name, n.parameters]));
  let reconciled = 0;
  for (const generatedNode of workflow.nodes) {
    if (R22EQ_AUTHORISED_NODES.has(generatedNode.name)) continue;
    const baselineParams = baselineParamsByName.get(generatedNode.name);
    if (baselineParams === undefined) continue;
    if (JSON.stringify(baselineParams) !== JSON.stringify(generatedNode.parameters)) {
      generatedNode.parameters = JSON.parse(JSON.stringify(baselineParams));
      reconciled += 1;
    }
  }
  console.log(`R22-E2Q-SCOPE-CLEANUP: reconciled ${reconciled} unchanged node(s) to the accepted baseline representation (n8n implicit-default / re-export materialisation differences; no logic change)`);
} else {
  console.warn(`R22-E2Q-SCOPE-CLEANUP: baseline artifact not found at ${baselineArtifactPath.pathname} -- skipping diff reconciliation (regeneration will show n8n-default-key drift on unchanged nodes; not a behaviour change)`);
}

fs.writeFileSync(outputPath, JSON.stringify([workflow], null, 2) + '\n');
console.log('Wrote', outputPath.pathname, '(test workflow, inactive, non-colliding id)');
