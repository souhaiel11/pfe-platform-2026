// Calcule en direct le risque courant du projet à partir des CVE critiques, du dernier build, des incidents ouverts, du Quality Gate et de la couverture.
export interface RiskRule {
  label: string;
  points: number;
}

export interface RiskInput {
  criticalCves: number;
  buildFailed: boolean;
  openIncidents: number;
  qualityGateError: boolean;
  coverage: number | null;
}

export interface RiskResult {
  risk: number;
  level: string;
  levelClass: string;
  rules: RiskRule[];
}

/** Calcule un score de risque 0-100 par addition de règles plafonnées (CVE critiques, build en échec, incidents ouverts, quality gate, couverture faible). */
export function computeRiskScore(input: RiskInput): RiskResult {
  const rules: RiskRule[] = [];
  let risk = 0;

  if (input.criticalCves > 0) {
    const points = Math.min(input.criticalCves * 2, 40);
    risk += points;
    rules.push({ label: `${input.criticalCves} CVE critique(s)`, points });
  }

  if (input.buildFailed) {
    risk += 25;
    rules.push({ label: 'Dernier build en échec (FAILURE)', points: 25 });
  }

  if (input.openIncidents > 0) {
    const points = Math.min(input.openIncidents * 5, 15);
    risk += points;
    rules.push({ label: `${input.openIncidents} incident(s) ouvert(s)`, points });
  }

  if (input.qualityGateError) {
    risk += 10;
    rules.push({ label: 'Quality Gate SonarQube en ERROR', points: 10 });
  }

  if (typeof input.coverage === 'number' && input.coverage < 50) {
    risk += 10;
    rules.push({ label: `Couverture de tests ${input.coverage}%`, points: 10 });
  }

  risk = Math.min(100, risk);
  const { level, levelClass } = levelFor(risk);

  return { risk, level, levelClass, rules };
}

/** Traduit un score numérique en palier d'affichage (FAIBLE/MODÉRÉ/ÉLEVÉ/CRITIQUE). */
function levelFor(risk: number): { level: string; levelClass: string } {
  if (risk <= 25) return { level: 'FAIBLE', levelClass: 'faible' };
  if (risk <= 50) return { level: 'MODÉRÉ', levelClass: 'modere' };
  if (risk <= 75) return { level: 'ÉLEVÉ', levelClass: 'eleve' };
  return { level: 'CRITIQUE', levelClass: 'critique' };
}
