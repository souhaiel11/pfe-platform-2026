// Score de sécurité d'un report.
import { EnrichedData } from './report-normalizer';

export interface SecurityScoreResult {
  score: number;
  incomplete: boolean;
  missingScanners: string[];
}

/** Indique si un scanner est considéré complet (absence de `status` = donnée historique fiable, présence différente de 'COMPLETED' = n'a pas tourné). */
function isScannerComplete(status?: string): boolean {
  return !status || status === 'COMPLETED';
}

/** Calcule le score de sécurité d'un report à partir des findings normalisés, en excluant du calcul tout scanner qui n'a pas tourné (jamais pénalisé ni compté comme "0 trouvé"). */
export function calculateSecurityScore(normalized: EnrichedData): SecurityScoreResult {
  const { trivy, owasp, sonar, zap } = normalized;

  if (normalized._sourceFormat === 'empty') {
    return { score: 0, incomplete: true, missingScanners: ['trivy', 'owasp', 'zap', 'sonar'] };
  }

  const trivyOk = isScannerComplete(trivy.status);
  const owaspOk = isScannerComplete(owasp.status);
  const zapOk = isScannerComplete(zap.status);
  const sonarOk = isScannerComplete(sonar.status);

  const missingScanners: string[] = [];
  if (!trivyOk) missingScanners.push('trivy');
  if (!owaspOk) missingScanners.push('owasp');
  if (!zapOk) missingScanners.push('zap');
  if (!sonarOk) missingScanners.push('sonar');

  const critical = (trivyOk ? trivy.critical || 0 : 0) + (owaspOk ? owasp.critical || 0 : 0);
  const high     = (trivyOk ? trivy.high || 0 : 0)     + (owaspOk ? owasp.high || 0 : 0);
  const medium   = (trivyOk ? trivy.cves.filter(c => c.severity === 'MEDIUM').length : 0)
                 + (owaspOk ? owasp.cves.filter(c => c.severity === 'MEDIUM').length : 0);

  const cveCriticalPenalty = Math.min(critical * 2, 40);
  const cveHighPenalty     = Math.min(high * 1, 20);
  const cveMediumPenalty   = Math.min(medium * 0.5, 10);

  const zapPenalty = zapOk
    ? Math.min((zap.alerts_high || 0) * 3 + (zap.alerts_medium || 0) * 1, 10)
    : 0;

  const sonarRaw = sonarOk
    ? (sonar.vulnerabilities || 0) * 5
      + (sonar.bugs || 0) * 2
      + Math.min(sonar.code_smells || 0, 10) * 0.5
      + (sonar.quality_gate === 'ERROR' || sonar.quality_gate === 'FAILED' ? 10 : 0)
    : 0;
  const sonarPenalty = Math.min(sonarRaw, 20);

  const totalPenalty = cveCriticalPenalty + cveHighPenalty + cveMediumPenalty + zapPenalty + sonarPenalty;
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  return { score, incomplete: missingScanners.length > 0, missingScanners };
}

/** Convertit un score (et son éventuelle incomplétude) en niveau de risque (LOW/MEDIUM/HIGH/CRITICAL/INDETERMINE). */
export function getRiskLevel(score: number, incomplete = false): string {
  if (incomplete) return 'INDETERMINE';
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'HIGH';
  return 'CRITICAL';
}
