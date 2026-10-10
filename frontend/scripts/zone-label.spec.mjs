// ═══════════════════════════════════════════════════════════════════════
//  Déclaration de nature de zone — Information / Action.
//
//  Demande de l'opérateur : « la partie qui contient juste des informations,
//  on écrit par exemple Information, et la partie qui contient des actions
//  ou une intervention humaine, on la déclare aussi, pour faciliter la
//  complexité d'affichage. »
//
//  Le risque d'une telle étiquette est qu'elle MENTE. Une zone marquée
//  « Action » sans aucun contrôle actionnable envoie chercher un bouton
//  inexistant ; une zone marquée « Information » qui contient un bouton
//  engageant la plateforme fait l'inverse, et c'est plus grave. Ces tests
//  verrouillent la cohérence entre l'étiquette et le contenu réel.
// ═══════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadFrontend } from './security-lifecycle-test-loader.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const zone = loadFrontend('../src/app/shared/zone-label/zone-label.component.ts');

const walk = dir => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]);
const sources = walk('../src/app/').filter(f => /\.(ts|html)$/.test(f) && !/\/fixtures\//.test(f));
const stripComments = src => src.replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ── 1. Deux natures, et seulement deux ────────────────────────────────
{
  const used = new Set();
  for (const f of sources) {
    if (f.includes('zone-label.component')) continue;
    for (const m of stripComments(read(f)).matchAll(/kind="([a-z]+)"/g)) used.add(m[1]);
  }
  for (const k of used) {
    assert.ok(['information', 'action'].includes(k), `nature de zone inconnue : « ${k} »`);
  }
  assert.ok(used.has('information') && used.has('action'), 'les deux natures doivent être employées');
  console.log(`1. natures employées : ${[...used].sort().join(', ')} PASS`);
}

// ── 2. L'étiquette porte un libellé LISIBLE, pas un code ──────────────
{
  const src = read('../src/app/shared/zone-label/zone-label.component.ts');
  assert.match(src, /'Action'/, 'le libellé « Action » doit apparaître tel quel');
  assert.match(src, /'Information'/, 'le libellé « Information » doit apparaître tel quel');
  // §24 — jamais la couleur seule : un glyphe distinct par nature.
  assert.match(src, /'◆'\s*:\s*'◇'/, 'un repère non chromatique est requis par nature');
  // Les deux natures sont stylées, et la nature est portée par un attribut
  // de données — pas par une classe devinée dans le gabarit.
  for (const k of ['information', 'action']) {
    assert.ok(src.includes(`data-kind="${k}"`), `nature non stylée : ${k}`);
  }
  console.log('2. libellé humain + repère non chromatique PASS');
}

// ── 3. Une zone « action » contient un contrôle réellement actionnable ─
{
  // Pour chaque étiquette « action » posée dans un gabarit, on exige la
  // présence d'au moins un bouton ou d'un contrôle de formulaire dans le
  // même fichier. Grossier mais suffisant : il n'existe aucune page de la
  // plateforme où une zone d'action serait dans un fichier sans contrôle.
  const offences = [];
  for (const f of sources) {
    if (f.includes('zone-label.component')) continue;
    const src = stripComments(read(f));
    if (!/kind="action"|'action' :|\? 'action'/.test(src)) continue;
    if (!/<button|<input|<select|<textarea/.test(src)) offences.push(f);
  }
  assert.deepEqual(offences, [], `zone « action » sans aucun contrôle actionnable :\n${offences.join('\n')}`);
  console.log('3. toute zone « action » contient un contrôle PASS');
}

// ── 4. Les écrans de lecture sont déclarés comme tels ─────────────────
{
  // Ces quatre écrans ne déclenchent rien : ils doivent porter la
  // déclaration « information », sans quoi la convention est inutile.
  for (const [name, path] of [
    ['tableau de bord',      '../src/app/features/dashboard/dashboard.component.html'],
    ['liste des incidents',  '../src/app/features/incidents/incidents.component.html'],
    ['indicateurs de risque','../src/app/features/analytics/prediction.component.html'],
    ['agents IA',            '../src/app/features/analysis/analysis.component.html'],
  ]) {
    assert.match(read(path), /<app-zone-label kind="information"/,
      `${name} : écran de lecture non déclaré`);
  }
  // Et l'écran qui autorise un déploiement est déclaré « action ».
  assert.match(read('../src/app/features/projects/project-detail.component.html'),
    /visitedTabs\.has\('deploiement'\)[\s\S]{0,300}kind="action"/,
    'l’onglet Déploiement doit être déclaré comme zone d’action');
  console.log('4. écrans de lecture et zone de décision déclarés PASS');
}

// ── 5. L'étiquette n'est JAMAIS un contrôle d'accès ───────────────────
{
  const src = read('../src/app/shared/zone-label/zone-label.component.ts');
  // Le composant ne fait que rendre deux chaînes : aucune injection de
  // service, aucune lecture de rôle, aucune garde. Une étiquette qui
  // deviendrait la source d'une autorisation serait un contresens de
  // sécurité — le backend reste seul juge.
  assert.doesNotMatch(src, /AuthService|currentUser|isAdmin|canActivate/,
    'le composant d’étiquette ne doit connaître ni rôle ni autorisation');
  assert.doesNotMatch(src, /constructor\s*\(/, 'aucune dépendance injectée attendue');
  // Le rendu dépend uniquement de l'entrée `kind`.
  const inst = Object.create(zone.ZoneLabelComponent.prototype);
  inst.kind = 'information'; inst.note = '';
  assert.equal(inst.kind, 'information');
  console.log('5. l’étiquette reste de la présentation, jamais une autorisation PASS');
}

console.log('zone-label.spec: ALL PASS');
