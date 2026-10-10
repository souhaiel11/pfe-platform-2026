// R49 — Docker a sa propre destination, et ses valeurs viennent de sources reelles.
//
// Defaut constate : cliquer la carte/l'etape Docker ouvrait l'onglet JENKINS.
// Le pipeline reel expose les etapes zap/build/owasp/sonar/tests/trivy/deploy/
// docker (verifie sur app-test-pfe-vermeg et pfe-app-test), donc 'docker' etait
// une destination vivante routee vers la mauvaise page. Jenkins reste une
// preuve secondaire, accessible DEPUIS la vue Docker.
//
//   node frontend/scripts/docker-view-navigation.spec.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');
const truthSrc = read('../src/app/shared/data-truth.ts');
const overview = read('../src/app/features/projects/project-overview.component.ts');
const detailTs = read('../src/app/features/projects/project-detail.component.ts');
const detailHtml = read('../src/app/features/projects/project-detail.component.html');

const strip = (s) => s
  .replace(/export function /g, 'function ')
  .replace(/: *number \| null/g, '').replace(/: *boolean(?: \| null)?/g, '')
  .replace(/: *\{ *repository[^}]*\}/g, '')
  .replace(/: *string(?: \| null)?/g, '').replace(/: *unknown/g, '').replace(/: *any/g, '')
  // assertions TypeScript : `as Record<...>`, `as const`
  .replace(/ as Record<[^>]*>/g, '').replace(/ as const/g, '');
// Les annotations de type sont retirees AVANT l'extraction : un type de retour
// comme `{ repository: ... }` porte des accolades qui fausseraient le comptage.
const plainSrc = strip(truthSrc);
const pick = (name) => {
  const start = plainSrc.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} doit exister`);
  let depth = 0;
  for (let j = plainSrc.indexOf('{', start); j < plainSrc.length; j++) {
    if (plainSrc[j] === '{') depth++;
    else if (plainSrc[j] === '}' && --depth === 0) return plainSrc.slice(start, j + 1);
  }
  throw new Error(`corps de ${name} introuvable`);
};
const { dockerImageState, dockerImageRef, dockerImageParts, dockerPushState, sourceInteger } = new Function(`
  ${pick('dockerImageState')}
  ${pick('dockerImageRef')}
  ${pick('dockerImageParts')}
  ${pick('dockerPushState')}
  ${pick('sourceInteger')}
  return { dockerImageState, dockerImageRef, dockerImageParts, dockerPushState, sourceInteger };
`)();

// ════════════════════════════════════════════════════════════════════════════
// 1. NAVIGATION — plus aucune redirection Docker -> Jenkins
// ════════════════════════════════════════════════════════════════════════════
const governedMap = overview.slice(overview.indexOf('const tabs: Record<string, string>'));
const mapLine = governedMap.slice(0, governedMap.indexOf('\n'));
assert.ok(/docker: 'docker'/.test(mapLine), "l'etape 'docker' doit ouvrir la vue Docker");
assert.ok(!/docker: 'jenkins'/.test(overview), "aucune etape docker ne doit router vers Jenkins");
assert.ok(!/container: 'jenkins'/.test(overview), "aucune etape conteneur ne doit router vers Jenkins");
assert.ok(/{ key: 'image', label: 'Image', tab: 'docker'/.test(overview),
  "l'etape heritee 'Image' doit ouvrir la vue Docker");
assert.ok(!/label: 'Image', tab: 'jenkins'/.test(overview));

// Les etapes legitimement Jenkins le restent : build et tests sont de la preuve CI.
assert.ok(/build: 'jenkins'/.test(mapLine), "l'etape build reste sous Jenkins");
assert.ok(/tests: 'jenkins'/.test(mapLine), "l'etape tests reste sous Jenkins");
// Et 'deploy' garde la section de gouvernance de la plateforme.
assert.ok(/deploy: 'deploiement'/.test(mapLine));

// Le routeur d'onglets doit connaitre 'docker', sinon setActiveTab retombe
// silencieusement sur 'rapport' (c'etait le second defaut, latent).
assert.ok(/docker: 'docker',/.test(detailTs), "tabMap doit mapper docker -> docker");
assert.ok(/VALID_TABS = \[[^\]]*'docker'/.test(detailTs), "'docker' doit rester un onglet valide");
// Aucune redirection docker/image/deploy -> jenkins ailleurs dans la page.
for (const bad of [/docker[^\n]{0,24}=>[^\n]{0,24}jenkins/i, /image[^\n]{0,20}'jenkins'/]) {
  assert.ok(!bad.test(detailTs) && !bad.test(overview), `mauvais routage restant : ${bad}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. ETAT DE L'IMAGE — chaque absence a son motif, aucun tiret
