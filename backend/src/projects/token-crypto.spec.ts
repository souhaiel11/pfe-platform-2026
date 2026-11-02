// Teste le chiffrement au repos des secrets de projet.
import * as assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { encryptToken, decryptToken, isEncryptedToken } from './token-crypto';

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const secret = 'souhaiel11:11aa22bb33cc44dd';
const stored = encryptToken(secret)!;
assert.ok(isEncryptedToken(stored));
assert.ok(!stored.includes('11aa22bb'), 'le secret n’apparaît jamais en clair dans la valeur stockée');
assert.notEqual(encryptToken(secret), stored, 'IV aléatoire : deux chiffrements diffèrent');
assert.equal(decryptToken(stored), secret);
assert.equal(encryptToken(stored), stored, 'idempotent : une valeur déjà chiffrée n’est pas rechiffrée');
assert.equal(decryptToken('squ_historique_en_clair'), 'squ_historique_en_clair', 'valeur historique lisible pendant la migration');
for (const empty of [null, undefined, '']) { assert.equal(encryptToken(empty as any), empty); assert.equal(decryptToken(empty as any), empty); }

// Donnée altérée ou mauvaise clé : jamais de secret renvoyé, jamais d'exception.
const parts = stored.split(':'); parts[4] = Buffer.from('autre').toString('base64');
assert.equal(decryptToken(parts.join(':')), null);
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
assert.equal(decryptToken(stored), null);

// Sans clé : écriture refusée (pas de repli silencieux en clair), lecture chiffrée impossible.
delete process.env.TOKEN_ENCRYPTION_KEY;
assert.throws(() => encryptToken('x'), /TOKEN_ENCRYPTION_KEY/);
assert.equal(decryptToken(stored), null);
console.log('token-crypto: OK');
