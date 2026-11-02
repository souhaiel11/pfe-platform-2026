// Vérifie la réutilisation de la même PR dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(here, '..', 'active', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.json');
const workflow = JSON.parse(readFileSync(wfPath, 'utf8'))[0];
const node = workflow.nodes.find(n => n.name === 'Select Existing PR');
assert.ok(node, 'Select Existing PR node must exist in the repo-tracked, active WF2 export');
const code = node.parameters.jsCode;

/** Exécute le traitement et collecte son résultat. */
function run(ctx, prCandidates) {
  /** Simule les dépendances nécessaires au scénario. */
  const mock = name => name === 'Prepare Batch Context' ? {
  /** Renvoie le premier élément disponible. */
  first: () => ({ json: ctx }) } : undefined;
  const fn = new Function('$', '$input', code);
  const mockInput = {
  /** Renvoie tous les éléments disponibles. */
  all: () => prCandidates.map(pr => ({ json: pr })) };
  return fn(mock, mockInput)[0].json;
}

const baseCtx = { targetBranchName: 'fix/pfe-incident-1-req-1', baseBranch: 'main', githubRepo: 'owner/repo', batchId: 'batch-1' };
const openMatchingPr = { number: 25, state: 'open', head: { ref: 'fix/pfe-incident-1-req-1', repo: { full_name: 'owner/repo' } }, base: { ref: 'main', repo: { full_name: 'owner/repo' } }, body: 'Batch : batch-1' };

// Case 1: normal (non-corrective) first attempt, no PR exists yet -- must
// still allow creation, exactly as before this change.
{
  const out = run(baseCtx, []);
  assert.equal(out.createRequired, true);
  assert.equal(out.existingPr, null);
}

// Case 2: normal (non-corrective) attempt, a matching open PR already
// exists -- reused, never duplicated (unchanged prior behavior).
{
  const out = run(baseCtx, [openMatchingPr]);
  assert.equal(out.createRequired, false);
  assert.equal(out.existingPr.number, 25);
}

// Case 3 (BRIQUE 5) -- corrective attempt, the expected PR is genuinely
// open: reused exactly like the normal case, zero behavior change.
{
  const out = run({ ...baseCtx, correctiveAttempt: true }, [openMatchingPr]);
  assert.equal(out.createRequired, false);
  assert.equal(out.existingPr.number, 25);
}

// Case 4 (BRIQUE 5, the new fail-closed contract) -- corrective attempt,
// but no matching OPEN PR exists (closed/merged/never existed): must NEVER
// fall through to PR creation. Deterministic failure, not a replacement PR.
{
  assert.throws(() => run({ ...baseCtx, correctiveAttempt: true }, []), /EXPECTED_PR_NOT_OPEN/);
}
{
  // Same PR exists but CLOSED -- filtered out by the existing state==='open'
  // check, so this is indistinguishable from "no PR" and must also fail closed.
  const closedPr = { ...openMatchingPr, state: 'closed' };
  assert.throws(() => run({ ...baseCtx, correctiveAttempt: true }, [closedPr]), /EXPECTED_PR_NOT_OPEN/);
}

// Case 5 -- correctiveAttempt explicitly false (or absent) behaves exactly
// like the normal case even with zero matching PRs (never throws).
{
  const out = run({ ...baseCtx, correctiveAttempt: false }, []);
  assert.equal(out.createRequired, true);
}

console.log('WF2 corrective same-PR guarantee (Brique 5): PASS');
