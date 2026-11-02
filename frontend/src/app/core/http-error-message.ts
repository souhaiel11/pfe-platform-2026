// Traduit les erreurs HTTP brutes renvoyées par le backend en messages lisibles par un humain, affichés dans l'UI.
import { HttpErrorResponse } from '@angular/common/http';

/** Choisit le message le plus utile pour une erreur HTTP donnée : code métier connu, puis code technique affichable, puis message de validation détaillé, puis statut HTTP générique. */
export function userHttpError(error: unknown, fallback = 'Une erreur est survenue. Veuillez réessayer.'): string {
  const status = error instanceof HttpErrorResponse ? error.status : Number((error as any)?.status || 0);
  const backendMessage = error instanceof HttpErrorResponse
    ? error.error?.message
    : (error as any)?.error?.message;
  if (status === 401) return 'Authentification requise. Veuillez vous reconnecter.';

  const backendCode = String(
    (error instanceof HttpErrorResponse ? error.error?.code : (error as any)?.error?.code) || '',
  ).trim();
  const KNOWN_CODES: Record<string, string> = {
    DOCKERFILE_FETCH_TIMEOUT: 'La récupération du Dockerfile a dépassé le délai prévu. Vérifiez la connexion du serveur puis réessayez.',
    DOCKERFILE_GIT_UNREACHABLE: 'La connexion à GitHub ou au service de récupération du Dockerfile a échoué. Réessayez.',
    DOCKERFILE_WORKFLOW_UNAVAILABLE: 'Le service de récupération du Dockerfile est indisponible. Réessayez.',
    DOCKERFILE_NOT_FOUND: 'Dockerfile inaccessible. Vérifiez le dépôt, la branche, le chemin et les droits GitHub.',
    DOCKERFILE_INVALID_RESPONSE: 'Le service de récupération n’a pas renvoyé de Dockerfile exploitable.',
    JENKINSFILE_FETCH_TIMEOUT:
      'La récupération du Jenkinsfile depuis GitHub a dépassé le délai prévu. Vérifiez la connexion Internet du serveur puis réessayez.',
    JENKINSFILE_GIT_UNREACHABLE:
      'La connexion du serveur à GitHub ou au service de récupération a échoué. Vérifiez la connexion puis réessayez.',
    JENKINSFILE_WORKFLOW_UNAVAILABLE:
      'Le service de récupération du Jenkinsfile est indisponible. Réessayez dans quelques instants.',
    JENKINSFILE_INVALID_RESPONSE:
      'Le service de récupération n’a pas renvoyé de Jenkinsfile exploitable. Réessayez.',
    JENKINSFILE_NOT_FOUND:
      'Jenkinsfile inaccessible. Vérifiez le dépôt, la branche, le chemin du fichier et les droits GitHub.',

    REMEDIATION_TARGET_ALREADY_IN_PROGRESS:
      'Une autre correction réserve déjà le même fichier de dépendances pour ce projet. Examinez la correction existante avant d’en lancer une nouvelle. Aucune nouvelle correction n’a été lancée.',
    // Distinct du code ci-dessus : ici AUCUNE correction ne tourne. Une
    // tentative précédente s'est terminée en échec sans pouvoir libérer le
    // fichier, et la tâche propriétaire est repassée à « à traiter » -- donc
    // invisible comme « en cours ». Inviter à « examiner la correction
    // existante » enverrait l'utilisateur chercher quelque chose qui n'existe
    // plus : on indique l'action réellement nécessaire.
    REMEDIATION_TARGET_BLOCKED_BY_FAILED_REMEDIATION:
      'Aucune correction n’est en cours : une tentative précédente a échoué et garde ce fichier de dépendances réservé. Un administrateur doit libérer le fichier avant toute nouvelle correction. Aucune nouvelle correction n’a été lancée.',
    REMEDIATION_TARGET_OWNERSHIP_REQUIRED:
      'Le fichier de dépendances n’est pas réservé par cette tentative. Une vérification de la correction existante est nécessaire avant de continuer.',
    SECURITY_REMEDIATION_TEMPORARILY_DISABLED:
      'La remédiation automatique est gelée sur cet environnement, ou l’autorisation de test exacte est absente. Aucune correction n’a été lancée et rien n’a été modifié.',
    POST_WRITE_RECOVERY_INPUT_INVALID:
      'La demande de reprise est incomplète : certains identifiants techniques requis sont absents ou mal formés.',
  };
  // Verrous de fichier en attente de merge (Sonar, et pom.xml pour WF6) : le message du backend nomme le
  // fichier et la PR qui le tient, et dit quoi faire — plus utile qu'un texte fixe ou qu'un code technique.
  if ((backendCode.startsWith('SONAR_FILE_') || backendCode === 'REMEDIATION_TARGET_PR_PENDING_MERGE' || backendCode === 'REMEDIATION_TARGET_ALREADY_IN_PROGRESS' || backendCode === 'SECURITY_FINDING_ALREADY_FIXED_ON_DEFAULT_BRANCH')
    && typeof backendMessage === 'string' && backendMessage.trim()) return backendMessage;
  if (KNOWN_CODES[backendCode]) return KNOWN_CODES[backendCode];
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(backendCode)) {
    return `Action refusée par la plateforme (code technique : ${backendCode}).`;
  }

  const code = String(backendMessage || (error as any)?.error?.code || '');
  if (code.includes('V1_8_EVIDENCE_STALE')) return 'La correction ne peut pas être lancée car les preuves de validation ne correspondent plus à la version actuelle du projet. Actualisez les données et faites vérifier la correction.';
  if ((status === 409 || status === 403) && typeof backendMessage === 'string' && /^(Déjà en cours|Conflit de propriété|La |Les |Une |Vous |Impossible |Cette )/.test(backendMessage) && !/[A-Z][A-Z0-9]+_[A-Z_]+/.test(backendMessage)) return backendMessage;
  if (status === 403) return 'Vous n’avez pas l’autorisation d’effectuer cette action.';
  if (status === 409) return 'Les données ont changé ou une opération incompatible est déjà enregistrée. Actualisez la page avant de réessayer.';
  if (status === 404) return 'Ressource introuvable.';
  if (status >= 500) return 'Une erreur interne est survenue. Réessayez ou consultez les détails techniques.';
  if (status === 400) {
    const details = Array.isArray(backendMessage)
      ? backendMessage.filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0)
      : [];
    if (details.length === 1) return details[0];
    if (details.length > 1) return `${details.length} informations invalides : ` + details.join(' · ');
    if (typeof backendMessage === 'string' && backendMessage.trim() && !/[A-Z][A-Z0-9]+_[A-Z_]+/.test(backendMessage)) {
      return backendMessage;
    }
    return 'La demande contient des informations invalides. Vérifiez les champs puis réessayez.';
  }
  return fallback;
}
