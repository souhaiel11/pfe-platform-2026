// ═══════════════════════════════════════════════════════════════════════
//  Correctifs P1 post-gel — tests de non-régression.
//
//  Deux défauts signalés après le gel, tous deux de ma propre passe de
//  finition :
//
//   P1-A  La liste des projets et le tableau de bord attendaient
//         /dashboard/jenkins-global dans un forkJoin BLOQUANT. Cette lecture
//         met 5 008 ms sur le backend live (son plafond de 5 000 ms, atteint
//         dès qu'un projet pointe vers une adresse Jenkins injoignable),
//         contre 27 ms pour les deux lectures qui portent l'écran. Cinq
//         secondes d'attente pour des données déjà disponibles.
//
//   P1-B  Un projet SANS job Jenkins est absent de jenkins-global, et était
//         rendu « Indisponible — les données Jenkins n'ont pas été
//         chargées ». C'est une panne affirmée sans avoir été constatée :
//         rien n'a échoué, il n'y a simplement rien à lire.
//
//  Ces tests verrouillent les deux corrections. Charges utiles = formes
//  réelles relevées sur le backend live le 2026-10-10.
// ═══════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './security-lifecycle-test-loader.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const frenchFormat = loadFrontend('../src/app/shared/french-format.ts');
const row = loadFrontend('../src/app/features/projects/project-list-row.ts', {
  '../../shared/french-format': frenchFormat,
});
const tone = loadFrontend('../src/app/shared/status-chip/status-tone.ts');
const labels = loadFrontend('../src/app/shared/status-labels.ts');

// ── P1-B.1 — « non configuré » n'est pas « en panne » ──────────────────
{
  // Projet réel sans job Jenkins (devsecops-remediation-testbed).
  const noJob = { id: 'p', name: 'devsecops-remediation-testbed', jenkinsJobName: null };
  const cell = row.buildCell(undefined, null, noJob);
  assert.equal(cell.state, 'NOT_CONFIGURED', 'un projet sans job Jenkins ne doit JAMAIS être rendu comme indisponible');
  assert.match(cell.detail, /Aucun job Jenkins/);
  assert.equal(cell.status, null);
  assert.equal(cell.number, null, 'aucun numéro de build ne peut exister sans job');
  assert.equal(cell.numberFromPlatform, false);

  // Chaîne vide et espaces comptent comme non configuré, pas comme un job.
  for (const blank of ['', '   ']) {
    assert.equal(row.buildCell(undefined, null, { jenkinsJobName: blank }).state, 'NOT_CONFIGURED', JSON.stringify(blank));
  }

  // §5/§6 : libellé humain, et tonalité JAMAIS rouge.
  assert.equal(labels.stageStatusLabel('NOT_CONFIGURED'), 'Non configuré');
  assert.equal(tone.statusTone('NOT_CONFIGURED'), 'disabled');
  assert.notEqual(tone.statusColor('NOT_CONFIGURED'), 'var(--accent-red)');
  console.log('P1-B.1 « non configuré » distinct de « en panne » PASS');
}

