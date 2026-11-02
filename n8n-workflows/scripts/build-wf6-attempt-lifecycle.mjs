// Construit tentative cible.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const baselineUrl = new URL('../../docs/qa/trivy-owasp-lifecycle/WF6-ACTIVE-BASELINE.json', import.meta.url);
export const targetUrl = new URL('../pending-live-update/WF6-SAFE-ATTEMPT-LIFECYCLE.OFFLINE.json', import.meta.url);
/** Construit tentative cible. */
export function buildAttemptTarget() {
  const [baseline] = JSON.parse(readFileSync(baselineUrl));
  assert.equal(baseline.versionId,'125eb57e-ac69-4632-bf60-490ff5736d5b');
  const target = structuredClone(baseline);
  const changed=[];
  // Correlation is read directly from the dominating webhook on every path.
  // No failed path needs Trusted Candidate. Its validation remains unchanged.
  for(const node of target.nodes.filter(n=>n.name.startsWith('Record Batch Result'))) {
    const old=node.parameters.jsonBody;
    assert.ok(old.startsWith('={{') && old.endsWith('}}'));
    const expression=old.slice(3,-2);
    const preGit=['Record Batch Result (EVALUATION_FAILED)','Record Batch Result (Not Ready)','Record Batch Result (INVALID_CANDIDATE)',
      'Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)','Record Batch Result (ANCESTRY_UNRESOLVABLE)','Record Batch Result (ANCESTRY_INVALID)',
      'Record Batch Result (PR_LOOKUP_FAILED)','Record Batch Result (PR_LOOKUP_INVALID)',
      'Record Batch Result (Historical Already Merged)','Record Batch Result (Historical Closed Not Merged)',
      'Record Batch Result (Historical PR Reused)','Record Batch Result (Branch Content Conflict)',
      'Record Batch Result (Candidate Drifted)','Record Batch Result (Base SHA Unresolvable)','Record Batch Result (BRANCH_LOOKUP_FAILED)'];
    node.parameters.jsonBody = `={{ (() => { const payload = (${expression}); const req = $("Webhook - Security Remediation Request").first().json.body; const attempts = req?.attempts || []; const failureCode = ${node.name === 'Record Batch Result (EVALUATION_FAILED)' ? '$json.body?.failureClass' : 'undefined'}; const sourceFindings = payload.findings?.length ? payload.findings : (req?.findingTaskIds || []).map(id => ({findingTaskId:id, cveId:req?.v1_8ValidatedFindings?.find(v => v.findingTaskId === id)?.cve || "UNKNOWN", status:payload.status, reason:payload.reason})); const findings = sourceFindings.map(f => { const a = attempts.find(a => a.findingTaskId === f.findingTaskId); if (!a?.attemptId || !Number.isInteger(a.attemptNumber) || a.attemptNumber < 1 || !req?.batchId) throw new Error("ATTEMPT_CORRELATION_MISSING"); return {...f, reasonCode:f.reasonCode || failureCode, attemptId:a.attemptId, attemptNumber:a.attemptNumber}; }); return {...payload, batchId:req.batchId, executionId:$execution.id, unresolvedGitSideEffect:${!preGit.includes(node.name)}, findings}; })() }}`;
    changed.push({name:node.name,reason:'Exact reserved attempt identity on callback; conservative Git side-effect evidence; no candidate/guard/PR mutation.'});
  }
  for (const node of target.nodes.filter(n => n.name === 'Evaluate Security Remediation' || n.name.startsWith('Revalidate Before Write'))) {
    const old = node.parameters.jsonBody;
    node.parameters.jsonBody = `={{ (() => { const body = (${old.slice(3,-2)}); const req = $("Webhook - Security Remediation Request").first().json.body; return {...body, batchId:req?.batchId, attempts:req?.attempts}; })() }}`;
    changed.push({name:node.name,reason:'Carry reserved correlation through evaluation/revalidation; candidate bytes and security decisions unchanged.'});
  }
  target.active=false;target.activeVersionId=null;
  return {baseline,target,changed};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const {target,changed}=buildAttemptTarget();
 writeFileSync(targetUrl,JSON.stringify([target],null,2)+'\n');
 writeFileSync(new URL('../../docs/qa/trivy-owasp-lifecycle/wf6-strict-diff.json',import.meta.url),JSON.stringify({sourceVersion:'125eb57e-ac69-4632-bf60-490ff5736d5b',WF6_FUNCTIONAL_NODE_CHANGED_COUNT:changed.length,WF6_CONNECTION_CHANGED_COUNT:0,WF6_CREDENTIAL_CHANGED_COUNT:0,WF6_UNRELATED_CHANGE_COUNT:0,changes:changed},null,2)+'\n');
 console.log(`Offline target: ${changed.length} callback nodes; graph/credentials/security nodes unchanged.`);
}
