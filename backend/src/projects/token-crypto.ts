// Chiffrement au repos des secrets de projet (jenkinsToken, githubToken, sonarqubeToken, slackToken) :
// AES-256-GCM, clé TOKEN_ENCRYPTION_KEY (32 octets en base64), format « enc:v1:<iv>:<tag>:<données> ».
// Le reste du code continue de manipuler la valeur en clair : seul le stockage change.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ValueTransformer } from 'typeorm';

const PREFIX = 'enc:v1:';
let missingKeyWarned = false;

/** Lit la clé de chiffrement (32 octets base64), ou null si elle est absente ou invalide. */
function encryptionKey(): Buffer | null {
  const raw = String(process.env.TOKEN_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

/** Vrai si la valeur est déjà au format chiffré. */
export function isEncryptedToken(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Chiffre une valeur en clair ; refuse d'écrire un secret si la clé est absente (jamais de repli silencieux en clair). */
export function encryptToken(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === '' || isEncryptedToken(value)) return value;
  const key = encryptionKey();
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY absente ou invalide : impossible d’enregistrer un secret de projet.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

/** Déchiffre une valeur stockée ; une valeur historique en clair est rendue telle quelle (migration progressive). */
export function decryptToken(value: string | null | undefined): string | null | undefined {
  if (!isEncryptedToken(value)) return value;
  const key = encryptionKey();
  if (!key) {
    if (!missingKeyWarned) { missingKeyWarned = true; console.error('[token-crypto] TOKEN_ENCRYPTION_KEY absente : secrets de projet illisibles.'); }
    return null;
  }
  try {
    const [ivB64, tagB64, dataB64] = String(value).slice(PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    console.error('[token-crypto] secret de projet indéchiffrable (clé différente ou donnée altérée).');
    return null;
  }
}

/** Transformer TypeORM appliqué aux colonnes de secrets de l'entité Project. */
export const encryptedTokenTransformer: ValueTransformer = { to: encryptToken, from: decryptToken };

/**
 * Jeton GitHub d'un projet, avec repli sur GITHUB_TOKEN (backend/.env) quand le projet n'en a pas : sans jeton, chaque appel
 * à l'API GitHub est anonyme et la limite de 60 requêtes/heure (par connexion) est vite atteinte — « Merge effectué » échoue
 * alors à tort. Le jeton de repli n'est jamais réécrit en base.
 */
export const githubTokenTransformer: ValueTransformer = {
  to: (value: string | null | undefined) => (value && process.env.GITHUB_TOKEN && value === process.env.GITHUB_TOKEN) ? null : encryptToken(value),
  from: (value: string | null | undefined) => decryptToken(value) || process.env.GITHUB_TOKEN || value,
};
