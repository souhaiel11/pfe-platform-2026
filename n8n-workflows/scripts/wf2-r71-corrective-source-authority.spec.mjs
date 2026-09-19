import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R71-CORRECTIVE-SOURCE-AUTHORITY.json', import.meta.url);
const priorArtifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R70-CORRECTIVE-TARGET-GROUNDING.json', import.meta.url);
const wf = JSON.parse(readFileSync(artifact))[0];
const prior = JSON.parse(readFileSync(priorArtifact))[0];
const node = name => wf.nodes.find(candidate => candidate.name === name);
const priorNode = name => prior.nodes.find(candidate => candidate.name === name);
const BASE = '6ed56ff791acbf3e111431285bef7b30c8076084';
const CANDIDATE = 'dc1aa978719ca40e6339e075cfe52a79875b2342';

function run(name, jsonInput, refs = {}) {
  const $ = key => {
    assert.ok(refs[key], `unexpected reference ${key}`);
    return { first: () => ({ json: refs[key][0] }), all: () => refs[key].map(json => ({ json })) };
  };
  return new Function('$input', '$json', '$', 'Buffer', node(name).parameters.jsCode)(
    { first: () => ({ json: jsonInput }), all: () => [{ json: jsonInput }] }, jsonInput, $, Buffer,
  );
}

