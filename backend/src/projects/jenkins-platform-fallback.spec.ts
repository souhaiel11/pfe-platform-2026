import * as assert from 'node:assert/strict';
import { resolveJenkinsInternalUrl, resolveJenkinsPublicUrl } from '../common/jenkins-url';

/**
 * R48 — repli plateforme pour l'adresse interne Jenkins, et Sonar security_hotspots.
 *
 * Constate en audit : Jenkins detenait de vrais builds pour six projets sur
 * sept, que la plateforme rapportait indisponibles. Deux causes de
 * configuration, aucune propre a un projet :
 *
 *   - app-test-pfe-vermeg / devsecops-remediation-testbed : jenkinsInternalUrl
 *     = http://jenkins:8080 (joignable, HTTP 403 => auth requise) mais aucun
 *     jeton ;
 *   - devsecops-testbed / vuln-testapp : jenkinsUrl = une IP d'hote devenue
 *     obsolete (delai d'attente depasse depuis le backend), jeton present.
 *
 * L'adresse interne de Jenkins est une propriete de la PLATEFORME : tous les
 * projets parlent au meme serveur. Le repli la rend disponible sans toucher a
 * la configuration par projet, qui reste prioritaire.
 *
 *   npx ts-node src/projects/jenkins-platform-fallback.spec.ts
 */
const PLATFORM = 'http://jenkins:8080';

(async () => {
  const saved = process.env.JENKINS_INTERNAL_URL;

  // ── 1. Sans repli configure : comportement d'origine, inchange ──
  delete process.env.JENKINS_INTERNAL_URL;
  assert.equal(resolveJenkinsInternalUrl({}), null,
    'sans configuration ni repli, aucune URL inventee');
  assert.equal(resolveJenkinsInternalUrl({ jenkinsInternalUrl: 'http://a:8080/' }), 'http://a:8080',
    "l'URL du projet est normalisee (slash final retire)");

  // ── 2. Repli plateforme : utilise SEULEMENT en l'absence de configuration ──
  process.env.JENKINS_INTERNAL_URL = `${PLATFORM}/`;
  assert.equal(resolveJenkinsInternalUrl({}), PLATFORM,
    'le repli doit servir quand le projet ne porte rien');
  assert.equal(resolveJenkinsInternalUrl({ jenkinsInternalUrl: null, jenkinsUrl: '' }), PLATFORM,
    'des champs vides equivalent a une absence');

  // ── 3. PRIORITE : la configuration du projet gagne toujours ──
  assert.equal(
    resolveJenkinsInternalUrl({ jenkinsInternalUrl: 'http://propre:9000' }), 'http://propre:9000',
    'jenkinsInternalUrl du projet reste prioritaire sur le repli');
  assert.equal(
    resolveJenkinsInternalUrl({ jenkinsUrl: 'http://legacy:8082' }), 'http://legacy:8082',
    'jenkinsUrl legacy reste prioritaire sur le repli');
  assert.equal(
    resolveJenkinsInternalUrl({ jenkinsInternalUrl: 'http://x:1', jenkinsUrl: 'http://y:2' }), 'http://x:1',
    "l'ordre interne > legacy est preserve");

  // ── 4. L'URL PUBLIQUE n'herite PAS du repli ──
  // Une adresse de service Docker n'est pas resoluble depuis un navigateur :
  // la proposer comme lien serait un lien mort.
  assert.equal(resolveJenkinsPublicUrl({}), null,
    "l'URL publique ne doit jamais tomber sur l'adresse interne");
  assert.equal(resolveJenkinsPublicUrl({ jenkinsPublicUrl: 'http://pub:8082' }), 'http://pub:8082');

  // ── 5. Le repli ne rend JAMAIS un projet « configure » ──
  // getJenkinsStatus() exige toujours un jenkinsJobName : un projet sans job
  // Jenkins reste NON CONFIGURE, meme avec le repli actif.
  const fs = await import('node:fs');
  const service = fs.readFileSync(__dirname + '/projects.service.ts', 'utf8');
  assert.ok(service.includes("if (!jenkinsInternalUrl || !project.jenkinsJobName) {"),
    'la garde NON CONFIGURE doit continuer d\'exiger un jenkinsJobName');
  assert.ok(service.includes("'Jenkins non configuré pour ce projet'"),
    "l'etat NON CONFIGURE doit rester distinct d'une indisponibilite");

  // ── 6. Identifiant Jenkins : meme forme de repli que resolveSonarToken ──
  assert.ok(service.includes('private resolveJenkinsCredential(project: Project): string | null {'),
    'un resolveur generique d\'identifiant doit exister');
  assert.ok(service.includes("const platform = String(process.env.JENKINS_TOKEN || '').trim();"),
    'le repli doit venir de la configuration d\'execution, jamais du code');
  assert.ok(/const own = String\(project\.jenkinsToken \|\| ''\)\.trim\(\);\s*\n\s*if \(own\) return own;/.test(service),
    'le jeton du projet doit rester prioritaire');
  assert.ok(service.includes('const jenkinsCredential = this.resolveJenkinsCredential(project);'),
    'getJenkinsStatus doit passer par le resolveur');

  // ── 7. Sonar : security_hotspots importe de bout en bout ──
  assert.ok(service.includes('ncloc,security_hotspots'),
    'security_hotspots doit etre demande a SonarQube');
  assert.ok(service.includes('securityHotspots: num(measures.security_hotspots)'),
    'il doit etre mappe sans substitution de zero');
  assert.ok(service.includes('linesOfCode: null, securityHotspots: null,'),
    "la forme « indisponible » doit porter le champ, pour que l'absence reste explicite");

  // ── 8. Aucune identite de projet dans le resolveur ──
  const urlModule = fs.readFileSync(__dirname + '/../common/jenkins-url.ts', 'utf8');
  const body = urlModule.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  for (const needle of ['pfe-app-test', 'app-test-pfe-vermeg', 'vuln-testapp', 'devsecops-testbed', '172.']) {
    assert.ok(!body.includes(needle), `jenkins-url.ts ne doit pas contenir ${needle}`);
  }
  // Le nom de service lui-meme ne doit pas etre code en dur : il vient de l'env.
  assert.ok(!body.includes('jenkins:8080'),
    "l'adresse de la plateforme doit venir de l'environnement, pas du code");

  if (saved === undefined) delete process.env.JENKINS_INTERNAL_URL;
  else process.env.JENKINS_INTERNAL_URL = saved;

  console.log('R48 jenkins platform fallback + sonar hotspots: PASS');
})().catch(e => { console.error(e); process.exit(1); });
