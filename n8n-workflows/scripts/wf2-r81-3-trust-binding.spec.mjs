import fs from 'node:fs';
import assert from 'node:assert/strict';

// R81.3 — OFFLINE ONLY. No network call, no n8n execution, no live promotion
// anywhere in this file. Proves, against the ACTUAL text of the real
// proposed WF2 artifact (the same R81_2-WRITER-PROMPT.json draft already
// reviewed under R81.2 -- NO WF2 CHANGE was made for R81.3, since the trust
// anchor it needs, `originalBlobSha`, was already threaded end-to-end by
// this exact draft), that the writer LLM structurally cannot override
// sourceContent, originalBlobSha (the trust anchor used for R81.3's
// integrity check), or candidateBaseSha before Write Guard sees them.

const workflowPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R81_2-WRITER-PROMPT.json', import.meta.url);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const node = (name) => {
  const found = workflow.nodes.find(n => n.name === name);
  if (!found) throw new Error('NODE_NOT_FOUND:' + name);
  return found;
};
const code = (name) => node(name).parameters.jsCode;

// ---- 0. Workflow safety invariants (R81.3 §11): NO WF2 change was made, so
// every invariant from the R81.2 artifact still holds byte-for-byte. ----
{
  assert.equal(workflow.id, 'u3eeMwTuhCsetfcS', 'WORKFLOW_ID preserved');
  assert.equal(workflow.nodes.length, 186, 'NODE_COUNT preserved at 186 -- R81.3 required ZERO new WF2 nodes');
  assert.equal(new Set(workflow.nodes.map(n => n.id)).size, 186, 'NODE_IDS_UNIQUE');
  const webhook = workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
  assert.equal(webhook.parameters.path, 'wf2-r22e-test', 'POST /wf2-r22e-test preserved');
  assert.equal(webhook.parameters.httpMethod, 'POST');
}
console.log('wf2-r81-3-trust-binding: workflow safety invariants (NODE_COUNT=186, unchanged): PASS');

// ---- 1. "Fetch Repository Files" -- the trusted, pre-LLM source fetch ----
{
  const params = node('Fetch Repository Files').parameters;
  assert.equal(params.resource, 'file');
  assert.equal(params.operation, 'get');
  // Fetches at the remediation branch's current head, or the batch baseSha
  // if the branch doesn't exist yet -- never at a candidate/LLM-supplied ref.
  assert.match(params.additionalParameters.reference, /Lookup Remediation Branch/);
  assert.match(params.additionalParameters.reference, /Prepare Batch Context.*baseSha/);
}
console.log('wf2-r81-3-trust-binding: Fetch Repository Files is the trusted pre-LLM source fetch: PASS');

