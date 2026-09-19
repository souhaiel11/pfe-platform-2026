import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R70-CORRECTIVE-TARGET-GROUNDING.json', import.meta.url);

export function hardenCorrectiveTargetGrounding(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R70_NODE_NOT_FOUND:' + name);
    return found;
  };

  // ── Fix 1 (the actual, empirically-proven root cause) ───────────────────
  // Execution 2028 proved that `correctiveAttempt`/`correctiveContext` never
  // reached the planner at all: `Adapt Webhook Payload`'s `incidentData`
  // object literal never carried them, so every downstream node that reads
  // `incidentData` (Apply Repository Metadata -> Policy Gate -> Prepare Batch
  // Context -> Build Independent Repository Policy -> Prepare Generic
  // Remediation Plan) silently lost them. The planner's LLM prompt for
  // execution 2028 contained no "CORRECTIVE MODE" instruction and
  // `remediationContract.correctiveContext` was `undefined` -- proven from
  // the execution's own recorded node output, not inferred. Every other R70
  // fix is inert without this one: there is no blockingCause evidence to
  // ground a target against if it never arrives.
  const adaptWebhookPayload = node('Adapt Webhook Payload');
  {
    const before = adaptWebhookPayload.parameters.jsCode;
    const marker = 'default_branch:body.defaultBranch||null,finding:normalizedFindings[0],findings:normalizedFindings,decision:';
    if (!before.includes(marker)) throw new Error('R70_ADAPT_WEBHOOK_PAYLOAD_SHAPE_CHANGED');
    adaptWebhookPayload.parameters.jsCode = before.replace(
      marker,
      "default_branch:body.defaultBranch||null,finding:normalizedFindings[0],findings:normalizedFindings," +
      "correctiveAttempt:body.correctiveAttempt===true," +
      "correctiveContext:body.correctiveAttempt===true?(body.correctiveContext||null):null," +
      'decision:',
    );
  }

  // ── Fix 2 ────────────────────────────────────────────────────────────────
  // Build Independent Repository Policy: for a corrective attempt, the
  // corrective blocking cause's grounded file fields (sourceFile,
  // candidateFile, mappingFile -- carried opaquely, R66/R68/R70 backend
  // evidence) are equally-authorized planning targets alongside the
  // original finding file(s), which remain authorized purely as historical
  // context. A cause file that does not exist in the CURRENT repository
  // tree is silently excluded here (not a hard failure of policy-building);
  // the CORRECTIVE_TARGET_NOT_GROUNDED gate in Validate Generic Remediation
  // Plan is what enforces that some real causal target was actually found.
  const buildPolicy = node('Build Independent Repository Policy');
  {
    const before = buildPolicy.parameters.jsCode;
    const findingLine = "const targetFiles=[...new Set((ctx.findings||[]).map(f=>normalize(f.file||f.component||'')).filter(Boolean))];if(!targetFiles.length||targetFiles.some(path=>!existingSet.has(path)))throw new Error('FINDING_SOURCE_NOT_IN_REPOSITORY');";
    if (!before.includes(findingLine)) throw new Error('R70_BUILD_POLICY_SHAPE_CHANGED');
    const replacement = String.raw`const findingTargetFiles=[...new Set((ctx.findings||[]).map(f=>normalize(f.file||f.component||'')).filter(Boolean))];if(!findingTargetFiles.length||findingTargetFiles.some(path=>!existingSet.has(path)))throw new Error('FINDING_SOURCE_NOT_IN_REPOSITORY');
const correctiveGroundedFiles=ctx.correctiveAttempt===true&&Array.isArray(ctx.correctiveContext?.blockingCauses)?[...new Set(ctx.correctiveContext.blockingCauses.flatMap(cause=>['sourceFile','candidateFile','mappingFile','path'].map(key=>cause&&cause[key]).filter(Boolean).map(String)))].map(path=>{try{return normalize(path)}catch{return null}}).filter(path=>path&&existingSet.has(path)):[];
const targetFiles=[...new Set([...findingTargetFiles,...correctiveGroundedFiles])];`;
    buildPolicy.parameters.jsCode = before.replace(findingLine, replacement)
      .replace(
        "return [{json:{...ctx,repositoryPolicy:{policyVersion:'1.0',existingFiles,permittedRoots,targetFiles,manifests,suggestedCommands:[...new Set(suggestedCommands)],source:'DETERMINISTIC_REPOSITORY_TREE'}}}];",
        "return [{json:{...ctx,repositoryPolicy:{policyVersion:'1.0',existingFiles,permittedRoots,targetFiles,findingTargetFiles,correctiveGroundedFiles,manifests,suggestedCommands:[...new Set(suggestedCommands)],source:'DETERMINISTIC_REPOSITORY_TREE'}}}];",
      );
    if (buildPolicy.parameters.jsCode === before) throw new Error('R70_BUILD_POLICY_NOT_MODIFIED');
  }

  // ── Fix 3 ────────────────────────────────────────────────────────────────
  // Expand Finding Source Files: read the file list from
  // repositoryPolicy.targetFiles (Fix 2's superset) instead of re-deriving
  // it from ctx.findings directly, so a corrective grounded file's ACTUAL
  // SOURCE CONTENT is fetched and reaches the planner's sourceSnapshots --
  // without this the planner could never propose a confident, evidence-based
  // change to that file even once it is an authorized target. For a
  // non-corrective batch repositoryPolicy.targetFiles is byte-identical to
  // the old finding-derived set, so this is a no-op for ordinary flow.
  const expandFindingSourceFiles = node('Expand Finding Source Files');
  {
    const before = expandFindingSourceFiles.parameters.jsCode;
    const oldLine = "const ctx=$('Prepare Batch Context').first().json;const paths=[...new Set((ctx.findings||[]).map(f=>String(f.file||f.component||'')).filter(Boolean))];if(!paths.length)throw new Error('NO_FINDING_SOURCE_FILES');return paths.map(target_file_path=>({json:{...ctx,target_file_path}}));";
    if (before.trim() !== oldLine.trim()) throw new Error('R70_EXPAND_FINDING_SOURCE_FILES_SHAPE_CHANGED');
    expandFindingSourceFiles.parameters.jsCode = String.raw`const ctx=$('Build Independent Repository Policy').first().json;
const paths=[...new Set((ctx.repositoryPolicy?.targetFiles?.length?ctx.repositoryPolicy.targetFiles:(ctx.findings||[]).map(f=>String(f.file||f.component||''))).filter(Boolean))];
if(!paths.length)throw new Error('NO_FINDING_SOURCE_FILES');
return paths.map(target_file_path=>({json:{...ctx,target_file_path}}));`;
  }

  // ── Fix 4 (Section 7 — planner input hardening) ─────────────────────────
  // Prepare Generic Remediation Plan: strengthen the existing corrective
  // instruction so the planner is explicitly told not to treat a historical
  // finding file as the edit target merely because it was the ORIGINAL
  // finding location, and to select targets from the causal corrective
  // evidence / current authorized source instead. Deliberately does not
  // prescribe a specific file or implementation -- it only states the
  // generic authority rule from the CORRECTIVE_TARGET_INVARIANT.
  const preparePlan = node('Prepare Generic Remediation Plan');
  {
    const before = preparePlan.parameters.jsCode;
    const oldTail = "Every proposed change must be expressed against the CURRENT candidate base, contract.correctiveContext.candidateBaseSha -- never against originalBaselineSha.':'';";
    if (!before.includes(oldTail)) throw new Error('R70_PREPARE_PLAN_SHAPE_CHANGED');
    const newTail = "Every proposed change must be expressed against the CURRENT candidate base, contract.correctiveContext.candidateBaseSha -- never against originalBaselineSha. (8) A historical scanner finding file (contract.findings[].target.file) is retained ONLY as remediation lineage/context; it is NOT automatically the edit target for this corrective attempt. (9) The causally authoritative edit target is whichever file the blocking cause itself identifies (contract.correctiveContext.blockingCauses[].sourceFile, candidateFile or mappingFile when present) or, when no such field is present, whichever file in the supplied source snapshots you can, with confidence, identify as containing the exact mapping described by blockingCauses[].mappingPath. (10) Do not patch the original finding file merely because it is familiar or already authorized -- it remains a valid target ONLY when it independently satisfies (9), which is a legitimate and common outcome you must not avoid. (11) If no file can be established under (9) with confidence, return that plan'\\''s rootCause as \"CONTEXT_REQUIRED\" and disposition MANUAL_OR_SPECIALIST rather than defaulting to the historical finding file.':'';";
    preparePlan.parameters.jsCode = before.replace(oldTail, newTail);
    if (preparePlan.parameters.jsCode === before) throw new Error('R70_PREPARE_PLAN_NOT_MODIFIED');
  }

  // ── Fix 5 (Section 8 — deterministic plan validation) ───────────────────
  // Validate Generic Remediation Plan: for correctiveAttempt=true, require
  // at least one planned file across the whole batch to be causally
  // supported -- either by an explicit blockingCause file field, or by a
  // deterministic, UNAMBIGUOUS match of blockingCause.mappingPath's exact
  // snippet against the bounded, already-fetched source snapshots (Fix 3
  // widened that fetch set to include any explicitly-grounded files, but
  // this fallback also covers a cause with no explicit file field at all).
  // Ambiguous (2+) or absent matches are never silently resolved. If the
  // whole batch's planned files are ONLY historical finding files with no
  // causal support at all, the plan is rejected before patch generation --
  // WF2_PATCH_NOT_EFFECTIVE remains untouched as defense in depth for the
  // case where a grounded target is proposed but not actually changed.
  const validatePlan = node('Validate Generic Remediation Plan');
  {
    const before = validatePlan.parameters.jsCode;
    const anchor = 'const fileMap=new Map();for(const plan of normalized){for(const path of plan.filesToModify)fileMap.set(path,{path,operation:\'MODIFY\'});for(const path of plan.filesToCreate)fileMap.set(path,{path,operation:\'CREATE\'});}';
    if (!before.includes(anchor)) throw new Error('R70_VALIDATE_PLAN_SHAPE_CHANGED');
    const groundingBlock = String.raw`
// R70 -- corrective target grounding (Section 8): a corrective attempt must
// causally justify at least one planned file; the original finding file(s)
// alone are never sufficient authority.
const correctiveContext=prepared.correctiveAttempt===true?prepared.correctiveContext:null;
if(correctiveContext&&Array.isArray(correctiveContext.blockingCauses)&&correctiveContext.blockingCauses.length){
  const causes=correctiveContext.blockingCauses;
  const explicitGrounded=new Set();
  for(const cause of causes){for(const key of ['sourceFile','candidateFile','mappingFile','path']){const path=cause&&cause[key];if(path)explicitGrounded.add(String(path));}}
  const snapshots=prepared.remediationContract?.sourceSnapshots||[];
  const resolvedFallback=new Set();
  for(const cause of causes){
    if(['sourceFile','candidateFile','mappingFile','path'].some(key=>cause&&cause[key]))continue;
    const mappingPath=String(cause?.mappingPath||'');
    const separatorIndex=mappingPath.indexOf(': ');
    const snippet=separatorIndex===-1?'':mappingPath.slice(separatorIndex+2).trim();
    if(!snippet)continue;
    const matches=snapshots.filter(s=>String(s.content||'').includes(snippet));
    if(matches.length===1)resolvedFallback.add(String(matches[0].file));
    // 0 or 2+ matches: unresolved/ambiguous -- never guessed, left unresolved.
  }
  const groundedTargetFiles=new Set([...explicitGrounded,...resolvedFallback]);
  if(!groundedTargetFiles.size)throw new Error('CORRECTIVE_TARGET_NOT_GROUNDED:'+JSON.stringify({reason:'NO_CAUSAL_FILE_RESOLVED'}));
  const plannedPaths=new Set(normalized.flatMap(plan=>plan.proposedPaths));
  const hasGroundedTarget=[...plannedPaths].some(path=>groundedTargetFiles.has(path));
  if(!hasGroundedTarget)throw new Error('CORRECTIVE_TARGET_NOT_GROUNDED:'+JSON.stringify({plannedPaths:[...plannedPaths],groundedTargetFiles:[...groundedTargetFiles]}));
}
`;
    validatePlan.parameters.jsCode = before.replace(anchor, groundingBlock.trim() + '\n' + anchor);
    if (validatePlan.parameters.jsCode === before) throw new Error('R70_VALIDATE_PLAN_NOT_MODIFIED');
  }

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenCorrectiveTargetGrounding(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R70 corrective-target-grounding hardening written to', outputPath.pathname);
}
