// Modèle de données du guide développeur généré par WF1 (rawData.developerGuide dans les rapports d'analyse).

export interface DevGuideCodeExample {
  before: string;
  after: string;
}

export interface DevGuideIssue {
  id: string;
  source: 'SONARQUBE' | 'TRIVY' | 'OWASP' | 'ZAP' | 'TESTS' | 'BUILD' | string;
  severity: 'BLOCKER' | 'CRITICAL' | 'HIGH' | 'MAJOR' | 'MEDIUM' | string;
  title: string;
  file: string;
  line: number;
  rule: string;
  problem: string;
  whyItMatters: string;
  howToFix: string[];
  codeExample?: DevGuideCodeExample | string;
  verification: string;
  estimatedEffortMinutes: number;
  priority: number;
}

export interface DevGuideFallbackFixOrderItem {
  priority: number;
  category: string;
  title: string;
  detail?: string;
  owner?: string;
  route?: string;
  source?: string;
}

export interface DeveloperGuide {
  incidentId: string;
  summaryForDeveloper: string;
  issues: DevGuideIssue[];
  quickWins: string[];
  fixOrder: (string | DevGuideFallbackFixOrderItem)[];
  totalEstimatedMinutes: number;
  confidence: number;
  parseError?: boolean;
}
