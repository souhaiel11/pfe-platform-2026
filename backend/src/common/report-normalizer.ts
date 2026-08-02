// Adaptateur unique de lecture des reports — normalise TOUT format de
// rawData (v2.1 déjà structuré, legacy security.vulnerabilities[], ou vide)
// vers une forme v2.1 stable. Fonction pure : pas d'accès DB, pas d'écriture.
// Tous les consommateurs (dashboard, indicateurs de risque, détail projet)
// doivent passer par normalizeReport() plutôt que lire rawData.enrichedData
// directement, pour qu'un projet dans n'importe quel format s'affiche sans
// intervention manuelle.

export interface Cve {
  id: string;
  pkg: string;
  cvss: number | null;
  title: string;
  source: string;
  severity: string;
  primaryUrl: string | null;
  fixedVersion: string | null;
  installedVersion: string | null;
}

export interface ScannerBlock {
  critical: number;
  high: number;
  cves_count: number;
  cves: Cve[];
}

export interface SonarIssue {
  line: number;
  type: string;
  message: string;
  severity: string;
  component: string;
}

export interface SonarBlock {
  bugs: number;
  vulnerabilities: number;
  code_smells: number;
  coverage: number;
  quality_gate: string;
  issues: SonarIssue[];
}

export interface ZapBlock {
  alerts_high: number;
  alerts_count: number;
  alerts_medium: number;
}

export interface EnrichedData {
  trivy: ScannerBlock;
  owasp: ScannerBlock;
  sonar: SonarBlock;
  zap: ZapBlock;
  note?: string;
  _sourceFormat: 'v2.1' | 'legacy' | 'empty';
}

function emptyScannerBlock(): ScannerBlock {
  return { critical: 0, high: 0, cves_count: 0, cves: [] };
}

function emptySonarBlock(): SonarBlock {
  return { bugs: 0, vulnerabilities: 0, code_smells: 0, coverage: 0, quality_gate: 'ERROR', issues: [] };
}

function emptyZapBlock(): ZapBlock {
  return { alerts_high: 0, alerts_count: 0, alerts_medium: 0 };
}

function countBySeverity(cves: Cve[], severity: string): number {
  return cves.filter(c => c.severity === severity).length;
}

// "commons-collections-3.2.1.jar" → "3.2.1" ; pas de version détectable → null.
function versionFromComponent(component: string | undefined): string | null {
  if (!component) return null;
  const m = component.match(/(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/);
  return m ? m[1] : null;
}

// "TaskController.java:48" → 48 ; pas de ligne détectable → 0.
function lineFromComponent(component: string | undefined): number {
  if (!component) return 0;
  const m = component.match(/:(\d+)\b/);
  return m ? parseInt(m[1], 10) : 0;
}

function primaryUrlFor(ref: string | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('CVE-')) return `https://nvd.nist.gov/vuln/detail/${ref}`;
  if (ref.startsWith('GHSA-')) return `https://github.com/advisories/${ref}`;
  return null;
}

// n8n ("Merge All Fetched Data") écrit parfois coverage comme string
// (fallback `sonarRaw.coverage || '0'`) — coercition ici, un seul endroit,
// pour que tout consommateur (score, indicateur de risque) reçoive un number.
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
}

function normalizeV21(enrichedData: any): EnrichedData {
  const sonar: SonarBlock = { ...emptySonarBlock(), ...enrichedData.sonar };
  sonar.coverage = toNumber(sonar.coverage, 0);

  return {
    trivy: { ...emptyScannerBlock(), ...enrichedData.trivy },
    owasp: { ...emptyScannerBlock(), ...enrichedData.owasp },
    sonar,
    zap: { ...emptyZapBlock(), ...enrichedData.zap },
    note: enrichedData.note,
    _sourceFormat: 'v2.1',
  };
}

function normalizeLegacy(security: any): EnrichedData {
  const vulnerabilities: any[] = Array.isArray(security.vulnerabilities) ? security.vulnerabilities : [];

  const trivyCves: Cve[] = [];
  const owaspCves: Cve[] = [];
  const sonarIssues: SonarIssue[] = [];

  for (const v of vulnerabilities) {
    const ref = v.ref;
    const severity = (v.severity || '').toUpperCase();
    const source = (v.source || '').toUpperCase();
    const title = v.impact || v.fixHint || '';

    if (source === 'SONARQUBE') {
      sonarIssues.push({
        line: lineFromComponent(v.component),
        type: 'VULNERABILITY',
        message: title,
        severity,
        component: v.component,
      });
      continue;
    }

    const cve: Cve = {
      id: ref,
      pkg: v.component,
      cvss: null,
      title,
      source,
      severity,
      primaryUrl: primaryUrlFor(ref),
      fixedVersion: null, // jamais présent dans le legacy — ne pas inventer
      installedVersion: versionFromComponent(v.component),
    };

    if (source === 'TRIVY') {
      trivyCves.push(cve);
    } else if (source === 'OWASP') {
      owaspCves.push(cve);
    } else {
      console.warn(`[report-normalizer] source de vulnérabilité inconnue: "${v.source}" — routée vers trivy.cves par défaut`);
      trivyCves.push(cve);
    }
  }

  const trivy: ScannerBlock = {
    critical: countBySeverity(trivyCves, 'CRITICAL'),
    high: countBySeverity(trivyCves, 'HIGH'),
    cves_count: trivyCves.length,
    cves: trivyCves,
  };
  const owasp: ScannerBlock = {
    critical: countBySeverity(owaspCves, 'CRITICAL'),
    high: countBySeverity(owaspCves, 'HIGH'),
    cves_count: owaspCves.length,
    cves: owaspCves,
  };

  // Champs non couverts par le schéma legacy documenté (pas de bugs/code_smells/
  // coverage/quality_gate/zap dans security.*) : on lit security.* si un jour
  // présent, sinon défaut neutre documenté — jamais une valeur inventée.
  const sonar: SonarBlock = {
    bugs: typeof security.sonarBugs === 'number' ? security.sonarBugs : 0,
    vulnerabilities: sonarIssues.length,
    code_smells: typeof security.codeSmells === 'number' ? security.codeSmells : 0,
    coverage: toNumber(security.coverage, 0),
    quality_gate: security.qualityGate || 'ERROR',
    issues: sonarIssues,
  };

  const z = security.zap || {};
  const zap: ZapBlock = {
    alerts_high: z.alerts_high || 0,
    alerts_count: z.alerts_count || 0,
    alerts_medium: z.alerts_medium || 0,
  };

  return {
    trivy,
    owasp,
    sonar,
    zap,
    note: 'Normalisé à la lecture depuis un rapport legacy. Compteurs dérivés des N findings persistés. Les résumés textuels IA non structurés ne sont pas comptabilisés.',
    _sourceFormat: 'legacy',
  };
}

function normalizeEmpty(): EnrichedData {
  return {
    trivy: emptyScannerBlock(),
    owasp: emptyScannerBlock(),
    sonar: emptySonarBlock(),
    zap: emptyZapBlock(),
    note: "Aucune donnée d'analyse dans ce rapport",
    _sourceFormat: 'empty',
  };
}

export function normalizeReport(rawData: any): EnrichedData {
  if (rawData?.enrichedData) {
    return normalizeV21(rawData.enrichedData);
  }
  if (Array.isArray(rawData?.security?.vulnerabilities)) {
    return normalizeLegacy(rawData.security);
  }
  return normalizeEmpty();
}
