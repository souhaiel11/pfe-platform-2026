// Labels/auth field schemas describe the implemented integration adapters.
// They never declare an integration configured, enabled, available or healthy.
const integrationPresentation: Record<string, any> = {
  prometheus: {name:'Prometheus',icon:'P',color:'#e24b4a',authType:'none',tokenLabel:''},
  kubernetes: {name:'Kubernetes',icon:'K',color:'#38bdf8',authType:'token',tokenLabel:'Jeton d’accès'},
  nexus: {name:'Nexus',icon:'N',color:'#a78bfa',authType:'basic',tokenLabel:''},
};
export function configuredIntegrationTools(rows: any[]): any[] {
  return rows.filter(r => r.toolType !== 'grafana').map(r => ({
    ...r, ...(integrationPresentation[r.toolType] || {name:r.name || r.toolType,icon:'•',color:'var(--text-secondary)',authType:'none',tokenLabel:''}),
    description:'Configuration de la sonde de connexion ; ne modifie pas le pipeline.',
    token:'', password:'', hasToken:!!r.hasToken, hasPassword:!!r.hasPassword,
    expanded:false, testing:false, saving:false,
    editable:!!integrationPresentation[r.toolType],
  }));
}
export function integrationStatusLabel(tool: any): string {
  if (!tool.url) return 'Non configuré';
  if (tool.enabled === false) return 'Configuration marquée inactive';
  if (!tool.lastChecked) return 'Connexion non vérifiée';
  if (tool.status === 'connected') return 'Dernière vérification réussie';
  if (tool.status === 'error') return 'Dernière vérification en échec';
  return 'Connexion non vérifiée';
}
export function enforcementModeLabel(mode: unknown): string {
  return ({SHADOW:'Observation (Shadow)',ENFORCED:'Contrôle appliqué'} as Record<string,string>)[String(mode)] || 'Non disponible';
}
export function editTypeLabel(type: unknown): string {
  return ({DEPENDENCY_VERSION:'Version de dépendance',PROPERTY_VERSION:'Propriété Maven',PARENT_VERSION:'Parent Maven'} as Record<string,string>)[String(type)] || 'Type non reconnu';
}
export function scannerEvidenceLabel(scanner: any): string {
  return Number(scanner.projectsCompleted)>0 ? 'Résultat disponible dans les dernières analyses' : 'Étape déclarée, sans résultat complet';
}
export function repositoryUrl(repo: unknown): string | null {
  const value=String(repo || '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return 'https://github.com/'+value;
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value) ? value : null;
}
