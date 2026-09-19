import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R72-PLANNER-OUTPUT-BUDGET.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R73-CORRECTIVE-TARGET-PROPAGATION.json', import.meta.url);

export function hardenCorrectiveTargetPropagation(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R73_NODE_NOT_FOUND:' + name);
    return found;
  };

  // Execution 2032 (attempt 8) proved R70's blockingCause grounding only
  // resolves an EXPLICIT sourceFile/candidateFile/mappingFile/path field.
  // This blockingCause instead carries candidateType:'TaskDTO' -- no file
  // field at all -- so `correctiveGroundedFiles` stayed empty, TaskDTO.java
  // never entered `repositoryPolicy.targetFiles`, and the planner's correct,
  // causally-grounded target was rejected by the deterministic membership
  // gate in Validate Generic Remediation Plan BEFORE R70's own
  // CORRECTIVE_TARGET_NOT_GROUNDED causality gate ever ran (that gate
  // executes only after the whole `normalized` plan list is built, and the
  // membership check throws inside that same build step). This adds a
  // second, deterministic grounding path -- exact type-to-source resolution
  // against the current candidate's repository tree, keyed off the generic
  // `candidateType` field already present in the corrective evidence
  // contract -- alongside the existing explicit-field path. It authorizes
  // ONLY the type the CANDIDATE actually needs changed (never `sourceType`,
  // which is baseline-only comparison evidence and must never become an
  // edit target, or S4684's DTO boundary would be undone).
  const buildPolicy = node('Build Independent Repository Policy');
  {
    const before = buildPolicy.parameters.jsCode;
    const anchor = "const correctiveGroundedFiles=ctx.correctiveAttempt===true&&Array.isArray(ctx.correctiveContext?.blockingCauses)?[...new Set(ctx.correctiveContext.blockingCauses.flatMap(cause=>['sourceFile','candidateFile','mappingFile','path'].map(key=>cause&&cause[key]).filter(Boolean).map(String)))].map(path=>{try{return normalize(path)}catch{return null}}).filter(path=>path&&existingSet.has(path)):[];";
    if (!before.includes(anchor)) throw new Error('R73_BUILD_POLICY_SHAPE_CHANGED');
    const replacement = String.raw`const simpleTypeName=value=>{const raw=String(value||'').trim();if(!raw)return null;const parts=raw.split('.');return parts[parts.length-1]||null};
const resolveTypeToPath=typeName=>{const simple=simpleTypeName(typeName);if(!simple)return null;const matches=existingFiles.filter(path=>{const base=path.split('/').pop()||'';const dot=base.lastIndexOf('.');return(dot===-1?base:base.slice(0,dot))===simple});return matches.length===1?matches[0]:null};
const correctiveGroundedFiles=ctx.correctiveAttempt===true&&Array.isArray(ctx.correctiveContext?.blockingCauses)?[...new Set(ctx.correctiveContext.blockingCauses.flatMap(cause=>[...['sourceFile','candidateFile','mappingFile','path'].map(key=>cause&&cause[key]).filter(Boolean).map(String),resolveTypeToPath(cause&&cause.candidateType)].filter(Boolean)))].map(path=>{try{return normalize(path)}catch{return null}}).filter(path=>path&&existingSet.has(path)):[];`;
    buildPolicy.parameters.jsCode = before.replace(anchor, replacement);
    if (buildPolicy.parameters.jsCode === before) throw new Error('R73_BUILD_POLICY_NOT_MODIFIED');
  }

  // Validate Generic Remediation Plan: consolidate grounding into ONE
  // canonical set computed before plan validation (never a second,
  // independently-computed allowlist), then require BOTH membership in the
  // effective authorized set AND -- for every individual corrective plan,
  // not merely "at least one across the batch" -- causal grounding. A
  // historical finding file remains a valid member (lineage/context, R70)
  // but is no longer sufficient authority on its own in corrective mode.
  const validatePlan = node('Validate Generic Remediation Plan');
  {
    const before = validatePlan.parameters.jsCode;

    const hoistAnchor = "const existing=new Set(policy.existingFiles||[]);const roots=policy.permittedRoots||[];const underRoot=path=>roots.some(root=>path.startsWith(root));const ext=path=>path.includes('.')?path.slice(path.lastIndexOf('.')).toLowerCase():'';";
    if (!before.includes(hoistAnchor)) throw new Error('R73_VALIDATE_PLAN_SHAPE_CHANGED_HOIST');
    const hoistBlock = String.raw`
// R73 -- one canonical corrective target set, computed once, before any
// per-plan check consumes it (no separate independently-computed allowlist).
const correctiveAttempt=prepared.correctiveAttempt===true;
const correctiveContext=correctiveAttempt?prepared.correctiveContext:null;
const correctiveCauses=correctiveContext&&Array.isArray(correctiveContext.blockingCauses)?correctiveContext.blockingCauses:[];
const correctiveSnapshots=prepared.remediationContract?.sourceSnapshots||[];
const mappingPathGrounded=new Set();
for(const cause of correctiveCauses){
  const mappingPath=String(cause?.mappingPath||'');
  const separatorIndex=mappingPath.indexOf(': ');
  const snippet=separatorIndex===-1?'':mappingPath.slice(separatorIndex+2).trim();
  if(!snippet)continue;
  const matches=correctiveSnapshots.filter(s=>String(s.content||'').includes(snippet));
  if(matches.length===1)mappingPathGrounded.add(String(matches[0].file));
  // 0 or 2+ matches: unresolved/ambiguous -- never guessed, left unresolved.
}
const groundedTargetFiles=new Set([...(policy.correctiveGroundedFiles||[]),...mappingPathGrounded]);
if(correctiveAttempt&&correctiveCauses.length&&!groundedTargetFiles.size)throw new Error('CORRECTIVE_TARGET_NOT_GROUNDED:'+JSON.stringify({reason:'NO_CAUSAL_FILE_RESOLVED'}));
const effectiveTargetFiles=new Set([...(policy.targetFiles||[]),...groundedTargetFiles]);
`;
    validatePlan.parameters.jsCode = validatePlan.parameters.jsCode.replace(hoistAnchor, hoistAnchor + hoistBlock);

    const membershipAnchor = "const target=normalize(plan.target?.file);if(!policy.targetFiles.includes(target)||!proposedPaths.includes(target))throw new Error('REMEDIATION_TARGET_NOT_PLANNED');";
    if (!validatePlan.parameters.jsCode.includes(membershipAnchor)) throw new Error('R73_VALIDATE_PLAN_SHAPE_CHANGED_MEMBERSHIP');
    const membershipReplacement = "const target=normalize(plan.target?.file);if(!effectiveTargetFiles.has(target)||!proposedPaths.includes(target))throw new Error('REMEDIATION_TARGET_NOT_PLANNED');if(correctiveAttempt&&!groundedTargetFiles.has(target))throw new Error('CORRECTIVE_TARGET_NOT_GROUNDED:'+JSON.stringify({target,groundedTargetFiles:[...groundedTargetFiles]}));";
    validatePlan.parameters.jsCode = validatePlan.parameters.jsCode.replace(membershipAnchor, membershipReplacement);

    // Superseded by the per-plan gate above: the old batch-level ("at least
    // one planned file is grounded") check independently recomputed the
    // same evidence from scratch after `normalized` was built. Per-plan
    // enforcement is strictly stronger (implies the batch-level property)
    // and this removal is exactly what eliminates the duplicate allowlist.
    const oldBlockStart = "\n// R70 -- corrective target grounding (Section 8): a corrective attempt must";
    const oldBlockEnd = "  if(!hasGroundedTarget)throw new Error('CORRECTIVE_TARGET_NOT_GROUNDED:'+JSON.stringify({plannedPaths:[...plannedPaths],groundedTargetFiles:[...groundedTargetFiles]}));\n}\n";
    const startIdx = validatePlan.parameters.jsCode.indexOf(oldBlockStart);
    const endIdx = validatePlan.parameters.jsCode.indexOf(oldBlockEnd);
    if (startIdx === -1 || endIdx === -1) throw new Error('R73_OLD_R70_BLOCK_NOT_FOUND');
    validatePlan.parameters.jsCode = validatePlan.parameters.jsCode.slice(0, startIdx)
      + validatePlan.parameters.jsCode.slice(endIdx + oldBlockEnd.length);

    if (validatePlan.parameters.jsCode === before) throw new Error('R73_VALIDATE_PLAN_NOT_MODIFIED');
    if (validatePlan.parameters.jsCode.includes('explicitGrounded')) throw new Error('R73_DUPLICATE_ALLOWLIST_REMAINS');
  }

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenCorrectiveTargetPropagation(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R73 corrective target propagation written to', outputPath.pathname);
}