// ════════════════════════════════════════════════════════════════════════════
// Cas reel : vuln-testapp build #41 — image_tag vide, build_status UNKNOWN.
assert.equal(dockerImageState({ image_tag: '', push_status: 'SKIPPED', build_status: 'UNKNOWN' }),
  'Image non construite');
assert.equal(dockerImageState({ build_status: 'NOT_RUN' }), 'Non exécuté');
assert.equal(dockerImageState({ build_status: 'NOT_CONFIGURED' }), 'Non configuré');
assert.equal(dockerImageState({ build_status: 'FAILED', image_tag: '' }), 'Image non construite');
assert.equal(dockerImageState({ build_status: 'FAILED', image_tag: 'x:1' }), 'Échec de construction');
assert.equal(dockerImageState({ build_status: 'RUNNING' }), 'En attente');
assert.equal(dockerImageState(null), 'Non disponible');
assert.equal(dockerImageState({}), 'Image non construite');
// Cas reel : app-test-pfe-vermeg build #8 — image construite, aucun etat a afficher.
assert.equal(dockerImageState({ image_tag: 'app-test-pfe-vermeg:8', build_status: 'SUCCESS' }), '');
assert.ok(!Object.values({ a: dockerImageState({}) }).includes('-'), "'-' n'est jamais un etat");

// ════════════════════════════════════════════════════════════════════════════
// 3. IDENTITE — rien n'est reconstruit a partir du nom du projet
// ════════════════════════════════════════════════════════════════════════════
assert.equal(dockerImageRef({ image_tag: 'app-test-pfe-vermeg:8' }), 'app-test-pfe-vermeg:8');
assert.equal(dockerImageRef({ image_tag: '   ' }), null, 'une reference vide n\'est pas une reference');
assert.equal(dockerImageRef({}), null);
assert.deepEqual(dockerImageParts({ image_tag: 'app-test-pfe-vermeg:8' }),
  { repository: 'app-test-pfe-vermeg', tag: '8' });
assert.deepEqual(dockerImageParts({ image_tag: 'registry.io/ns/app:1.2.3' }),
  { repository: 'registry.io/ns/app', tag: '1.2.3' });
assert.deepEqual(dockerImageParts({ image_tag: 'sansTag' }), { repository: 'sansTag', tag: null },
  "aucune substitution par 'latest'");
assert.deepEqual(dockerImageParts({}), { repository: null, tag: null });

// ════════════════════════════════════════════════════════════════════════════
// 4. REGISTRE — « poussee » n'est ni « construite » ni « deployee »
// ════════════════════════════════════════════════════════════════════════════
assert.equal(dockerPushState({ push_status: 'NOT_ATTEMPTED' }), 'Non tentée');
assert.equal(dockerPushState({ push_status: 'SKIPPED' }), 'Non exécutée');
assert.equal(dockerPushState({ push_status: 'SUCCESS' }), 'Poussée');
assert.equal(dockerPushState({ push_status: 'FAILED' }), 'Échec');
assert.equal(dockerPushState({}), 'Non disponible');
assert.notEqual(dockerPushState({ push_status: 'NOT_ATTEMPTED' }), dockerPushState({ push_status: 'SKIPPED' }),
  'non tentee et non executee sont deux faits distincts');

