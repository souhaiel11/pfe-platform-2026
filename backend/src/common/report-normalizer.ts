// Adaptateur unique de lecture des reports : normalise tout format de rawData (v2.1 déjà structuré, legacy security.vulnerabilities[], ou vide) vers une forme v2.1 stable.
import { deriveScannerTruth } from './scanner-diagnostics';
import { parseFixedVersions } from '../security-remediation/fixed-version-normalizer';

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
  fixedVersions: string[];
}

export interface ScannerTruthFields {
  status?: string;
  _source?: string;
  executed?: boolean | null;
  completed?: boolean | null;
  resultAvailable?: boolean | null;
  findingCount?: number | null;
  technicalCode?: string | null;
  problemClass?: 'PRODUCT_DEFECT' | 'FIXABLE_CONFIGURATION' | 'TECHNICAL_BLOCKER' | null;
  owner?: string | null;
  evidence?: string[];
  route?: string;
}

export interface ScannerBlock extends ScannerTruthFields {
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

export interface SonarBlock extends ScannerTruthFields {
  bugs: number;
  vulnerabilities: number;
  code_smells: number;
  coverage: number;
  quality_gate: string;
  issues: SonarIssue[];
  analysisSubmitted?: boolean | null;
  qualityGateResolved?: boolean | null;
}

export interface ZapBlock extends ScannerTruthFields {
  alerts_high: number;
  alerts_count: number;
  alerts_medium: number;
}

export interface EnrichedData {
  trivy: ScannerBlock;
  owasp: ScannerBlock;
  sonar: SonarBlock;
  zap: ZapBlock;
  stages?: Record<string, {
    stage: string;
    status: 'PASSED' | 'FAILED' | 'WARNING' | 'RUNNING' | 'NOT_RUN' | 'NOT_REACHED';
    blocking: boolean;
    executed: boolean;
    findings: unknown[];
    findingCount: number | null;
    source: string;
    message?: string;
    completed?: boolean | null;
    resultAvailable?: boolean | null;
    technicalCode?: string | null;
    problemClass?: 'PRODUCT_DEFECT' | 'FIXABLE_CONFIGURATION' | 'TECHNICAL_BLOCKER' | null;
    owner?: string | null;
    evidence?: string[];
    route?: string;
  }>;
  stageModelVersion?: string;
  note?: string;
  _sourceFormat: 'v2.1' | 'legacy' | 'empty';
}

/** Construit un bloc Trivy/OWASP vide par défaut, utilisé quand le rapport brut ne porte pas encore ce scanner. */
function emptyScannerBlock(): ScannerBlock {
  return { critical: 0, high: 0, cves_count: 0, cves: [] };
}

/** Construit un bloc Sonar vide par défaut. */
function emptySonarBlock(): SonarBlock {
  return { bugs: 0, vulnerabilities: 0, code_smells: 0, coverage: 0, quality_gate: 'ERROR', issues: [] };
}

/** Construit un bloc ZAP vide par défaut. */
function emptyZapBlock(): ZapBlock {
  return { alerts_high: 0, alerts_count: 0, alerts_medium: 0 };
}

/** Compte les CVE d'une sévérité donnée dans une liste. */
function countBySeverity(cves: Cve[], severity: string): number {
  return cves.filter(c => c.severity === severity).length;
}

/** Extrait un numéro de version d'un nom de composant (ex. "commons-collections-3.2.1.jar" → "3.2.1"), ou null si non détectable. */
function versionFromComponent(component: string | undefined): string | null {
  if (!component) return null;
  const m = component.match(/(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/);
  return m ? m[1] : null;
}

/** Extrait un numéro de ligne d'un nom de composant (ex. "TaskController.java:48" → 48), ou 0 si non détectable. */
function lineFromComponent(component: string | undefined): number {
  if (!component) return 0;
  const m = component.match(/:(\d+)\b/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Déduit l'URL de référence publique d'une CVE/GHSA à partir de son identifiant, sans appel réseau. */
function primaryUrlFor(ref: string | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('CVE-')) return `https://nvd.nist.gov/vuln/detail/${ref}`;
  if (ref.startsWith('GHSA-')) return `https://github.com/advisories/${ref}`;
  return null;
}

/** Convertit une valeur (number ou string numérique) en nombre, avec une valeur de repli si elle n'est pas convertible. */
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
}

/** Complète la vérité scanner (executed/completed/resultAvailable/findingCount...) d'un bloc qui ne la porte pas encore, sans jamais écraser un champ déjà présent. */
function fillScannerTruth<T extends ScannerTruthFields>(block: T, realFindingCount: number): T {
  const scanStateLike = block.status === 'COMPLETED'
    ? (realFindingCount > 0 ? 'COMPLETED_WITH_FINDINGS' : 'COMPLETED_ZERO_FINDINGS')
    : block.status;
  const truth = deriveScannerTruth(scanStateLike, {
    executed: block.executed,
    completed: block.completed,
    resultAvailable: block.resultAvailable,
    findingCount: block.findingCount !== undefined ? block.findingCount : (block.status === 'COMPLETED' ? realFindingCount : undefined),
    technicalCode: block.technicalCode as any,
    problemClass: block.problemClass,
    owner: block.owner,
    evidence: block.evidence,
    route: block.route as any,
  });
  return {
    ...block,
    executed: block.executed !== undefined ? block.executed : truth.executed,
    completed: block.completed !== undefined ? block.completed : truth.completed,
    resultAvailable: block.resultAvailable !== undefined ? block.resultAvailable : truth.resultAvailable,
    findingCount: block.findingCount !== undefined ? block.findingCount : truth.findingCount,
    technicalCode: block.technicalCode !== undefined ? block.technicalCode : truth.technicalCode,
    problemClass: block.problemClass !== undefined ? block.problemClass : truth.problemClass,
    owner: block.owner !== undefined ? block.owner : truth.owner,
    evidence: block.evidence !== undefined ? block.evidence : truth.evidence,
    route: block.route !== undefined ? block.route : truth.route,
  };
}

/** Applique la même règle de vérité scanner à une entrée `stages.<x>`, en remplaçant un findingCount=0 non fiable par null. */
function fillStageTruth(stage: any): any {
  if (!stage || typeof stage !== 'object') return stage;
  const nonComplete = ['FAILED', 'NOT_RUN', 'NOT_REACHED', 'RUNNING'].includes(stage.status);
  const findingCount = stage.findingCount === undefined
    ? null
    : (nonComplete && stage.findingCount === 0 && stage.resultAvailable !== true ? null : stage.findingCount);
  return { ...stage, findingCount };
}

/** Peuple le champ `fixedVersions` de chaque CVE d'un bloc scanner à partir de son `fixedVersion`, sans toucher aux autres champs. */
function withFixedVersions(block: ScannerBlock): ScannerBlock {
  return { ...block, cves: (block.cves || []).map(c => ({ ...c, fixedVersions: parseFixedVersions(c.fixedVersion) })) };
}

/** Normalise un enrichedData déjà au format v2.1 : complète les blocs manquants, convertit les types et comble la vérité scanner absente. */
function normalizeV21(enrichedData: any): EnrichedData {
  const sonarRaw: SonarBlock = { ...emptySonarBlock(), ...enrichedData.sonar };
  sonarRaw.coverage = toNumber(sonarRaw.coverage, 0);

  const trivyRaw: ScannerBlock = withFixedVersions({ ...emptyScannerBlock(), ...enrichedData.trivy });
  const owaspRaw: ScannerBlock = withFixedVersions({ ...emptyScannerBlock(), ...enrichedData.owasp });
  const zapRaw: ZapBlock = { ...emptyZapBlock(), ...enrichedData.zap };

  let stages = enrichedData.stages;
  if (stages && typeof stages === 'object') {
    stages = Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, fillStageTruth(v)]));
  }

  return {
    trivy: fillScannerTruth(trivyRaw, trivyRaw.cves_count),
    owasp: fillScannerTruth(owaspRaw, owaspRaw.cves_count),
    sonar: fillScannerTruth(sonarRaw, sonarRaw.issues?.length || 0),
    zap: fillScannerTruth(zapRaw, zapRaw.alerts_count),
    stages,
    stageModelVersion: enrichedData.stageModelVersion,
    note: enrichedData.note,
    _sourceFormat: 'v2.1',
  };
}

/** Convertit un ancien rapport `security.vulnerabilities[]` vers la forme v2.1, en répartissant chaque vulnérabilité par scanner d'origine. */
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
      fixedVersion: null,
      fixedVersions: [],
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

/** Construit la forme v2.1 neutre (tout à zéro), utilisée quand le rapport brut ne porte aucune donnée d'analyse. */
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

/** Point d'entrée unique : détecte le format du rawData d'un report (v2.1, legacy ou vide) et le normalise vers la forme v2.1 stable. */
export function normalizeReport(rawData: any): EnrichedData {
  if (rawData?.enrichedData) {
    return normalizeV21(rawData.enrichedData);
  }
  if (Array.isArray(rawData?.security?.vulnerabilities)) {
    return normalizeLegacy(rawData.security);
  }
  return normalizeEmpty();
}
