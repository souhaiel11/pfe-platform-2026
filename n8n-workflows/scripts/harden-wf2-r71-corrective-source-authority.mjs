import fs from 'node:fs';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R70-CORRECTIVE-TARGET-GROUNDING.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R71-CORRECTIVE-SOURCE-AUTHORITY.json', import.meta.url);

export function hardenCorrectiveSourceAuthority(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R71_NODE_NOT_FOUND:' + name);
    return found;
  };

  const useExisting = node('Use Existing Branch');
  useExisting.parameters.jsCode = `const ctx=$('Prepare Batch Context').first().json;const response=$json;if(response.statusCode!==200||response.body?.ref!=='refs/heads/'+ctx.targetBranchName)throw new Error('EXISTING_BRANCH_IDENTITY_MISMATCH');const candidateBaseSha=String(response.body?.object?.sha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(candidateBaseSha))throw new Error('EXISTING_BRANCH_HEAD_SHA_UNAVAILABLE');let sourceSha=String(ctx.baseSha||'').toLowerCase();if(ctx.correctiveAttempt===true){const previousValidatedSha=String(ctx.correctiveContext?.previousValidatedSha||'').toLowerCase();const currentPrHeadSha=String(ctx.correctiveContext?.currentPrHeadSha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(previousValidatedSha))throw new Error('CORRECTIVE_SOURCE_SHA_MISSING');if(currentPrHeadSha&&!/^[a-f0-9]{40}$/.test(currentPrHeadSha))throw new Error('CORRECTIVE_SOURCE_SHA_MISSING');if(candidateBaseSha!==previousValidatedSha||(currentPrHeadSha&&currentPrHeadSha!==previousValidatedSha))throw new Error('CORRECTIVE_SOURCE_SHA_MISMATCH');sourceSha=previousValidatedSha;}if(!/^[a-f0-9]{40}$/.test(sourceSha))throw new Error('SOURCE_SHA_MISSING');return [{json:{...ctx,branchExists:true,candidateBaseSha,sourceSha,originalBaselineSha:String(ctx.baseSha||'').toLowerCase()}}];`;

  const recordBaseline = node('Record New Branch Baseline');
  recordBaseline.parameters.jsCode = `const ctx=$('Prepare Batch Context').first().json;if(ctx.correctiveAttempt===true)throw new Error('CORRECTIVE_SOURCE_SHA_MISSING');const sourceSha=String(ctx.baseSha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(sourceSha))throw new Error('SOURCE_SHA_MISSING');return [{json:{...ctx,branchExists:false,candidateBaseSha:sourceSha,sourceSha,originalBaselineSha:sourceSha}}];`;

  const tree = node('Fetch Repository Tree');
  tree.parameters.url = '=https://api.github.com/repos/{{ $(\'Prepare Batch Context\').first().json.repository_owner }}/{{ $(\'Prepare Batch Context\').first().json.repository_name }}/git/trees/{{ encodeURIComponent($json.sourceSha) }}';

  const buildPolicy = node('Build Independent Repository Policy');
  buildPolicy.parameters.jsCode = buildPolicy.parameters.jsCode
    .replace("const ctx=$('Prepare Batch Context').first().json;const response=$json;", `const batch=$('Prepare Batch Context').first().json;const response=$json;const lookup=$('Lookup Remediation Branch').first().json||{};const candidateBaseSha=String(lookup.body?.object?.sha||batch.baseSha||'').toLowerCase();const originalBaselineSha=String(batch.baseSha||'').toLowerCase();let sourceSha=originalBaselineSha;if(batch.correctiveAttempt===true){const previousValidatedSha=String(batch.correctiveContext?.previousValidatedSha||'').toLowerCase();const currentPrHeadSha=String(batch.correctiveContext?.currentPrHeadSha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(previousValidatedSha))throw new Error('CORRECTIVE_SOURCE_SHA_MISSING');if(!/^[a-f0-9]{40}$/.test(candidateBaseSha)||candidateBaseSha!==previousValidatedSha||(currentPrHeadSha&&currentPrHeadSha!==previousValidatedSha))throw new Error('CORRECTIVE_SOURCE_SHA_MISMATCH');sourceSha=previousValidatedSha;}if(!/^[a-f0-9]{40}$/.test(sourceSha))throw new Error('SOURCE_SHA_MISSING');if(String(response.sha||'').toLowerCase()!==sourceSha)throw new Error('SOURCE_TREE_SHA_MISMATCH');const ctx={...batch,candidateBaseSha,sourceSha,originalBaselineSha};`);
  if (!buildPolicy.parameters.jsCode.includes('SOURCE_TREE_SHA_MISMATCH')) throw new Error('R71_BUILD_POLICY_SHAPE_CHANGED');

  for (const name of ['Fetch Finding Source Context', 'Fetch Referenced API Sources', 'Fetch Required Dependency Sources']) {
    const fetchNode = node(name);
    fetchNode.parameters.additionalParameters.reference = "={{ $('Build Independent Repository Policy').first().json.sourceSha }}";
  }

  const expandDependencies = node('Expand Required Dependency Sources');
  expandDependencies.parameters.jsCode = expandDependencies.parameters.jsCode.replace(
    /const frozenSourceSha = String\(\$\('Prepare Batch Context'\)\.first\(\)\.json\.baseSha\|\|''\);/,
    "const frozenSourceSha = String(ctx.sourceSha||'');",
  ).replace(
    /\/\/ Provenance of the EVIDENCE,[\s\S]*?\/\/ The remediation branch remains the target for lookup\/commit\/drift\/PR writes\.\n/,
    '// R71: source evidence is frozen to the canonical sourceSha selected and verified before every fetch.\n',
  );
  if (!expandDependencies.parameters.jsCode.includes("String(ctx.sourceSha||'')")) throw new Error('R71_FROZEN_SOURCE_SHAPE_CHANGED');

  const preparePlan = node('Prepare Generic Remediation Plan');
  preparePlan.parameters.jsCode = preparePlan.parameters.jsCode.replace(
    "return {file:String(item.json.path||item.json.target_file_path||''),sha:String(item.json.sha||''),content}",
    "return {file:String(item.json.path||item.json.target_file_path||''),sha:String(item.json.sha||''),sourceSha:String(ctx.sourceSha||''),content}",
  ).replace(
    "originalBaselineSha:String(ctx.baselineSha||'')",
    "originalBaselineSha:String(ctx.originalBaselineSha||ctx.baseSha||'')",
  );
  if (!preparePlan.parameters.jsCode.includes("candidateBaseSha:String(ctx.candidateBaseSha||'')")) throw new Error('R71_PLAN_CANDIDATE_SHA_MISSING');

  return workflow;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exported = JSON.parse(fs.readFileSync(sourcePath));
  const workflow = Array.isArray(exported) ? exported[0] : exported;
  hardenCorrectiveSourceAuthority(workflow);
  fs.writeFileSync(outputPath, JSON.stringify(Array.isArray(exported) ? [workflow] : workflow, null, 2));
  console.log('R71 corrective source authority written to', outputPath.pathname);
}
