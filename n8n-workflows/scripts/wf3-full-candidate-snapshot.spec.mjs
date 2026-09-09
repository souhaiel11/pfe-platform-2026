// BRIQUE 3 CLOSEOUT — proves the "Get Full Candidate Sonar Snapshot" node's
// pagination/completeness LOGIC in the repo-tracked WF3 export
// (n8n-workflows/active/wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json).
// REPO-ONLY / STATIC: this mocks n8n's Code-node `this.helpers` API and
// never touches a live n8n instance, so it cannot prove the real HTTP
// pagination works against a live SonarQube -- only that the node's own
// accumulation/completeness/error-handling logic is deterministic and never
// fabricates `candidateSnapshotComplete: true`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(here, '..', 'active', 'wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json');
const workflow = JSON.parse(readFileSync(wfPath, 'utf8'))[0];
const node = workflow.nodes.find(n => n.name === 'Get Full Candidate Sonar Snapshot');
assert.ok(node, 'Get Full Candidate Sonar Snapshot node must exist in the repo-tracked WF3 export');
const code = node.parameters.jsCode;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function makeThis(pages) {
  let calls = 0;
  return {
    helpers: {
      httpRequestWithAuthentication: {
        call: async (_thisArg, _credType, options) => {
          const page = Number(options.qs.p);
          calls++;
          const response = pages[page - 1];
          if (response === 'THROW') throw new Error('simulated network failure');
          if (response === undefined) throw new Error(`unexpected page requested: ${page}`);
          return response;
        },
      },
    },
    _calls: () => calls,
  };
}

async function run(ctxJson, pages) {
  const mockThis = makeThis(pages);
  const mockDollar = name => ({ first: () => ({ json: name === 'Extract Validation Context' ? ctxJson : undefined }) });
  const fn = new AsyncFunction('$', code);
  const out = (await fn.call(mockThis, mockDollar))[0].json;
  return { out, calls: mockThis._calls() };
}

const baseCtx = { sonarAnalysisMode: 'COMMUNITY_EXACT_SHA', validationSonarProjectKey: 'proj-pr-25', checkoutSha: 'a'.repeat(40) };

async function main() {
  // Case 1: single page, fewer issues than the page size -- complete.
  {
    const issues = Array.from({ length: 3 }, (_, i) => ({ key: `k${i}`, rule: 'java:S1', component: 'proj-pr-25:A.java' }));
    const { out, calls } = await run(baseCtx, [{ issues, total: 3 }]);
    assert.equal(calls, 1);
    assert.equal(out.candidateSnapshotComplete, true);
    assert.equal(out.candidateFindingsSnapshot.length, 3);
    assert.equal(out.candidateSnapshotError, null);
  }

  // Case 2: multiple pages, full pagination actually walks every page.
  {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ key: `p1-${i}`, rule: 'java:S1', component: 'A.java' }));
    const page2 = Array.from({ length: 120 }, (_, i) => ({ key: `p2-${i}`, rule: 'java:S1', component: 'A.java' }));
    const { out, calls } = await run(baseCtx, [{ issues: page1, total: 620 }, { issues: page2, total: 620 }]);
    assert.equal(calls, 2, 'both pages were actually fetched');
    assert.equal(out.candidateFindingsSnapshot.length, 620);
    assert.equal(out.candidateSnapshotComplete, true);
  }

  // Case 3: a page request fails mid-pagination -- never fabricate complete.
  {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ key: `p1-${i}` }));
    const { out } = await run(baseCtx, [{ issues: page1, total: 620 }, 'THROW']);
    assert.equal(out.candidateSnapshotComplete, false);
    assert.ok(out.candidateSnapshotError && out.candidateSnapshotError.startsWith('FETCH_FAILED_PAGE_'));
  }

  // Case 4: malformed response (no issues array) -- never fabricate complete.
  {
    const { out } = await run(baseCtx, [{ notIssues: [] }]);
    assert.equal(out.candidateSnapshotComplete, false);
    assert.ok(out.candidateSnapshotError.startsWith('MALFORMED_RESPONSE_PAGE_'));
  }

  // Case 5: total is missing/non-numeric -- never fabricate complete.
  {
    const { out } = await run(baseCtx, [{ issues: [{ key: 'k1' }] }]);
    assert.equal(out.candidateSnapshotComplete, false);
    assert.ok(out.candidateSnapshotError.startsWith('TOTAL_UNAVAILABLE_PAGE_'));
  }

  // Case 6: no validationSonarProjectKey (or wrong analysis mode) -- fails
  // closed immediately, zero HTTP calls.
  {
    const { out, calls } = await run({ ...baseCtx, validationSonarProjectKey: '' }, []);
    assert.equal(calls, 0);
    assert.equal(out.candidateSnapshotComplete, false);
    assert.equal(out.candidateSnapshotError, 'PROJECT_KEY_UNAVAILABLE');
    assert.deepEqual(out.candidateFindingsSnapshot, []);
  }

  console.log('WF3 full candidate Sonar snapshot pagination: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
