// Score de sécurité d'un report — figé, 100% dérivé des findings scanner de
// CE scan (Trivy/OWASP/Sonar/ZAP), jamais de openIncidents/buildFailed (qui
// changent en continu et rendraient une valeur stockée périmée). Plafonné
// par catégorie de sévérité pour rester discriminant à fort volume de CVE.
import { EnrichedData } from './report-normalizer';

export function calculateSecurityScore(normalized: EnrichedData): number {
  const { trivy, owasp, sonar, zap } = normalized;

  const critical = (trivy.critical || 0) + (owasp.critical || 0);
  const high     = (trivy.high || 0) + (owasp.high || 0);
  const medium   = trivy.cves.filter(c => c.severity === 'MEDIUM').length
                 + owasp.cves.filter(c => c.severity === 'MEDIUM').length;

  const cveCriticalPenalty = Math.min(critical * 2, 40);
  const cveHighPenalty     = Math.min(high * 1, 20);
  const cveMediumPenalty   = Math.min(medium * 0.5, 10);

  const zapPenalty = Math.min((zap.alerts_high || 0) * 3 + (zap.alerts_medium || 0) * 1, 10);

  const sonarRaw = (sonar.vulnerabilities || 0) * 5
                 + (sonar.bugs || 0) * 2
                 + Math.min(sonar.code_smells || 0, 10) * 0.5
                 + (sonar.quality_gate === 'ERROR' || sonar.quality_gate === 'FAILED' ? 10 : 0);
  const sonarPenalty = Math.min(sonarRaw, 20);

  const totalPenalty = cveCriticalPenalty + cveHighPenalty + cveMediumPenalty + zapPenalty + sonarPenalty;
  return Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
}

export function getRiskLevel(score: number): string {
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'HIGH';
  return 'CRITICAL';
}
