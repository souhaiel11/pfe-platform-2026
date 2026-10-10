// Liens de source / navigation de preuve — sémantique de vérité côté UI.
//
// Ce que ce test protège :
//   — un chemin de source connu SANS URL ne devient jamais cliquable ;
//   — une preuve absente s'affiche « Source non disponible », jamais un lien
//     vers l'accueil d'un outil ;
//   — tout lien externe s'ouvre en nouvel onglet avec noopener noreferrer ;
//   — AUCUN composant ne construit d'URL d'outil : la seule origine est le
//     contrat backend (GET /api/source-evidence/*) ;
//   — une réponse de preuve qui ne porte pas le projet/incident affiché est
//     rejetée, donc une fuite de lien entre projets est impossible.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadFrontend } from './security-lifecycle-test-loader.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// Les commentaires DÉCRIVENT les contrats d'URL (c'est leur rôle : expliquer
// pourquoi tel lien est exact). Ils sont blanchis avant toute analyse de
// code, blocs multi-lignes compris — sinon une explication correcte ferait
// échouer le test qu'elle documente. Les retours à la ligne sont préservés
// pour que les numéros de ligne restent exacts.
const stripComments = source => source
  .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\/.*$/gm, '');

// Chargement par le loader partagé de ce répertoire : il neutralise les
// décorateurs Angular SANS figer les @Input() (voir
// security-lifecycle-test-loader.mjs), ce qui permet d'exercer les vraies
// méthodes des vrais composants.
const types = loadFrontend('../src/app/shared/source-evidence/source-evidence.types.ts', {}, { URL });
const evidenceDeps = { './source-evidence.types': types, '../../shared/source-evidence/source-evidence.types': types };
const loadComponent = (path, exportName, dependencies = {}) => {
  const module = loadFrontend(path, { ...evidenceDeps, ...dependencies }, { URL });
  return Object.create(module[exportName].prototype);
};

const linkSource = read('../src/app/shared/source-evidence/source-evidence-link.component.ts');
const listSource = read('../src/app/shared/source-evidence/source-evidence-list.component.ts');
const projectTs = read('../src/app/features/projects/project-detail.component.ts');
const projectHtml = read('../src/app/features/projects/project-detail.component.html');
const incidentTs = read('../src/app/features/incidents/incident-detail.component.ts');
const incidentHtml = read('../src/app/features/incidents/incident-detail.component.html');
const cveSource = read('../src/app/features/projects/cve-table.component.ts');
const zapSource = read('../src/app/features/projects/zap-table.component.ts');
const remediationSource = read('../src/app/features/incidents/remediation-card.component.ts');
const apiSource = read('../src/app/core/services/api.service.ts');

const { safeEvidenceUrl, normalizeEvidence, normalizeEvidenceSlots, normalizeEvidenceView, providerLabel, EVIDENCE_UNAVAILABLE_LABEL } = types;

// ── 1. Portillon de sortie : ce qui ne peut pas devenir un href ──────────
{
  for (const hostile of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,xx', 'file:///etc/passwd',
    'vbscript:x', 'http://user:secret@localhost:9000/', 'https://u:p@example.com/',
    '', '   ', 'not a url', '/relative', 'reports/trivy-report.json', null, undefined, 42, {},
  ]) {
    assert.equal(safeEvidenceUrl(hostile), null, `rejeté: ${String(hostile)}`);
  }
  for (const ok of ['http://localhost:9000/dashboard?id=k', 'https://github.com/o/r/commit/abc']) {
    assert.ok(safeEvidenceUrl(ok), `accepté: ${ok}`);
  }
  console.log('1. sanitisation des URL de preuve PASS');
}

