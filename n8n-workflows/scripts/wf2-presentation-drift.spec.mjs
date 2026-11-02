// Vérifie les écarts entre les versions du workflow dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presentationDiff, presentationContent, sha256 } from './wf2-drift-content.mjs';
/** Lit les données depuis leur source. */
const read = path => { const w=JSON.parse(readFileSync(path)); return Array.isArray(w)?w[0]:w; };
const r = read(new URL('../../docs/qa/r91-live-promotion/WF2-R91-POST-RESTART-ACTIVE.json',import.meta.url));
const w = read(process.env.WF2_CANCELLATION_ARTIFACT || new URL('../../docs/qa/wf2-drift-normalization/current-active.json',import.meta.url));
assert.equal(w.activeVersionId, '6f258934-86ea-4dd9-8617-e80afc420373', 'this presentation regression fixture is version-specific');
const diff = presentationDiff(r,w);
assert.equal(diff.positions.length,7);
assert.equal(diff.stickyNotes.length,6);
assert.notEqual(sha256(presentationContent(r)),sha256(presentationContent(w)));
console.log('PRESENTATION PASS: detected 7 position changes and 6 sticky changes; no executable failure');
console.log(JSON.stringify(diff,null,2));
