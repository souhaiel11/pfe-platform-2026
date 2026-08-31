// Résolveurs canoniques d'URL Jenkins — seule définition, réutilisée
// partout, pour ne jamais dupliquer la logique de repli legacy.
//
// project.jenkinsUrl est DEPRECATED et surchargé historiquement (voir
// project.entity.ts) : jamais utiliser ce champ directement ailleurs que
// dans ces deux résolveurs.

type JenkinsUrlSource = {
  jenkinsInternalUrl?: string | null;
  jenkinsPublicUrl?: string | null;
  jenkinsUrl?: string | null;
};

function normalize(url: string | null | undefined): string | null {
  const trimmed = String(url || '').trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

// URL serveur-à-serveur (backend → Jenkins). Jamais utilisée pour un lien
// navigateur — une URL Docker interne (http://jenkins:8080) n'est pas
// résoluble hors du réseau Docker.
export function resolveJenkinsInternalUrl(project: JenkinsUrlSource): string | null {
  return normalize(project.jenkinsInternalUrl) || normalize(project.jenkinsUrl);
}

// URL affichée/cliquée dans le navigateur. Jamais utilisée pour un appel
// backend.
export function resolveJenkinsPublicUrl(project: JenkinsUrlSource): string | null {
  return normalize(project.jenkinsPublicUrl) || normalize(project.jenkinsUrl);
}

// Validation de saisie pour jenkinsInternalUrl / jenkinsPublicUrl côté
// configuration projet (PUT /projects/:id). http(s) uniquement, pas
// d'identifiants ni de paramètres embarqués dans l'URL — un secret ne doit
// jamais transiter par ce champ texte libre.
export function assertValidJenkinsUrlInput(value: string, fieldLabel: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${fieldLabel} doit être une URL http(s) valide.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${fieldLabel} doit utiliser http ou https.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${fieldLabel} ne doit pas contenir d'identifiants (user:password@).`);
  }
  if (parsed.search) {
    throw new Error(`${fieldLabel} ne doit pas contenir de paramètres.`);
  }
}