// ── P1-B.2 — une panne RÉELLE reste une panne, avec son motif exact ────
{
  // Projet réel avec job configuré, dont la lecture a réellement échoué.
  const configured = { id: 'p', name: 'vuln-testapp', jenkinsJobName: 'vuln-testapp', jenkinsCredentialConfigured: true };
  const timedOut = row.buildCell(
    { lastBuild: null, error: 'Timeout Jenkins après 5000ms' },
    { currentBuild: 41 }, configured);
  assert.equal(timedOut.state, 'UNAVAILABLE', 'un job configuré dont la lecture échoue reste indisponible');
  assert.equal(timedOut.detail, 'Timeout Jenkins après 5000ms', 'le motif exact du backend est conservé mot pour mot');
  assert.equal(timedOut.number, 41);
  assert.equal(timedOut.numberFromPlatform, true);

  // Second FAIT juxtaposé quand il est vrai — jamais une cause déduite.
  const noCred = { id: 'p', name: 'app-test-pfe-vermeg', jenkinsJobName: 'app-test-pfe-vermeg', jenkinsCredentialConfigured: false };
  const withHint = row.buildCell(
    { lastBuild: null, error: 'Données Jenkins temporairement indisponibles' }, null, noCred);
  assert.equal(withHint.state, 'UNAVAILABLE');
  assert.match(withHint.detail, /Données Jenkins temporairement indisponibles/, 'le motif du backend reste en premier');
  assert.match(withHint.detail, /Aucun identifiant Jenkins/, 'le fait complémentaire est ajouté');
  // Et jamais de causalité inventée : le backend ne dit pas POURQUOI.
  assert.doesNotMatch(withHint.detail, /parce que|à cause|car /i, 'aucune cause déduite à la place du backend');

  // Identifiant configuré : pas de mention parasite.
  const credOk = row.buildCell(
    { lastBuild: null, error: 'Timeout Jenkins après 5000ms' }, null, configured);
  assert.doesNotMatch(credOk.detail, /identifiant Jenkins/, 'pas de mention quand l’identifiant EST configuré');
  // Champ absent (backend antérieur) : on n'affirme rien non plus.
  assert.doesNotMatch(
    row.buildCell({ lastBuild: null, error: 'boom' }, null, { jenkinsJobName: 'j' }).detail,
    /identifiant Jenkins/, 'un champ absent ne devient pas une absence constatée');
  console.log('P1-B.2 panne réelle : motif exact conservé, aucune cause inventée PASS');
}

// ── P1-B.3 — « non configuré » n'est pas une alerte ───────────────────
{
  const r = row.buildProjectListRow(
    { id: 'p', name: 'sans-jenkins', jenkinsJobName: null, openIncidents: 0 },
    { securityScore: 90, incomplete: false, missingScanners: [] },
    undefined,
    { ready: true, deploymentConfigured: true },
  );
  assert.equal(r.build.state, 'NOT_CONFIGURED');
  assert.equal(row.needsAttention(r), false, 'un outil non configuré n’est pas un problème à traiter');
  assert.equal(row.attentionReasons(r).length, 0);
  console.log('P1-B.3 absence de configuration jamais comptée comme alerte PASS');
}

// ── P1-A — Jenkins hors du chemin critique ────────────────────────────
{
  for (const [name, path] of [
    ['liste des projets', '../src/app/features/projects/projects.component.ts'],
    ['tableau de bord',   '../src/app/features/dashboard/dashboard.component.ts'],
  ]) {
    const src = read(path);

    // La lecture Jenkins ne doit plus figurer dans un forkJoin d'objet : le
    // `forkJoin({...})` bloquant est précisément ce qui alignait l'écran sur
    // la plus lente des lectures.
    const blockingForkJoins = [...src.matchAll(/forkJoin\(\{[\s\S]*?\}\)/g)].map(m => m[0]);
    assert.ok(blockingForkJoins.length > 0, `${name} : aucun forkJoin trouvé, test à revoir`);
    for (const block of blockingForkJoins) {
      assert.doesNotMatch(block, /getJenkinsGlobal/,
        `${name} : getJenkinsGlobal est de nouveau dans un forkJoin bloquant (régression de latence)`);
    }

    // Elle doit exister, hors de ce bloc, et déposer son résultat.
    assert.match(src, /getJenkinsGlobal\(\)/, `${name} : la lecture Jenkins doit toujours avoir lieu`);
    assert.match(src, /buildLoading/, `${name} : la colonne doit signaler son propre chargement (§18)`);

    // Les lectures qui portent l'écran restent, elles, dans le bloc bloquant.
    assert.match(src, /forkJoin\(\{[\s\S]*?getProjects\(\)[\s\S]*?getSecurityGlobal\(\)[\s\S]*?\}\)/,
      `${name} : /projects et security-global doivent rester la lecture d'ouverture`);

    // Chaque arrivée recompose les lignes depuis ce qui est connu.
    assert.match(src, /rebuildRows\(\)/, `${name} : recomposition incrémentale attendue`);
  }
  console.log('P1-A Jenkins hors du chemin critique, sur les deux écrans PASS');
}

