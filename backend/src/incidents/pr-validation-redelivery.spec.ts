// Teste la sélection de la notification Jenkins d'origine pour la récupération d'un callback WF3 perdu.
import * as assert from 'node:assert/strict';
import { findPrValidationDelivery, redeliveryConfig } from './pr-validation-redelivery';

const vrid = 'd56373b602c1792129aa4262dcdcafa66f19db9236024f2c8d9ced7d4e3a28eb';
const exec = (body: any) => ({ data: { resultData: { runData: { 'Incident Webhook': [{ data: { main: [[{ json: { body } }]] } }] } } } });
const good = { event: 'pr_validation', build_number: '1', build_url: 'http://localhost:8082/job/projet-validation-vermeg-multibranch/job/PR-11/1/', ctx: vrid };
const expected = { buildPath: '/job/projet-validation-vermeg-multibranch/job/PR-11', buildNumber: 1, validationRequestId: vrid };

assert.deepEqual(findPrValidationDelivery([exec(good)], expected), good);
// Autre build, autre PR, autre demande, événement non-PR, exécution sans webhook : jamais choisis.
assert.equal(findPrValidationDelivery([exec({ ...good, build_number: '2', build_url: good.build_url.replace('/1/', '/2/') })], expected), null);
assert.equal(findPrValidationDelivery([exec({ ...good, build_url: good.build_url.replace('PR-11', 'PR-1') })], expected), null);
assert.equal(findPrValidationDelivery([exec({ ...good, ctx: 'autre-demande' })], expected), null);
assert.equal(findPrValidationDelivery([exec({ ...good, event: 'build' })], expected), null);
assert.equal(findPrValidationDelivery([{ data: {} }, null as any], expected), null);
// Le bon élément est trouvé parmi d'autres.
assert.deepEqual(findPrValidationDelivery([exec({ ...good, event: 'build' }), exec(good)], expected), good);

assert.equal(redeliveryConfig({}), null, 'non configuré : on garde le refus historique');
assert.ok(redeliveryConfig({ N8N_API_URL: 'http://n8n:5678', N8N_API_KEY: 'k', N8N_URL: 'http://n8n:5678', N8N_JENKINS_EVENT_KEY: 'w', N8N_WF1_ID: 'id' }));
console.log('pr-validation-redelivery: OK');
