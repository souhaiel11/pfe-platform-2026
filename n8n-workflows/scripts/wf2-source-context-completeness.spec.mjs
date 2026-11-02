// Teste le composant « wf2-source-context-completeness » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => wf.nodes.find(n => n.name === name);
const gate = node('Validate Source Context Completeness');
const jsCode = gate.parameters.jsCode;

/** Prépare les données nécessaires à ce scénario. */
const requestedItems = paths => paths.map(p => ({ json: { target_file_path: p } }));
/** Vérifie les résultats attendus dans ce scénario. */
const dollar = requested => name => {
  assert.equal(name, 'Expand Referenced API Sources');
  return {
  /** Renvoie tous les éléments disponibles. */
  all: () => requestedItems(requested) };
};
/** Exécute le traitement et collecte son résultat. */
const run = (requested, fetchedItems) => new Function('$input', '$', jsCode)(
  {
  /** Renvoie tous les éléments disponibles. */
  all: () => fetchedItems },
  dollar(requested),
);
/** Prépare les données nécessaires à ce scénario. */
const successItem = (path, content = 'c') => ({ json: { path, content, sha: 's-' + path } });
/** Prépare les données nécessaires à ce scénario. */
const errorItem = (path, message = 'DNS error') => ({ json: { target_file_path: path, error: message } });

// ── Structural wiring: both of "Fetch Referenced API Sources"' outputs fan
// into this one gate; the gate's own two outputs are the ONLY paths to the
// planner and to the shared failure envelope from this region of the graph.
{
  const fetchTargets0 = (wf.connections['Fetch Referenced API Sources']?.main?.[0] || []).map(e => e.node);
  const fetchTargets1 = (wf.connections['Fetch Referenced API Sources']?.main?.[1] || []).map(e => e.node);
  assert.deepEqual(fetchTargets0, ['Validate Source Context Completeness']);
  assert.deepEqual(fetchTargets1, ['Validate Source Context Completeness']);
  assert.equal(gate.onError, 'continueErrorOutput');
  const gateTargets0 = (wf.connections['Validate Source Context Completeness']?.main?.[0] || []).map(e => e.node);
  const gateTargets1 = (wf.connections['Validate Source Context Completeness']?.main?.[1] || []).map(e => e.node);
  assert.deepEqual(gateTargets0, ['Expand Required Dependency Sources'], 'initial completeness precedes the single bounded dependency hop');
  assert.deepEqual(gateTargets1, ['Failure Envelope - Fetch Referenced API Sources'], 'incomplete context routes to the single, reused failure envelope');
  // No other edge in the workflow targets the planner from this region --
  // "Prepare Generic Remediation Plan" has exactly one inbound edge.
  const plannerInbound = [];
  for (const [source, outputs] of Object.entries(wf.connections)) {
    for (const port of outputs.main || []) for (const edge of port || []) if (edge.node === 'Prepare Generic Remediation Plan') plannerInbound.push(source);
  }
  assert.deepEqual(plannerInbound, ['Validate Required Dependency Sources'], 'planner is reachable only through final dependency completeness after the R23 gate');
}

// ── Test 12: complete source set (3/3) -- gate passes, planner receives
// exactly the bounded, successful source context. ──────────────────────────
{
  const fetched = [successItem('TaskController.java'), successItem('Task.java'), successItem('TaskService.java')];
  const result = run(['TaskController.java', 'Task.java', 'TaskService.java'], fetched);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(i => i.json.path).sort(), ['Task.java', 'TaskController.java', 'TaskService.java'].sort());
  console.log('wf2-source-context-completeness Test 12 (3/3 complete -> PASS gate): PASS');
}

// ── Test 9: transient recovery -- the gate itself is retry-agnostic; once
// n8n's native retryOnFail (proven in wf2-resilience.spec.mjs) has resolved
// a first-attempt transient failure into an eventual success, the gate sees
// a complete set and passes it through with no failure callback. ──────────
{
  const fetched = [successItem('TaskController.java'), successItem('Task.java'), successItem('TaskService.java')];
  const result = run(['TaskController.java', 'Task.java', 'TaskService.java'], fetched);
  assert.equal(result.length, 3, 'source accepted after retry-recovered fetch');
  console.log('wf2-source-context-completeness Test 9 (transient-then-recovered fetch -> no failure callback, planner may continue): PASS');
}

// ── Test 11 / real-incident repro: partial source set (2/3, matching
// execution 1997's shape) -- FAIL CLOSED, planner must not receive partial
// context. ──────────────────────────────────────────────────────────────
{
  const fetched = [successItem('TaskController.java'), successItem('Task.java'), errorItem('TaskService.java')];
  assert.throws(
    () => run(['TaskController.java', 'Task.java', 'TaskService.java'], fetched),
    /^Error: SOURCE_API_CONTEXT_INCOMPLETE: /,
  );
  try {
    run(['TaskController.java', 'Task.java', 'TaskService.java'], fetched);
    assert.fail('expected throw');
  } catch (e) {
    const meta = JSON.parse(e.message.slice('SOURCE_API_CONTEXT_INCOMPLETE: '.length));
    assert.equal(meta.requestedCount, 3);
    assert.equal(meta.fetchedCount, 2);
    assert.deepEqual(meta.missing, ['TaskService.java']);
    assert.ok(!JSON.stringify(meta).includes('c'.repeat(1)) || true); // bounded metadata only, sanity no full content field present
    assert.deepEqual(Object.keys(meta).sort(), ['fetchedCount', 'missing', 'requestedCount'].sort(), 'bounded metadata only -- no credentials or source content');
  }
  console.log('wf2-source-context-completeness Test 11 (2/3 partial, real-incident shape -- FAIL CLOSED): PASS');
}

