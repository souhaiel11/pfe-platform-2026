// Teste le composant « wf1-owasp-normalization » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildOwaspNodePatch } from './build-wf1-owasp-normalization.mjs';
/** Lit les données depuis leur source. */
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const input = process.argv[2] || new URL('../active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json', import.meta.url);
const raw = read(input), workflow = Array.isArray(raw) ? raw[0] : raw;
const baseline = workflow.nodes.find(n => n.name === 'Merge All Fetched Data').parameters.jsCode;
const patch = buildOwaspNodePatch(workflow);
const updated = structuredClone(workflow);
updated.nodes.find(n => n.name === patch.nodeName).parameters.jsCode = patch.jsCode;
assert.equal(buildOwaspNodePatch(updated).jsCode, patch.jsCode, 'generator is idempotent');
const dependencies = read(new URL('../../backend/src/common/fixtures/owasp-149-dependencies.json', import.meta.url)).dependencies;
const trivy = { Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-2023-6378', PkgName: 'ch.qos.logback:logback-classic', InstalledVersion: '1.2.11', FixedVersion: '1.3.12, 1.4.12, 1.2.13', Severity: 'HIGH' }] }] };
/** Évalue les données et retourne la décision correspondante. */
function evaluate(code) {
 const values = { 'Parse OWASP JSON': { dependencies }, 'Parse Trivy JSON': trivy, 'Extract Project Config': { jenkins: { build_number: 149 }, projectConfig: {} }, 'Prepare Fetch URLs': { incidentUUID: 'fixture' } };
 /** Simule l’accès à un nœud n8n pour le scénario. */
 const $ = name => ({ 
 /** Renvoie le premier élément disponible. */
 first: () => ({ json: values[name] || {} }) });
 return JSON.parse(JSON.stringify(vm.runInNewContext(`(function(){${code}\n})()`, { $, console })[0].json.enrichedData));
}
const old = evaluate(baseline), next = evaluate(patch.jsCode);
assert.equal(next.owasp.cves.length, 146);
assert.ok(next.owasp.cves.every(f => f.packageType === 'maven' && f.purl && f.installedVersion && f.fixedVersion === null));
assert.deepEqual(next.trivy, old.trivy);
for (const key of ['sonar', 'zap', 'tests', 'build', 'docker', 'deploy']) assert.deepEqual(next[key], old[key]);
assert.deepEqual(next.owasp.cves.map(f => f.id), old.owasp.cves.map(f => f.id));
console.log('WF1 offline node: PASS (146 real findings enriched; Trivy and other blocks unchanged; generator idempotent)');
