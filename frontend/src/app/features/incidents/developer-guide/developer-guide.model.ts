// ─────────────────────────────────────────────────────────────
// Modèle du guide développeur généré par WF1 v5
// (rawData.developerGuide dans les analysis reports)
// ─────────────────────────────────────────────────────────────

export interface DevGuideCodeExample {
  before: string;
  after: string;
}

export interface DevGuideIssue {
  id: string;                       // "SONAR-1", "CVE-2024-1234", "ZAP-1"...
  source: 'SONARQUBE' | 'TRIVY' | 'OWASP' | 'ZAP' | 'TESTS' | 'BUILD' | string;
  severity: 'BLOCKER' | 'CRITICAL' | 'HIGH' | 'MAJOR' | 'MEDIUM' | string;
  title: string;
  file: string;
  line: number;
  rule: string;
  problem: string;                  // le vrai problème, en langage simple
  whyItMatters: string;             // risque concret si non corrigé
  howToFix: string[];               // étapes ordonnées
  codeExample?: DevGuideCodeExample | string;
  verification: string;             // commande pour prouver que le fix marche
  estimatedEffortMinutes: number;
  priority: number;                 // 1 = à corriger en premier
}

// Forme produite par le fallback déterministe (WF1) quand l'agent LLM
// Developer Guidance échoue à parser sa réponse : pas de fiche par issue,
// seulement un plan d'action au niveau catégorie. Distincte de la forme
// "string" (id d'issue) utilisée par fixOrder quand issues[] est peuplé.
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
  quickWins: string[];              // ids des issues < 15 min
  fixOrder: (string | DevGuideFallbackFixOrderItem)[]; // ids (guide détaillé) OU items de plan (fallback déterministe)
  totalEstimatedMinutes: number;
  confidence: number;
  parseError?: boolean;
}
