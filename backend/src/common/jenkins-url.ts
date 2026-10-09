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
// R48 — repli plateforme, symétrique de ProjectsService.resolveSonarToken().
//
// L'adresse interne de Jenkins est une propriété de la PLATEFORME, pas un
// secret propre à un projet : tous les projets parlent au même Jenkins, par
// le même nom de service Docker. Sans ce repli, un projet onboardé sans
// jenkinsInternalUrl — ou dont le jenkinsUrl porte une IP d'hôte devenue
// obsolète — voyait ses builds rapportés indisponibles alors que Jenkins les
// détenait réellement. La donnée était perdue par la plateforme.
//
// L'ordre de priorité ne change pas : la configuration du projet reste
// prioritaire, le repli ne s'applique qu'à son absence. Il ne rend JAMAIS un
// projet « configuré » : getJenkinsStatus() exige toujours un jenkinsJobName,
// donc un projet sans job Jenkins reste NON CONFIGURÉ.
export function resolveJenkinsInternalUrl(project: JenkinsUrlSource): string | null {
  return normalize(project.jenkinsInternalUrl)
    || normalize(project.jenkinsUrl)
    || normalize(process.env.JENKINS_INTERNAL_URL);
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
