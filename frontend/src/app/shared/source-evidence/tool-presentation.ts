// Présentation visuelle (nom, description, icône) des outils externes dont la plateforme affiche des preuves.

import { EvidenceProvider } from './source-evidence.types';

export interface SourceTool {
  key: string;
  provider: EvidenceProvider | null;
  name: string;
  description: string;
  icon: string;
}

const TOOLS: Record<string, SourceTool> = {
  JENKINS: { key:'JENKINS', provider:'JENKINS', name:'Jenkins', description:'Builds et journaux d’exécution', icon:'jenkins' },
  SONARQUBE: { key:'SONARQUBE', provider:'SONARQUBE', name:'SonarQube', description:'Qualité du code et analyse statique', icon:'sonarqube' },
  TRIVY: { key:'TRIVY', provider:'TRIVY', name:'Trivy', description:'Sécurité des images et composants', icon:'trivy' },
  OWASP: { key:'OWASP', provider:'OWASP', name:'OWASP Dependency-Check', description:'Vulnérabilités des dépendances', icon:'owasp' },
  ZAP: { key:'ZAP', provider:'ZAP', name:'ZAP', description:'Analyse dynamique de l’application', icon:'zap' },
  GITHUB: { key:'GITHUB', provider:'GITHUB', name:'GitHub', description:'Code source et Pull Requests', icon:'github' },
  N8N: { key:'N8N', provider:'N8N', name:'n8n', description:'Exécutions des workflows', icon:'n8n' },
  AZURE: { key:'AZURE', provider:'AZURE', name:'Azure', description:'Ressources cloud et registre d’images', icon:'azure' },
  DOCKER: { key:'DOCKER', provider:'DOCKER', name:'Docker', description:'Images et artefacts de construction', icon:'docker' },
};

// Résout la présentation d'un outil source (nom, description, icône) pour un fournisseur donné ; ACR partage la présentation d'Azure, un fournisseur inconnu reçoit une présentation générique.
export function sourceTool(provider: unknown): SourceTool {
  const key = provider === 'ACR' ? 'AZURE' : String(provider || '');
  return TOOLS[key] || {key:'SOURCE',provider:null,name:'Source',description:'Références du projet',icon:''};
}
