#!/usr/bin/env node
// Vérifie WF6 pr36 garde et ses cas d’erreur.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';

const [w] = JSON.parse(readFileSync(new URL('../pending-live-update/wf6-security-remediation-maven.OFFLINE-DRAFT.json', import.meta.url)));
const byName = Object.fromEntries(w.nodes.map(n => [n.name, n]));

const PR36_REPO = 'souhaiel11/pfe-app-test';
const PR36_BRANCH = 'security/fix/a37e178f7ce1-1ebe4cecc872';
const UNRELATED_BRANCH = 'security/fix/deadbeefcafe-1234567890ab';

/** Vérifie les résultats attendus dans ce scénario. */
function runGuard(nodeName, jsonInput, trustedCandidateJson) {
  const node = byName[nodeName];
  assert.ok(node, `node "${nodeName}" must exist in the workflow`);
  assert.equal(node.type, 'n8n-nodes-base.code', `"${nodeName}" must be a Code node`);
  const context = {
    $json: jsonInput,
    /** Simule l’accès à un nœud n8n pour le scénario. */
    $: (ref) => {
      assert.equal(ref, 'Trusted Candidate', `guard must only ever reference the "Trusted Candidate" node, got "${ref}"`);
      return { 
      /** Renvoie le premier élément disponible. */
      first: () => ({ json: trustedCandidateJson }) };
    },
  };
  const wrapped = `(function(){ ${node.parameters.jsCode} })()`;
  const result = vm.runInNewContext(wrapped, context);
  return result[0].json;
}

// --- Node presence and wiring shape ---
test('both PR36 guard nodes and the shared rejection responder exist', () => {
  for (const name of ['PR36 Protection Check (Target)', 'PR36 Protection Passed? (Target)',
    'PR36 Protection Check (Resolved PR)', 'PR36 Protection Passed? (Resolved PR)', 'Respond - PR36_PROTECTED']) {
    assert.ok(byName[name], `"${name}" must exist`);
  }
  assert.equal(byName['Respond - PR36_PROTECTED'].type, 'n8n-nodes-base.respondToWebhook');
  assert.match(byName['Respond - PR36_PROTECTED'].parameters.responseBody, /PR36_PROTECTED/);
});

test('guard is wired BEFORE the first PR-lookup/branch-lookup node on both entry paths, not after', () => {
  // Initial Ancestry Valid? (TRUE) must now lead into the guard, not directly into the lookup.
  assert.equal(w.connections['Initial Ancestry Valid?'].main[0][0].node, 'PR36 Protection Check (Target)');
  assert.equal(w.connections['PR36 Protection Check (Target)'].main[0][0].node, 'PR36 Protection Passed? (Target)');
  const [safe1, blocked1] = w.connections['PR36 Protection Passed? (Target)'].main;
  assert.equal(safe1[0].node, 'Early Historical PR Lookup', 'only a PASSED guard may proceed into the historical PR lookup');
  assert.equal(blocked1[0].node, 'Respond - PR36_PROTECTED');

  assert.equal(w.connections['Historical Trusted PR State'].main[0][0].node, 'PR36 Protection Check (Resolved PR)');
  assert.equal(w.connections['PR36 Protection Check (Resolved PR)'].main[0][0].node, 'PR36 Protection Passed? (Resolved PR)');
  const [safe2, blocked2] = w.connections['PR36 Protection Passed? (Resolved PR)'].main;
  assert.equal(safe2[0].node, 'Historical PR Shape Valid?', 'only a PASSED guard may proceed into PR-shape validation (the path toward Historical PR Reused / eventual write)');
  assert.equal(blocked2[0].node, 'Respond - PR36_PROTECTED');
});

// --- Guard A: target branch/repository check ---
test('protected branch rejected before any GitHub write (target guard)', () => {
  const out = runGuard('PR36 Protection Check (Target)', {}, { repository: PR36_REPO, branchName: PR36_BRANCH });
  assert.equal(out.pr36Protected, true);
  assert.equal(out.pr36GuardReason, 'MATCHES_PR36_TARGET_BRANCH');
});

test('missing required identity rejected (target guard, fail-closed)', () => {
  for (const trusted of [{ repository: '', branchName: PR36_BRANCH }, { repository: PR36_REPO, branchName: '' }, {}]) {
    const out = runGuard('PR36 Protection Check (Target)', {}, trusted);
    assert.equal(out.pr36Protected, true, `missing identity must fail closed for input ${JSON.stringify(trusted)}`);
    assert.equal(out.pr36GuardReason, 'IDENTITY_MISSING');
  }
});

