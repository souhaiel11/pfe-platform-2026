// Offline contract tests: actual HTTP pagination expressions, collector and
// verdict code from the artifact. No network, n8n engine or business actions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wf = JSON.parse(readFileSync(new URL('../active/wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json', import.meta.url)))[0];
const node = name => wf.nodes.find(n => n.name === name);
const runCode = (name, mocks, input = []) => new Function('$', '$input', node(name).parameters.jsCode)(
  name => ({ first: () => ({ json: mocks[name] }) }), { all: () => input.map(json => ({ json })), first: () => ({ json: input[0] }) },
)[0].json;
const pagination = node('Get SonarQube Approved Findings').parameters.options.pagination.pagination;
const expr = code => new Function('$pageCount', '$response', `return (${code.slice(3, -2)});`);
const nextPage = expr(pagination.parameters.parameters[0].value);
const done = expr(pagination.completeExpression);
const SHA = 'a'.repeat(40);
const ctx = {
  sonarAnalysisMode: 'COMMUNITY_EXACT_SHA', validationSonarProjectKey: 'project-candidate',
  ceTaskId: 'task', analysisId: 'analysis', expectedPrHeadSha: SHA, checkoutSha: SHA,
  incidentId: 'incident', jenkinsStatus: 'SUCCESS',
  requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
};
const target = { findingId: 'finding', rule: 'scanner:rule', file: 'src/Target.ext', line: 3 };
const issue = (i, overrides = {}) => ({ key: `issue-${i}`, rule: target.rule, component: `project-candidate:src/Other${i}.ext`, line: 3, status: 'OPEN', ...overrides });
const list = (count, start = 0) => Array.from({ length: count }, (_, i) => issue(i + start));
const page = (issues, total, p = 1) => ({ issues, total, paging: { total, pageIndex: p, pageSize: 500 } });
function run(pages, context = ctx, preparedOverride = {}) {
  const prepared = runCode('Prepare Approved Finding Validation', { 'Extract Validation Context': context }, [{
    sonarqubeKey: 'project-main', metadata: { fixRequest: { findings: [target], findingIds: [target.findingId] } },
  }]);
  Object.assign(prepared, preparedOverride);
  const mocks = { 'Extract Validation Context': context, 'Prepare Approved Finding Validation': prepared };
  const fetched = [], requested = [];
  // Simulate only transport. Pagination progression/stopping are evaluated
  // from the actual HTTP node configuration. n8n returns one item per page;
  // a rejected request produces an error item via continueErrorOutput.
  for (let count = 0; count < pagination.maxRequests; count++) {
    const p = nextPage(count);
    requested.push(p);
    const response = pages[p - 1];
    if (!response || response instanceof Error) { fetched.length = 0; fetched.push({ error: 'offline HTTP failure' }); break; }
    fetched.push(response);
    if (done(count, { body: response, statusCode: 200 })) break;
  }
  const collected = runCode('Collect Target Finding Evidence', mocks, fetched);
  const result = runCode('Consolidate Validation Result', {
    ...mocks, 'Collect Target Finding Evidence': collected,
    'Get Incident From DB': { id: context.incidentId },
    'Get SonarQube PR Quality Gate': { projectStatus: { status: 'OK' } },
    // Deliberately unrelated full snapshot: target results MUST ignore it.
    'Get Full Candidate Sonar Snapshot': { candidateFindingsSnapshot: [issue('full', { component: 'project-candidate:src/Target.ext' })], candidateSnapshotComplete: true },
  });
  return { collected, result, requested, verdict: result.findingResults[0].result };
}
assert.equal(pagination.limitPagesFetched, true);
assert.equal(pagination.maxRequests, 40);
assert.equal(pagination.parameters.parameters[0].type, 'qs');
assert.equal(pagination.parameters.parameters[0].name, 'p');
assert.equal(node('Get SonarQube Approved Findings').onError, 'continueErrorOutput');
for (const count of [0, 3, 500]) {
  const out = run([page(list(count), count)]);
  assert.equal(out.collected.targetEvidenceComplete, true, `total ${count}`);
  assert.equal(out.verdict, 'VALID'); assert.deepEqual(out.requested, [1]);
}
const late = issue(500, { component: 'project-candidate:src/Target.ext' });
let out = run([page(list(500), 501), page([late], 501, 2)]);
assert.equal(out.verdict, 'INVALID', '501: target on page two');
assert.deepEqual(out.requested, [1, 2]);
out = run([page(list(500), 501), page([issue(500)], 501, 2)]);
assert.equal(out.verdict, 'VALID', '501: absent only after complete search');
assert.equal(out.collected.issues.length, 501);
out = run([page(list(500), 1001), page(list(500, 500), 1001, 2), page([late], 1001, 3)]);
// The key must be unique across all pages.
assert.equal(out.verdict, 'INCONCLUSIVE', 'duplicate key cannot fabricate complete');
out = run([page(list(500), 1001), page(list(500, 500), 1001, 2), page([{ ...late, key: 'late-unique' }], 1001, 3)]);
assert.equal(out.verdict, 'INVALID', 'target on third page');
const failures = [
  ['page two failure', [page(list(500), 501), new Error('offline')]],
  ['total changes', [page(list(500), 501), page([issue(500)], 502, 2)]],
  ['inconsistent total metadata', [{ ...page([], 0), total: 1 }]],
  ['page index wrong', [page(list(500), 501), page([issue(500)], 501, 1)]],
  ['short page', [page(list(10), 501)]],
  ['missing metadata', [{ issues: [] }]],
  ['malformed issues', [{ ...page([], 0), issues: null }]],
  ['malformed issue identity', [page([{ key: 'bad' }], 1)]],
  ['null total', [{ ...page([], 0), total: null, paging: { total: null, pageIndex: 1, pageSize: 500 } }]],
  ['negative total', [page([], -1)]],
  ['duplicate across pages', [page(list(500), 501), page([issue(0)], 501, 2)]],
  ['duplicate within page', [page([issue(0), issue(0)], 2)]],
  ['page bound', Array.from({ length: 40 }, (_, i) => page(list(500, i * 500), 20001, i + 1))],
];
for (const [label, pages] of failures) {
  const out = run(pages);
  assert.equal(out.collected.targetEvidenceComplete, false, label);
  assert.equal(out.verdict, 'INCONCLUSIVE', label);
  assert.equal(out.result.targetEvidenceError, 'TARGET_EVIDENCE_INCOMPLETE', label);
}
// Legacy Sonar paging metadata remains accepted, with the same checks.
assert.equal(run([{ issues: [], total: 0, p: 1, ps: 500 }]).verdict, 'VALID');
for (const context of [{ ...ctx, checkoutSha: 'b'.repeat(40) }, { ...ctx, expectedPrHeadSha: null }, { ...ctx, ceTaskId: null }]) {
  assert.equal(run([page([], 0)], context).verdict, 'INCONCLUSIVE', 'SHA/correlation failure');
}
assert.equal(run([page([], 0)], ctx, { candidateSha: 'b'.repeat(40) }).verdict, 'INCONCLUSIVE');
assert.equal(run([page([], 0)], ctx, { analysisId: 'other-analysis' }).verdict, 'INCONCLUSIVE');
// Exercise the real entry guard too: mismatched requests are rejected before
// any scanner request. Consolidation also refuses mismatched evidence above.
const entry = {
  ...ctx, validationRequestId: 'validation', projectId: 'project', fixRequestId: 'fix',
  batchId: 'batch', batchKey: 'batch-key', attemptCount: 1, repository: 'owner/repository',
  prNumber: 42, prHeadBranch: 'candidate', jenkinsJob: 'job', prValidationJob: 'job-pr',
  jenkinsBuildNumber: 1, jenkinsBuildUrl: 'https://ci.invalid/build/1', baseSonarProjectKey: 'project-main',
};
assert.equal(runCode('Extract Validation Context', {}, [entry]).checkoutSha, SHA);
assert.throws(() => runCode('Extract Validation Context', {}, [{ ...entry, checkoutSha: 'b'.repeat(40) }]), /PR_HEAD_SHA_MISMATCH/);
assert.throws(() => runCode('Extract Validation Context', {}, [{ ...entry, analysisId: null }]), /INVALID_VALIDATION_CONTRACT/);
const complete = run([page([], 0)]);
assert.equal(complete.result.checkoutSha, SHA);
assert.equal(complete.result.expectedPrHeadSha, SHA);
assert.equal(complete.result.analysisId, ctx.analysisId);
assert.equal(complete.result.candidateSnapshotComplete, true);
for (const state of [{ status: 'UNKNOWN' }, { status: undefined }, { status: 'OPEN', issueStatus: 'FIXED' }]) {
  assert.equal(run([page([{ ...late, ...state }], 1)]).verdict, 'INCONCLUSIVE', 'unknown/conflicting lifecycle evidence');
}
assert.equal(run([page([{ ...late, status: 'CLOSED', resolution: 'FIXED' }], 1)]).verdict, 'VALID');
assert.equal(run([page([{ ...late, status: 'REOPENED' }], 1)]).verdict, 'INVALID');
// Native mode retains the generic PR-scoped query; candidate identity is unchanged.
assert.equal(run([page([], 0)], { ...ctx, sonarAnalysisMode: 'DEVELOPER_NATIVE_PR', prNumber: 42 }).verdict, 'VALID');
console.log('WF3 target pagination: 0/short/500/501/later pages, errors/metadata/bounds/duplicates, SHA and verdict safety PASS');
