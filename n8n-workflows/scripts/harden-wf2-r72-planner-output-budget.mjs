import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R71-CORRECTIVE-SOURCE-AUTHORITY.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R72-PLANNER-OUTPUT-BUDGET.json', import.meta.url);

export function hardenPlannerOutputBudget(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R72_NODE_NOT_FOUND:' + name);
    return found;
  };

  // Execution 2031 (attempt 7): claude-sonnet-5 hit stop_reason=max_tokens with
  // output_tokens=8192 entirely consumed by thinking_tokens=8191, leaving zero
  // tokens for the required plan JSON. "Validate Generic Remediation Plan"
  // correctly raised CLAUDE_EMPTY_TEXT_RESPONSE. Apply the same supported
  // contract already proven for the opus-5 patch-generation call ("Prepare -
  // Code Patch Body"): double the hard cap and bound thinking below it so a
  // visible-text floor remains guaranteed regardless of reasoning length.
  const preparePlan = node('Prepare Generic Remediation Plan');
  const before = preparePlan.parameters.jsCode;
  preparePlan.parameters.jsCode = before.replace(
    "const llmRequestBody={model:'claude-sonnet-5',max_tokens:8192,output_config:{format:{",
    "const llmRequestBody={model:'claude-sonnet-5',max_tokens:16384,thinking:{type:'adaptive'},output_config:{effort:'medium',format:{",
  );
  if (preparePlan.parameters.jsCode === before) throw new Error('R72_PLAN_BODY_SHAPE_CHANGED');
  if (!preparePlan.parameters.jsCode.includes("max_tokens:16384,thinking:{type:'adaptive'},output_config:{effort:'medium'")) {
    throw new Error('R72_PLAN_BUDGET_NOT_APPLIED');
  }

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenPlannerOutputBudget(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R72 planner output budget written to', outputPath.pathname);
}