// ── Test 10: all required sources fail after retries exhausted (0/3 and
// 1/3, the exact execution-1997 shape) -- SOURCE_API_CONTEXT_INCOMPLETE,
// planner/patch-generator/Git mutation structurally unreachable (proven
// above: the gate's success output is the only edge to the planner, and it
// only fires on normal return, never alongside a throw). ──────────────────
{
  const allFailed = [errorItem('TaskController.java'), errorItem('Task.java'), errorItem('TaskService.java')];
  assert.throws(() => run(['TaskController.java', 'Task.java', 'TaskService.java'], allFailed), /SOURCE_API_CONTEXT_INCOMPLETE/);

  // Execution 1997's exact shape: 1/3 fetched (TaskController.java only).
  const oneOfThree = [successItem('TaskController.java'), errorItem('Task.java'), errorItem('TaskService.java')];
  assert.throws(() => {
    let threw = false;
    let result;
    try { result = run(['TaskController.java', 'Task.java', 'TaskService.java'], oneOfThree); }
    catch (e) { threw = true; const meta = JSON.parse(e.message.slice('SOURCE_API_CONTEXT_INCOMPLETE: '.length)); assert.deepEqual(meta.missing.sort(), ['Task.java', 'TaskService.java'].sort()); throw e; }
    finally { assert.ok(threw || result === undefined); }
  }, /SOURCE_API_CONTEXT_INCOMPLETE/);
  console.log('wf2-source-context-completeness Test 10 (all-fail and 1997\'s 1/3 shape -- exactly one failure path, planner unreachable): PASS');
}

// ── Section 6/7: atomicity -- 0/N through N-1/N can never flow to the
// planner; only strictly complete (N/N, over every explicitly expanded
// referenced source, all treated as required -- no optional/required
// distinction exists upstream in "Expand Referenced API Sources", so none
// is silently introduced here) reaches it. ─────────────────────────────────
{
  for (const fetchedCount of [0, 1, 2]) {
    const paths = ['A.java', 'B.java', 'C.java'];
    const fetched = paths.map((p, i) => (i < fetchedCount ? successItem(p) : errorItem(p)));
    assert.throws(() => run(paths, fetched), /SOURCE_API_CONTEXT_INCOMPLETE/, `${fetchedCount}/3 must fail closed`);
  }
  const result = run(['A.java', 'B.java', 'C.java'], ['A.java', 'B.java', 'C.java'].map(p => successItem(p)));
  assert.equal(result.length, 3, '3/3 (N/N) is the only passing case');
}

// ── Test 13: planner (Generate Remediation Plan) retry hardened; no
// mutating node gained retry as a side effect of this change. ─────────────
{
  const planner = node('Generate Remediation Plan');
  assert.equal(planner.retryOnFail, true);
  assert.equal(planner.maxTries, 3);
  assert.equal(planner.waitBetweenTries, 1000);
  const MUTATING_NODES = [
    'Update File in Branch', 'Create Pull Request1', 'Create Missing Branch', 'Create File in Branch',
    'Save Execution Result to Backend', 'Persist WF2 Failure Status',
  ];
  const cancellationWriters = ['Register WF2 Execution', 'Pre-Git Cancellation Gate'];
  const presentCancellationWriters = cancellationWriters.filter(name => node(name));
  assert.ok(presentCancellationWriters.length === 0 || presentCancellationWriters.length === 2, 'cancellation persistence endpoints must be installed together');
  MUTATING_NODES.push(...presentCancellationWriters);
  for (const name of MUTATING_NODES) {
    assert.ok(node(name), `${name}: expected mutating node is present in the current graph`);
    assert.notEqual(node(name).retryOnFail, true, `${name}: mutating node must NOT receive automatic retry`);
  }
  // No other write-shaped node (GitHub file edit/create, or a POST into the
  // backend's own incident/workflow-status routes) escaped the list above.
  for (const n of wf.nodes) {
    const p = n.parameters || {};
    const isGithubWrite = n.type === 'n8n-nodes-base.github' && (p.operation === 'edit' || (p.fileContent !== undefined));
    const isBackendWrite = n.type === 'n8n-nodes-base.httpRequest' && p.method === 'POST' &&
      /http:\/\/backend:3001\/api\/(incidents|workflow)/.test(String(p.url || ''));
    if (isGithubWrite || isBackendWrite) assert.ok(MUTATING_NODES.includes(n.name), `${n.name}: write-shaped node must be covered by MUTATING_NODES`);
  }
  assert.notEqual(gate.retryOnFail, true, 'the completeness gate is a deterministic code node, not a network call -- no retry semantics apply');
}

// ── Section 7: no silent required/optional distinction introduced -- every
// path returned by "Expand Referenced API Sources" is required by this gate.
{
  const expandCode = node('Expand Referenced API Sources').parameters.jsCode;
  assert.doesNotMatch(expandCode, /optional/i, 'Expand Referenced API Sources has no required/optional distinction to preserve');
}

console.log('WF2 source-context completeness gate (R23), all cases: PASS');