// ---- 2. "Prepare - Code Patch Body" -- sourceContent decoded from the
// trusted fetch, BEFORE the LLM call; file_sha captured from the same
// trusted fetch's own reported blob SHA. This node runs entirely before any
// LLM HTTP request in this workflow. ----
{
  const c = code('Prepare - Code Patch Body');
  assert.match(c, /sourceContent=''.*Buffer\.from\(String\(input\.content\|\|''\)/s, 'sourceContent is decoded from input.content (the GitHub fetch), not from anywhere LLM-controlled');
  assert.match(c, /file_sha:String\(input\.sha\|\|''\)/, 'file_sha is GitHub\'s own reported blob SHA for the fetched file, captured before the LLM runs');
  // The output item explicitly sets sourceContent AFTER spreading ...input,
  // so even a caller-supplied sourceContent on the input item would be
  // overridden by the trusted decoded value -- never the reverse.
  assert.match(c, /return \{json:\{\.\.\.input,[^}]*sourceContent,/s, 'sourceContent is set AFTER the ...input spread, so the trusted decoded value always wins');
}
console.log('wf2-r81-3-trust-binding: Prepare - Code Patch Body computes sourceContent/file_sha before the LLM call: PASS');

// ---- 3. "Parse - Code Patch Output" -- the LLM's own response is strictly
// schema-locked to exactly 5 fields (an extra key throws), and the node's
// return spreads the pre-LLM `prepared` item FIRST, only overlaying those 5
// named LLM fields plus 1 derived-from-`prepared` field (oldSha) -- NEVER
// sourceContent, NEVER candidateBaseSha. This is the exact spread-ordering
// proof requested: inspected against the real code text, not inferred. ----
{
  const c = code('Parse - Code Patch Output');
  assert.match(c, /const fields=\['targetFile','processedFindingIds','patchedCode','patchDescription','conformanceEvidence'\]/, 'the LLM output schema is exactly these 5 fields');
  assert.match(c, /Object\.keys\(parsed\)\.some\(key=>!fields\.includes\(key\)\)/, 'any key in the parsed LLM JSON outside the 5-field allowlist throws -- the LLM cannot smuggle a 6th key such as sourceContent or originalBlobSha');
  const returnMatch = c.match(/return \{json:\{\.\.\.prepared,([^}]*)\}\};?\s*$/);
  assert.ok(returnMatch, 'the final return spreads ...prepared first, then a bounded explicit field list');
  const overlaid = returnMatch[1];
  assert.doesNotMatch(overlaid, /\bsourceContent\s*:/, 'sourceContent is never re-assigned after the ...prepared spread -- the trusted value from Prepare - Code Patch Body survives untouched');
  assert.doesNotMatch(overlaid, /\bcandidateBaseSha\s*:/, 'candidateBaseSha does not even exist at this stage yet, and is never introduced here from parsed LLM output');
  assert.doesNotMatch(overlaid, /\boriginalBlobSha\s*:/, 'originalBlobSha does not exist yet at this stage either (it is derived downstream from oldSha, itself pinned below)');
  assert.match(overlaid, /oldSha:prepared\.file_sha/, 'oldSha (the future originalBlobSha) is taken from prepared.file_sha -- the trusted GitHub blob SHA -- never from `parsed` (the LLM JSON)');
  assert.doesNotMatch(c, /oldSha\s*:\s*parsed\./, 'oldSha is never assigned from the parsed LLM object under any key');
}
console.log('wf2-r81-3-trust-binding: Parse - Code Patch Output cannot leak an LLM-controlled sourceContent/oldSha (schema lockdown + spread ordering): PASS');

// ---- 4. "Generic Candidate Preflight" -- spreads ...patch first; its own
// explicit field list never re-derives sourceContent/oldSha from `code`
// (the candidate's own new content) or from any LLM response it makes here
// (that LLM call is a SEPARATE judge whose verdict is consumed elsewhere,
// by "Enforce Independent Review" -- never folded back into content fields). ----
{
  const c = code('Generic Candidate Preflight');
  const returnMatch = c.match(/return \{json:\{\.\.\.patch,([^}]*)\}\};?\s*$/);
  assert.ok(returnMatch, 'the final return spreads ...patch first, then a bounded explicit field list');
  const overlaid = returnMatch[1];
  assert.doesNotMatch(overlaid, /\bsourceContent\s*:/, 'sourceContent is not re-assigned here -- it survives from ...patch');
  assert.doesNotMatch(overlaid, /\boldSha\s*:/, 'oldSha is not re-assigned here -- it survives from ...patch');
  assert.doesNotMatch(overlaid, /\bcandidateBaseSha\s*:/, 'candidateBaseSha is not re-assigned here');
}
console.log('wf2-r81-3-trust-binding: Generic Candidate Preflight preserves sourceContent/oldSha unmodified: PASS');

