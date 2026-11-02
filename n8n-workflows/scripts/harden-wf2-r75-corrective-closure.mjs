// Encadre la clôture des tentatives correctives.
import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R74-CORRECTIVE-ISSUE-CANONICALIZATION.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CLOSURE.json', import.meta.url);

/** Encadre la clôture des tentatives correctives. */
export function hardenCorrectiveClosure(workflow) {
  /** Retrouve ou construit le nœud du workflow demandé. */
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R75_NODE_NOT_FOUND:' + name);
    return found;
  };
  /** Signale une erreur pour replace. */
  const replace = (name, before, after) => {
    const target = node(name);
    if (!target.parameters.jsCode.includes(before)) throw new Error('R75_ANCHOR_NOT_FOUND:' + name);
    target.parameters.jsCode = target.parameters.jsCode.replace(before, after);
  };

  // One canonical issue is one active remediation unit. Historical findings
  // remain immutable lineage and never determine corrective cardinality.
  replace('Prepare Generic Remediation Plan',
    "provenance:{source:'correctiveContext.blockingCauses',index,batchId:ctx.batchId}",
    "provenance:{source:'correctiveContext.blockingCauses',index,batchId:ctx.batchId,previousValidatedSha:String(correctiveContext?.previousValidatedSha||''),blockingCause:cause,historicalFindingIds:[...new Set([...(correctiveContext?.originalFindingResults||[]).map(result=>String(result?.findingId||'')).filter(Boolean),...findings.map(f=>String(f.findingId||f.id||f.key||'')).filter(Boolean)])].sort(),historicalScannerEvidence:findings.map(f=>({findingId:String(f.findingId||f.id||f.key||''),scannerEvidence:f.evidence||f.scannerEvidence||f}))}"
  );
  replace('Prepare Generic Remediation Plan',
    "when correctiveIssues[] is grounded, act on it directly.':'';",
    "when correctiveIssues[] is grounded, act on it directly. (13) Corrective cardinality is exactly one plan per contract.correctiveIssues[] entry. Copy that issue\\'s candidateId into plan.findingId. historicalFindings[] may be many-to-one lineage and MUST NOT cause duplicate plans.':'';"
  );

  replace('Validate Generic Remediation Plan',
    "const plans=Array.isArray(parsed)?parsed:(Array.isArray(parsed.plans)?parsed.plans:[]);const expected=[...new Set(prepared.findingIds.map(String))].sort();\nconst ids=[...new Set(plans.map(p=>String(p.findingId||'')))].sort();if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('REMEDIATION_PLAN_INCOMPLETE');",
    "const plans=Array.isArray(parsed)?parsed:(Array.isArray(parsed.plans)?parsed.plans:[]);\nconst correctiveMode=prepared.correctiveAttempt===true;\nconst correctiveIssues=correctiveMode&&Array.isArray(prepared.remediationContract?.correctiveIssues)?prepared.remediationContract.correctiveIssues:[];\nconst expected=[...new Set((correctiveMode?correctiveIssues.map(issue=>issue?.candidateId):prepared.findingIds).map(String).filter(Boolean))].sort();\nconst ids=[...new Set(plans.map(p=>String(p.findingId||'')).filter(Boolean))].sort();\nif(!expected.length||plans.length!==expected.length||ids.length!==plans.length||JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('REMEDIATION_PLAN_INCOMPLETE');\nconst issueById=new Map(correctiveIssues.map(issue=>[String(issue.candidateId||''),issue]));\nconst historicalFindingIds=[...new Set((correctiveMode?correctiveIssues.flatMap(issue=>issue?.provenance?.historicalFindingIds||[]):prepared.findingIds).map(String).filter(Boolean))].sort();\nif(correctiveMode&&(!historicalFindingIds.length||historicalFindingIds.some(id=>!prepared.findingIds.map(String).includes(id))))throw new Error('CORRECTIVE_LINEAGE_MISMATCH');"
  );
  replace('Validate Generic Remediation Plan',
    "return {...plan,findingId:String(plan.findingId),target:{file:target,line:Number(plan.target?.line)||null}",
    "const issue=correctiveMode?issueById.get(String(plan.findingId)):null;return {...plan,findingId:String(plan.findingId),activeDefectId:String(plan.findingId),historicalFindingIds:correctiveMode?[...(issue?.provenance?.historicalFindingIds||[])].map(String).sort():[String(plan.findingId)],correctiveIssue:issue||undefined,target:{file:target,line:Number(plan.target?.line)||null}"
  );
  replace('Validate Generic Remediation Plan',
    "return [...fileMap.values()].map(file=>({json:{...prepared,remediationPlans:normalized,plannedFiles:[...fileMap.values()],target_file_path:file.path,fileOperation:file.operation}}));",
    "return [...fileMap.values()].map(file=>({json:{...prepared,activeRemediationIds:expected,historicalFindingIds,remediationPlans:normalized,plannedFiles:[...fileMap.values()],target_file_path:file.path,fileOperation:file.operation}}));"
  );

  replace('Prepare - Code Patch Body',
    "const approvedFindingIds=[...new Set(plans.map(p=>p.findingId))].sort();const completePlan={sourceApiContext,sourceGrounding,relationshipOperations:plans.flatMap(plan=>plan.relationshipOperations||[]),batchId:gate.batchId,file:{path:fileName,operation,originalContent:sourceContent},plans,allPlannedFiles:plannedInput.plannedFiles,globalForbidden:",
    "const approvedFindingIds=[...new Set(plans.map(p=>p.findingId))].sort();const completePlan={sourceApiContext,sourceGrounding,relationshipOperations:plans.flatMap(plan=>plan.relationshipOperations||[]),batchId:gate.batchId,activeRemediationIds:plannedInput.activeRemediationIds||approvedFindingIds,historicalFindingIds:plannedInput.historicalFindingIds||[],correctiveIssues:plannedInput.remediationContract?.correctiveIssues||[],historicalFindings:plannedInput.remediationContract?.historicalFindings||[],file:{path:fileName,operation,originalContent:sourceContent},plans,allPlannedFiles:plannedInput.plannedFiles,globalForbidden:"
  );

  replace('Prepare Candidate Manifest',
    "const manifest={candidateId:ctx.batchId+'-attempt-'+String(ctx.attemptCount),requestId:ctx.requestId,batchId:ctx.batchId,candidateAttempt:Number(ctx.attemptCount)||0,repository:ctx.repository_owner+'/'+ctx.repository_name,candidateBaseSha,branchExists,targetBranchName:ctx.targetBranchName,baseBranch:ctx.baseBranch,files};",
    "const activeRemediationIds=validatedPlan[0]?.activeRemediationIds||[...new Set(validatedPlan.flatMap(item=>(item.remediationPlans||[]).map(plan=>String(plan.findingId))))].sort();const historicalFindingIds=validatedPlan[0]?.historicalFindingIds||[...new Set(ctx.findingIds||[])].map(String).sort();const manifest={candidateId:ctx.batchId+'-attempt-'+String(ctx.attemptCount),requestId:ctx.requestId,batchId:ctx.batchId,candidateAttempt:Number(ctx.attemptCount)||0,repository:ctx.repository_owner+'/'+ctx.repository_name,candidateBaseSha,branchExists,targetBranchName:ctx.targetBranchName,baseBranch:ctx.baseBranch,activeRemediationIds,historicalFindingIds,correctiveIssues:validatedPlan[0]?.remediationContract?.correctiveIssues||[],historicalFindings:validatedPlan[0]?.remediationContract?.historicalFindings||[],files};"
  );
  replace('Prepare Candidate Manifest',
    "originalFindings: prepared.remediationContract?.findings || [],",
    "originalFindings: prepared.remediationContract?.findings || [],\n  correctiveIssues: prepared.remediationContract?.correctiveIssues || [],\n  historicalFindings: prepared.remediationContract?.historicalFindings || [],"
  );

  replace('Validate Batch Completeness',
    "const expectedFindingIds=norm(ctx.findingIds);\nconst expectedFiles=norm(planned.map(f=>f.path));",
    "const expectedFindingIds=norm(manifest.activeRemediationIds||planned.flatMap(file=>file.approvedFindingIds||[]));\nconst historicalFindingIds=norm(manifest.historicalFindingIds||ctx.findingIds);\nconst contextHistoricalFindingIds=norm(ctx.findingIds);\nif(!expectedFindingIds.length||JSON.stringify(historicalFindingIds)!==JSON.stringify(contextHistoricalFindingIds))throw new Error('CORRECTIVE_LINEAGE_MISMATCH');\nconst expectedFiles=norm(planned.map(f=>f.path));"
  );
  replace('Validate Batch Completeness',
    "return [{json:{completenessPassed:true,candidateDecision:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',scannerResolution:'UNKNOWN_UNTIL_WF3',expectedFindingIds,expectedTargetFiles:expectedFiles,processedFindingIds:acceptedFindingIds,candidateAcceptedFindingIds:acceptedFindingIds,candidateVerifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results,candidateDigest:manifest.candidateDigest}}];",
    "return [{json:{completenessPassed:true,candidateDecision:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',scannerResolution:'UNKNOWN_UNTIL_WF3',expectedFindingIds:historicalFindingIds,activeRemediationIds:expectedFindingIds,validatedRemediationIds:acceptedFindingIds,historicalFindingIds,expectedTargetFiles:expectedFiles,processedFindingIds:historicalFindingIds,candidateAcceptedFindingIds:historicalFindingIds,candidateVerifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results,candidateDigest:manifest.candidateDigest}}];"
  );

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenCorrectiveClosure(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R75 corrective closure written to', outputPath.pathname);
}
