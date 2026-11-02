// Vérifie WF2 offline test garde dans les workflows n8n.
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const { fileURLToPath } = require('node:url');
const originalRead = fs.readFileSync;
/** Lit fichier Sync. */
fs.readFileSync = function(path, ...args) {
  const name = path instanceof URL ? fileURLToPath(path) : String(path);
  if (process.env.WF2_TEST_ARTIFACT && name.endsWith('/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json')) {
    const parsed = JSON.parse(originalRead(process.env.WF2_TEST_ARTIFACT, 'utf8'));
    const encoded = JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]);
    return args[0] === 'utf8' || args[0]?.encoding ? encoded : Buffer.from(encoded);
  }
  return originalRead.call(this, path, ...args);
};
/** Envoie la requête et lit la réponse distante. */
globalThis.fetch = async () => { throw new Error('OFFLINE_TEST_NETWORK_FORBIDDEN'); };
/** Signale une erreur pour forbidden. */
const forbidden = () => { throw new Error('OFFLINE_TEST_NETWORK_FORBIDDEN'); };
require('node:http').request = forbidden;
require('node:http').get = forbidden;
require('node:https').request = forbidden;
require('node:https').get = forbidden;
syncBuiltinESMExports();
