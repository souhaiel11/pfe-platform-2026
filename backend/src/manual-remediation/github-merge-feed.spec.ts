// Teste le constat de merge par le flux Atom des commits (secours quand l'API GitHub refuse : quota anonyme épuisé).
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findMergeInCommitFeed } from './github-merge-feed';

const feed = readFileSync(join(__dirname, '__fixtures__/commits-main.atom'), 'utf8');
assert.deepEqual(findMergeInCommitFeed(feed, 35, 'souhaiel11'),
  { mergeCommitSha: '1d73b80923954a0eeb5874a8e6b710211f6bc564', mergedAt: '2026-10-27T16:42:32Z' }, 'real GitHub feed: PR #35 merge commit');
assert.equal(findMergeInCommitFeed(feed, 34, 'souhaiel11')?.mergeCommitSha, 'd06f3bb2ebc87300aca9cb8554fa3a97b45baf4d');
assert.equal(findMergeInCommitFeed(feed, 3, 'souhaiel11'), null, '#3 must not match #35 or #34');
assert.equal(findMergeInCommitFeed(feed, 35, 'someone-else'), null, 'merge from another owner is not trusted');
assert.equal(findMergeInCommitFeed(feed, 99, 'souhaiel11'), null, 'unmerged PR is not found');
console.log('github-merge-feed.spec.ts: ALL CHECKS PASS');
