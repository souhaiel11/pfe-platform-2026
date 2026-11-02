// Teste la francisation des constats de scanners affichés dans l'interface.
import * as assert from 'node:assert/strict';
import { cveTextFr, localizeFindingsFr, recommendationFr, sonarMessageFr } from './fr-findings';
import { CVE_FR } from './cve-fr.data';

// Vulnérabilité connue : résumé rédigé, recommandation « Upgrade to » traduite.
const trivy = { id: 'CVE-2021-44228', source: 'TRIVY', pkg: 'org.apache.logging.log4j:log4j-core', installedVersion: '2.14.1',
  title: 'log4j-core: Remote code execution in Log4j 2.x', description: 'Apache Log4j2 2.0-beta9 through 2.15.0 JNDI features…',
  recommendation: 'Upgrade to 2.15.0, 2.3.1, 2.12.2', severity: 'CRITICAL' };
const fr = localizeFindingsFr(trivy);
assert.equal(fr.title, CVE_FR['CVE-2021-44228'][0]);
assert.match(fr.description, /^Log4j interprète les expressions JNDI/);
assert.equal(fr.recommendation, 'Mettre à jour vers la version 2.15.0, 2.3.1 ou 2.12.2.');
assert.equal(trivy.title, 'log4j-core: Remote code execution in Log4j 2.x', 'la donnée d’origine n’est jamais modifiée');

// Vulnérabilité inconnue : texte français construit à partir des données, jamais l’anglais du scanner.
const unknown = cveTextFr('CVE-2099-0001', { pkg: 'demo:lib', installedVersion: '1.0', fixedVersion: '1.1', severity: 'HIGH' });
assert.equal(unknown.titre, 'Vulnérabilité CVE-2099-0001 dans demo:lib');
assert.match(unknown.description, /demo:lib 1\.0 est concerné par la vulnérabilité CVE-2099-0001, de gravité élevée\. Elle est corrigée à partir de la version 1\.1\./);
assert.equal(recommendationFr('Upgrade to 2.0'), 'Mettre à jour vers la version 2.0.');
assert.equal(recommendationFr('see vendor advisory', '3.4'), 'Mettre à jour vers la version 3.4 ou une version ultérieure.');

// Tâche de correction : le titre et la description du constat sont traduits, l’identifiant reste intact.
const task = { id: '5b0c1b8e-0000-4000-8000-000000000000', ruleOrCve: 'CVE-2019-10086', source: 'OWASP', title: 'CVE-2019-10086',
  findingSnapshot: { ruleOrCve: 'CVE-2019-10086', component: 'commons-beanutils:commons-beanutils', description: 'In Apache Commons Beanutils 1.9.2…' } };
const frTask = localizeFindingsFr(task);
assert.equal(frTask.ruleOrCve, 'CVE-2019-10086');
assert.equal(frTask.title, CVE_FR['CVE-2019-10086'][0]);
assert.equal(frTask.findingSnapshot.description, CVE_FR['CVE-2019-10086'][1]);

// SonarQube : message traduit avec ses paramètres réels ; règle inconnue = formulation française neutre.
assert.equal(sonarMessageFr('java:S1068', 'Remove this unused "HOTE_INTERNE" private field.'),
  'Supprimer le champ privé « HOTE_INTERNE », qui n’est jamais utilisé.');
assert.equal(sonarMessageFr('java:S3776', 'Refactor this method to reduce its Cognitive Complexity from 24 to the 15 allowed.'),
  'Restructurer cette méthode pour ramener sa complexité cognitive de 24 au maximum autorisé de 15.');
assert.match(sonarMessageFr('java:S9999', 'Something'), /^Problème de qualité de code détecté par SonarQube \(règle java:S9999\)/);
const sonar = localizeFindingsFr({ id: 'x', rule: 'java:S2095', message: 'Use try-with-resources or close this "Statement" in a "finally" clause.',
  title: 'Use try-with-resources or close this "Statement" in a "finally" clause.', recommendation: '' });
assert.match(sonar.title, /^Utiliser try-with-resources ou fermer « Statement »/);
assert.equal(sonar.title, sonar.message);

// ZAP : par identifiant de règle ; l’UUID d’une tâche n’est jamais pris pour un identifiant ZAP.
const zap = localizeFindingsFr({ id: '10106', pluginId: '10106', source: 'ZAP', title: 'HTTP Only Site',
  description: '<p>The site is only served under HTTP and not HTTPS.</p>', recommendation: '<p>Configure your web or application server to use SSL (https).</p>' });
assert.equal(zap.title, 'Site servi uniquement en HTTP');
assert.match(zap.recommendation, /HTTPS/);
const zapTask = localizeFindingsFr({ id: '5b0c1b8e-0000-4000-8000-000000000001', source: 'ZAP', ruleOrCve: '10020', title: 'Missing Anti-clickjacking Header' });
assert.equal(zapTask.title, 'En-tête anti-clickjacking absent');
// Ancien constat ZAP dont l'identifiant est le titre anglais : reconnu par son titre officiel.
const legacyZap = localizeFindingsFr({ id: 'u', source: 'ZAP', ruleOrCve: 'Weak Authentication Method', title: 'Weak Authentication Method',
  findingSnapshot: { source: 'ZAP', ruleOrCve: 'Weak Authentication Method', description: '<p>HTTP basic or digest authentication has been used…</p>' } });
assert.equal(legacyZap.title, 'Méthode d’authentification faible');
assert.match(legacyZap.findingSnapshot.description, /^Une authentification HTTP Basic/);
assert.equal(localizeFindingsFr({ source: 'ZAP', title: 'Some New Alert', description: 'x y z' }).title, 'Alerte de sécurité ZAP');

// Message technique d'étape (n8n) traduit.
assert.match(localizeFindingsFr({ stage: 'trivy', status: 'FAILED', message: "This operation expects the node's input data to contain a binary file 'data', but none was found [item 0]" }).message,
  /^Le rapport de ce scanner n’a pas pu être lu/);

// Objets sans rapport avec un constat : inchangés.
const incident = { id: 'i', title: 'projet - Build #2', createdAt: new Date(0), metadata: { note: 'Upgrade to 2.0' } };
assert.deepEqual(localizeFindingsFr(incident), incident);

console.log('fr-findings: tous les scénarios passent');