// ════════════════════════════════════════════════════════════════════════════
// 4bis. NUMERO DE BUILD — Jenkins le livre parfois en chaine
// Cas reel : vuln-testapp build "41" et devsecops-testbed "19" sont des chaines,
// alors que app-test-pfe-vermeg 8 et pfe-app-test 151 sont des nombres. La garde
// stricte availableNumber() rejetait les chaines : la vue affichait « Non
// disponible » pour un numero que la source portait bel et bien.
// ════════════════════════════════════════════════════════════════════════════
assert.equal(sourceInteger(8), 8);
assert.equal(sourceInteger('41'), 41, 'un numero livre en chaine doit etre lu');
assert.equal(sourceInteger('  151  '), 151);
assert.equal(sourceInteger(0), 0, 'un zero reel reste zero');
// Et rien de douteux ne passe :
for (const junk of ['41abc', '4.1', '1e3', '-7', '', '   ', 'NaN', null, undefined, {}, [], true, 4.5, -1]) {
  assert.equal(sourceInteger(junk), null, `sourceInteger(${JSON.stringify(junk)}) doit rester null`);
}
assert.ok(/dockerBuildNumber\(\)[^\n]*sourceInteger/.test(detailTs),
  'le numero de build doit passer par sourceInteger');

// ════════════════════════════════════════════════════════════════════════════
// 5. DIGEST PREFERE AU TAG, ET JAMAIS SUBSTITUE
// ════════════════════════════════════════════════════════════════════════════
assert.ok(/dockerDigest\(\)[\s\S]{0,220}provenanceVerified|artifact\?\.digest/.test(detailTs),
  'le digest doit venir de l\'artefact de gouvernance');
assert.ok(!/digest[^\n]{0,40}\|\|[^\n]{0,20}tag/i.test(detailTs),
  'le digest ne doit JAMAIS retomber sur le tag');
assert.ok(detailHtml.includes('Provenance non vérifiée'),
  'un digest absent doit dire pourquoi');