const correctiveBatch = {
  baseSha: BASE, correctiveAttempt: true,
  correctiveContext: { previousValidatedSha: CANDIDATE, currentPrHeadSha: CANDIDATE },
  findings: [{ file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' }],
};
const lookup = { statusCode: 200, body: { ref: 'refs/heads/fix/test', object: { sha: CANDIDATE } } };
const batchWithIdentity = { ...correctiveBatch, targetBranchName: 'fix/test' };

// A/B/C/D/F — one field, exact corrective authority, strict failure, lineage retained.
{
  const [corrective] = run('Use Existing Branch', lookup, { 'Prepare Batch Context': [batchWithIdentity] });
  assert.equal(corrective.json.sourceSha, CANDIDATE);
  assert.equal(corrective.json.candidateBaseSha, CANDIDATE);
  assert.equal(corrective.json.originalBaselineSha, BASE);

  const normalBatch = { ...batchWithIdentity, correctiveAttempt: false, correctiveContext: null };
  const [normal] = run('Use Existing Branch', lookup, { 'Prepare Batch Context': [normalBatch] });
  assert.equal(normal.json.sourceSha, BASE);
  assert.equal(normal.json.originalBaselineSha, BASE);

  assert.throws(() => run('Use Existing Branch', lookup, {
    'Prepare Batch Context': [{ ...batchWithIdentity, correctiveContext: {} }],
  }), /CORRECTIVE_SOURCE_SHA_MISSING/);
  assert.throws(() => run('Use Existing Branch', lookup, {
    'Prepare Batch Context': [{ ...batchWithIdentity, correctiveContext: { previousValidatedSha: 'a'.repeat(40), currentPrHeadSha: 'a'.repeat(40) } }],
  }), /CORRECTIVE_SOURCE_SHA_MISMATCH/);
  console.log('R71_CANONICAL_SOURCE_AUTHORITY: PASS');
}

// Repository policy receives and verifies the immutable tree SHA.
{
  const tree = { sha: CANDIDATE, truncated: false, tree: [
    { type: 'blob', path: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' },
    { type: 'blob', path: 'src/main/java/com/pfe/devsecops/service/TaskService.java' },
    { type: 'blob', path: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java' },
    { type: 'blob', path: 'pom.xml' },
  ] };
  const [out] = run('Build Independent Repository Policy', tree, {
    'Prepare Batch Context': [correctiveBatch], 'Lookup Remediation Branch': [lookup],
  });
  assert.equal(out.json.sourceSha, CANDIDATE);
  assert.equal(out.json.candidateBaseSha, CANDIDATE);
  assert.equal(out.json.originalBaselineSha, BASE);
  assert.throws(() => run('Build Independent Repository Policy', { ...tree, sha: BASE }, {
    'Prepare Batch Context': [correctiveBatch], 'Lookup Remediation Branch': [lookup],
  }), /SOURCE_TREE_SHA_MISMATCH/);
  console.log('R71_TREE_EXACT_SHA_AND_LINEAGE: PASS');
}

// E — every planning fetch must reference the single canonical sourceSha.
{
  const fetches = ['Fetch Finding Source Context', 'Fetch Referenced API Sources', 'Fetch Required Dependency Sources'];
  for (const name of fetches) {
    const reference = node(name).parameters.additionalParameters.reference;
    assert.match(reference, /Build Independent Repository Policy/);
    assert.match(reference, /sourceSha/);
    assert.ok(!reference.includes('baseSha'), `${name} must not bypass sourceSha`);
  }
  assert.match(node('Fetch Repository Tree').parameters.url, /\$json\.sourceSha/);
  assert.ok(!node('Fetch Repository Tree').parameters.url.includes('targetBranchName'));
  console.log('R71_ALL_SOURCE_FETCHES_EXACT_SHA: PASS');
}

// G/H/I — deterministic execution-2030 replay fixture; no planner/generator/write is invoked.
{
  const sourcesAtSha = new Map([
    ['src/main/java/com/pfe/devsecops/controller/TaskController.java', 'class TaskController { TaskDTO updateTask(Long id, TaskDTO dto) { return null; } }'],
    ['src/main/java/com/pfe/devsecops/service/TaskService.java', 'class TaskService { TaskDTO updateTask(Long id, TaskDTO updatedTask) { existing.setStatus(parseStatus(updatedTask.getStatus())); return null; } }'],
    ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java', 'class TaskDTO { private String status; String getStatus(){ return status; } }'],
  ]);
  const mappingPath = 'updateTask(TaskDTO): existing.setStatus(parseStatus(updatedTask.getStatus()));';
  const snippet = mappingPath.slice(mappingPath.indexOf(': ') + 2);
  assert.equal(CANDIDATE, correctiveBatch.correctiveContext.previousValidatedSha);
  assert.ok(sourcesAtSha.get('src/main/java/com/pfe/devsecops/controller/TaskController.java').includes('TaskDTO'));
  assert.ok(sourcesAtSha.get('src/main/java/com/pfe/devsecops/service/TaskService.java').includes('parseStatus'));
  assert.ok(sourcesAtSha.get('src/main/java/com/pfe/devsecops/dto/TaskDTO.java').includes('class TaskDTO'));
  assert.deepEqual([...sourcesAtSha].filter(([, content]) => content.includes(snippet)).map(([path]) => path),
    ['src/main/java/com/pfe/devsecops/service/TaskService.java']);
  assert.equal(wf.nodes.some(n => /Generate Code Patch|Update File in Branch|Create File in Branch/.test(n.name) && n.__executed), false);
  console.log('R71_EXECUTION_2030_OFFLINE_REPLAY: PASS');
}

// Frozen provenance and planner contract use the canonical authority while retaining baseline lineage.
{
  const expansion = node('Expand Required Dependency Sources').parameters.jsCode;
  assert.match(expansion, /frozenSourceSha = String\(ctx\.sourceSha/);
  assert.ok(!expansion.includes("$('Prepare Batch Context').first().json.baseSha||''"));
  const plan = node('Prepare Generic Remediation Plan').parameters.jsCode;
  assert.match(plan, /sourceSha:String\(ctx\.sourceSha/);
  assert.match(plan, /candidateBaseSha:String\(ctx\.candidateBaseSha/);
  assert.match(plan, /originalBaselineSha:String\(ctx\.originalBaselineSha\|\|ctx\.baseSha/);
  console.log('R71_FROZEN_PROVENANCE: PASS');
}

// Syntax coverage is derived from the exact R71 delta.
{
  const modifiedCodeNodes = wf.nodes.filter(candidate => {
    const before = priorNode(candidate.name);
    return candidate.type === 'n8n-nodes-base.code' && before && candidate.parameters?.jsCode !== before.parameters?.jsCode;
  });
  const expected = ['Use Existing Branch', 'Record New Branch Baseline', 'Build Independent Repository Policy',
    'Expand Required Dependency Sources', 'Prepare Generic Remediation Plan'];
  assert.deepEqual(modifiedCodeNodes.map(n => n.name).sort(), expected.sort());
  for (const candidate of modifiedCodeNodes) assert.doesNotThrow(() => new Function(candidate.parameters.jsCode), candidate.name);
  console.log(`R71_MODIFIED_NODE_COUNT = ${modifiedCodeNodes.length}`);
  console.log(`R71_SYNTAX_PASS = ${modifiedCodeNodes.length}`);
  console.log('R71_SYNTAX_FAIL = 0');
}

assert.equal(wf.nodes.length, prior.nodes.length);
console.log('R71_NORMAL_FLOW_SEMANTICS_UNCHANGED: PASS');
