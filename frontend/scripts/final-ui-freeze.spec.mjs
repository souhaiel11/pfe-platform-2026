// ═══════════════════════════════════════════════════════════════════════
//  Gel UI/UX final — garde-fous de la passe de finition.
//
//  Ce qui est vérifié ici n'est pas « l'écran est joli » mais les deux
//  propriétés qu'une passe UI peut casser sans que rien ne plante :
//
//   1. la DISCIPLINE DE DONNÉES — inconnu reste inconnu, un échec de
//      requête ne se présente jamais comme une absence de problème, et
//      aucune colonne ne se remplit d'un zéro ou d'une valeur empruntée
//      à un autre projet (§17/§31) ;
//   2. la COHÉRENCE DE PRÉSENTATION — un seul système de statut, un seul
//      modèle de ligne partagé entre la liste des projets et le tableau
//      de bord, donc impossible que les deux écrans affirment deux
//      choses différentes du même projet (§5/§6/§27).
//
//  Les charges utiles de test sont des RÉPONSES RÉELLES relevées sur le
//  backend live (GET /projects, /dashboard/security-global,
//  /dashboard/jenkins-global, /azure-deploy/ready/:id) — pas des formes
//  inventées qui valideraient un contrat que le backend ne sert pas.
// ═══════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { deepEqual as looseDeepEqual } from 'node:assert';

// Les valeurs testées sont construites dans le bac à sable `vm` du
// chargeur partagé : leurs tableaux ont un autre Array.prototype, ce qui
// fait échouer deepStrictEqual sur la seule identité du prototype. On
// compare donc les valeurs, pas les realms.
assert.deepStrictEqualLoose = looseDeepEqual;
import { readFileSync } from 'node:fs';
import { loadFrontend } from './security-lifecycle-test-loader.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const frenchFormat = loadFrontend('../src/app/shared/french-format.ts');
const row = loadFrontend('../src/app/features/projects/project-list-row.ts', {
  '../../shared/french-format': frenchFormat,
});
const incidents = loadFrontend('../src/app/features/incidents/incidents.component.ts', {
  '../../shared/french-format': frenchFormat,
});
const copyable = loadFrontend('../src/app/shared/copyable-id/copyable-id.component.ts');
const infoHint = loadFrontend('../src/app/shared/info-hint/info-hint.component.ts');

// ── Réponses réelles du backend (relevées le 2026-10-10) ───────────────
const LIVE_PROJECT_VERMEG = {
  id: '078b5e76-c6f3-4014-9f52-ea5e4f435399', name: 'app-test-pfe-vermeg',
  environment: 'dev', githubRepo: 'souhaiel11/app-test-pfe-vermeg',
  // jenkinsJobName fait partie de la réponse réelle de GET /projects, et il
  // est significatif : son absence signifie « Jenkins non configuré », pas
  // « lecture Jenkins en échec » (voir post-freeze-p1.spec.mjs).
  jenkinsJobName: 'app-test-pfe-vermeg', jenkinsCredentialConfigured: false,
  openIncidents: 10, analyzingIncidents: 0, resolvedIncidents: 0,
  createdAt: '2026-10-08T14:55:21.408Z', updatedAt: '2026-10-10T12:26:24.274Z',
};
const LIVE_JENKINS_VERMEG = {
  projectId: '078b5e76-c6f3-4014-9f52-ea5e4f435399', projectName: 'app-test-pfe-vermeg',
  jenkinsJobName: 'app-test-pfe-vermeg', status: 'unknown', recentSuccessRate: null,
  lastBuild: null, error: 'Données Jenkins temporairement indisponibles',
};
const LIVE_JENKINS_PFE_APP_TEST = {
  projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', projectName: 'pfe-app-test',
  jenkinsJobName: 'pfe-app-test', status: 'green', recentSuccessRate: 100,
  lastBuild: { number: 151, result: 'SUCCESS', durationSeconds: 278, timestamp: '2026-10-06T16:07:38.376Z', url: 'http://jenkins/job/pfe-app-test/151/' },
  error: null,
};
const LIVE_SECURITY_VERMEG = {
  projectId: '078b5e76-c6f3-4014-9f52-ea5e4f435399', projectName: 'app-test-pfe-vermeg',
  securityScore: 92, incomplete: false, missingScanners: [],
  criticalCves: 2, highCves: 2,
  trivy: { critical: 1, high: 1 }, owasp: { critical: 1, high: 1 },
  zap: { high: 0, medium: 1 }, sonar: { qualityGate: 'OK', coverage: 0 },
};
const LIVE_SECURITY_INCOMPLETE = {
  projectId: '75d13a2c-cf80-479c-8ec9-d5e1c01a4ce6', projectName: 'devsecops-testbed',
  securityScore: 80, incomplete: true, missingScanners: ['trivy', 'owasp', 'zap'],
  criticalCves: 34, highCves: 117, sonar: { qualityGate: 'API_ERROR', coverage: 0 },
};
const LIVE_READINESS_NOT_READY = {
  status: 'NOT_READY', ready: false,
  blockingReasons: [
    'La validation ne correspond pas au build courant',
    'Trivy : en échec',
    'La décision de gouvernance bloque explicitement ce build',
  ],
  warnings: ['ZAP : en avertissement'],
  currentBuild: 10, validatedBuild: null, unresolvedBlockingCount: 2,
  correlationVerified: false,
};
const LIVE_READINESS_NOT_CONFIGURED = {
  ready: false,
  reasons: ['Aucun report combined pour ce projet — impossible de vérifier son état, refus par défaut.'],
  deploymentConfigured: false, deploymentTarget: null,
};