// ════════════════════════════════════════════════════════════════════════════
// 6. SEMANTIQUES SEPAREES — build / image / registre / scan / deploiement
// ════════════════════════════════════════════════════════════════════════════
for (const section of ['Construction', 'Registre', 'Sécurité de l’image (Trivy)', 'Déploiement']) {
  assert.ok(detailHtml.includes(`>${section}<`) || detailHtml.includes(section),
    `la vue Docker doit distinguer la section ${section}`);
}
// « prete » != « deployee » : la vue ne doit jamais affirmer un deploiement.
assert.ok(detailTs.includes("'Image prête pour déploiement'"));
assert.ok(!/['"]Déployée['"]/.test(detailTs),
  'la vue Docker ne doit jamais affirmer qu\'une image est deployee');
assert.ok(/if \(!this\.deploymentConfigured\) return 'Non configuré';/.test(detailTs),
  'une cible non configuree doit se dire NON CONFIGURE');

// Le scan Trivy passe par la discipline scanner : pas de zero fabrique.
for (const f of ["'critical'", "'high'", "'cves_count'"]) {
  assert.ok(detailHtml.includes(`scannerMetric(ed?.trivy, ${f})`),
    `le resume Trivy doit lire ${f} via scannerMetric`);
}
assert.ok(detailHtml.includes("scannerState(ed?.trivy)"), "l'etat du scan doit etre explicite");

// ════════════════════════════════════════════════════════════════════════════
// 7. JENKINS EN PREUVE SECONDAIRE, pas en destination
// ════════════════════════════════════════════════════════════════════════════
// La preuve Jenkins vit maintenant dans le bloc « Sources & preuves » de la
// vue Docker, alimente par le contrat backend (GET /api/source-evidence/*).
// L'invariant teste reste le MEME : Jenkins est une preuve que l'on peut
// suivre DEPUIS la vue Docker, jamais la destination du clic sur la carte.
assert.ok(/dockerEvidenceSections\(\)/.test(detailHtml),
  'la vue Docker doit exposer son bloc de sources/preuves');
const dockerSections = /dockerEvidenceSections\(\): EvidenceSection\[\] \{\s*return \[([\s\S]*?)\];/.exec(detailTs);
assert.ok(dockerSections, 'les sections de preuve Docker doivent etre declarees');
for (const slot of ['JENKINS_BUILD', 'DOCKERFILE', 'PUBLISHED_IMAGE', 'ACR_REGISTRY']) {
  assert.ok(dockerSections[1].includes(`'${slot}'`),
    `la vue Docker doit porter la preuve ${slot}`);
}
// Aucune URL d'outil ne doit plus etre recomposee dans la vue Docker. Les
// commentaires sont blanchis : ils EXPLIQUENT le retrait de l'ancien helper,
// ils ne le reintroduisent pas.
const withoutComments = source => source
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
assert.ok(!/dockerJenkinsBuildUrl/.test(withoutComments(detailHtml) + withoutComments(detailTs)),
  'plus aucune URL Jenkins ad hoc dans la vue Docker');
// Et la navigation interne reste interne.
assert.ok(detailHtml.includes('Voir les vulnérabilités de l’image'));
assert.ok(detailHtml.includes('Voir le déploiement'));
assert.ok(/<button class="btn btn-secondary" type="button"[\s\S]{0,200}setActiveTab\('deploiement'\)/.test(detailHtml),
  'le deploiement reste une navigation interne, pas un lien sortant');

// ════════════════════════════════════════════════════════════════════════════
// 8. PORTEE PROJET — chargement paresseux, annulation, purge, assertion
// ════════════════════════════════════════════════════════════════════════════
assert.ok(/this\.activeTab === 'docker'\) this\.loadImageProvenance\(\)/.test(detailTs),
  'la provenance ne doit se charger que sur l\'onglet Docker');
assert.ok(/getGovernancePreview\(this\.id\)\.pipe\(takeUntil\(this\.projectScopeReset\$\)\)/.test(detailTs),
  'la requete doit etre annulee au changement de projet');
assert.ok(/this\.imageProvenance = null;\s*\n\s*this\.imageProvenanceLoading = false;/.test(detailTs),
  'l\'etat Docker doit etre purge au changement de projet');
assert.ok(/!g\.projectId \|\| g\.projectId === this\.id/.test(detailTs),
  'une reponse d\'un autre projet ne doit jamais etre affichee');

// ════════════════════════════════════════════════════════════════════════════
// 9. AUCUN CHAMP FABRIQUE — taille, image de base et chemin Dockerfile
// n'ont aucune source autoritaire par projet : ils ne sont donc PAS affiches.
// ════════════════════════════════════════════════════════════════════════════
for (const absent of ['Taille de l’image', 'Image de base', 'Chemin du Dockerfile']) {
  assert.ok(!detailHtml.includes(absent),
    `${absent} n'a pas de source autoritaire : ne pas l'afficher plutot que l'inventer`);
}

// ════════════════════════════════════════════════════════════════════════════
// 10. GENERICITE — aucune identite de projet
// ════════════════════════════════════════════════════════════════════════════
for (const [name, src] of [['data-truth.ts', truthSrc], ['project-detail.ts', detailTs],
                           ['project-overview.ts', overview], ['project-detail.html', detailHtml]]) {
  const body = src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('<!--'))
    .join('\n');
  for (const needle of ['pfe-app-test', 'app-test-pfe-vermeg', 'vuln-testapp', 'devsecops-testbed',
                        'acrpfedevsecops', 'aci-pfe-app-test']) {
    assert.ok(!body.includes(needle), `${name} ne doit pas nommer ${needle} hors commentaire`);
  }
  assert.ok(!/['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/.test(body),
    `${name} ne doit contenir aucun UUID de projet`);
  assert.ok(!/sha256:[0-9a-f]{16}/.test(body), `${name} ne doit contenir aucun digest en dur`);
}

console.log('R49 docker view + navigation: PASS');

// ════════════════════════════════════════════════════════════════════════════
// 11. R50 — publication, provenance et deploiement restent trois etats
// ════════════════════════════════════════════════════════════════════════════
const plain2 = strip(truthSrc);
const pickFrom = (name) => {
  const st = plain2.indexOf(`function ${name}`);
  assert.notEqual(st, -1, `${name} doit exister`);
  let d = 0;
  for (let j = plain2.indexOf('{', st); j < plain2.length; j++) {
    if (plain2[j] === '{') d++;
    else if (plain2[j] === '}' && --d === 0) return plain2.slice(st, j + 1);
  }
};
const { dockerProvenanceState, dockerPushState: pushState } = new Function(`
  ${pickFrom('dockerPushState')}
  ${pickFrom('dockerProvenanceState')}
  return { dockerPushState, dockerProvenanceState };
`)();

// L'etat « aucun registre configure » que le pipeline peut desormais emettre
// doit se lire, et rester distinct d'un echec et d'un non-essai.
assert.equal(pushState({ push_status: 'NOT_CONFIGURED' }), 'Aucun registre configuré');
for (const [a, b] of [['NOT_CONFIGURED', 'FAILED'], ['NOT_CONFIGURED', 'NOT_ATTEMPTED'],
                      ['NOT_ATTEMPTED', 'SKIPPED'], ['SUCCESS', 'FAILED']]) {
  assert.notEqual(pushState({ push_status: a }), pushState({ push_status: b }),
    `${a} et ${b} doivent rester deux etats distincts`);
}
assert.equal(pushState({ push_status: 'SUCCESS' }), 'Poussée');

// Provenance : un etat a part entiere, jamais confondu avec la publication.
assert.equal(dockerProvenanceState({ provenance_status: 'SUCCESS' }), 'Enregistrée');
assert.equal(dockerProvenanceState({ provenance_status: 'FAILED' }), 'Échec');
assert.equal(dockerProvenanceState({ provenance_status: 'NOT_ATTEMPTED' }), 'Non tentée');
assert.equal(dockerProvenanceState({}), 'Non disponible');
// Le cas reel qui compte : pousse pour de vrai, provenance refusee.
assert.equal(pushState({ push_status: 'SUCCESS', provenance_status: 'FAILED' }), 'Poussée');
assert.equal(dockerProvenanceState({ push_status: 'SUCCESS', provenance_status: 'FAILED' }), 'Échec');

// Aucun de ces etats ne doit jamais s'enoncer « deploye ».
for (const fn of [pushState, dockerProvenanceState]) {
  for (const s of ['SUCCESS', 'FAILED', 'NOT_ATTEMPTED', 'NOT_CONFIGURED']) {
    const out = String(fn({ push_status: s, provenance_status: s }));
    assert.ok(!/déploy|deploy/i.test(out), `« ${out} » ne doit pas evoquer un deploiement`);
  }
}
// La vue affiche les deux lignes, et la reference publiee seulement si elle existe.
assert.ok(detailHtml.includes('Provenance enregistrée'), 'la vue doit afficher l etat de provenance');
assert.ok(/\*ngIf="dockerPublishedReference\(\)"/.test(detailHtml),
  'la reference publiee ne s affiche que si le registre l a confirmee');
assert.ok(/published_reference/.test(detailTs),
  'la reference publiee est lue du bloc docker, jamais reconstruite');

console.log('R50 publication / provenance / deployment stay distinct: PASS');

// ── R51 — l'etat PENDING que le pipeline peut desormais emettre ──
// L'enregistrement de provenance a lieu apres l'envoi du rapport, donc le
// rapport porte PENDING : ni succes, ni echec, et surtout pas « Non disponible ».
assert.equal(dockerProvenanceState({ provenance_status: 'PENDING' }), 'En attente d’ingestion');
for (const other of ['SUCCESS', 'FAILED', 'NOT_ATTEMPTED', 'UNKNOWN']) {
  assert.notEqual(dockerProvenanceState({ provenance_status: 'PENDING' }),
    dockerProvenanceState({ provenance_status: other }),
    `PENDING doit rester distinct de ${other}`);
}
// Le contrat final doit pouvoir representer les quatre faits demandes.
assert.ok(detailHtml.includes('Publication'), 'contrat — statut de publication representable');
assert.ok(detailHtml.includes('Référence publiée'), 'contrat — reference publiee representable');
assert.ok(detailHtml.includes('Provenance enregistrée'), 'contrat — provenance representable');
assert.ok(/dockerDigest\(\)/.test(detailHtml) && /artifact\?\.digest/.test(detailTs),
  'contrat — digest lu de l artefact resolu par le backend, pas du pipeline');
// Et chaque absence reste vraie.
assert.equal(dockerProvenanceState({}), 'Non disponible');
assert.ok(detailHtml.includes('Provenance non vérifiée') && detailHtml.includes('Non disponible'),
  'contrat — les champs manquants restent truthful');

console.log('R51 provenance PENDING + final contract: PASS');
