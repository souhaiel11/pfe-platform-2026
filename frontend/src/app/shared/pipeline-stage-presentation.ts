// Presentation only. Jenkins deploy prepares the DAST target; Azure final
// deployment is rendered separately after readiness gates, not invented here.
export const PIPELINE_STAGE_ORDER: Record<string, number> = {
  build: 20, tests: 30, sonar: 40, owasp: 50, container: 60,
  trivy: 70, security: 75, deploy: 80, zap: 90,
};
const ALIASES: Record<string, string> = { jenkins_build: 'build', compile: 'build', test: 'tests', sonarqube: 'sonar', docker: 'container', image: 'container' };
const LABELS: Record<string, string> = { build: 'Build', tests: 'Tests', sonar: 'Analyse qualité — SonarQube', owasp: 'Analyse des dépendances — OWASP Dependency-Check', container: 'Construction de l’image — Docker', trivy: 'Analyse de l’image — Trivy', security: 'Validation de sécurité', deploy: 'Déploiement de la cible de validation', zap: 'Tests dynamiques de sécurité — OWASP ZAP' };
export function canonicalStage(value: unknown): string {
  const key = String(value || '').trim().toLowerCase();
  return ALIASES[key] || key;
}
export function pipelineStageLabel(value: unknown): string { return LABELS[canonicalStage(value)] || 'Autre étape'; }
const warned = new Set<string>();
export function sortPipelineStages<T extends { stage?: string; key?: string }>(stages: readonly T[]): T[] {
  const key = (s: T) => canonicalStage(s.stage || s.key);
  for (const s of stages) if (!(key(s) in PIPELINE_STAGE_ORDER) && !warned.has(key(s))) {
    warned.add(key(s)); console.warn('[pipeline presentation] Unknown stage:', key(s));
  }
  return [...stages].sort((a, b) => (PIPELINE_STAGE_ORDER[key(a)] ?? 1000) - (PIPELINE_STAGE_ORDER[key(b)] ?? 1000) || key(a).localeCompare(key(b)));
}