// ── 1. §17 — « Jenkins n'a pas répondu » ≠ « aucun build » ─────────────
{
  const unavailable = row.buildCell(LIVE_JENKINS_VERMEG, LIVE_READINESS_NOT_READY);
  assert.equal(unavailable.state, 'UNAVAILABLE');
  assert.equal(unavailable.status, null, 'une panne Jenkins ne produit JAMAIS un résultat de build');
  assert.equal(unavailable.detail, 'Données Jenkins temporairement indisponibles', 'le motif exact est conservé');
  // Le numéro corrélé par la plateforme reste exploitable, et dit d'où il vient.
  assert.equal(unavailable.number, 10);
  assert.equal(unavailable.numberFromPlatform, true);

  // Sans information de projet, l'ancien comportement est conservé : on ne
  // peut pas conclure « non configuré » sans avoir lu la configuration.
  const notLoaded = row.buildCell(null, null);
  assert.equal(notLoaded.state, 'UNAVAILABLE');
  assert.equal(notLoaded.number, null);
  assert.match(notLoaded.detail, /n’ont pas été chargées/);

  // Jenkins a répondu et ne rapporte aucun build : fait constaté, pas panne.
  const noBuild = row.buildCell({ lastBuild: null, error: null }, null);
  assert.equal(noBuild.state, 'NO_BUILD');
  assert.equal(noBuild.detail, null);

  const known = row.buildCell(LIVE_JENKINS_PFE_APP_TEST, null);
  assert.equal(known.state, 'KNOWN');
  assert.equal(known.status, 'SUCCESS');
  assert.equal(known.number, 151);
  assert.equal(known.numberFromPlatform, false, 'un numéro venu de Jenkins n’est pas attribué à la plateforme');

  // Un résultat vide renvoyé par Jenkins ne devient pas un succès.
  assert.equal(row.buildCell({ lastBuild: { number: 7, result: '' }, error: null }, null).status, null);
  console.log('1. §17 build : panne, absence et résultat restent trois faits distincts PASS');
}

// ── 2. §31 — le score ne s'emprunte ni ne se comble ───────────────────
{
  const known = row.securityCell(LIVE_SECURITY_VERMEG);
  assert.equal(known.state, 'KNOWN');
  assert.equal(known.score, 92);
  assert.equal(known.criticalCves, 2);

  const absent = row.securityCell(undefined);
  assert.equal(absent.state, 'UNAVAILABLE');
  assert.equal(absent.score, null, 'un projet absent de security-global n’hérite d’aucun score');
  assert.equal(absent.criticalCves, null, 'et surtout pas d’un 0 qui se lirait « aucune CVE »');
  assert.deepStrictEqualLoose(absent.missingScanners, []);

  const partial = row.securityCell(LIVE_SECURITY_INCOMPLETE);
  assert.equal(partial.state, 'INCOMPLETE', 'un score calculé sans tous les scanners est partiel, pas un verdict');
  assert.equal(partial.score, 80);
  assert.deepStrictEqualLoose(partial.missingScanners, ['trivy', 'owasp', 'zap']);

  // Un score non numérique n'est pas rendu comme 0.
  assert.equal(row.securityCell({ securityScore: null }).state, 'UNAVAILABLE');
  assert.equal(row.securityCell({ securityScore: 'n/a' }).score, null);
  console.log('2. §31 score de sécurité : aucun repli, aucun zéro pour un inconnu PASS');
}

