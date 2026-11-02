// Teste le choix du commit de base après un merge confirmé sans build.
import * as assert from 'node:assert/strict';
import { effectiveBaseSha } from './post-merge-baseline';

const buildSha = 'a'.repeat(40), mergeSha = 'B'.repeat(40);
const builtAt = '2026-10-25T10:00:00Z';

assert.equal(effectiveBaseSha(buildSha, builtAt, null), buildSha, 'sans merge confirmé : commit du build');
assert.equal(effectiveBaseSha(buildSha, builtAt, { mergeCommitSha: mergeSha, prMergedAt: '2026-10-25T11:00:00Z' }), mergeSha.toLowerCase(),
  'merge postérieur au build : on part du commit de merge');
assert.equal(effectiveBaseSha(buildSha, new Date('2026-10-25T12:00:00Z'), { mergeCommitSha: mergeSha, prMergedAt: '2026-10-25T11:00:00Z' }), buildSha,
  'build postérieur au merge (il le contient déjà) : commit du build');
assert.equal(effectiveBaseSha(buildSha, builtAt, { mergeCommitSha: 'pas-un-sha', prMergedAt: '2026-10-25T11:00:00Z' }), buildSha, 'SHA invalide ignoré');
assert.equal(effectiveBaseSha(buildSha, builtAt, { mergeCommitSha: mergeSha, prMergedAt: 'n/a' }), buildSha, 'date invalide ignorée');
assert.equal(effectiveBaseSha(buildSha, null, { mergeCommitSha: mergeSha, prMergedAt: '2026-10-25T11:00:00Z' }), buildSha, 'date de build inconnue : prudence');
console.log('post-merge-baseline: OK');
