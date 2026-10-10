// R48 — completude des donnees, sans regression de la verite des donnees.
//
// Couvre les quatre fronts du bouclage :
//   - les constats retenus d'une execution anterieure sont annonces, pas tus,
//     et n'alimentent AUCUN compteur de ce build ;
//   - l'absence de configuration Azure se distingue de l'impossibilite
//     technique, sans toucher READY / CONDITIONAL / CRITICAL_RISK ;
//   - les mesures Sonar courantes sont lues du contrat backend, chaque absence
//     gardant son motif, et un zero reel restant zero ;
//   - aucune identite de projet n'est requise pour tout cela.
//
//   node frontend/scripts/data-truth-completeness-r48.spec.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');
const truthSrc = read('../src/app/shared/data-truth.ts');

const strip = (s) => s
  .replace(/export function /g, 'function ')
  .replace(/: *number \| null/g, '').replace(/: *boolean/g, '')
  .replace(/: *string/g, '').replace(/: *unknown/g, '').replace(/: *any/g, '');
const pick = (name, src = truthSrc) => {
  const start = src.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `${name} doit exister`);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return strip(src.slice(start, j + 1));
  }
  throw new Error(`corps de ${name} introuvable`);
};
const mod = new Function(`
  ${pick('availableNumber')}
  ${pick('scannerHasResult')}
  ${pick('scannerMetric')}
  ${pick('scannerHasStaleFindings')}
  ${pick('scannerStaleFindingCount')}
  return { availableNumber, scannerHasResult, scannerMetric, scannerHasStaleFindings, scannerStaleFindingCount };
`)();
const { scannerHasResult, scannerMetric, scannerHasStaleFindings, scannerStaleFindingCount } = mod;

// ════════════════════════════════════════════════════════════════════════════
// 1. Constats retenus d'une execution anterieure
// Cas reel : devsecops-testbed build #19 — status NOT_RUN avec 154 CVE Trivy.
// ════════════════════════════════════════════════════════════════════════════
const staleTrivy = {
  status: 'NOT_RUN', scanState: 'NOT_RUN', findingsStale: true,
  findingsStaleReason: 'SCANNER_NOT_RUN_THIS_BUILD',
  critical: 11, high: 56, cves_count: 154, cves: new Array(154).fill({}),
  executed: false, completed: false, resultAvailable: false, findingCount: null,
};
assert.equal(scannerHasStaleFindings(staleTrivy), true, 'les 154 CVE doivent etre reconnues comme anterieures');
assert.equal(scannerStaleFindingCount(staleTrivy), 154, 'leur nombre reel doit etre annonce');

// ── ET SURTOUT : elles ne comptent pas pour ce build (non-regression) ──
assert.equal(scannerHasResult(staleTrivy), false,
  'un scanner non execute ne doit JAMAIS paraitre avoir un resultat');
for (const field of ['critical', 'high', 'cves_count']) {
  assert.equal(scannerMetric(staleTrivy, field), null,
    `${field} doit rester indisponible pour ce build malgre les constats retenus`);
}

// ── Une vraie execution n'est jamais etiquetee anterieure ──
const realTrivy = {
  status: 'COMPLETED', scanState: 'COMPLETED_WITH_FINDINGS', findingsStale: false,
  critical: 1, high: 1, cves_count: 4, cves: new Array(4).fill({}), resultAvailable: true,
};
assert.equal(scannerHasStaleFindings(realTrivy), false);
assert.equal(scannerStaleFindingCount(realTrivy), null);
assert.equal(scannerMetric(realTrivy, 'critical'), 1, 'une vraie execution garde ses compteurs');

// ── Etiquette sans constats : rien a annoncer ──
assert.equal(scannerHasStaleFindings({ status: 'NOT_RUN', findingsStale: true, cves: [] }), false);
assert.equal(scannerHasStaleFindings({ status: 'NOT_RUN', findingsStale: true }), false);
// ── Un bloc d'avant le correctif (sans le champ) ne change pas de comportement ──
assert.equal(scannerHasStaleFindings({ status: 'NOT_RUN', cves: new Array(9).fill({}) }), false,
  'sans etiquette explicite de WF1, aucune supposition');
for (const junk of [null, undefined, {}, 'x', 7]) assert.equal(scannerHasStaleFindings(junk), false);

// ── ZERO REEL PRESERVE (non-regression du front precedent) ──
const cleanScan = { status: 'COMPLETED', scanState: 'COMPLETED_ZERO_FINDINGS', resultAvailable: true, critical: 0, cves: [] };
assert.equal(scannerMetric(cleanScan, 'critical'), 0, 'un zero mesure reste zero');

// ════════════════════════════════════════════════════════════════════════════
// 2. Azure — « non configure » n'est pas « techniquement impossible »
// ════════════════════════════════════════════════════════════════════════════
const dgSrc = read('../src/app/features/projects/deployment-governance.component.ts');
assert.ok(dgSrc.includes("const NOT_CONFIGURED_PRESENTATION = { label: 'Azure non configuré'"),
  'une presentation dediee doit exister');
assert.ok(/d === 'TECHNICALLY_IMPOSSIBLE' && this\.deploymentConfigured === false/.test(dgSrc),
  'la distinction doit exiger un deploymentConfigured EXPLICITEMENT false');