// ── P1-A bis — pas d'état de build affirmé avant la réponse (§18) ─────
{
  for (const [name, path] of [
    ['liste des projets', '../src/app/features/projects/projects.component.html'],
    ['tableau de bord',   '../src/app/features/dashboard/dashboard.component.html'],
  ]) {
    const tpl = read(path);
    // Tant que buildLoading est vrai, la cellule dit « Vérification… » et non
    // « Indisponible » : on n'affirme pas une absence avant d'avoir lu.
    assert.match(tpl, /buildLoading[\s\S]{0,120}Vérification/,
      `${name} : la colonne de build doit dire « Vérification… » pendant la lecture`);
    assert.match(tpl, /!buildLoading/,
      `${name} : « Indisponible » doit être conditionné à la fin de la lecture`);
    // Et le nouvel état doit être rendu.
    assert.match(tpl, /NOT_CONFIGURED/, `${name} : l'état « non configuré » doit être affiché`);
  }
  console.log('P1-A bis aucune absence affirmée avant lecture PASS');
}


// ── S3 (levée ciblée du gel) — boutons d'action des tables de scanners ──
//
//  Signalé par l'opérateur : « la partie action dans OWASP, ZAP, Trivy, les
//  boutons ne sont pas beaux. » Diagnostic : ce n'était pas une question de
//  goût. Les trois boutons de la colonne Action étaient des <button> SANS
//  AUCUNE CLASSE, et styles.scss ne définit aucune règle pour un `button`
//  nu. Le navigateur leur appliquait donc son propre rendu — boîte grise
//  système, police système — qui ne suit ni le thème clair/sombre ni le
//  système `.btn` de la plateforme, et qui les rendait tous les trois
//  identiques, donc sans hiérarchie lisible (§6/§7).
{
  const platformBtn = /class="[^"]*\bbtn\b[^"]*"/;

  // Les commentaires sont retirés avant l'analyse : un commentaire qui CITE
  // le défaut corrigé ne doit pas être compté comme le défaut (même raison
  // que le `strip` de status-chip.spec.mjs).
  const stripComments = src => src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  // Aucun bouton d'action de ces deux tables ne doit rester sans classe.
  for (const [name, path] of [
    ['cve-table (Trivy/OWASP)', '../src/app/features/projects/cve-table.component.ts'],
    ['zap-table (ZAP)',         '../src/app/features/projects/zap-table.component.ts'],
  ]) {
    const src = stripComments(read(path));
    const bare = [...src.matchAll(/<button(?![^>]*\bclass=)[^>]*>/g)].map(m => m[0]);
    assert.equal(bare.length, 0,
      `${name} : bouton sans classe (rendu natif du navigateur, hors thème) :\n${bare.join('\n')}`);

    // Et ils doivent utiliser le système de la plateforme, pas un style local.
    assert.match(src, platformBtn, `${name} : doit utiliser les classes .btn de la plateforme`);
    // Les anciennes classes locales ne doivent pas revenir.
    for (const dead of ['track-btn', 'reopen-btn']) {
      assert.ok(!src.includes(dead), `${name} : classe de bouton locale réintroduite (${dead})`);
    }
  }

  // §7 — hiérarchie dans la ligne : « Corriger » primaire, le reste secondaire.
  const cve = stripComments(read('../src/app/features/projects/cve-table.component.ts'));
  assert.match(cve, /class="btn btn-primary btn-sm"[^>]*>Corriger</,
    '« Corriger » doit être l’action primaire de la ligne');
  assert.match(cve, /class="btn btn-secondary btn-sm"[\s\S]{0,200}Réessayer/,
    '« Réessayer » doit être secondaire, pas aussi proéminent que « Corriger »');
  // Le dépliant annonce son état au clavier (§24).
  assert.match(cve, /aria-expanded/, 'le bouton de détail doit annoncer son état');
  assert.match(cve, /Masquer le détail/, 'le libellé doit refléter l’état réel du dépliant');

  // §24 — la ligne ZAP dépliante est atteignable et annonce son état.
  const zap = stripComments(read('../src/app/features/projects/zap-table.component.ts'));
  for (const attr of ['role="button"', 'aria-expanded', 'keydown.enter', 'keydown.space', 'aria-label']) {
    assert.ok(zap.includes(attr), `zap-table : ligne dépliante sans ${attr}`);
  }

  // §17 — les boutons « Réessayer » des cartes d'erreur étaient nus aussi.
  for (const path of [
    '../src/app/features/incidents/incident-detail.component.html',
    '../src/app/features/projects/project-detail.component.html',
    '../src/app/features/admin/admin.component.html',
  ]) {
    const tpl = read(path);
    assert.doesNotMatch(tpl, /<button \(click\)="load(Project)?\(\)">Réessayer<\/button>/,
      `${path} : bouton « Réessayer » sans classe (rendu natif)`);
  }
  console.log('S3 boutons d’action : système de la plateforme, hiérarchie, clavier PASS');
}


