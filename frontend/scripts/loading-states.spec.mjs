// Priorité 2 (audit UX) : les zones vides pendant le chargement doivent
// afficher le patron standard .loading-overlay/.spinner, jamais un écran
// figé ou un message "vide" pendant qu'une requête est encore en vol.
// Même technique que batch-polling.spec.mjs / chat-service.spec.mjs :
// source réelle transpilée + exécutée dans un bac à sable, instanciation
// via Object.create() (les initialiseurs de champs ne s'exécutent donc
// pas -- tout ce qu'une méthode testée lit est fixé à la main avant
// l'appel).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const rxjs = require('rxjs');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const angularStub = () => new Proxy({}, { get: () => (..._args) => target => target });

function loadClass(relPath, exportName) {
  const source = read(relPath);
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: angularStub,
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {},
    console,
  });
  return Object.create(exports[exportName].prototype);
}

// ── Dashboard : bannière sécurité + activité récente -> spinner pendant le chargement ──
const dashboardTemplate = read('../src/app/features/dashboard/dashboard.component.html');
assert.match(
  dashboardTemplate,
  /<section class="panel" \*ngIf="securitySummaryLoading">\s*<div class="loading-overlay" role="status"><div class="spinner"><\/div><span>Chargement…<\/span>/,
  'bannière "Sécurité plateforme" doit afficher le spinner standard pendant securitySummaryLoading',
);
assert.match(
  dashboardTemplate,
  /<div class="activity-list">\s*<div class="loading-overlay" role="status" \*ngIf="activitiesLoading"><div class="spinner"><\/div><span>Chargement…<\/span>/,
  '"Activité récente" doit afficher le spinner standard pendant activitiesLoading',
);
// Non-régression Priorité 1 (ne doit pas avoir été défait par cette passe).
assert.match(dashboardTemplate, /<div class="loading-overlay" role="status" \*ngIf="buildReliabilityLoading">/);
// Le comportement une fois les données arrivées ne doit pas avoir changé :
// les sections existantes gardent leurs conditions d'origine, juste préfixées.
assert.match(dashboardTemplate, /\*ngIf="!securitySummaryLoading && securitySummary"/);
assert.match(dashboardTemplate, /\*ngIf="!activitiesLoading && !dataErrors\['incidents'\] && !activities\.length"/);
console.log('loading-states dashboard: PASS');

// ── Détail projet : spinner standard au lieu du texte brut "Chargement..." ──
const projectDetailTemplate = read('../src/app/features/projects/project-detail.component.html');
assert.doesNotMatch(
  projectDetailTemplate,
  /class="loading-state">Chargement\.\.\.</,
  'ancien patron texte brut ne doit plus exister -- seul écran encore dessus avant cette passe',
);
assert.match(
  projectDetailTemplate,
  /<div \*ngIf="loading" class="loading-overlay">\s*<div class="spinner"><\/div><span>Chargement…<\/span>/,
);
assert.match(projectDetailTemplate, /#convergenceLoadingTpl/);
assert.match(projectDetailTemplate, /\*ngIf="!convergenceLoading; else convergenceLoadingTpl"/);
console.log('loading-states project-detail template: PASS');

// ── Détail projet : convergenceLoading transite correctement ──
const project = loadClass('../src/app/features/projects/project-detail.component.ts', 'ProjectDetailComponent');
// `id` est un @Input() -- sous la stub Angular de ce harnais (property
// decorator neutralisé), la propriété hérite d'un descripteur non
// réinscriptible sur le prototype. loadConvergence() lit this.id mais le
// stub api.getConvergence() ci-dessous l'ignore, donc inutile (et non
// sûr) de l'assigner ici -- voir batch-polling.spec.mjs, qui ne le fait
// pas non plus pour la même raison.
project.dataErrors = {};
project.convergenceCycles = [];
let convergenceResponse;
project.api = { getConvergence: () => convergenceResponse };

convergenceResponse = rxjs.of({ cycles: [{ buildNumber: 12 }] });
project.loadConvergence();
assert.equal(project.convergenceLoading, false, 'après une réponse réussie, convergenceLoading doit repasser à false');
assert.equal(project.convergenceCycles.length, 1);

convergenceResponse = rxjs.throwError(() => new Error('boom'));
project.loadConvergence();
assert.equal(project.convergenceLoading, false, 'après une erreur, convergenceLoading doit aussi repasser à false');
assert.equal(project.convergenceCycles.length, 0);
assert.match(project.dataErrors['convergence'], /Impossible de charger les cycles/);

// Pendant l'appel (avant résolution de l'observable), le flag doit être vrai
// -- c'est précisément ce qui manquait : "Aucun cycle corrélé disponible"
// ne doit plus s'afficher à ce moment-là.
const pendingConvergence = new rxjs.Subject();
convergenceResponse = pendingConvergence;
project.loadConvergence();
assert.equal(project.convergenceLoading, true, 'pendant la requête, convergenceLoading doit être vrai');
pendingConvergence.next({ cycles: [] });
pendingConvergence.complete();
assert.equal(project.convergenceLoading, false);
console.log('loading-states project-detail convergence: PASS');

// ── Formulaire projet : projectLoading indépendant de `loading` (save) ──
const form = loadClass('../src/app/features/projects/project-form.component.ts', 'ProjectFormComponent');
form.projectId = 'proj-1';
form.loading = false; // valeur réelle du constructeur -- jamais exécuté via Object.create()
let formResponse;
form.api = { getProject: () => formResponse };
form.form = { patchValue() {}, markAsPristine() {} };

formResponse = rxjs.of({ jenkinsCredentialConfigured: true });
form.loadProject();
assert.equal(form.projectLoading, false);
assert.equal(form.loading, false, 'loadProject() ne doit jamais toucher `loading` (réservé à save())');

const pendingForm = new rxjs.Subject();
formResponse = pendingForm;
form.loadProject();
assert.equal(form.projectLoading, true, 'pendant le chargement du projet, projectLoading doit être vrai');
assert.equal(form.loading, false, 'pendant ce même chargement, `loading` (texte du bouton "Sauvegarde...") doit rester false');
pendingForm.error(new Error('boom'));
assert.equal(form.projectLoading, false);
assert.match(form.saveError, /Impossible de charger la configuration/);

const projectFormTemplate = read('../src/app/features/projects/project-form.component.html');
const saveButtonDisabled = [...projectFormTemplate.matchAll(/\[disabled\]="([^"]*)"[^>]*>\s*\{\{\s*loading/g)];
assert.ok(saveButtonDisabled.length >= 2, 'les deux boutons Sauvegarder doivent exister');
for (const m of saveButtonDisabled) {
  assert.match(m[1], /loading \|\| projectLoading/, 'le bouton Sauvegarder doit rester désactivé pendant le chargement du projet, pas seulement pendant la sauvegarde');
}
assert.match(projectFormTemplate, /<div class="loading-overlay" \*ngIf="projectLoading">/);
console.log('loading-states project-form: PASS');
