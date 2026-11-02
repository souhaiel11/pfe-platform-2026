// QA-E2E-2026-10-11 — non-régression du défaut D-9, reproduit en direct.
import * as assert from 'node:assert/strict';
import { classifyJenkinsTriggerStatus, isAcceptedJenkinsBuildResponse } from './incidents.service';

// 303 = la demande a été absorbée par un élément de file existant.
assert.deepEqual(classifyJenkinsTriggerStatus(303), { accepted: false, code: 'JENKINS_TRIGGER_ALREADY_QUEUED' });
console.log('D9-1 303 (demande fusionnée par Jenkins) -> JENKINS_TRIGGER_ALREADY_QUEUED: PASS');

// Le cas nominal reste intact.
assert.deepEqual(classifyJenkinsTriggerStatus(201), { accepted: true });
console.log('D9-2 201 reste le seul statut accepté: PASS');

// Un 200 reste "non accepté" : sans Location, rien ne prouve qu'un build a
// été mis en file. On ne l'assimile JAMAIS à un succès pour faire disparaître
// le symptôme — c'est la redirection non suivie qui corrige la cause.
assert.deepEqual(classifyJenkinsTriggerStatus(200), { accepted: false, code: 'JENKINS_TRIGGER_NOT_ACCEPTED' });
console.log('D9-3 200 nu reste non accepté (le correctif agit sur la cause, pas sur le symptôme): PASS');

// Les autres redirections ne sont pas silencieusement assimilées au 303.
for (const s of [301, 302, 307, 308]) {
  assert.deepEqual(classifyJenkinsTriggerStatus(s), { accepted: false, code: 'JENKINS_TRIGGER_NOT_ACCEPTED' }, `statut ${s}`);
}
console.log('D9-4 301/302/307/308 ne sont pas confondus avec le 303 de fusion: PASS');

// Taxonomie préexistante inchangée.
assert.equal(classifyJenkinsTriggerStatus(401).code, 'JENKINS_AUTH_FAILED');
assert.equal(classifyJenkinsTriggerStatus(403).code, 'JENKINS_AUTH_FAILED');
assert.equal(classifyJenkinsTriggerStatus(404).code, 'JENKINS_JOB_NOT_FOUND');
assert.equal(classifyJenkinsTriggerStatus(409).code, 'JENKINS_TRIGGER_CONFLICT');
assert.equal(classifyJenkinsTriggerStatus(503).code, 'JENKINS_UNAVAILABLE');
console.log('D9-5 taxonomie existante (401/403/404/409/503) préservée: PASS');

// Un 303 n'est jamais une réponse de build acceptée, même avec un Location
// valide : aucun NOUVEAU build n'a été créé, et le prétendre fabriquerait un
// queueId que l'appelant croirait sien.
assert.equal(isAcceptedJenkinsBuildResponse(303, 'http://jenkins:8080/queue/item/11065/'), false);
assert.equal(isAcceptedJenkinsBuildResponse(201, 'http://jenkins:8080/queue/item/11062/'), true);
assert.equal(isAcceptedJenkinsBuildResponse(201, null), false);
console.log('D9-6 un 303 ne vaut jamais acceptation (aucun build neuf créé): PASS');

console.log('jenkins-duplicate-trigger.spec: ALL PASS');
