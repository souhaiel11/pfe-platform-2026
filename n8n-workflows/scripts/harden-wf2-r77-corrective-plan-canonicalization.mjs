import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CARDINALITY-INVARIANT.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R77-CORRECTIVE-PLAN-CANONICALIZATION.json', import.meta.url);

export function hardenCorrectivePlanCanonicalization(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R77_NODE_NOT_FOUND:' + name);
    return found;
  };

  // Execution 2036 (attempt 11) proved R75's identity CHECK correct but
  // insufficient on its own: the model produced 2 byte-identical plans
  // (differing only in `findingId`), each keyed by a historical Sonar id,
  // both correctly targeting the grounded file (TaskDTO.java) -- R73/R74
  // grounding held perfectly. R75 compared the model's own chosen
  // identity/cardinality against the expected canonical set and correctly
  // rejected the mismatch, but the identity/cardinality itself was still
  // entirely model-controlled: nothing forced the model to key its plan(s)
  // by correctiveIssues[].candidateId rather than by however many
  // historicalFindings[] entries it saw. R77 moves that decision onto the
  // platform: raw plans are deterministically canonicalized -- mapped to
  // exactly one correctiveIssue each via candidateId match or unique
  // grounded-target-file membership, semantically-identical duplicates
  // mapping to the same issue are collapsed (never picked arbitrarily), and
  // any real disagreement fails closed -- before the plan ever reaches
  // R75's identity check, which now always sees platform-assigned identity.
  const preparePlan = node('Prepare Generic Remediation Plan');
  {
    const before = preparePlan.parameters.jsCode;
    const anchor = "(12) When contract.correctiveIssues is present and non-empty, it -- not historicalFindings[].target line numbers -- is the authoritative description of the current defect and its causally-grounded target file(s) (correctiveIssues[].groundedTargetFiles / effectiveTargetFiles). Do not infer the current defect location from historicalFindings[].target line drift, and do not treat an apparent mismatch between a historicalFindings[] line and a correctiveIssues[] target as evidence that the blocking cause does not apply to a finding -- when correctiveIssues[] is grounded, act on it directly.':'';";
    if (!before.includes(anchor)) throw new Error('R77_PREPARE_PLAN_SHAPE_CHANGED');
    const replacement = "(12) When contract.correctiveIssues is present and non-empty, it -- not historicalFindings[].target line numbers -- is the authoritative description of the current defect and its causally-grounded target file(s) (correctiveIssues[].groundedTargetFiles / effectiveTargetFiles). Do not infer the current defect location from historicalFindings[].target line drift, and do not treat an apparent mismatch between a historicalFindings[] line and a correctiveIssues[] target as evidence that the blocking cause does not apply to a finding -- when correctiveIssues[] is grounded, act on it directly. (13) In corrective mode, create EXACTLY ONE plan per contract.correctiveIssues[] item -- never one plan per historicalFindings[] entry. Set that plan\\'s findingId to the corresponding correctiveIssues[].candidateId, not to any historicalFindings[] id. historicalFindings exists only as lineage/audit context for the reasoning behind the plan; it must never determine how many plans you produce or what identity they carry.':'';";
    preparePlan.parameters.jsCode = before.replace(anchor, replacement);
    if (preparePlan.parameters.jsCode === before) throw new Error('R77_PREPARE_PLAN_NOT_MODIFIED');
  }

  // Deterministic canonicalization, inserted before the existing R75
  // identity/cardinality check (which is left in place, unchanged, as a
  // redundant safety net -- it is now always satisfied by construction for
  // corrective mode, since canonicalization itself enforces exactly one
  // plan per correctiveIssue keyed by candidateId).
  const validatePlan = node('Validate Generic Remediation Plan');
  {
    const before = validatePlan.parameters.jsCode;
    const anchor = "const plans=Array.isArray(parsed)?parsed:(Array.isArray(parsed.plans)?parsed.plans:[]);const expected=";
    if (!before.includes(anchor)) throw new Error('R77_VALIDATE_PLAN_SHAPE_CHANGED');
    const replacement = String.raw`const rawPlans=Array.isArray(parsed)?parsed:(Array.isArray(parsed.plans)?parsed.plans:[]);
const canonicalCorrectiveIssues=prepared.correctiveAttempt===true&&Array.isArray(prepared.remediationContract?.correctiveIssues)&&prepared.remediationContract.correctiveIssues.length?prepared.remediationContract.correctiveIssues:null;
const canonicalizeCorrectivePlans=(raw,issues)=>{
  const planPaths=plan=>[...new Set([...(plan.filesToModify||[]),...(plan.filesToCreate||[]),...(plan.proposedPaths||[])].map(String))];
  const resolveIssue=plan=>{
    const byId=issues.filter(issue=>String(issue.candidateId)===String(plan.findingId||''));
    if(byId.length===1)return byId[0];
    if(byId.length>1)return null;
    const paths=planPaths(plan);
    const byTarget=issues.filter(issue=>{const grounded=new Set([...(issue.groundedTargetFiles||[]),...(issue.effectiveTargetFiles||[])].map(String));return paths.some(p=>grounded.has(p))});
    return byTarget.length===1?byTarget[0]:null;
  };
  const groups=new Map();const unmapped=[];
  for(const plan of raw){
    const issue=resolveIssue(plan);
    if(!issue){unmapped.push(plan);continue}
    const key=String(issue.candidateId);
    if(!groups.has(key))groups.set(key,{issue,plans:[]});
    groups.get(key).plans.push(plan);
  }
  if(unmapped.length)throw new Error('CORRECTIVE_PLAN_UNMAPPED:'+JSON.stringify({count:unmapped.length,findingIds:unmapped.map(p=>String(p.findingId||''))}));
  const missing=issues.filter(issue=>!groups.has(String(issue.candidateId)));
  if(missing.length)throw new Error('REMEDIATION_PLAN_INCOMPLETE:'+JSON.stringify({missingIssueIds:missing.map(i=>i.candidateId)}));
  const canonical=[];
  for(const {issue,plans:group} of groups.values()){
    if(group.length>1){
      const strip=plan=>{const {findingId,...rest}=plan;return JSON.stringify(rest)};
      const distinct=new Set(group.map(strip));
      if(distinct.size>1)throw new Error('CORRECTIVE_PLAN_CONFLICT:'+JSON.stringify({candidateId:issue.candidateId,count:group.length}));
    }
    canonical.push({...group[0],findingId:String(issue.candidateId)});
  }
  return canonical;
};
const plans=canonicalCorrectiveIssues?canonicalizeCorrectivePlans(rawPlans,canonicalCorrectiveIssues):rawPlans;
const expected=`;
    validatePlan.parameters.jsCode = before.replace(anchor, replacement);
    if (validatePlan.parameters.jsCode === before) throw new Error('R77_VALIDATE_PLAN_NOT_MODIFIED');
    if (!validatePlan.parameters.jsCode.includes('CORRECTIVE_PLAN_CONFLICT')) throw new Error('R77_CANONICALIZATION_MISSING');
  }

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenCorrectivePlanCanonicalization(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R77 corrective plan canonicalization written to', outputPath.pathname);
}
