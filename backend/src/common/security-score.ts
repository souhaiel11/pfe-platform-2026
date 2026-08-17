// Score de sécurité d'un report — figé, 100% dérivé des findings scanner de
// CE scan (Trivy/OWASP/Sonar/ZAP), jamais de openIncidents/buildFailed (qui
// changent en continu et rendraient une valeur stockée périmée). Plafonné
// par catégorie de sévérité pour rester discriminant à fort volume de CVE.
import { EnrichedData } from './report-normalizer';

export interface SecurityScoreResult {
  score: number;
  // true si au moins un scanner v2.1 n'a pas tourné (status présent et
  // différent de 'COMPLETED') — jamais déclenché sur un report legacy/vide,
  // dont l'absence de `status` est une donnée de confiance historique, pas
  // une preuve d'échec. Voir isScannerComplete ci-dessous.
  incomplete: boolean;
  missingScanners: string[];
}

// Un scanner sans `status` (legacy, ou report antérieur à cette convention)
// est traité comme fiable — on ne requalifie jamais rétroactivement une
// donnée historique réelle en "incomplète". Seul un `status` explicitement
// présent et différent de 'COMPLETED' (ex. 'UNKNOWN', 'FAILED') marque le
// scanner comme n'ayant pas tourné.
function isScannerComplete(status?: string): boolean {
  return !status || status === 'COMPLETED';
}

export function calculateSecurityScore(normalized: EnrichedData): SecurityScoreResult {
  const { trivy, owasp, sonar, zap } = normalized;

  const trivyOk = isScannerComplete(trivy.status);
  const owaspOk = isScannerComplete(owasp.status);
  const zapOk = isScannerComplete(zap.status);
  const sonarOk = isScannerComplete(sonar.status);

  const missingScanners: string[] = [];
  if (!trivyOk) missingScanners.push('trivy');
  if (!owaspOk) missingScanners.push('owasp');
  if (!zapOk) missingScanners.push('zap');
  if (!sonarOk) missingScanners.push('sonar');

  // Un scanner qui n'a pas tourné est exclu du calcul — ni compté "0 trouvé"
  // (masquerait son absence), ni pénalisé d'une valeur forfaitaire inventée
  // (indéfendable : "pourquoi X points et pas Y ?"). L'absence de preuve
  // n'améliore ni ne dégrade le score brut ; c'est `incomplete` ci-dessous
  // qui porte la conséquence réelle (jamais LOW/healthy, voir getRiskLevel).
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

// incomplete=true → 'INDETERMINE', jamais LOW ni aucun autre palier dérivé
// du score brut : un scanner absent n'a rien trouvé DU TOUT (ni risque, ni
// absence de risque) — forcer HIGH inventerait un risque jamais détecté,
// exactement le péché symétrique du faux LOW qu'on corrige ici.
export function getRiskLevel(score: number, incomplete = false): string {
  if (incomplete) return 'INDETERMINE';
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'HIGH';
  return 'CRITICAL';
}
