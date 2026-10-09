// R48 — WF1 ne doit plus perdre de champs reellement fournis par la source,
// ni presenter des constats d'une execution anterieure comme ceux de ce build.
//
// Deux defauts corriges a leur PREMIER point de verite (le node
// « Merge All Fetched Data » de WF1), pas dans le frontend :
//
//   1. Le rapport ZAP porte pluginid, confidence, cweid, et par instance l'URL
//      et le parametre atteints. L'ingestion ne gardait `pluginid` que comme
//      identifiant de repli et jetait tout le reste. La table ZAP du frontend
//      lie DEJA `url` et `param` : elle affichait « Non disponible » faute
//      d'import, pas faute de source.
//
//   2. Un scanner hors perimetre pour un build (etat NOT_RUN) dont le fichier
//      de rapport se parse quand meme lit le rapport d'un build ANTERIEUR : le
//      volume partage n'est pas purge. devsecops-testbed build #19 annoncait
//      ainsi `status: NOT_RUN` avec 154 CVE Trivy et 169 CVE OWASP reelles.
//
//   node n8n-workflows/scripts/wf1-r48-ingestion-completeness.spec.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wfPath = join(here, '../active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json');
const raw = JSON.parse(readFileSync(wfPath, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const code = wf.nodes.find(n => n.name === 'Merge All Fetched Data').parameters.jsCode;

// Les helpers sont extraits DE la source du node, jamais recopies : une
// divergence spec/workflow serait invisible autrement.
const grab = (sig) => {
  const i = code.indexOf(sig);
  assert.notEqual(i, -1, `${sig} doit exister dans le node WF1`);
  // Extraction equilibree : certains helpers tiennent sur plusieurs lignes.
  let depth = 0, started = false;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '{' || c === '(' || c === '[') { depth++; started = true; }
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ';' && started && depth === 0) return code.slice(i, j + 1);
  }
  throw new Error(`fin de ${sig} introuvable`);
};
const sandbox = [
  "const count = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;",
  "const upper = (v) => String(v || '').toUpperCase();",
  grab('const ZAP_CONFIDENCE ='),
  grab('const zapConfidence ='),
  grab('const zapConfidenceLabel ='),
  grab('const zapInstanceField ='),
  grab('const staleFindings ='),
  'return { zapConfidence, zapConfidenceLabel, zapInstanceField, staleFindings };',
].join('\n');
const { zapConfidence, zapConfidenceLabel, zapInstanceField, staleFindings } = new Function(sandbox)();

// ── 1. Echelle de confiance ZAP : 0..4, rien d'autre ──
assert.equal(zapConfidence('2'), 2, 'la confiance arrive en chaine depuis le JSON ZAP');
assert.equal(zapConfidenceLabel('2'), 'Moyenne');
assert.equal(zapConfidence(0), 0, '0 = faux positif, une valeur reelle');
assert.equal(zapConfidenceLabel(0), 'Faux positif');
assert.equal(zapConfidenceLabel(4), 'Confirmee');
for (const absent of [undefined, null, '', 'high', -1, 5, 2.5, NaN]) {
  assert.equal(zapConfidence(absent), null, `confiance invalide (${absent}) doit rester null`);
  assert.equal(zapConfidenceLabel(absent), null);
}

// ── 2. URL/parametre : premiere instance non vide, jamais inventes ──
assert.equal(
  zapInstanceField({ instances: [{ uri: 'http://app:8080/login', param: 'q' }] }, 'uri'),
  'http://app:8080/login');
assert.equal(zapInstanceField({ instances: [{ uri: '  ' }, { uri: 'http://b/' }] }, 'uri'), 'http://b/',
  'une instance vide ne doit pas masquer la suivante');
assert.equal(zapInstanceField({}, 'uri'), null);
assert.equal(zapInstanceField({ instances: [] }, 'uri'), null);
assert.equal(zapInstanceField({ instances: [{}] }, 'param'), null);
assert.equal(zapInstanceField(null, 'uri'), null);

// ── 3. Constats retenus : NOT_RUN + fichier valide == execution anterieure ──
assert.equal(staleFindings('NOT_RUN', true), true, 'le cas devsecops-testbed #19');
assert.equal(staleFindings('NOT_RUN', false), false, 'aucun rapport : rien a etiqueter');
assert.equal(staleFindings('COMPLETED_WITH_FINDINGS', true), false, 'une vraie execution n\'est pas periemee');
assert.equal(staleFindings('COMPLETED_ZERO_FINDINGS', true), false);
assert.equal(staleFindings('FAILED', true), false, 'un echec est deja un etat honnete, distinct');
assert.equal(staleFindings('MISSING', true), false);

