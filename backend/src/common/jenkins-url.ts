// Résolveurs canoniques d'URL Jenkins (interne et publique) et validation de saisie — seule définition, réutilisée partout pour ne jamais dupliquer la logique de repli.
type JenkinsUrlSource = {
  jenkinsInternalUrl?: string | null;
  jenkinsPublicUrl?: string | null;
  jenkinsUrl?: string | null;
};

/** Nettoie une URL (trim + retire le / final), ou renvoie null si elle est vide. */
function normalize(url: string | null | undefined): string | null {
  const trimmed = String(url || '').trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

/** Résout l'URL Jenkins interne (serveur-à-serveur) d'un projet, avec repli sur la configuration plateforme si le projet n'en a pas. */
export function resolveJenkinsInternalUrl(project: JenkinsUrlSource): string | null {
  return normalize(project.jenkinsInternalUrl)
    || normalize(project.jenkinsUrl)
    || normalize(process.env.JENKINS_INTERNAL_URL);
}

/** Résout l'URL Jenkins publique (cliquable dans le navigateur) d'un projet. */
export function resolveJenkinsPublicUrl(project: JenkinsUrlSource): string | null {
  return normalize(project.jenkinsPublicUrl) || normalize(project.jenkinsUrl);
}

/** Valide qu'une URL Jenkins saisie par l'utilisateur est http(s), sans identifiants ni paramètres embarqués. */
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
