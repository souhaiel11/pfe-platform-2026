// Teste la garde SSRF du webhook Jenkins (trustedJenkinsConsoleUrl).
import * as assert from 'node:assert/strict';
import { trustedJenkinsConsoleUrl } from './trusted-jenkins-url';

const project = { jenkinsInternalUrl: 'http://jenkins:8080', jenkinsPublicUrl: 'http://localhost:8082' };

// URL publique du projet : lue via l'URL interne.
assert.equal(trustedJenkinsConsoleUrl('http://localhost:8082/job/pfe-app-test/163/', project),
  'http://jenkins:8080/job/pfe-app-test/163/consoleText');
// URL interne et job multibranche.
assert.equal(trustedJenkinsConsoleUrl('http://jenkins:8080/job/projet-validation-vermeg/job/main/13/', project),
  'http://jenkins:8080/job/projet-validation-vermeg/job/main/13/consoleText');
// Hôte étranger, métadonnées cloud, service interne : refusés.
for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://evil.example/job/x/1/', 'http://backend:3001/job/x/1/',
  'http://localhost:3001/job/x/1/', 'file:///etc/passwd'])
  assert.equal(trustedJenkinsConsoleUrl(url, project), null, url);
// Bonne origine mais chemin qui n'est pas un build, identifiants ou paramètres embarqués : refusés.
for (const url of ['http://localhost:8082/script', 'http://localhost:8082/job/x/1/../../script', 'http://u:p@localhost:8082/job/x/1/',
  'http://localhost:8082/job/x/1/?a=b', 'http://localhost:8082/job/x/lastBuild/'])
  assert.equal(trustedJenkinsConsoleUrl(url, project), null, url);
// Sans projet ni Jenkins configuré : jamais de requête.
assert.equal(trustedJenkinsConsoleUrl('http://localhost:8082/job/x/1/', null), null);
assert.equal(trustedJenkinsConsoleUrl('http://localhost:8082/job/x/1/', {}), null);
console.log('trusted-jenkins-url: OK');