// ── P1-D — Vue Déploiement : l'attente Azure est dite, et payée une fois ──
//
//  Mesures sur la plateforme live : GET /azure-deploy/governance/:id prend
//  10,7 à 12,4 s pour les deux projets qui ont un artefact publié. Ce n'est
//  pas un défaut : le serveur interroge réellement le registre Azure
//  (France Central) — /resolve-digest 4,88 s et /inspect-artifact 5,92 s,
//  dont la somme recouvre la mesure totale. C'est le prix de la garantie :
//  la décision n'est jamais rendue sur une copie locale.
//
//  Deux choses restaient corrigeables côté interface, et elles le sont :
//   1. l'attente n'était pas expliquée — 12 s de squelette muet se lisent
//      comme une interface figée ;
//   2. le composant étant sous `*ngIf` seul, il était détruit à chaque
//      changement d'onglet et repayait les 12 s à CHAQUE retour.
{
  const dg = read('../src/app/features/projects/deployment-governance.component.html');

  // 1. Le squelette dit ce qu'il attend, et nomme le registre Azure.
  assert.match(dg, /dg-skeleton[\s\S]{0,900}registre Azure/i,
    'le squelette de chargement doit nommer la vérification attendue');
  assert.match(dg, /Aucune décision n’est rendue\s*\n?\s*avant qu’il aboutisse|Aucune décision n’est rendue[\s\S]{0,60}aboutisse/,
    'l’attente doit rappeler qu’aucune décision n’est rendue entre-temps');
  // L'explication vit DANS le bloc de chargement, pas en permanence.
  const skeleton = dg.slice(dg.indexOf('dg-skeleton'), dg.indexOf('dg-error-panel'));
  assert.match(skeleton, /previewLoading/, 'l’explication doit être conditionnée au chargement');

  // 2. L'onglet Déploiement est monté à la première ouverture puis gardé.
  const tpl = read('../src/app/features/projects/project-detail.component.html');
  assert.match(tpl, /\*ngIf="visitedTabs\.has\('deploiement'\)"\s*\[hidden\]="activeTab !== 'deploiement'"/,
    'l’onglet Déploiement doit rester monté après sa première ouverture');
  // Mais JAMAIS monté d'avance : rien ne part vers Azure avant l'ouverture.
  const ts = read('../src/app/features/projects/project-detail.component.ts');
  assert.match(ts, /visitedTabs = new Set<string>\(\['rapport'\]\)/,
    'seul l’onglet initial est marqué visité au départ — aucune anticipation Azure');
  assert.match(ts, /this\.visitedTabs\.add\(this\.activeTab\)/,
    'un onglet doit être marqué visité au moment où il est ouvert');

  // 3. Ce n'est pas une mise en cache de la décision : le bouton de
  //    réévaluation reste le chemin vers une décision fraîche.
  assert.match(dg, /\(click\)="reevaluate\(\)"/, 'la réévaluation explicite doit rester disponible');
  console.log('P1-D attente Azure expliquée, et payée une seule fois par visite PASS');
}

console.log('post-freeze-p1.spec: ALL PASS');