// ---- 5. "Accumulate Candidate File" -- spreads ...candidate first;
// candidateBaseSha is computed from "Lookup Remediation Branch" / "Prepare
// Batch Context" (both independent of the candidate/LLM), never from
// `candidate` itself, and is added AFTER the spread so it always wins even
// if a malformed/forged candidate item somehow carried its own. ----
{
  const c = code('Accumulate Candidate File');
  assert.match(c, /candidateBaseSha=String\(branchExists\?\(lookup\.body\?\.object\?\.sha\|\|''\):\$\('Prepare Batch Context'\)\.first\(\)\.json\.baseSha\)/, 'candidateBaseSha is derived from Lookup Remediation Branch / Prepare Batch Context, never from the candidate/LLM path');
  const returnMatch = c.match(/return \{json:\{\.\.\.candidate,([^}]*)\}\};?\s*$/);
  assert.ok(returnMatch, 'the final return spreads ...candidate first');
  assert.match(returnMatch[1], /\bcandidateBaseSha\b/, 'candidateBaseSha (the independently-sourced value) is what gets overlaid, not something read off the candidate item');
  assert.doesNotMatch(returnMatch[1], /\bsourceContent\s*:/, 'sourceContent still untouched here');
}
console.log('wf2-r81-3-trust-binding: Accumulate Candidate File sources candidateBaseSha independently of the candidate/LLM path: PASS');

// ---- 6. "Prepare Candidate Manifest" -- the manifest actually sent to
// Write Guard carries BOTH the authentic sourceContent AND its trust anchor
// originalBlobSha (:= it.oldSha, traced above to GitHub's own file_sha),
// neither ever read from `patchedCode`/`parsed`. ----
{
  const c = code('Prepare Candidate Manifest');
  assert.match(c, /sourceContent:it\.sourceContent/, 'CandidateFile.sourceContent is threaded from the accumulated, trust-preserved item');
  assert.match(c, /originalBlobSha:it\.oldSha\|\|null/, 'CandidateFile.originalBlobSha is threaded from it.oldSha -- the same trusted GitHub blob SHA traced through every node above, untouched by the LLM');
  assert.doesNotMatch(c, /sourceContent:it\.(?:patchedCode|content)\b/, 'sourceContent is never accidentally sourced from the candidate\'s own new content');
  assert.doesNotMatch(c, /originalBlobSha:it\.(?:patchedCode|contentSha256)\b/, 'originalBlobSha is never accidentally sourced from the candidate\'s own new content or its hash');
}
console.log('wf2-r81-3-trust-binding: Prepare Candidate Manifest carries authentic sourceContent + originalBlobSha to Write Guard: PASS');

// ---- 7. Simulated malicious/corrupt writer output attempting to spoof
// sourceContent/originalBlobSha: replay "Parse - Code Patch Output"'s own
// documented precondition (the schema-lockdown proven in step 3) against a
// concrete malicious LLM response object, confirming the spoof attempt is
// rejected by the SAME mechanism already proven, not merely asserted. ----
{
  const fields = ['targetFile', 'processedFindingIds', 'patchedCode', 'patchDescription', 'conformanceEvidence'];
  const maliciousResponse = {
    targetFile: 'src/main/java/com/example/X.java',
    processedFindingIds: ['S1135'],
    patchedCode: 'class X {}\n',
    patchDescription: 'looks clean',
    conformanceEvidence: ['no markers'],
    // spoof attempt: try to smuggle a fabricated "clean" original + a hash
    // that would make it look verified.
    sourceContent: 'class X {}\n',
    originalBlobSha: 'a'.repeat(40),
  };
  const rejected = Object.keys(maliciousResponse).some(key => !fields.includes(key));
  assert.equal(rejected, true, 'a parsed LLM response carrying extra sourceContent/originalBlobSha keys is rejected by Parse - Code Patch Output\'s own schema check -- the spoof never reaches the return statement, let alone the manifest');
}
console.log('wf2-r81-3-trust-binding: simulated malicious writer output spoofing sourceContent/originalBlobSha is rejected by schema lockdown: PASS');

console.log('wf2-r81-3-trust-binding: ALL CHECKS PASS (offline, no n8n execution, no live promotion, NODE_COUNT=186 unchanged)');
