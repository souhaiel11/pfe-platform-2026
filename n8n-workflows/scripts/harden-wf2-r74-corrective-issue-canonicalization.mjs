import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R73-CORRECTIVE-TARGET-PROPAGATION.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R74-CORRECTIVE-ISSUE-CANONICALIZATION.json', import.meta.url);

export function hardenCorrectiveIssueCanonicalization(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R74_NODE_NOT_FOUND:' + name);
    return found;
  };

  // Attempt 8 (execution 2032) and attempt 9 (execution 2034) received the
  // IDENTICAL blockingCause (candidateType:'TaskDTO', same sourceSha), yet
  // attempt 9's plan cited historicalFindings[].target (TaskController.java
  // lines 34/39, still returning raw Task/List<Task>) as grounds to conclude
  // the blocking cause "does not correspond to this finding" and self-routed
  // to MANUAL_OR_SPECIALIST -- even though correctiveContext.originalFindingResults
  // already proved those two findingIds VALID/absent at this exact SHA. The
  // planner had two structurally-equal-looking sources of "where the problem
  // is" (historicalFindings[].target vs correctiveContext.blockingCauses) with
  // no explicit priority between them. This introduces one canonical,
  // deterministically-grounded `correctiveIssues[]` per blocking cause --
  // reusing exactly the R73 grounding evidence (explicit fields, candidateType
  // tree-resolution, mappingPath content-resolution) -- as the sole primary
  // remediation object in corrective mode, demoting the historical finding
  // list to an explicitly-labeled, non-authoritative `historicalFindings`
  // lineage field. Normal (non-corrective) mode is untouched: `contract.findings`
  // keeps its exact prior shape and remains primary.
  const preparePlan = node('Prepare Generic Remediation Plan');
  {
    const before = preparePlan.parameters.jsCode;

    const contractAnchor = "const correctiveContext=ctx.correctiveAttempt===true&&ctx.correctiveContext?ctx.correctiveContext:null;\nconst contract={schemaVersion:'1.0',batchId:ctx.batchId,repository:{owner:ctx.repository_owner,name:ctx.repository_name,defaultBranch:ctx.default_branch,technology:ctx.projectTechnology||ctx.technology||ctx.repositoryMetadata||{}},findings:findings.map(f=>({findingId:String(f.findingId||f.id||f.key),source:String(f.source||'SONARQUBE'),rule:String(f.rule||f.ruleKey||''),severity:String(f.severity||''),type:String(f.type||''),message:String(f.message||''),target:{file:String(f.file||f.component||''),line:Number(f.line)||null},scannerEvidence:f.evidence||f.scannerEvidence||f})),sourceSnapshots,sourceGrounding,forbiddenChanges:forbidden,...(correctiveContext?{correctiveContext:{previousAttempt:correctiveContext.previousAttempt,previousValidatedSha:correctiveContext.previousValidatedSha,candidateBaseSha:String(ctx.candidateBaseSha||''),originalBaselineSha:String(ctx.originalBaselineSha||ctx.baseSha||''),reasonCodes:correctiveContext.reasonCodes,blockingCauses:correctiveContext.blockingCauses,originalFindingResults:correctiveContext.originalFindingResults}}:{})};\n";
    if (!before.includes(contractAnchor)) throw new Error('R74_CONTRACT_SHAPE_CHANGED');

    const historicalFindingEntries = "findings.map(f=>({findingId:String(f.findingId||f.id||f.key),source:String(f.source||'SONARQUBE'),rule:String(f.rule||f.ruleKey||''),severity:String(f.severity||''),type:String(f.type||''),message:String(f.message||''),target:{file:String(f.file||f.component||''),line:Number(f.line)||null},scannerEvidence:f.evidence||f.scannerEvidence||f}))";

    const contractReplacement = String.raw`const correctiveContext=ctx.correctiveAttempt===true&&ctx.correctiveContext?ctx.correctiveContext:null;
const existingFilesForResolution=ctx.repositoryPolicy?.existingFiles||[];
const simpleTypeName=value=>{const raw=String(value||'').trim();if(!raw)return null;const parts=raw.split('.');return parts[parts.length-1]||null};
const resolveTypeToPath=typeName=>{const simple=simpleTypeName(typeName);if(!simple)return null;const matches=existingFilesForResolution.filter(path=>{const base=path.split('/').pop()||'';const dot=base.lastIndexOf('.');return(dot===-1?base:base.slice(0,dot))===simple});return matches.length===1?matches[0]:null};
const groundCause=cause=>{const explicit=['sourceFile','candidateFile','mappingFile','path'].map(key=>cause&&cause[key]).filter(Boolean).map(String);const typeResolved=resolveTypeToPath(cause&&cause.candidateType);const mappingPath=String(cause?.mappingPath||'');const separatorIndex=mappingPath.indexOf(': ');const snippet=separatorIndex===-1?'':mappingPath.slice(separatorIndex+2).trim();const mappingMatches=snippet?sourceSnapshots.filter(s=>String(s.content||'').includes(snippet)):[];const mappingResolved=mappingMatches.length===1?String(mappingMatches[0].file):null;return [...new Set([...explicit,typeResolved,mappingResolved].filter(Boolean))]};
const correctiveIssues=correctiveContext&&Array.isArray(correctiveContext.blockingCauses)?correctiveContext.blockingCauses.map((cause,index)=>{const groundedTargetFiles=groundCause(cause);const effectiveTargetFiles=[...new Set([...(ctx.repositoryPolicy?.targetFiles||[]),...groundedTargetFiles])];return {type:cause?.type||null,behavioralInvariant:cause?.behavioralInvariant||null,sourceType:cause?.sourceType||null,sourceField:cause?.sourceField||null,sourceDefault:cause?.sourceDefault??null,candidateType:cause?.candidateType||null,candidateField:cause?.candidateField||null,candidateDefault:cause?.candidateDefault??null,mappingPath:cause?.mappingPath||null,groundedTargetFiles,effectiveTargetFiles,evaluatedSha:String(cause?.candidateSha||ctx.candidateBaseSha||''),candidateId:ctx.batchId+':issue-'+index,provenance:{source:'correctiveContext.blockingCauses',index,batchId:ctx.batchId}}}):[];
const historicalFindingEntries=${historicalFindingEntries};
const contract={schemaVersion:'1.0',batchId:ctx.batchId,repository:{owner:ctx.repository_owner,name:ctx.repository_name,defaultBranch:ctx.default_branch,technology:ctx.projectTechnology||ctx.technology||ctx.repositoryMetadata||{}},...(correctiveContext?{correctiveIssues,historicalFindings:historicalFindingEntries}:{findings:historicalFindingEntries}),sourceSnapshots,sourceGrounding,forbiddenChanges:forbidden,...(correctiveContext?{correctiveContext:{previousAttempt:correctiveContext.previousAttempt,previousValidatedSha:correctiveContext.previousValidatedSha,candidateBaseSha:String(ctx.candidateBaseSha||''),originalBaselineSha:String(ctx.originalBaselineSha||ctx.baseSha||''),reasonCodes:correctiveContext.reasonCodes,blockingCauses:correctiveContext.blockingCauses,originalFindingResults:correctiveContext.originalFindingResults}}:{})};
`;
    preparePlan.parameters.jsCode = preparePlan.parameters.jsCode.replace(contractAnchor, contractReplacement);
    if (preparePlan.parameters.jsCode === before) throw new Error('R74_CONTRACT_NOT_MODIFIED');
    if (!preparePlan.parameters.jsCode.includes('const correctiveIssues=')) throw new Error('R74_ISSUES_MISSING');

    const ruleAnchor = "MANUAL_OR_SPECIALIST rather than defaulting to the historical finding file.':'';";
    if (!preparePlan.parameters.jsCode.includes(ruleAnchor)) throw new Error('R74_INSTRUCTION_ANCHOR_NOT_FOUND');
    const ruleReplacement = "MANUAL_OR_SPECIALIST rather than defaulting to the historical finding file. (12) When contract.correctiveIssues is present and non-empty, it -- not historicalFindings[].target line numbers -- is the authoritative description of the current defect and its causally-grounded target file(s) (correctiveIssues[].groundedTargetFiles / effectiveTargetFiles). Do not infer the current defect location from historicalFindings[].target line drift, and do not treat an apparent mismatch between a historicalFindings[] line and a correctiveIssues[] target as evidence that the blocking cause does not apply to a finding -- when correctiveIssues[] is grounded, act on it directly.':'';";
    preparePlan.parameters.jsCode = preparePlan.parameters.jsCode.replace(ruleAnchor, ruleReplacement);
    if (!preparePlan.parameters.jsCode.includes('(12) When contract.correctiveIssues')) throw new Error('R74_INSTRUCTION_NOT_MODIFIED');
  }

  // Validate Generic Remediation Plan requires NO change: audited and
  // confirmed it never authorized a target by cross-referencing
  // historicalFindings[]/contract.findings[].target file/line identity --
  // its membership (policy.targetFiles / effectiveTargetFiles) and causality
  // (groundedTargetFiles, R73) gates operate purely on the LLM's own emitted
  // plan.target.file against deterministically-resolved path sets. R74 only
  // changes what is offered to the model as authoritative input; the
  // validator's authorization logic is already target-set-based, not
  // historical-identity-based, and is left untouched.

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenCorrectiveIssueCanonicalization(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R74 corrective issue canonicalization written to', outputPath.pathname);
}
