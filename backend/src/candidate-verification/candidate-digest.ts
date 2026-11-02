// Fonctions pures de calcul d'empreintes (hash) pour les candidats de remédiation.
import { createHash } from 'crypto';
import { CandidateFile, CandidateManifest } from './candidate-verification.types';

// Calcule le hash SHA-256 du contenu texte d'un fichier, utilisé comme empreinte de son contenu.
export function computeContentSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// Vérifie que la valeur est bien un SHA git complet (40 caractères hexadécimaux).
export function isFullGitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

// Calcule le SHA-1 "blob git" d'un contenu, exactement comme `git hash-object`, pour
// comparer un contenu candidat au blob SHA connu côté GitHub sans appeler git.
export function computeGitBlobSha1(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex');
}

// Calcule l'empreinte globale d'un manifeste candidat (SHA de base + fichiers triés +
// opération + hash de contenu), pour comparer deux manifestes sans relire tout le contenu.
export function computeCandidateDigest(manifest: Pick<CandidateManifest, 'candidateBaseSha' | 'files'>): string {
  const canonicalFiles = manifest.files
    .map((file: CandidateFile) => ({ path: file.path, operation: file.operation, contentSha256: file.contentSha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const canonical = { candidateBaseSha: manifest.candidateBaseSha.toLowerCase(), files: canonicalFiles };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
