import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R74-CORRECTIVE-ISSUE-CANONICALIZATION.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CARDINALITY-INVARIANT.json', import.meta.url);

export function hardenCorrectiveCardinalityInvariant(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R75_NODE_NOT_FOUND:' + name);
    return found;
  };

  // Execution 2035 (attempt 10) proved R71/R72/R73/R74 all working end to
  // end: correct source SHA, full planner budget, grounded target
  // (TaskDTO.java), and a stable canonical correctiveIssue -- yet still
  // failed with REMEDIATION_PLAN_INCOMPLETE. Root cause: R74 made
  // correctiveIssues[] (1 item here) the planner's primary identity, so the
  // model correctly emitted ONE plan keyed by the issue's candidateId
  // ("<batchId>:issue-0") -- but this validator's schema/cardinality check
  // still compared plan ids against `prepared.findingIds`, the 2 HISTORICAL
  // Sonar finding ids. 2 historical findings -> 1 proven corrective issue is
  // the expected, correct outcome now (R74's whole point); requiring 2
  // duplicate plans for the same grounded fix would require exactly the
  // conflation R74 removed.
  //
  // IMPORTANT REFINEMENT (caught by the existing workflow-attempt-identity
  // backend test, not invented speculatively): an older corrective blocking
  // cause shape (TARGET_FINDING_INVALID, pre-dating the generic
  // DEFAULT_VALUE_SEMANTICS_DEFECT grounding introduced later) already
  // carries its OWN explicit `findingId` -- a real, direct 1:1 correspondence
  // to a still-invalid historical finding. Synthesizing a candidateId for
  // THAT cause would be a regression: it already has a legitimate identity.
  // The correct, type-agnostic rule (no cause-type name is ever checked) is:
  // prefer the cause's own `findingId` when the cause carries one; only
  // synthesize `batchId:issue-<index>` for a cause that does not. This one
  // rule is applied identically at candidateId-construction time (Prepare
  // Generic Remediation Plan, R74) and at both places that must agree with
  // it (this file's two validator-side changes below) -- one invariant, not
  // three independently-drifting formulas.
  const preparePlan = node('Prepare Generic Remediation Plan');
  {
    const before = preparePlan.parameters.jsCode;
    const anchor = "candidateId:ctx.batchId+':issue-'+index,";
    if (!before.includes(anchor)) throw new Error('R75_PREPARE_PLAN_SHAPE_CHANGED');
    const replacement = "candidateId:cause&&cause.findingId?String(cause.findingId):ctx.batchId+':issue-'+index,";
    preparePlan.parameters.jsCode = before.replace(anchor, replacement);
    if (preparePlan.parameters.jsCode === before) throw new Error('R75_PREPARE_PLAN_NOT_MODIFIED');
  }

  const validatePlan = node('Validate Generic Remediation Plan');
  {
    const before = validatePlan.parameters.jsCode;
    const anchor = "const expected=[...new Set(prepared.findingIds.map(String))].sort();";
    if (!before.includes(anchor)) throw new Error('R75_VALIDATE_PLAN_SHAPE_CHANGED');
    const replacement = "const expected=(prepared.correctiveAttempt===true&&Array.isArray(prepared.remediationContract?.correctiveIssues)&&prepared.remediationContract.correctiveIssues.length)?[...new Set(prepared.remediationContract.correctiveIssues.map(issue=>String(issue.candidateId)))].sort():[...new Set(prepared.findingIds.map(String))].sort();";
    validatePlan.parameters.jsCode = before.replace(anchor, replacement);
    if (validatePlan.parameters.jsCode === before) throw new Error('R75_VALIDATE_PLAN_NOT_MODIFIED');
  }

  // Validate Batch Completeness independently re-derives its own expected
  // finding-id set from ctx.findingIds (post-write, after the file is
  // actually committed) -- the SAME conflation, one stage later. Uses the
  // identical per-cause rule (prefer cause.findingId, else synthesize) from
  // the SAME evidence (ctx.correctiveContext.blockingCauses, available here
  // via the R70 passthrough), so every gate agrees by construction, never as
  // independently-drifting allowlists.
  const validateBatch = node('Validate Batch Completeness');
  {
    const before = validateBatch.parameters.jsCode;
    const anchor = "const expectedFindingIds=norm(ctx.findingIds);";
    if (!before.includes(anchor)) throw new Error('R75_VALIDATE_BATCH_SHAPE_CHANGED');
    const replacement = "const correctiveBlockingCauses=ctx.correctiveAttempt===true&&Array.isArray(ctx.correctiveContext?.blockingCauses)?ctx.correctiveContext.blockingCauses:[];const isCanonicalCorrectiveBatch=correctiveBlockingCauses.length>0;const expectedFindingIds=isCanonicalCorrectiveBatch?norm(correctiveBlockingCauses.map((cause,index)=>cause&&cause.findingId?String(cause.findingId):ctx.batchId+':issue-'+index)):norm(ctx.findingIds);";
    validateBatch.parameters.jsCode = before.replace(anchor, replacement);
    if (validateBatch.parameters.jsCode === before) throw new Error('R75_VALIDATE_BATCH_NOT_MODIFIED');
  }

  // Prepare Candidate Manifest builds the independent semantic reviewer's
  // request context and reads `prepared.remediationContract.findings` for
  // `originalFindings` -- exactly the field R74 removed from corrective mode
  // (replaced there by correctiveIssues + historicalFindings). Left
  // unfixed, a corrective candidate's semantic review would silently lose
  // all scanner-finding context (originalFindings === []) while every other
  // context field still worked -- a quiet quality regression, not a thrown
  // error, so nothing would have caught it before this audit. Falling back
  // to historicalFindings restores the exact same lineage data under its
  // new corrective-mode name; normal mode (where `findings` is still
  // present) is byte-identical to before.
  const prepareManifest = node('Prepare Candidate Manifest');
  {
    const before = prepareManifest.parameters.jsCode;
    const anchor = 'originalFindings: prepared.remediationContract?.findings || [],';
    if (!before.includes(anchor)) throw new Error('R75_PREPARE_MANIFEST_SHAPE_CHANGED');
    const replacement = 'originalFindings: prepared.remediationContract?.findings || prepared.remediationContract?.historicalFindings || [],';
    prepareManifest.parameters.jsCode = before.replace(anchor, replacement);
    if (prepareManifest.parameters.jsCode === before) throw new Error('R75_PREPARE_MANIFEST_NOT_MODIFIED');
  }

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenCorrectiveCardinalityInvariant(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R75 corrective cardinality invariant written to', outputPath.pathname);
}