// ── 2. Invariant LINK ⟺ url, et préservation exacte du chemin ────────────
{
  const link = normalizeEvidence({ provider: 'JENKINS', kind: 'JENKINS_BUILD', label: 'Voir le build Jenkins', url: 'http://localhost:8082/job/a/7/', buildNumber: 7 });
  assert.equal(link.availability, 'LINK');
  assert.equal(link.reason, null);

  // Chemin connu sans URL → PATH_ONLY, chemin EXACT, jamais de lien.
  const path = normalizeEvidence({ provider: 'TRIVY', kind: 'TRIVY_REPORT', label: 'Voir le rapport Trivy', url: null, sourcePath: '/partage/rapports/job/6/trivy-report.json', reason: 'Rapport dans le workspace du build.' });
  assert.equal(path.availability, 'PATH_ONLY');
  assert.equal(path.url, null);
  assert.equal(path.sourcePath, '/partage/rapports/job/6/trivy-report.json');
  assert.ok(path.reason);

  // Une URL hostile servie par le backend est neutralisée ici aussi, et la
  // preuve RETOMBE sur son chemin — elle ne devient pas un lien.
  const poisoned = normalizeEvidence({ provider: 'ZAP', kind: 'ZAP_REPORT', label: 'L', url: 'javascript:alert(1)', sourcePath: 'rapports/zap-report.json' });
  assert.equal(poisoned.availability, 'PATH_ONLY');
  assert.equal(poisoned.url, null);

  // Aucune information → libellé d'indisponibilité, jamais un lien.
  const none = normalizeEvidence({ provider: 'OWASP', kind: 'OWASP_REPORT', label: 'L' });
  assert.equal(none.availability, 'UNAVAILABLE');
  assert.equal(none.url, null);
  assert.equal(none.sourcePath, null);
  assert.equal(none.reason, EVIDENCE_UNAVAILABLE_LABEL);

  assert.equal(normalizeEvidence(null), null);
  assert.deepEqual(Object.keys(normalizeEvidenceSlots({ A: null, B: 'x' })), []);
  assert.equal(Object.keys(normalizeEvidenceSlots({ A: { kind: 'A', label: 'a' } })).length, 1);
  // Les preuves IMBRIQUÉES passent le même portillon : sinon une URL non
  // navigable y redeviendrait un [href] en contournant l'assainissement.
  const view = normalizeEvidenceView({
    slots: { A: { kind: 'A', label: 'a', url: 'javascript:alert(1)', sourcePath: 'p' } },
    findings: [{ findingId: 'CVE-1', slots: { ADVISORY: { kind: 'ADVISORY', label: 'a', url: 'javascript:alert(1)', sourcePath: 'CVE-1' } } }],
    sonarIssues: [{ issueId: 'i', slots: { GIT_FILE: { kind: 'GIT_FILE', label: 'f', url: 'http://sonarqube:9000/x' } } }],
    remediations: [{ taskId: 't', slots: { PULL_REQUEST: { kind: 'PULL_REQUEST', label: 'pr', url: 'https://github.com/o/r/pull/1' } } }],
  });
  assert.equal(view.slots.A.url, null);
  assert.equal(view.findings[0].slots.ADVISORY.url, null);
  assert.equal(view.findings[0].slots.ADVISORY.availability, 'PATH_ONLY');
  // Un alias Docker est une URL syntaxiquement valide : le portillon frontend
  // ne la rejette pas (c'est le rôle du backend), mais elle reste traitée.
  assert.ok(view.sonarIssues[0].slots.GIT_FILE);
  assert.equal(view.remediations[0].slots.PULL_REQUEST.url, 'https://github.com/o/r/pull/1');

  assert.equal(providerLabel('SONARQUBE'), 'SonarQube');
  assert.equal(providerLabel('INCONNU'), 'Source');
  console.log('2. invariant lien/chemin/indisponible PASS');
}

