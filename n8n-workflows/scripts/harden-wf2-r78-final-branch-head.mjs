import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R77-CORRECTIVE-PLAN-CANONICALIZATION.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R78-FINAL-BRANCH-HEAD.json', import.meta.url);

export function hardenFinalBranchHead(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R78_NODE_NOT_FOUND:' + name);
    return found;
  };

  // Execution 2038 (attempt 13, the first real R77 success) proved a second,
  // independent defect: `Save Execution Result to Backend` sourced
  // fixRequest.prHeadSha from the PR object returned by the post-write
  // `Lookup Existing Batch PR` GitHub search/list call ($json.head.sha).
  // That endpoint is a secondary index that can lag a live `git push` by a
  // few seconds -- in 2038 it returned the FIRST of two sequential commits
  // (53cbd28d...) even though the branch/PR's true head was already the
  // SECOND (5ef66be3...), because the search index hadn't caught up yet.
  // `Validate Batch Completeness` already collects every write's commitSha,
  // but only into `commitShas[]`, which is lexicographically SORTED
  // (`norm()` = dedupe + `.sort()`) -- not write-order -- so array position
  // cannot be trusted as "final" either. `Loop Over Manifest Files` is an
  // n8n splitInBatches(batchSize:1) loop, which n8n guarantees runs fully
  // sequentially (iteration i completes before i+1 starts), so the node's
  // own `$runIndex` at each pass is a genuine, deterministic write-order
  // sequence number, independent of any later sort or of any external
  // GitHub read. R78 stamps that sequence at write time and derives the
  // batch's true final branch head from it directly -- never from a
  // separately-fetched PR/ref object.
  const buildResult = node('Build File Result (Pass 2)');
  {
    const before = buildResult.parameters.jsCode;
    const anchor = 'contentSha256:candidate.contentSha256}};';
    if (!before.includes(anchor)) throw new Error('R78_BUILD_RESULT_SHAPE_CHANGED');
    const replacement = 'contentSha256:candidate.contentSha256,writeSequence:$runIndex}};';
    buildResult.parameters.jsCode = before.replace(anchor, replacement);
    if (buildResult.parameters.jsCode === before) throw new Error('R78_BUILD_RESULT_NOT_MODIFIED');
  }

  const validateBatch = node('Validate Batch Completeness');
  {
    const before = validateBatch.parameters.jsCode;
    const requiredAnchor = "const required=['targetFile','approvedFindingIds','processedFindingIds','candidateAcceptedFindingIds','validationEvidence','outcome','candidateStateVerified','updateApplied','fileOperation','newSha','commitSha','contentSha256'];";
    if (!before.includes(requiredAnchor)) throw new Error('R78_VALIDATE_BATCH_REQUIRED_SHAPE_CHANGED');
    const requiredReplacement = "const required=['targetFile','approvedFindingIds','processedFindingIds','candidateAcceptedFindingIds','validationEvidence','outcome','candidateStateVerified','updateApplied','fileOperation','newSha','commitSha','contentSha256','writeSequence'];";
    let after = before.replace(requiredAnchor, requiredReplacement);
    if (after === before) throw new Error('R78_VALIDATE_BATCH_REQUIRED_NOT_MODIFIED');

    const returnAnchor = "const results=[...byFile.values()].sort((a,b)=>String(a.targetFile).localeCompare(String(b.targetFile)));";
    if (!after.includes(returnAnchor)) throw new Error('R78_VALIDATE_BATCH_RESULTS_SHAPE_CHANGED');
    // finalBranchHead is derived exclusively from writeSequence -- never from
    // array order, never from any externally-fetched PR/ref object. A tie
    // (two results claiming the same maximum sequence) or a non-integer
    // sequence fails closed rather than guessing.
    const finalHeadLogic = String.raw`const results=[...byFile.values()].sort((a,b)=>String(a.targetFile).localeCompare(String(b.targetFile)));
const writeSequenceOf=r=>Number.isInteger(r.writeSequence)?r.writeSequence:null;
if(results.some(r=>writeSequenceOf(r)===null))throw new Error('WF2_WRITE_SEQUENCE_INVALID:'+JSON.stringify({invalidFiles:results.filter(r=>writeSequenceOf(r)===null).map(r=>r.targetFile)}));
const maxWriteSequence=Math.max(...results.map(writeSequenceOf));
const finalWriters=results.filter(r=>writeSequenceOf(r)===maxWriteSequence);
if(finalWriters.length!==1)throw new Error('WF2_FINAL_BRANCH_HEAD_AMBIGUOUS:'+JSON.stringify({maxWriteSequence,candidates:finalWriters.map(r=>r.targetFile)}));
const finalBranchHead=finalWriters[0].commitSha;
if(!sha(finalBranchHead))throw new Error('WF2_FINAL_BRANCH_HEAD_INVALID:'+JSON.stringify({finalBranchHead}));`;
    after = after.replace(returnAnchor, finalHeadLogic);
    if (after === before) throw new Error('R78_VALIDATE_BATCH_FINAL_HEAD_NOT_INSERTED');

    const returnStatementAnchor = 'candidateVerifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results,candidateDigest:manifest.candidateDigest}}];';
    if (!after.includes(returnStatementAnchor)) throw new Error('R78_VALIDATE_BATCH_RETURN_SHAPE_CHANGED');
    const returnStatementReplacement = 'candidateVerifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),finalBranchHead,fileResults:results,candidateDigest:manifest.candidateDigest}}];';
    after = after.replace(returnStatementAnchor, returnStatementReplacement);
    if (after === before) throw new Error('R78_VALIDATE_BATCH_RETURN_NOT_MODIFIED');

    validateBatch.parameters.jsCode = after;
  }

  const saveResult = node('Save Execution Result to Backend');
  {
    const before = saveResult.parameters.jsonBody;
    const anchor = "prHeadSha: $json.head?.sha || ''";
    if (!before.includes(anchor)) throw new Error('R78_SAVE_RESULT_SHAPE_CHANGED');
    const replacement = "prHeadSha: $('Validate Batch Completeness').first().json.finalBranchHead || ''";
    saveResult.parameters.jsonBody = before.replace(anchor, replacement);
    if (saveResult.parameters.jsonBody === before) throw new Error('R78_SAVE_RESULT_NOT_MODIFIED');
  }

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenFinalBranchHead(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R78 final branch head fix written to', outputPath.pathname);
}
