// Vérifie les écarts entre les versions du workflow dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executableContent, presentationContent, sha256 } from './wf2-drift-content.mjs';
const raw=JSON.parse(readFileSync(new URL('../pending-live-update/WF2-R91-TRUE-CANCELLATION.OFFLINE.json',import.meta.url)));
const w=Array.isArray(raw)?raw[0]:raw;
/** Prépare les données nécessaires à ce scénario. */
const hash=x=>sha256(executableContent(x));
/** Prépare les données nécessaires à ce scénario. */
const presentation=x=>sha256(presentationContent(x));
const visual=structuredClone(w);visual.nodes[0].position=[1,2];visual.nodes.find(n=>n.type==='n8n-nodes-base.stickyNote').parameters.content='documentation';visual.versionId='metadata';visual.updatedAt='metadata';
assert.equal(hash(w),hash(visual));assert.notEqual(presentation(w),presentation(visual));
for(const change of [
 x=>x.nodes[0].parameters.securityMutation=true,
 x=>x.nodes[0].credentials={githubApi:{id:'different',name:'different'}},
 x=>x.nodes[0].onError='continueRegularOutput',
 x=>x.nodes[0].disabled=true,
 x=>x.nodes[0].type='changed',
 x=>x.settings.executionOrder='changed',
 x=>x.connections['WF2 Cancellation Terminal']={main:[[{node:'Create Pull Request1',type:'main',index:0}]]},
]) { const mutated=structuredClone(w);change(mutated);assert.notEqual(hash(w),hash(mutated)); }
const reordered=structuredClone(w);reordered.nodes.reverse();assert.equal(hash(w),hash(reordered));
console.log('CANONICAL HASH PASS: visual/version exclusions; parameters, credentials, error policy, disabled flag, type, settings and unsafe edges remain detectable');