// ── 3. Gabarit du composant de lien : trois états, un seul cliquable ────
{
  // L'état LINK est le SEUL à porter un [href], et il porte les deux
  // protections d'ouverture externe.
  const anchor = /<a \*ngIf="item\.availability === 'LINK'"[\s\S]*?<\/a>/.exec(linkSource);
  assert.ok(anchor, 'la branche LINK doit être un <a>');
  assert.match(anchor[0], /\[href\]="item\.url"/);
  assert.match(anchor[0], /target="_blank"/);
  assert.match(anchor[0], /rel="noopener noreferrer"/);
  assert.match(anchor[0], /↗/, 'un lien externe doit être signalé comme tel');

  // PATH_ONLY : un <span>, un <code>, aucun href.
  const pathBlock = /<span \*ngIf="item\.availability === 'PATH_ONLY'"[\s\S]*?(?=<span \*ngIf="item\.availability === 'UNAVAILABLE'")/.exec(linkSource);
  assert.ok(pathBlock, 'la branche PATH_ONLY doit exister');
  assert.doesNotMatch(pathBlock[0], /href/, 'un chemin ne doit JAMAIS porter de href');
  // §20 — forme ABRÉGÉE affichée, valeur COMPLÈTE conservée dans title.
  assert.match(pathBlock[0], /<code class="sev-path-value"[^>]*>\{\{ shortIdentifier\(item\.sourcePath\) \}\}<\/code>/);
  assert.match(pathBlock[0], /\[attr\.title\]="isAbbreviated\(item\.sourcePath\) \? item\.sourcePath : null"/);
  // §21 — le bouton copier transmet la valeur COMPLÈTE, jamais l'abrégée.
  assert.match(pathBlock[0], /\(click\)="copy\(item\.sourcePath\)"/);
  assert.match(pathBlock[0], /\[attr\.aria-label\]="'Copier ' \+ item\.label"/);

  // UNAVAILABLE : le libellé exact, aucun href.
  const noneBlock = /<span \*ngIf="item\.availability === 'UNAVAILABLE'"[\s\S]*?(?=<\/ng-container>)/.exec(linkSource);
  assert.ok(noneBlock, 'la branche UNAVAILABLE doit exister');
  assert.doesNotMatch(noneBlock[0], /href/);
  assert.match(noneBlock[0], /Source non disponible/);

  // Exactement un href dans tout le composant.
  assert.equal((linkSource.match(/\[href\]/g) || []).length, 1, 'un seul href possible dans le composant');
  // Et aucune construction d'URL.
  assert.doesNotMatch(stripComments(linkSource), /https?:\/\//, 'le composant de lien ne contient aucune URL');
  console.log('3. gabarit du composant de preuve PASS');
}

// ── 4. Les sections vides se taisent au lieu d'afficher du vide ─────────
{
  const list = loadComponent('../src/app/shared/source-evidence/source-evidence-list.component.ts', 'SourceEvidenceListComponent');
  list.hideEmptySections = true;
  list.sections = [
    { id: 'a', title: 'A', slots: ['LIEN'] },
    { id: 'b', title: 'B', slots: ['RIEN', 'RIEN2'] },
  ];
  list.slots = {
    LIEN: { availability: 'LINK', url: 'http://localhost:9000/x' },
    RIEN: { availability: 'UNAVAILABLE', url: null },
    RIEN2: { availability: 'UNAVAILABLE', url: null },
  };
  assert.deepEqual(list.visibleSections().map(s => s.id), ['a']);
  // Un chemin seul SUFFIT à rendre une section visible : c'est une vraie
  // information de source, même sans lien.
  list.slots.RIEN = { availability: 'PATH_ONLY', url: null, sourcePath: 'x/y.json' };
  assert.deepEqual(list.visibleSections().map(s => s.id), ['a', 'b']);
  list.hideEmptySections = false;
  assert.equal(list.visibleSections().length, 2);
  assert.equal(list.slotOf('ABSENT'), null);
  console.log('4. sections de preuve vides masquées PASS');
}

// ── 5. Aucun composant ne construit d'URL d'outil ───────────────────────
{
  const walk = dir => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]);
  const files = walk('../src/app/').filter(f => /\.(ts|html)$/.test(f) && !/\/fixtures\//.test(f));

  // Motifs de CONSTRUCTION d'URL d'outil. La seule exception autorisée est
  // platform-capability-presentation.ts::repositoryUrl (forme owner/repo du
  // dépôt GitHub, déjà testée ailleurs et respectant le fournisseur).
  const builders = [
    { re: /\/dashboard\?id=/, what: 'URL de tableau de bord SonarQube' },
    { re: /\/project\/issues\?id=/, what: 'URL d’issues SonarQube' },
    { re: /coding_rules\?open=/, what: 'URL de règle SonarQube' },
    { re: /'\/job\/'|"\/job\/"|`\/job\//, what: 'chemin de job Jenkins' },
    { re: /nvd\.nist\.gov/, what: 'URL NVD' },
    { re: /github\.com\/advisories/, what: 'URL d’avis GitHub' },
    { re: /portal\.azure\.com/, what: 'URL de portail Azure' },
    { re: /\/blob\/|\/commit\/|\/pull\//, what: 'chemin d’objet Git' },
    { re: /azurecr\.io/, what: 'référence de registre ACR' },
    { re: /\/workflow\/.*\/executions/, what: 'URL d’exécution n8n' },
  ];
  const allowed = new Set(['../src/app/shared/platform-capability-presentation.ts']);
  const offences = [];
  for (const file of files) {
    if (allowed.has(file)) continue;
    const source = stripComments(read(file));
    for (const { re, what } of builders) {
      source.split('\n').forEach((line, i) => {
        if (re.test(line)) offences.push(`${file}:${i + 1} ${what}`);
      });
    }
  }
  assert.deepEqual(offences, [], `construction d'URL d'outil dans l'UI :\n${offences.join('\n')}`);

  // Et le composant qui construisait une URL NVD ne le fait plus.
  assert.doesNotMatch(stripComments(cveSource), /nvdUrl/, 'cve-table ne doit plus deviner de référentiel public');
  assert.match(cveSource, /advisoryEvidence\(c\)/, 'cve-table consomme la preuve d’avis du backend');
  assert.match(cveSource, /reportEvidence\(c\)/, 'cve-table consomme la preuve de rapport du backend');
  console.log('5. aucune construction d’URL d’outil dans l’UI PASS');
}

// ── 6. Les URL de preuve viennent d'un SEUL endroit : le contrat backend ─
{
  assert.match(apiSource, /source-evidence\/project\/\$\{id\}/);
  assert.match(apiSource, /source-evidence\/incident\/\$\{id\}/);
  // Lecture seule : aucun POST/PUT/DELETE sur cette route.
  const calls = apiSource.match(/this\.http\.\w+<[^>]*>\(`\$\{this\.base\}\/source-evidence[^`]*`/g) || [];
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call, /this\.http\.get</, 'la table de preuve est en lecture seule');
  console.log('6. origine unique des URL de preuve PASS');
}

// ── 7. Isolation par projet / par incident : aucune fuite possible ──────
{
  // Vue PROJET : une réponse qui ne porte pas CE projet est rejetée.
  const project = loadComponent('../src/app/features/projects/project-detail.component.ts', 'ProjectDetailComponent');
  project.id = 'projet-affiche';
  project.projectEvidence = null;
  project.reportEvidence = null;
  const captured = {};
  project.api = {
    getProjectSourceEvidence: () => ({ pipe: () => ({ subscribe: handlers => { captured.project = handlers; } }) }),
    getIncidentSourceEvidence: () => ({ pipe: () => ({ subscribe: handlers => { captured.report = handlers; } }) }),
  };
  project.projectScopeReset$ = {};
  project.loadSourceEvidence();
  captured.project.next({ projectId: 'UN-AUTRE-PROJET', slots: { SONAR_PROJECT: { kind: 'SONAR_PROJECT', label: 'L', url: 'http://localhost:9000/dashboard?id=autre' } } });
  assert.equal(project.projectEvidence, null, 'une preuve d’un autre projet doit être rejetée');
  assert.equal(project.evidence('SONAR_PROJECT'), null);

  captured.project.next({ projectId: 'projet-affiche', slots: { SONAR_PROJECT: { kind: 'SONAR_PROJECT', label: 'L', url: 'http://localhost:9000/dashboard?id=le-bon' } } });
  assert.equal(project.evidence('SONAR_PROJECT').url, 'http://localhost:9000/dashboard?id=le-bon');

  // Vue ANALYSE : le projet ET l'analyse doivent correspondre.
  project.loadReportEvidence('analyse-1');
  captured.report.next({ projectId: 'projet-affiche', incidentId: 'AUTRE-ANALYSE', slots: {} });
  assert.equal(project.reportEvidence, null, 'une preuve d’une autre analyse doit être rejetée');
  project.loadReportEvidence('analyse-1');
  captured.report.next({ projectId: 'UN-AUTRE-PROJET', incidentId: 'analyse-1', slots: {} });
  assert.equal(project.reportEvidence, null, 'une preuve d’un autre projet doit être rejetée');

  // Une erreur réseau n'invente rien.
  project.loadReportEvidence('analyse-1');
  captured.report.error(new Error('réseau'));
  assert.equal(project.reportEvidence, null);

  // Changer de projet purge la table de preuve.
  assert.match(projectTs, /this\.projectEvidence = null;\s*\n\s*this\.reportEvidence = null;/,
    'le changement de projet doit purger les preuves');

  // Vue INCIDENT : même garde.
  const incident = loadComponent('../src/app/features/incidents/incident-detail.component.ts', 'IncidentDetailComponent');
  incident.id = 'incident-affiche';
  incident.sourceEvidence = null;
  let incidentHandlers;
  incident.api = { getIncidentSourceEvidence: () => ({ pipe: () => ({ subscribe: h => { incidentHandlers = h; } }) }) };
  incident.incidentScopeReset$ = {};
  incident.loadSourceEvidence();
  incidentHandlers.next({ incidentId: 'UN-AUTRE-INCIDENT', slots: { JENKINS_BUILD: { kind: 'JENKINS_BUILD', label: 'L', url: 'http://localhost:8082/job/a/9/' } } });
  assert.equal(incident.sourceEvidence, null, 'une preuve d’un autre incident doit être rejetée');
  assert.equal(incident.evidence('JENKINS_BUILD'), null);
  incidentHandlers.next({ incidentId: 'incident-affiche', buildNumber: 9, commitSha: 'abcdef1234567890', slots: { JENKINS_BUILD: { kind: 'JENKINS_BUILD', label: 'L', url: 'http://localhost:8082/job/a/9/' } }, sections: [], findings: [], remediations: [] });
  assert.equal(incident.evidence('JENKINS_BUILD').url, 'http://localhost:8082/job/a/9/');
  assert.equal(incident.provenanceNote(), 'Build #9 — commit abcdef1');
  console.log('7. isolation projet/incident des liens de preuve PASS');
}

// ── 8. Repli d'emplacement : analyse > projet, jamais l'inverse ─────────
{
  const project = loadComponent('../src/app/features/projects/project-detail.component.ts', 'ProjectDetailComponent');
  project.projectEvidence = {
    projectId: 'p',
    slots: {
      JENKINS_JOB: { kind: 'JENKINS_JOB', availability: 'LINK', url: 'http://localhost:8082/job/a/' },
      JENKINS_LATEST_BUILD: { kind: 'JENKINS_BUILD', availability: 'LINK', url: 'http://localhost:8082/job/a/12/' },
      JENKINS_LATEST_BUILD_LOGS: { kind: 'JENKINS_BUILD_LOGS', availability: 'LINK', url: 'http://localhost:8082/job/a/12/consoleText' },
    },
  };
  project.reportEvidence = null;
  // Sans analyse sélectionnée, « le build affiché » est le dernier du projet.
  assert.equal(project.allEvidenceSlots()['JENKINS_BUILD'].url, 'http://localhost:8082/job/a/12/');

  // Avec une analyse sélectionnée, c'est SON build — jamais le dernier.
  project.reportEvidence = { slots: { JENKINS_BUILD: { kind: 'JENKINS_BUILD', availability: 'LINK', url: 'http://localhost:8082/job/a/7/' } } };
  assert.equal(project.allEvidenceSlots()['JENKINS_BUILD'].url, 'http://localhost:8082/job/a/7/');
  // Le repli ne va jamais dans l'autre sens : la preuve de PROJET ne prend
  // pas la valeur d'une analyse.
  assert.equal(project.projectEvidenceSlot('JENKINS_BUILD'), null);
  assert.equal(project.projectEvidenceSlot('JENKINS_JOB').url, 'http://localhost:8082/job/a/');

  // Les emplacements déclarés par chaque onglet existent dans le contrat.
  const declared = new Set();
  for (const name of ['jenkinsEvidenceSections', 'dockerEvidenceSections', 'sonarEvidenceSections', 'securityEvidenceSections', 'deploymentEvidenceSections']) {
    for (const section of project[name]()) for (const slot of section.slots) declared.add(slot);
  }
  const contract = new Set([
    'SONAR_PROJECT', 'JENKINS_JOB', 'JENKINS_BUILD', 'JENKINS_BUILD_LOGS', 'GIT_REPOSITORY', 'GIT_COMMIT',
    'TRIVY_REPORT', 'OWASP_REPORT', 'ZAP_REPORT', 'ZAP_TARGET',
    'PUBLISHED_IMAGE', 'IMAGE_DIGEST', 'DOCKERFILE', 'ACR_REGISTRY', 'AZURE_TARGET', 'AZURE_RESOURCE_GROUP',
  ]);
  for (const slot of declared) assert.ok(contract.has(slot), `emplacement hors contrat : ${slot}`);
  console.log('8. repli d’emplacement et conformité au contrat PASS');
}

// ── 9. Placement : chaque interface porte la preuve qui la concerne ─────
{
  // Vue projet : un bloc par onglet technique.
  for (const [sections, label] of [
    ['jenkinsEvidenceSections()', 'Jenkins'],
    ['dockerEvidenceSections()', 'Docker'],
    ['sonarEvidenceSections()', 'SonarQube'],
    ['securityEvidenceSections()', 'Sécurité'],
    ['reportEvidenceSections()', 'Rapport IA'],
  ]) {
    assert.ok(projectHtml.includes(`[sections]="${sections}"`), `l'onglet ${label} doit porter son bloc de preuve`);
  }
  // Sécurité : la source EXACTE à côté de chaque scanner.
  for (const slot of ['TRIVY_REPORT', 'OWASP_REPORT', 'ZAP_REPORT', 'ZAP_TARGET']) {
    assert.ok(projectHtml.includes(`evidence('${slot}')`), `la section ${slot} doit afficher sa source`);
  }
  // Le constat Sonar : issue exacte, règle, fichier au commit.
  for (const slot of ['SONAR_ISSUE', 'SONAR_RULE', 'GIT_FILE']) {
    assert.ok(projectHtml.includes(`sonarIssueEvidence(selectedSonarFinding)?.['${slot}']`), `le tiroir Sonar doit porter ${slot}`);
  }
  // Config : chemins de rapport affichés comme CHEMINS.
  for (const field of ['trivyReportPath', 'owaspReportPath', 'zapReportPath']) {
    assert.ok(projectHtml.includes(`project?.${field}`), `la config doit exposer ${field}`);
  }

  // Vue incident : provenance + validation, étapes distinctes.
  assert.ok(incidentHtml.includes('[sections]="evidenceSections()"'), 'la provenance d’incident doit être affichée');
  for (const slot of ['FIX_PULL_REQUEST', 'VALIDATION_PULL_REQUEST', 'VALIDATION_BUILD', 'VALIDATION_COMMIT', 'VALIDATION_LOGS']) {
    assert.ok(incidentHtml.includes(`evidence('${slot}')`), `l’incident doit porter ${slot}`);
  }
  // La PR générée (WF2) et la PR validée (WF3) restent DEUX emplacements.
  assert.notEqual(
    incidentHtml.indexOf("evidence('FIX_PULL_REQUEST')"),
    incidentHtml.indexOf("evidence('VALIDATION_PULL_REQUEST')"),
  );

  // Cartes de remédiation : sources de phase, sans bouton sortant.
  assert.equal((incidentHtml.match(/\[sources\]=/g) || []).length, 5, 'chaque phase doit déclarer ses sources');
  assert.match(remediationSource, /presentSources\(\)/);
  assert.match(zapSource, /reportEvidence\(a\)/);
  assert.match(zapSource, /\[item\]="targetEvidence"/);
  console.log('9. placement des preuves par interface PASS');
}

// ── 10. §19 — la navigation interne reste interne ───────────────────────
{
  // Un clic sur une carte/étape mène à une VUE de la plateforme ; seuls les
  // liens de preuve sortent. La vue Docker ne redirige donc pas vers Jenkins.
  assert.doesNotMatch(stripComments(projectHtml), /dockerJenkinsBuildUrl/, 'plus de lien Jenkins ad hoc dans la vue Docker');
  assert.match(projectHtml, /\(click\)="setActiveTab\('securite'\); setSecurityFilter\('trivy'\)"/,
    'la navigation interne de la vue Docker doit rester interne');
  assert.match(projectHtml, /\(click\)="setActiveTab\('deploiement'\)"/);
  // Et le bouton de build Jenkins reste une ACTION, pas un lien.
  assert.match(projectHtml, /\(click\)="triggerBuild\(\)"/);
  console.log('10. navigation interne préservée PASS');
}

// ── 11. §17/§18 — chargement et échec ne sont JAMAIS une absence ────────
{
  // Le composant de lien a trois états de CHARGEMENT en plus des trois
  // états de disponibilité, et ils ne se mélangent pas.
  assert.match(linkSource, /\*ngIf="state === 'loading'"[^>]*class="sev-skeleton"/,
    'un squelette doit couvrir le chargement');
  assert.doesNotMatch(
    /<span \*ngIf="state === 'loading'"[\s\S]*?<\/span>/.exec(linkSource)[0],
    /Source non disponible/,
    'le chargement ne doit jamais afficher une absence');
  const errorBlock = /<span \*ngIf="state === 'error'"[\s\S]*?(?=<ng-container \*ngIf="state === 'ready'")/.exec(linkSource);
  assert.ok(errorBlock, 'un état d’échec distinct doit exister');
  assert.doesNotMatch(errorBlock[0], /Source non disponible/,
    'un échec de requête ne doit jamais se présenter comme une absence de preuve');
  assert.match(errorBlock[0], /Réessayer/, 'un échec doit offrir une reprise');
  // La liste aussi : squelettes, message d’erreur distinct, vide discret.
  assert.match(listSource, /state === 'loading'/);
  assert.match(listSource, /Impossible de charger les sources/);
  assert.match(listSource, /class="sev-block-retry"/);
  assert.match(listSource, /state === 'ready' && !visibleSections\(\)\.length/,
    'le vide ne s’affiche qu’une fois le chargement terminé');

  // Les deux écrans suivent réellement l’état, et une erreur n’est pas null.
  for (const [source, name] of [[projectTs, 'projet'], [incidentTs, 'incident']]) {
    assert.match(source, /EvidenceLoadState/, `${name} doit suivre l’état de chargement`);
    assert.match(source, /State = 'error'/, `${name} doit distinguer l’échec`);
  }
  // Et l’état agrégé ne retombe jamais sur « prêt » quand une lecture échoue.
  const project = loadComponent('../src/app/features/projects/project-detail.component.ts', 'ProjectDetailComponent');
  project.projectEvidenceState = 'error'; project.reportEvidenceState = 'ready';
  assert.equal(project.evidenceState(), 'error');
  project.projectEvidenceState = 'ready'; project.reportEvidenceState = 'loading';
  assert.equal(project.evidenceState(), 'loading');
  project.projectEvidenceState = 'ready'; project.reportEvidenceState = 'ready';
  assert.equal(project.evidenceState(), 'ready');
  console.log('11. chargement / échec / absence restent trois faits distincts PASS');
}

// ── 12. §20 — un identifiant abrégé ne devient jamais la valeur réelle ──
{
  const { shortIdentifier, isAbbreviated } = types;
  const digest = 'sha256:' + 'a'.repeat(64);
  assert.equal(shortIdentifier(digest), 'sha256:aaaaaaaaaaaa…');
  assert.ok(isAbbreviated(digest));
  const sha = 'f02b6fb4d2b2e9f46afcdc9ca88dc1d086187248';
  assert.equal(shortIdentifier(sha), 'f02b6fb');
  // Un chemin ou une référence d’image n’est JAMAIS tronqué : son milieu
  // porte l’information (quel fichier, quel dépôt).
  for (const keep of [
    '/partage/rapports/job/6/trivy-report.json',
    'acrpfedevsecops.azurecr.io/mon-app:10-f02b6fb4d2b2',
    'rg-demo', 'aci-demo', 'http://cible-interne:8080',
  ]) {
    assert.equal(shortIdentifier(keep), keep, `ne doit pas être tronqué: ${keep}`);
    assert.equal(isAbbreviated(keep), false);
  }
  assert.equal(shortIdentifier(null), null);
  assert.equal(shortIdentifier('   '), null);
  console.log('12. abréviation réservée aux empreintes opaques PASS');
}

console.log('source-evidence.spec: ALL PASS');