// ── 3. §14 — « bloqué » vient toujours avec son pourquoi ──────────────
{
  const blocked = row.deploymentCell(LIVE_READINESS_NOT_READY);
  assert.equal(blocked.state, 'NOT_READY');
  assert.equal(blocked.blockingCount, 3);
  assert.equal(blocked.firstReason, 'La validation ne correspond pas au build courant');

  const notConfigured = row.deploymentCell(LIVE_READINESS_NOT_CONFIGURED);
  assert.equal(notConfigured.state, 'NOT_CONFIGURED', 'sans cible, ni « prêt » ni « bloqué » ne s’appliquent');
  assert.equal(notConfigured.blockingCount, null);

  assert.equal(row.deploymentCell({ ready: true, deploymentConfigured: true }).state, 'READY');
  assert.equal(row.deploymentCell(null).state, 'UNAVAILABLE', 'une gouvernance non lue n’est pas un refus');
  assert.equal(row.deploymentCell({}).state, 'UNAVAILABLE');
  console.log('3. §14 déploiement : non configuré, bloqué et inconnu sont distincts PASS');
}

// ── 4. §28 — « demande une attention » n'est jamais une absence ───────
{
  const base = row.buildProjectListRow(
    { ...LIVE_PROJECT_VERMEG, openIncidents: 0 }, LIVE_SECURITY_VERMEG,
    { lastBuild: { number: 4, result: 'SUCCESS' }, error: null },
    { ready: true, deploymentConfigured: true },
  );
  assert.equal(row.needsAttention(base), false);
  assert.deepStrictEqualLoose(row.attentionReasons(base), []);

  // Build en échec, incidents ouverts, déploiement refusé, score bas.
  const failing = row.buildProjectListRow(
    LIVE_PROJECT_VERMEG, LIVE_SECURITY_VERMEG,
    { lastBuild: { number: 11, result: 'FAILURE' }, error: null },
    LIVE_READINESS_NOT_READY,
  );
  assert.equal(row.needsAttention(failing), true);
  const reasons = row.attentionReasons(failing);
  assert.ok(reasons.some(r => /Build #11 en échec/.test(r)), reasons.join(' | '));
  assert.ok(reasons.some(r => /10 incidents ouverts/.test(r)), reasons.join(' | '));
  assert.ok(reasons.some(r => /Déploiement bloqué — 3 conditions/.test(r)), reasons.join(' | '));

  // Tout ignorer d'un projet ne le rend PAS alarmant : ne pas savoir n'est
  // pas un problème constaté, et le présenter comme tel noierait les vrais.
  const unknownEverything = row.buildProjectListRow(
    { ...LIVE_PROJECT_VERMEG, openIncidents: 0 }, undefined, null, null,
  );
  assert.equal(row.needsAttention(unknownEverything), false, 'inconnu n’est pas une alerte');
  assert.deepStrictEqualLoose(row.attentionReasons(unknownEverything), []);

  // Un déploiement non configuré n'est pas un problème.
  const noTarget = row.buildProjectListRow(
    { ...LIVE_PROJECT_VERMEG, openIncidents: 0 }, LIVE_SECURITY_VERMEG,
    { lastBuild: { number: 4, result: 'SUCCESS' }, error: null },
    LIVE_READINESS_NOT_CONFIGURED,
  );
  assert.equal(row.needsAttention(noTarget), false);

  // Un build instable est signalé, sans être confondu avec un échec.
  const unstable = row.buildProjectListRow(
    { ...LIVE_PROJECT_VERMEG, openIncidents: 0 }, LIVE_SECURITY_VERMEG,
    { lastBuild: { number: 12, result: 'UNSTABLE' }, error: null }, null,
  );
  assert.equal(row.needsAttention(unstable), true);
  assert.ok(row.attentionReasons(unstable).some(r => /instable ou interrompu/.test(r)));
  console.log('4. §28 attention : fondée sur des faits constatés, motifs nommés PASS');
}

// ── 5. §28 — tri « ce qui va mal d'abord », inconnu en dernier ────────
{
  const make = (name, score, open) => row.buildProjectListRow(
    { id: name, name, jenkinsJobName: name, openIncidents: open, updatedAt: '2026-10-10T12:00:00.000Z' },
    score === null ? undefined : { securityScore: score, incomplete: false, missingScanners: [] },
    { lastBuild: { number: 1, result: 'SUCCESS' }, error: null },
    { ready: true, deploymentConfigured: true },
  );
  const sorted = row.sortByAttention([make('sain', 95, 0), make('inconnu', null, 0), make('bas', 30, 0), make('incidents', 90, 4)]);
  assert.deepStrictEqualLoose(sorted.map(r => r.name), ['bas', 'incidents', 'sain', 'inconnu']);
  console.log('5. §28 tri : dégradés en tête, inconnus en queue PASS');
}

// ── 6. §19 — la fraîcheur n'est jamais fabriquée ──────────────────────
{
  const now = new Date('2026-10-10T13:00:00.000Z');
  const withActivity = row.buildProjectListRow(
    { id: 'p', name: 'p', updatedAt: '2026-10-10T12:26:24.274Z' }, undefined, null, null, now);
  assert.equal(withActivity.lastActivity, 'il y a 33 min');
  assert.ok(withActivity.lastActivityExact, 'l’horodatage exact reste consultable');

  const noActivity = row.buildProjectListRow({ id: 'p', name: 'p' }, undefined, null, null, now);
  assert.equal(noActivity.lastActivity, null, 'sans date enregistrée, aucune fraîcheur inventée');
  assert.equal(noActivity.lastActivityExact, null);
  console.log('6. §19 fraîcheur : absente plutôt qu’inventée PASS');
}

// ── 7. §10 — ligne d'incident : sévérité lue, jamais devinée ──────────
{
  const liveIncident = {
    id: 'd316950a-0eaf-495c-a915-2c51862e3c39',
    projectId: '078b5e76-c6f3-4014-9f52-ea5e4f435399',
    title: 'app-test-pfe-vermeg - Build #10',
    status: 'blocked', source: 'jenkins', buildNumber: 10,
    aiAnalysis: '{"build":10,"job":"app-test-pfe-vermeg","status":"SUCCESS","decision":"BLOCK","securityLevel":"CRITICAL"}',
    createdAt: '2026-10-09T21:14:15.322Z', updatedAt: '2026-10-09T21:16:00.743Z',
    project: { id: '078b5e76-c6f3-4014-9f52-ea5e4f435399', name: 'app-test-pfe-vermeg' },
  };
  const r = incidents.toIncidentRow(liveIncident, new Date('2026-10-09T22:16:00.743Z'));
  assert.equal(r.severity, 'CRITICAL');
  assert.equal(r.projectName, 'app-test-pfe-vermeg');
  assert.equal(r.buildNumber, 10);
  assert.equal(r.status, 'blocked');
  assert.equal(r.lastActivity, 'il y a 1 h');

  // aiAnalysis en texte brut ne porte pas de sévérité : null, pas une valeur
  // de remplissage (même règle que incident-detail).
  assert.equal(incidents.incidentSeverity({ aiAnalysis: 'analyse en texte libre' }), null);
  assert.equal(incidents.incidentSeverity({ aiAnalysis: '{"pas":"de niveau"}' }), null);
  assert.equal(incidents.incidentSeverity({}), null);

  // Un numéro de build absent ou non entier n'est pas rendu comme #0.
  assert.equal(incidents.toIncidentRow({ id: 'x', buildNumber: 0 }).buildNumber, null);
  assert.equal(incidents.toIncidentRow({ id: 'x', buildNumber: 'abc' }).buildNumber, null);
  assert.equal(incidents.toIncidentRow({ id: 'x' }).lastActivity, null);
  console.log('7. §10 ligne d’incident : lue du backend, jamais complétée PASS');
}

// ── 8. §20/§21 — un identifiant long ne casse pas la mise en page ─────
{
  const chip = Object.create(copyable.CopyableIdComponent.prototype);
  chip.length = 12; chip.keepPrefix = '';
  chip.value = null;
  assert.equal(chip.shortForm(), null, 'une valeur absente n’affiche rien du tout');

  chip.value = 'f02b6fb4d2b2a9c7e1d4';
  assert.equal(chip.shortForm(), 'f02b6fb4d2b2…');

  // Déjà courte : aucune ellipse trompeuse.
  chip.value = 'abc123';
  assert.equal(chip.shortForm(), 'abc123');

  // Le préfixe sha256: reste lisible, la troncature porte sur l'empreinte.
  chip.keepPrefix = 'sha256:'; chip.length = 16;
  chip.value = 'sha256:ec3f0931a6e6f48a0e0ba97a2b5f85f3ba03ecd1a2b3c4d5e6f708192a3b4c5d';
  assert.equal(chip.shortForm(), 'sha256:ec3f0931a6e6f48a…');
  console.log('8. §20/§21 identifiants : forme courte, valeur complète préservée PASS');
}

// ── 9. §22 — aide contextuelle courte, et muette si on ne sait pas ────
{
  const hint = Object.create(infoHint.InfoHintComponent.prototype);
  hint.hint = null;
  hint.term = 'terme-inexistant';
  assert.equal(hint.text(), null, 'un terme inconnu n’affiche pas un point d’interrogation vide');
  hint.term = 'digest';
  assert.match(hint.text(), /sha256/);
  for (const [term, text] of Object.entries(infoHint.GLOSSARY)) {
    assert.ok(text.length <= 220, `aide trop longue pour une infobulle : ${term}`);
  }
  console.log('9. §22 aide contextuelle : courte, et absente plutôt qu’approximative PASS');
}

// ── 10. §6/§27 — un seul système de statut, aucune coquille dupliquée ─
{
  const projectsTpl = read('../src/app/features/projects/projects.component.html');
  const incidentsTpl = read('../src/app/features/incidents/incidents.component.html');
  const dashboardTpl = read('../src/app/features/dashboard/dashboard.component.html');

  for (const [name, tpl] of [['projets', projectsTpl], ['incidents', incidentsTpl], ['tableau de bord', dashboardTpl]]) {
    assert.match(tpl, /<app-status-chip/, `${name} doit utiliser la pastille de statut partagée`);
  }

  // §26 — plus de titre « // xxx » hérité d'un gabarit de démonstration.
  assert.doesNotMatch(incidentsTpl, /page-title">\/\//);
  assert.doesNotMatch(read('../src/app/features/analysis/analysis.component.html'), /page-title">\/\//);

  // §27 — le tableau de bord ne redéclare plus la navigation, la barre
  // supérieure ni la fiche utilisateur de la coquille applicative.
  for (const dead of ['class="sidebar"', 'class="topbar"', 'class="notif-panel"', 'sidebar-nav', 'user-pill']) {
    assert.ok(!dashboardTpl.includes(dead), `balisage de coquille dupliqué toujours présent : ${dead}`);
  }
  // Et il ne possède plus son propre bouton de thème (un seul dans la coquille).
  assert.ok(!dashboardTpl.includes('toggleTheme()'), 'un seul bouton de thème, celui de la coquille');

  // §23 — chaque tableau large défile dans son conteneur.
  for (const [name, tpl] of [['incidents', incidentsTpl], ['tableau de bord', dashboardTpl]]) {
    assert.match(tpl, /class="table-scroll"/, `${name} : tableau sans conteneur de défilement`);
  }
  console.log('10. §6/§23/§26/§27 cohérence de présentation PASS');
}

// ── 11. §16/§17 — état vide et échec de requête restent distincts ─────
{
  for (const path of [
    '../src/app/features/projects/projects.component.html',
    '../src/app/features/incidents/incidents.component.html',
    '../src/app/features/analytics/prediction.component.html',
    '../src/app/features/analysis/analysis.component.html',
  ]) {
    const tpl = read(path);
    assert.match(tpl, /Impossible de charger/, `${path} : l’échec de requête doit être dit explicitement`);
    assert.match(tpl, /Réessayer/, `${path} : un échec doit offrir une reprise`);
    assert.match(tpl, /loadError/, `${path} : l’état d’erreur doit être distinct de l’état vide`);
    // L'état vide est conditionné à l'absence d'erreur : jamais « aucune
    // donnée » affiché à la place d'une panne.
    assert.match(tpl, /!loadError/, `${path} : l’état vide doit exclure le cas d’erreur`);
  }
  console.log('11. §16/§17 vide ≠ échec, sur chaque liste PASS');
}

console.log('final-ui-freeze.spec: ALL PASS');
