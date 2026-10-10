// Presentation labels only. Operational values are supplied by project/API.
export function generalSettingsSummary(project: any, capabilities: any) {
  const remediation = capabilities?.remediation;
  const modes: Record<string,string> = { ENFORCED: 'Contrôle appliqué', SHADOW: 'Mode observation' };
  const edits: Record<string,string> = {
    DEPENDENCY_VERSION: 'Version de dépendance Maven',
    PROPERTY_VERSION: 'Propriété Maven',
    PARENT_VERSION: 'Parent Maven',
  };
  const deployment = project?.azureConfig;
  const provider = deployment?.provider === 'azure-container-instances' ? 'Azure Container Instances' : null;
  const ciConfigured = project?.cicdTool === 'jenkins' && project?.jenkinsJobName && (project?.jenkinsInternalUrl || project?.jenkinsUrl);
  return {
    project: project?.name || 'Non disponible',
    repository: project?.githubRepo || 'Non disponible',
    ci: ciConfigured ? 'Jenkins' : 'Non disponible',
    deployment: provider ? [provider, deployment.targetName].filter(Boolean).join(' · ') : 'Non disponible',
    mode: modes[remediation?.enforcementMode] || 'Non disponible',
    editTypes: Array.isArray(remediation?.supportedEditTypes) ? remediation.supportedEditTypes.map((type: string) => edits[type] || 'Type de correction non reconnu') : [],
  };
}