// Gouvernance intacte : les trois autres classes ne sont jamais reinterpretees.
for (const cls of ['READY', 'CONDITIONAL', 'CRITICAL_RISK']) {
  assert.ok(!new RegExp(`d === '${cls}'[^\\n]*deploymentConfigured`).test(dgSrc),
    `${cls} ne doit jamais etre reinterprete par la configuration`);
}
assert.ok(dgSrc.includes("TECHNICALLY_IMPOSSIBLE: { label: 'Déploiement techniquement impossible'"),
  "l'etiquette d'origine doit rester pour un projet REELLEMENT configure");
// `null` (inconnu) ne doit pas basculer dans « non configure ».
assert.ok(!/deploymentConfigured !== true/.test(dgSrc),
  'une configuration inconnue ne doit pas etre presentee comme absente');

// ════════════════════════════════════════════════════════════════════════════
// 3. Mesures Sonar courantes — lues du contrat, jamais devinees
// ════════════════════════════════════════════════════════════════════════════
const pdSrc = read('../src/app/features/projects/project-detail.component.ts');
const pdHtml = read('../src/app/features/projects/project-detail.component.html');

assert.ok(pdSrc.includes('getSonarMetrics(this.id)'), 'le contrat backend existant doit etre consomme');
assert.ok(/this\.activeTab === 'sonarqube'\) this\.loadSonarMetrics\(\)/.test(pdSrc),
  'le chargement doit rester paresseux, par onglet (protection de performance)');
assert.ok(/takeUntil\(this\.projectScopeReset\$\)[\s\S]{0,80}sonarLive|getSonarMetrics\(this\.id\)\.pipe\(takeUntil\(this\.projectScopeReset\$\)\)/.test(pdSrc),
  'la requete doit etre annulee au changement de projet');
assert.ok(/this\.sonarLive = null;\s*\n\s*this\.sonarLiveLoading = false;/.test(pdSrc),
  "l'etat doit etre vide au changement de projet (aucune valeur periemee)");

// Chaque motif d'indisponibilite du backend a sa formulation : aucun fourre-tout.
for (const reason of ['SONAR_NOT_CONFIGURED', 'SONAR_TOKEN_UNAVAILABLE', 'SONAR_PROJECT_NOT_FOUND', 'SONAR_API_ERROR']) {
  assert.ok(pdSrc.includes(reason), `le motif ${reason} doit etre presente distinctement`);
}
assert.ok(pdSrc.includes("SONAR_API_STATUS_"), 'un statut HTTP de Sonar doit rester lisible');
// Les mesures passent par availableNumber ET par available === true.
assert.ok(/sonarLiveMetric\(field: string\)[\s\S]{0,180}available === true[\s\S]{0,60}availableNumber/.test(pdSrc),
  'une mesure ne doit etre lue que si le backend declare les donnees disponibles');

// Les onze mesures reellement servies par le contrat sont affichees.
for (const m of ['qualityGate', 'bugs', 'vulnerabilities', 'codeSmells', 'securityHotspots',
                 'coverage', 'duplications', 'linesOfCode', 'reliabilityRating',
                 'securityRating', 'maintainabilityRating']) {
  assert.ok(pdHtml.includes(`'${m}'`), `la mesure ${m} doit apparaitre dans la vue Sonar`);
}
assert.ok(pdHtml.includes("sonarLiveText('lastAnalysisAt')"), "la date d'analyse doit etre affichee");
// Separation historique / courant explicitement enoncee a l'ecran.
assert.ok(pdHtml.includes('Mesures SonarQube courantes') && /de ce build<\/strong>/.test(pdHtml),
  'la vue doit distinguer explicitement instantane de build et etat courant');

// ════════════════════════════════════════════════════════════════════════════
// 4. ZAP — champs importes affiches, confiance 0 traitee comme une valeur
// ════════════════════════════════════════════════════════════════════════════
const zapSrc = read('../src/app/features/projects/zap-table.component.ts');
for (const f of ['confidenceLabel', 'pluginId', 'cweId']) {
  assert.ok(zapSrc.includes(`a.${f}`), `la table ZAP doit afficher ${f}`);
}
assert.ok(/confidence\?: number \| null/.test(zapSrc), 'le type normalise doit porter confidence');
// L'etiquette est utilisee plutot que le nombre : 0 = « Faux positif » reste lisible.
assert.ok(zapSrc.includes('*ngIf="a.confidenceLabel"'),
  "l'affichage doit s'appuyer sur l'etiquette, pour que la confiance 0 reste visible");

// ════════════════════════════════════════════════════════════════════════════
// 5. GENERICITE — aucune identite de projet nulle part
// ════════════════════════════════════════════════════════════════════════════
for (const [name, src] of [['data-truth.ts', truthSrc], ['project-detail.ts', pdSrc],
                           ['deployment-governance.ts', dgSrc], ['zap-table.ts', zapSrc]]) {
  const body = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  for (const needle of ['pfe-app-test', 'app-test-pfe-vermeg', 'vuln-testapp', 'devsecops-testbed']) {
    assert.ok(!body.includes(needle), `${name} ne doit pas nommer ${needle} hors commentaire`);
  }
  assert.ok(!/['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/.test(body),
    `${name} ne doit contenir aucun UUID de projet`);
}

console.log('R48 data completeness without truth regression: PASS');
