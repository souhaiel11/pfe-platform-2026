// Vérifie le nombre de findings transmis à la correction.
import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R74-CORRECTIVE-ISSUE-CANONICALIZATION.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CARDINALITY-INVARIANT.json', import.meta.url);

/** Vérifie le nombre de findings transmis à la correction. */
export function hardenCorrectiveCardinalityInvariant(workflow) {
  /** Retrouve ou construit le nœud du workflow demandé. */
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R75_NODE_NOT_FOUND:' + name);
    return found;
  };

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

  const validateBatch = node('Validate Batch Completeness');
  {
    const before = validateBatch.parameters.jsCode;
    const anchor = "const expectedFindingIds=norm(ctx.findingIds);";
    if (!before.includes(anchor)) throw new Error('R75_VALIDATE_BATCH_SHAPE_CHANGED');
    const replacement = "const correctiveBlockingCauses=ctx.correctiveAttempt===true&&Array.isArray(ctx.correctiveContext?.blockingCauses)?ctx.correctiveContext.blockingCauses:[];const isCanonicalCorrectiveBatch=correctiveBlockingCauses.length>0;const expectedFindingIds=isCanonicalCorrectiveBatch?norm(correctiveBlockingCauses.map((cause,index)=>cause&&cause.findingId?String(cause.findingId):ctx.batchId+':issue-'+index)):norm(ctx.findingIds);";
    validateBatch.parameters.jsCode = before.replace(anchor, replacement);
    if (validateBatch.parameters.jsCode === before) throw new Error('R75_VALIDATE_BATCH_NOT_MODIFIED');
  }

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