// ── 4. Le node pose bien l'etiquette sur les trois scanners ──
for (const scanner of ['trivy', 'owasp', 'zap']) {
  const v = `${scanner}FindingsStale`;
  assert.ok(code.includes(`const ${v} = staleFindings(`), `${v} doit etre calcule`);
  assert.ok(new RegExp(`findingsStale: ${v}`).test(code), `le bloc ${scanner} doit exposer findingsStale`);
  assert.ok(new RegExp(`findingsStaleReason: ${v} \\? 'SCANNER_NOT_RUN_THIS_BUILD'`).test(code),
    `le bloc ${scanner} doit exposer un motif explicite`);
}

// ── 5. LES CHAMPS DE VERITE NE SONT PAS TOUCHES (non-regression) ──
// L'etiquette informe ; elle ne transforme pas un scanner non execute en
// scanner ayant des resultats. C'est ce qui empeche les faux zeros.
assert.ok(code.includes("case 'NOT_RUN': return { executed: false, completed: false, resultAvailable: false, findingCount: null };"),
  'la table de verite NOT_RUN doit rester intacte');
assert.ok(code.includes('const trivyFindingCount = trivyResultAvailable ?'),
  'findingCount doit rester conditionne a resultAvailable');
// Les blocs scanner tiennent sur une seule longue ligne : on verifie donc que
// les champs de verite restent lies a LEURS variables d'origine, et non au
// drapeau d'etiquetage.
for (const [scanner, truthVar] of [['trivy', 'trivy'], ['owasp', 'owasp'], ['zap', 'zapTruthBase']]) {
  const bound = scanner === 'zap'
    ? 'executed:zapTruthBase.executed'
    : `executed: ${truthVar}Executed`;
  assert.ok(code.includes(bound), `le bloc ${scanner} doit garder ${bound}`);
}
assert.ok(!/findingsStale[A-Za-z]* *\? *[^:]*executed/.test(code),
  "le drapeau d'etiquetage ne doit jamais alimenter executed");

// ── 6. Les champs ZAP ajoutes sont tous presents dans le mapping ──
const zapPush = code.slice(code.indexOf('zapAlerts.push({'), code.indexOf("remediationType:'DEVELOPER_ACTION_REQUIRED'});") + 50);
for (const [field, src] of [
  ['pluginId', 'a.pluginid'], ['confidence', 'zapConfidence(a.confidence)'],
  ['confidenceLabel', 'zapConfidenceLabel(a.confidence)'], ['cweId', 'a.cweid'],
  ['url', "zapInstanceField(a,'uri')"], ['param', "zapInstanceField(a,'param')"],
]) {
  assert.ok(zapPush.includes(`${field}:${src}`), `l'alerte ZAP doit porter ${field} depuis ${src}`);
}

// ── 7. Aucune identite de projet introduite ──
for (const needle of ['pfe-app-test', 'app-test-pfe-vermeg', 'vuln-testapp', 'devsecops-testbed']) {
  const inCode = code.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  assert.ok(!inCode.includes(needle), `WF1 ne doit pas nommer ${needle} hors commentaire`);
}

// ── 8. Contre un VRAI rapport ZAP, si disponible ──
let realChecked = 'non disponible dans ce checkout';
try {
  const report = JSON.parse(readFileSync(join(here, 'fixtures/zap-report.real.json'), 'utf8'));
  const site = Array.isArray(report.site) ? report.site[0] : report.site;
  const a = (site.alerts || [])[0];
  assert.ok(a, 'le rapport reel doit porter au moins une alerte');
  assert.equal(typeof zapConfidence(a.confidence), 'number', 'confidence reelle doit etre importable');
  assert.ok(a.pluginid, 'pluginid reel doit exister');
  assert.equal(typeof zapInstanceField(a, 'uri'), 'string', "l'URL d'instance reelle doit etre importable");
  realChecked = `${(site.alerts || []).length} alertes reelles verifiees`;
} catch (e) {
  if (e?.code !== 'ENOENT') throw e;
}

console.log(`R48 WF1 ingestion completeness: PASS (rapport reel : ${realChecked})`);
