// Sémantique de statut (§5/§6) — un seul système, et surtout : une absence
// d'information ne doit JAMAIS se présenter comme un échec constaté.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadFrontend } from './security-lifecycle-test-loader.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const tone = loadFrontend('../src/app/shared/status-chip/status-tone.ts');
const labels = loadFrontend('../src/app/shared/status-labels.ts');
const chipSource = read('../src/app/shared/status-chip/status-chip.component.ts');

// ── 1. Inconnu n'est jamais rouge ───────────────────────────────────────
{
  for (const unknown of [null, undefined, '', '   ', 'STATUT_INVENTE', 'xyz']) {
    assert.equal(tone.statusTone(unknown), 'neutral', `inconnu doit rester neutre: ${unknown}`);
    assert.notEqual(tone.statusColor(unknown), 'var(--accent-red)');
  }
  // Un build en cours ou interrompu n'est pas un échec.
  assert.equal(tone.statusTone('RUNNING'), 'pending');
  assert.equal(tone.statusTone('PENDING'), 'pending');
  assert.equal(tone.statusTone('ABORTED'), 'disabled');
  assert.equal(tone.statusTone('NOT_RUN'), 'disabled');
  assert.equal(tone.statusTone('NOT_CONFIGURED'), 'disabled');
  // Et un échec reste un échec.
  for (const bad of ['FAILURE', 'FAILED', 'ERROR', 'INVALID']) {
    assert.equal(tone.statusTone(bad), 'error', bad);
  }
  for (const ok of ['SUCCESS', 'PASSED', 'VERIFIED', 'PROVENANCE_VERIFIED']) {
    assert.equal(tone.statusTone(ok), 'success', ok);
  }
  assert.equal(tone.statusTone('success'), 'success', 'la casse ne doit pas changer le verdict');
  console.log('1. inconnu/en-cours jamais rendu comme un échec PASS');
}

// ── 2. §5 — libellés français requis ───────────────────────────────────
{
  const expected = {
    SUCCESS: 'Réussi', FAILED: 'Échec', PENDING: 'En attente', RUNNING: 'En cours',
    NOT_CONFIGURED: 'Non configuré', STALE: 'Données anciennes', BLOCKED: 'Bloqué',
    REVOKED: 'Révoqué', PROVENANCE_VERIFIED: 'Provenance vérifiée',
  };
  for (const [raw, label] of Object.entries(expected)) {
    assert.equal(labels.stageStatusLabel(raw), label, `${raw} -> ${label}`);
  }
  // Donnée absente et service indisponible gardent des sens DISTINCTS.
  assert.equal(labels.stageStatusLabel(null), 'Non disponible');
  assert.equal(labels.stageStatusLabel('UNAVAILABLE'), 'Indisponible');
  // Une valeur non répertoriée n'est jamais déformée.
  assert.equal(labels.stageStatusLabel('java:S125'), 'java:S125');
  console.log('2. libellés de statut français PASS');
}

// ── 3. §6 — jamais la couleur seule ────────────────────────────────────
{
  const tones = ['success', 'error', 'warning', 'pending', 'neutral', 'disabled'];
  const glyphs = tones.map(t => tone.statusGlyph(t));
  assert.equal(new Set(glyphs).size, tones.length, 'chaque tonalité a son propre repère');
  for (const g of glyphs) assert.ok(g && g.length, 'un repère non chromatique est requis');
  // Le gabarit rend glyphe + libellé, et la couleur vient de data-tone.
  assert.match(chipSource, /\{\{ glyph\(\) \}\}/);
  assert.match(chipSource, /\{\{ label\(\) \}\}/);
  assert.match(chipSource, /\[attr\.data-tone\]="tone\(\)"/);
  // Le glyphe est décoratif : le libellé porte le sens pour un lecteur d'écran.
  assert.match(chipSource, /class="sc-glyph" aria-hidden="true"/);
  // Toutes les tonalités sont stylées.
  for (const t of tones) assert.ok(chipSource.includes(`data-tone="${t}"`), `tonalité non stylée: ${t}`);
  // La valeur technique reste consultable sans devenir primaire (§5).
  assert.match(chipSource, /titleText\(\)/);
  console.log('3. statut = glyphe + libellé + couleur PASS');
}

// ── 4. Le binaire vert/rouge sur statut a disparu des gabarits ─────────
{
  const walk = dir => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]);
  const strip = s => s
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const offences = [];
  for (const file of walk('../src/app/').filter(f => /\.(ts|html)$/.test(f) && !/\/fixtures\//.test(f))) {
    strip(read(file)).split('\n').forEach((line, i) => {
      // `=== 'SUCCESS' ? vert : rouge` peint en échec tout ce qui n'est pas
      // un succès — y compris « en cours » et « inconnu ».
      if (/===\s*'SUCCESS'\s*\?[^:]*:\s*'var\(--accent-red\)'/.test(line.replace(/\s+/g, ' '))) {
        offences.push(`${file}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(offences, [], `binaire succès/échec restant :\n${offences.join('\n')}`);
  console.log('4. plus de binaire succès/échec sur un statut PASS');
}

console.log('status-chip.spec: ALL PASS');
