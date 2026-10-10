// Configuration is not connectivity: only a dated diagnostic proves a check.
export function jenkinsSettingsPresentation(project: any) {
  const configured = !!(project?.jenkinsJobName?.trim() && (project?.jenkinsInternalUrl?.trim() || project?.jenkinsUrl?.trim()));
  const diagnostic = project?.validationStatus?.jenkins;
  const checkedAt = typeof diagnostic?.checkedAt === 'string' && Number.isFinite(Date.parse(diagnostic.checkedAt)) ? diagnostic.checkedAt : null;
  return {
    configured,
    configuration: configured ? 'Configuré' : 'Non configuré',
    connection: !configured || !checkedAt ? 'Non vérifiée'
      : diagnostic.valid === true ? 'Connexion réussie lors de la dernière vérification'
      : diagnostic.valid === false ? 'Dernière vérification échouée' : 'Résultat de vérification indisponible',
    checkedAt: configured ? checkedAt : null,
    job: project?.jenkinsJobName || null,
  };
}
