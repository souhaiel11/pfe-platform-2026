// R47 — la couverture n'est une mesure que si l'etape de tests a tourne.
//
// WF1 ecrit `coverage: 0` dans le bloc `tests` meme quand l'etape a ete sautee.
// Afficher « 0 % » dans ce cas presente une absence de mesure comme une
// couverture reellement nulle. Un zero d'une etape EXECUTEE reste un vrai zero.
//
//   node frontend/scripts/data-truth-coverage.spec.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/app/shared/data-truth.ts'), 'utf8');

// Le module est du TypeScript sans dependance : on evalue les trois fonctions
// en retirant les annotations de type, plutot que de dupliquer leur logique.
const strip = (s) => s
  .replace(/export function /g, 'function ')
  .replace(/: *number \| null/g, '').replace(/: *boolean/g, '')
  .replace(/: *string(?= *\{)/g, '').replace(/: *unknown/g, '').replace(/: *any/g, '');
const pick = (name) => {
  const start = src.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `${name} doit exister dans data-truth.ts`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return strip(src.slice(start, j + 1));
  }
  throw new Error(`corps de ${name} introuvable`);
};
// Les listes de statuts sont lues DANS la source, jamais recopiees ici : une
// divergence entre le spec et le module serait invisible autrement.
const consts = (src.match(/^const TEST_STAGE_[A-Z_]+ = \[[^\]]*\];$/gm) || []).join('\n');
assert.ok(consts.includes('TEST_STAGE_EXECUTED') && consts.includes('TEST_STAGE_NOT_EXECUTED'),
  'data-truth.ts doit declarer les deux listes de statuts');
const mod = new Function(`
  ${consts}
  ${pick('availableNumber')}
  ${pick('testStageExecuted')}
  ${pick('testStageCoverage')}
  ${pick('testStageCoverageState')}
  return { availableNumber, testStageExecuted, testStageCoverage, testStageCoverageState };
`)();
const { testStageCoverage, testStageCoverageState } = mod;

// ── 1. Etape sautee : `coverage: 0` est un remplissage, jamais une mesure ──
// Observe reellement sur pfe-app-test (build #151) et vuln-testapp (build #41).
assert.equal(testStageCoverage({ coverage: 0, status: 'SKIPPED', total: 0 }), null,
  'une etape SKIPPED ne doit pas produire 0 %');
assert.equal(testStageCoverageState({ coverage: 0, status: 'SKIPPED', total: 0 }), 'Non execute');

// ── 2. Issue inconnue : rien n'a ete mesure ──
// Observe reellement sur devsecops-testbed (build #19).
assert.equal(testStageCoverage({ coverage: 0, status: 'UNKNOWN', total: 0 }), null,
  'une etape UNKNOWN ne doit pas produire 0 %');
assert.equal(testStageCoverageState({ coverage: 0, status: 'UNKNOWN', total: 0 }), 'Non disponible');

// ── 3. ZERO REEL PRESERVE : etape executee qui mesure 0 ──
// Observe reellement sur devsecops-platform-testbed (build #17, 2 tests).
assert.equal(testStageCoverage({ coverage: 0, status: 'SUCCESS', total: 2 }), 0,
  'un zero mesure par une etape executee doit rester 0');
assert.equal(testStageCoverageState({ coverage: 0, status: 'SUCCESS', total: 2 }), '');

// ── 4. Vraie valeur conservee ──
// Observe reellement sur app-test-pfe-vermeg (build #8, 24 tests).
assert.equal(testStageCoverage({ coverage: 92, status: 'SUCCESS', total: 24 }), 92);

// ── 5. Tests en echec : JaCoCo a tout de meme pu mesurer ──
assert.equal(testStageCoverage({ coverage: 71.5, status: 'UNSTABLE', total: 30, failures: 2 }), 71.5);
assert.equal(testStageCoverage({ coverage: 40, status: 'FAILURE', total: 10, failures: 10 }), 40);

// ── 6. Bloc absent / vide : aucune invention ──
for (const empty of [null, undefined, {}, 'nope', 42]) {
  assert.equal(testStageCoverage(empty), null);
}
assert.equal(testStageCoverageState(null), 'Non disponible');
assert.equal(testStageCoverageState({}), 'Non disponible');

// ── 7. Etape non configuree, distincte de non executee ──
assert.equal(testStageCoverageState({ status: 'NOT_CONFIGURED' }), 'Non configure');

// ── 8. Une couverture negative ou non numerique n'est pas une mesure ──
assert.equal(testStageCoverage({ coverage: -1, status: 'SUCCESS' }), null);
assert.equal(testStageCoverage({ coverage: 'NaN', status: 'SUCCESS' }), null);
assert.equal(testStageCoverage({ coverage: null, status: 'SUCCESS' }), null);

// ── 9. Aucun cas particulier par projet ──
assert.equal(
  testStageCoverage({ coverage: 0, status: 'SKIPPED', project: 'pfe-app-test' }),
  testStageCoverage({ coverage: 0, status: 'SKIPPED', project: 'nimporte-quel-nouveau-projet' }),
  'le resultat ne doit dependre que des champs declares par le bloc');

// ── 10. Aucune vue ne contourne le helper ──
const detailTs = readFileSync(join(here, '../src/app/features/projects/project-detail.component.ts'), 'utf8');
const detailHtml = readFileSync(join(here, '../src/app/features/projects/project-detail.component.html'), 'utf8');
const overviewTs = readFileSync(join(here, '../src/app/features/projects/project-overview.component.ts'), 'utf8');
for (const [name, body] of [['project-detail.ts', detailTs], ['project-overview.ts', overviewTs]]) {
  assert.ok(!/availableNumber\([^)]*tests\?\.coverage/.test(body),
    `${name} ne doit plus lire tests.coverage sans verifier l'execution`);
}
assert.ok(!/ed\.tests\?\.coverage *== *null/.test(detailHtml),
  'project-detail.component.html ne doit plus binder tests.coverage directement');
assert.equal((detailHtml.match(/authoritativeCoverage\(\) == null \? coverageState\(\)/g) || []).length, 2,
  'les deux cartes Couverture doivent partager la meme source autoritaire');

console.log('R47 coverage data truth: PASS');
