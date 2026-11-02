// Teste la politique de robustesse des mots de passe.
import * as assert from 'node:assert/strict';
import { passwordPolicyViolations } from './password-policy';

for (const weak of ['Admin@123', 'Dev@123', 'password123', 'Court1!', 'toutenminuscule1!', 'TOUTENMAJUSCULE1!', 'SansChiffre!!!!', 'SansSpecial1234'])
  assert.ok(passwordPolicyViolations(weak).length > 0, weak);
assert.ok(passwordPolicyViolations('Souhaiel-2026!xyz', 'souhaiel.amri@esprit.tn').length === 0, 'local part "souhaiel.amri" is not contained');
assert.ok(passwordPolicyViolations('MonAdmin-2026!xyz', 'admin@devsecops.local').includes('ne pas contenir l’identifiant du compte'));
assert.deepEqual(passwordPolicyViolations('Vx7#pL2q!Rm9wZ'), []);
assert.ok(passwordPolicyViolations(undefined).length > 0);
console.log('password-policy: OK');