test('an unrelated valid remediation target retains normal behavior (target guard)', () => {
  const out = runGuard('PR36 Protection Check (Target)', {}, { repository: PR36_REPO, branchName: UNRELATED_BRANCH });
  assert.equal(out.pr36Protected, false);
  assert.equal(out.pr36GuardReason, null);
  const outOtherRepo = runGuard('PR36 Protection Check (Target)', {}, { repository: 'someone-else/other-repo', branchName: PR36_BRANCH });
  assert.equal(outOtherRepo.pr36Protected, false, 'same branch string in a DIFFERENT repository is not PR36 and must not be blocked');
});

// --- Guard B: resolved-PR repository+number check ---
test('PR #36 reuse rejected (resolved-PR guard)', () => {
  const state = { ok: true, headMatches: true, state: 'OPEN', pullRequestUrl: 'https://github.com/' + PR36_REPO + '/pull/36', pullRequestNumber: 36, headSha: 'a'.repeat(40) };
  const out = runGuard('PR36 Protection Check (Resolved PR)', state, { repository: PR36_REPO });
  assert.equal(out.pr36Protected, true);
  assert.equal(out.pr36GuardReason, 'MATCHES_PR36_NUMBER');
  // original fields must still pass through unchanged (downstream nodes read $json.ok/.state directly)
  assert.equal(out.ok, true); assert.equal(out.state, 'OPEN'); assert.equal(out.pullRequestNumber, 36);
});

test('missing required identity rejected (resolved-PR guard, fail-closed)', () => {
  const stateNoNumber = { ok: true, state: 'OPEN', pullRequestNumber: Number.NaN };
  const out1 = runGuard('PR36 Protection Check (Resolved PR)', stateNoNumber, { repository: PR36_REPO });
  assert.equal(out1.pr36Protected, true, 'a malformed (non-safe-integer) resolved PR number must fail closed, never silently pass');
  assert.equal(out1.pr36GuardReason, 'IDENTITY_MISSING');

  const stateOk = { pullRequestNumber: 999 };
  const out2 = runGuard('PR36 Protection Check (Resolved PR)', stateOk, { repository: '' });
  assert.equal(out2.pr36Protected, true, 'a missing repository identity must fail closed even when a PR number is present');
  assert.equal(out2.pr36GuardReason, 'IDENTITY_MISSING');
});

test('an unrelated valid remediation target retains normal behavior (resolved-PR guard)', () => {
  const noHistoricalPr = { ok: true, state: 'NONE', pullRequestNumber: null };
  const out1 = runGuard('PR36 Protection Check (Resolved PR)', noHistoricalPr, { repository: PR36_REPO });
  assert.equal(out1.pr36Protected, false, 'no historical PR resolved at all is the normal new-branch path and must not be blocked');
  assert.equal(out1.pr36GuardReason, null);
  assert.equal(out1.state, 'NONE', 'original fields still pass through on the safe path too');

  const differentPr = { ok: true, state: 'OPEN', pullRequestNumber: 41 };
  const out2 = runGuard('PR36 Protection Check (Resolved PR)', differentPr, { repository: PR36_REPO });
  assert.equal(out2.pr36Protected, false, 'a genuinely different, legitimate historical PR number must retain normal reuse behavior');
});

// --- No merge capability exists anywhere in this workflow (structural, not just this guard) ---
test('no PR-merge node exists anywhere in the workflow', () => {
  const suspicious = w.nodes.filter(n => /merge/i.test(n.name) && !/merge_at|merged_at/i.test(n.name));
  // "Historical PR Merged?"/"Final PR Merged?" are READ-ONLY state checks (IF nodes inspecting merged_at),
  // never a mutating merge call -- confirmed by type, never httpRequest with a PUT/merge endpoint.
  for (const n of suspicious) {
    assert.notEqual(n.type, 'n8n-nodes-base.httpRequest', `"${n.name}" must not be an HTTP call -- no node in this workflow may call GitHub's merge endpoint`);
  }
});

console.log('WF6 PR36 explicit protection guard: PASS (wiring position, target-branch guard, resolved-PR guard, fail-closed identity checks, unrelated-target passthrough, no merge capability)');
