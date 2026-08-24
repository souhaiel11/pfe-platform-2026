// Adaptateur unique de lecture des reports — normalise TOUT format de
// rawData (v2.1 déjà structuré, legacy security.vulnerabilities[], ou vide)
// vers une forme v2.1 stable. Fonction pure : pas d'accès DB, pas d'écriture.
// Tous les consommateurs (dashboard, indicateurs de risque, détail projet)
// doivent passer par normalizeReport() plutôt que lire rawData.enrichedData
// directement, pour qu'un projet dans n'importe quel format s'affiche sans
// intervention manuelle.

import { deriveScannerTruth } from './scanner-diagnostics';

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

// Vérité scanner orthogonale au statut de stage — voir scanner-diagnostics.ts.
// Additive et partagée par les 3 blocs scanner (trivy/owasp/zap partagent
// exactement ces champs ; sonar les hérite aussi et ajoute
// analysisSubmitted/qualityGateResolved). Un consommateur existant qui
// ignore ces champs continue de fonctionner sur critical/high/cves_count/
// status/_source inchangés.
export interface ScannerTruthFields {
  // Statut réel du scanner sur CE report — absent (legacy/empty) = donnée de
  // confiance historique ; présent et différent de 'COMPLETED' (ex. 'UNKNOWN')
  // = le scanner n'a pas tourné, voir security-score.ts::isScannerComplete.
  status?: string;
  _source?: string;
  executed?: boolean | null;
  completed?: boolean | null;
  resultAvailable?: boolean | null;
  // Distinct de cves_count/alerts_count (toujours un number, préservés pour
  // compat) : findingCount est le SEUL champ qui peut valoir null pour dire
  // "on ne sait pas" — jamais 0 par défaut sur un scan non complété.
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
  // Sonar seul : soumission de l'analyse vs résolution du quality gate —
  // voir scanner-diagnostics.ts::SonarTruth. completed=false n'implique pas
  // analysisSubmitted=false (build #11 : soumission réussie, corrélation
  // ceTaskId jamais faite).
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
    // number|null : null = scanner non complété, décompte inconnu (jamais 0
    // par défaut) — voir scanner-diagnostics.ts. Historiquement toujours un
    // number ; les consommateurs existants lisent déjà via `?? 0` (voir
    // azure-deploy-readiness.service.ts) donc null reste compatible.
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

// Repli déterministe pour un bloc scanner (trivy/owasp/zap/sonar) qui ne
// porte pas encore executed/completed/resultAvailable/findingCount (report
// écrit par une version de WF1 antérieure à ce fix). N'écrase JAMAIS un
// champ déjà présent sur le bloc — seulement complète les trous. Le
// "scanState" réel (NOT_RUN/MISSING/FAILED/COMPLETED_ZERO_FINDINGS/
// COMPLETED_WITH_FINDINGS) n'est pas conservé au-delà de WF1 : block.status
// après legacyStatus() vaut soit 'COMPLETED' soit exactement le scanState
// brut (NOT_RUN/MISSING/FAILED), ce qui suffit à retrouver la bonne ligne
// de la table de repli.
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

// Même repli pour une entrée `stages.<x>` — findingCount y est déjà toujours
// écrit par WF1 (jamais undefined), donc seule la règle "0 sur un scan non
// complété doit devenir null" s'applique (le bug confirmé par l'audit
// build #11 dans stageFromScan()::`?? 0`, corrigé côté WF1 également).
function fillStageTruth(stage: any): any {
  if (!stage || typeof stage !== 'object') return stage;
  const nonComplete = ['FAILED', 'NOT_RUN', 'NOT_REACHED', 'RUNNING'].includes(stage.status);
  const findingCount = stage.findingCount === undefined
    ? null
    : (nonComplete && stage.findingCount === 0 && stage.resultAvailable !== true ? null : stage.findingCount);
  return { ...stage, findingCount };
}

function normalizeV21(enrichedData: any): EnrichedData {
  const sonarRaw: SonarBlock = { ...emptySonarBlock(), ...enrichedData.sonar };
  sonarRaw.coverage = toNumber(sonarRaw.coverage, 0);

  const trivyRaw: ScannerBlock = { ...emptyScannerBlock(), ...enrichedData.trivy };
  const owaspRaw: ScannerBlock = { ...emptyScannerBlock(), ...enrichedData.owasp };
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
