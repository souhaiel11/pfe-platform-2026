import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json', import.meta.url)))[0];
const node = wf.nodes.find(n => n.name === 'Fetch SonarQube Issues');
assert.equal(node.type, 'n8n-nodes-base.code');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function run(pages, projectKey = 'baseline-project') {
  let calls = 0;
  const helper = async (_auth, opts) => {
    calls++;
    const page = Number(opts.qs.p);
    if (pages instanceof Error) throw pages;
    if (pages.failAt === page) throw new Error('HTTP failure');
    return pages.responses[page - 1] ?? {};
  };
  const fn = new AsyncFunction('$json', node.parameters.jsCode);
  const out = await fn.call({ helpers: { httpRequestWithAuthentication: helper } }, { projectConfig: { sonarqubeKey: projectKey } });
  return { json: out[0].json, calls };
}

const issues = n => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, rule: 'x', component: `p:F${i}.java`, status: 'OPEN' }));

let out = await run({ responses: [{ total: 120, issues: issues(120) }] });
assert.equal(out.json.complete, true);
assert.equal(out.json.collectedCount, 120);
assert.equal(out.calls, 1);

const page2Finding = { key: 'late', rule: 'java:S9999', component: 'p:Late.java', status: 'OPEN' };
out = await run({ responses: [{ total: 501, issues: issues(500) }, { total: 501, issues: [page2Finding] }] });
assert.equal(out.json.complete, true);
assert.equal(out.json.collectedCount, 501);
assert.equal(out.json.issues.some(i => i.key === 'late'), true);
assert.equal(out.calls, 2);

out = await run({ responses: [{ total: 120, issues: issues(50) }] });
assert.equal(out.json.complete, false);
assert.equal(out.json.collectedCount, 50);

out = await run({ responses: [{ total: 501, issues: issues(500) }], failAt: 2 });
assert.equal(out.json.complete, false);
assert.match(out.json.snapshotError, /FETCH_FAILED_PAGE_2/);

out = await run({ responses: [{ issues: issues(1) }] });
assert.equal(out.json.complete, false);

out = await run({ responses: [{ total: 2, issues: issues(1) }, { total: 3, issues: issues(1) }] });
assert.equal(out.json.complete, false);
assert.match(out.json.snapshotError, /TOTAL_INCONSISTENT_PAGE_2/);

out = await run({ responses: Array.from({ length: 40 }, () => ({ total: 20001, issues: issues(500) })) });
assert.equal(out.json.complete, false);
assert.equal(out.json.snapshotError, 'PAGE_LIMIT_EXCEEDED');

console.log('WF1 baseline pagination/completeness: PASS');
