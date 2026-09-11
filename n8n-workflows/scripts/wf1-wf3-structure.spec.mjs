// Offline JSON, expression and graph validation; never invokes n8n.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const load = file => JSON.parse(readFileSync(new URL('../active/' + file, import.meta.url)))[0];
const wf1 = load('wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json');
const wf3 = load('wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let expressions = 0, codes = 0;
for (const wf of [wf1, wf3]) {
  assert.equal(new Set(wf.nodes.map(n => n.id)).size, wf.nodes.length, 'unique IDs');
  assert.equal(new Set(wf.nodes.map(n => n.name)).size, wf.nodes.length, 'unique names');
  const names = new Set(wf.nodes.map(n => n.name));
  const edges = [];
  for (const [source, outputs] of Object.entries(wf.connections)) {
    assert.ok(names.has(source));
    for (const branches of Object.values(outputs)) for (const branch of branches) for (const edge of branch) {
      assert.ok(names.has(edge.node), 'connection target exists'); edges.push([source, edge.node]);
    }
  }
  const reachable = new Set(wf.nodes.filter(n => ['n8n-nodes-base.webhook', 'n8n-nodes-base.executeWorkflowTrigger'].includes(n.type)).map(n => n.name));
  for (let previous = -1; previous !== reachable.size;) {
    previous = reachable.size;
    for (const [a, b] of edges) if (reachable.has(a)) reachable.add(b);
  }
  assert.equal(reachable.size, names.size, 'all functional nodes reachable');
  function inspect(value, label) {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        assert.doesNotThrow(() => new Function(`return (${match[1]});`), label); expressions++;
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'jsCode') {
          assert.doesNotThrow(() => new AsyncFunction('$', '$input', child), label + '.jsCode'); codes++;
        } else inspect(child, label + '.' + key);
      }
    }
  }
  for (const node of wf.nodes) {
    assert.ok(!node.disabled);
    inspect(node.parameters, node.name);
    assert.ok(!['n8n-nodes-base.github', 'n8n-nodes-base.git', 'n8n-nodes-base.executeCommand'].includes(node.type));
  }
}
assert.equal(wf1.nodes.length, 50);
assert.deepEqual(wf1.nodes.filter(n => n.type === 'n8n-nodes-base.webhook').map(n => n.parameters.path), ['jenkins-event']);
const wf1n = name => wf1.nodes.find(n => n.name === name);
const wf1next = name => wf1.connections[name].main.flat().map(e => e.node);
assert.equal(wf1n('Fetch SonarQube Issues').type, 'n8n-nodes-base.httpRequest');
assert.equal(wf1n('Fetch SonarQube Issues').onError, 'continueErrorOutput');
assert.deepEqual(wf1next('Fetch SonarQube Issues'), ['Consolidate Baseline Sonar Snapshot','Consolidate Baseline Sonar Snapshot']);
assert.deepEqual(wf1next('Consolidate Baseline Sonar Snapshot'), ['Resolve Exact Sonar Correlation']);
assert.ok(!JSON.stringify(wf1n('Fetch SonarQube Issues')).includes('httpRequestWithAuthentication'));
assert.ok(!wf1n('Consolidate Baseline Sonar Snapshot').parameters.jsCode.includes('httpRequestWithAuthentication'));
assert.equal(wf3.nodes.length, 11);
assert.equal(wf3.nodes.filter(n => n.type === 'n8n-nodes-base.webhook').length, 0);
const n = name => wf3.nodes.find(n => n.name === name);
const next = name => wf3.connections[name].main.flat().map(e => e.node);
assert.deepEqual(next('Get SonarQube Approved Findings'), ['Collect Target Finding Evidence', 'Collect Target Finding Evidence']);
assert.deepEqual(next('Collect Target Finding Evidence'), ['Get Full Candidate Sonar Snapshot']);
assert.deepEqual(next('Get Full Candidate Sonar Snapshot'), ['Consolidate Full Candidate Sonar Snapshot', 'Consolidate Full Candidate Sonar Snapshot']);
assert.deepEqual(next('Consolidate Full Candidate Sonar Snapshot'), ['Consolidate Validation Result']);
assert.deepEqual(n('Get SonarQube Approved Findings').credentials, n('Get SonarQube PR Quality Gate').credentials);
assert.ok(!n('Collect Target Finding Evidence').credentials, 'collector needs no credential values');
assert.ok(!n('Collect Target Finding Evidence').parameters.jsCode.includes('Get Full Candidate Sonar Snapshot'));
assert.equal(n('Get Full Candidate Sonar Snapshot').type, 'n8n-nodes-base.httpRequest');
assert.ok(!JSON.stringify(n('Get Full Candidate Sonar Snapshot')).includes('httpRequestWithAuthentication'));
assert.ok(!n('Consolidate Full Candidate Sonar Snapshot').parameters.jsCode.includes('httpRequestWithAuthentication'));
for (const name of ['Collect Target Finding Evidence', 'Prepare Approved Finding Validation', 'Consolidate Validation Result']) {
  assert.doesNotMatch(n(name).parameters.jsCode, /java:S4684|pfe-app-test|PR25|WF2_TEST|testMode/);
}
console.log(`WF1/WF3 JSON/graph/credentials/genericity: PASS; ${codes} code nodes and ${expressions} expressions compile`);
