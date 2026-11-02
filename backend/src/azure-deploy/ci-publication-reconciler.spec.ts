// Teste la reconstitution du reçu de poussée depuis le log console Jenkins.
import * as assert from 'node:assert/strict';
import { extractPushedManifestDigest, pendingPublicationOf } from './ci-publication-reconciler';

const digest = 'sha256:' + 'b'.repeat(64);
const log = [
  '+ docker push acrpfedevsecops.azurecr.io/projet-validation-vermeg:15-97d5b240f60d',
  '1f37df016c8b: Pushed',
  `15-97d5b240f60d: digest: ${digest} size: 856`,
  'Image published: acrpfedevsecops.azurecr.io/projet-validation-vermeg:15-97d5b240f60d',
].join('\n');
assert.equal(extractPushedManifestDigest(log, '15-97d5b240f60d'), digest);
assert.equal(extractPushedManifestDigest(log, '16-aaaaaaaaaaaa'), null, 'autre tag : rien');
assert.equal(extractPushedManifestDigest(log + `\n15-97d5b240f60d: digest: sha256:${'c'.repeat(64)} size: 1`, '15-97d5b240f60d'), null, 'deux digests différents : ambigu, refusé');
assert.equal(extractPushedManifestDigest(log, '15.*'), null, 'tag invalide refusé (pas de motif)');
assert.equal(extractPushedManifestDigest('', '15-97d5b240f60d'), null);

const incident = { buildNumber: 15, metadata: { sourceCommitSha: '97d5b240f60d64dd55e41e98d7a00c867f1b89b2', build_url: 'http://localhost:8082/job/p/job/main/15/',
  enrichedData: { docker: { provenance_status: 'PENDING', push_status: 'SUCCESS', repository: 'projet-validation-vermeg', published_tag: '15-97d5b240f60d' } } } };
assert.deepEqual(pendingPublicationOf(incident), { buildNumber: 15, commitSha: '97d5b240f60d64dd55e41e98d7a00c867f1b89b2', repository: 'projet-validation-vermeg',
  tag: '15-97d5b240f60d', buildUrl: 'http://localhost:8082/job/p/job/main/15/' });
for (const patch of [{ provenance_status: 'REGISTERED' }, { push_status: 'FAILED' }, { published_tag: undefined }])
  assert.equal(pendingPublicationOf({ ...incident, metadata: { ...incident.metadata, enrichedData: { docker: { ...incident.metadata.enrichedData.docker, ...patch } } } }), null, JSON.stringify(patch));
assert.equal(pendingPublicationOf({ ...incident, metadata: { ...incident.metadata, sourceCommitSha: 'abc' } }), null, 'commit source non prouvé');
console.log('ci-publication-reconciler: OK');
