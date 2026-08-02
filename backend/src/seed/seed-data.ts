import { ProjectEnvironment, ProjectStatus, CicdTool } from '../projects/project.entity';
import { BugSeverity } from '../bugs/bug.entity';

export const DEMO_SOURCE = 'demo';

export interface CveEntry {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  pkg: string;
  installedVersion: string;
  fixedVersion: string;
  title: string;
  primaryUrl: string;
  cvss: number;
  source: 'TRIVY' | 'OWASP';
}

export interface SonarIssue {
  severity: string;
  type: string;
  message: string;
  component: string;
  line: number;
  effort: string;
}

export interface BugTemplate {
  severity: BugSeverity;
  title: string;
  filePath: string;
  line: number;
}

export interface DemoProjectDef {
  jenkinsJobName: string;
  name: string;
  description: string;
  environment: ProjectEnvironment;
  status: ProjectStatus;
  securityScore: number;
  sonar: { bugs: number; vulnerabilities: number; code_smells: number; coverage: number; quality_gate: string; status: string; issues: SonarIssue[] };
  trivyCves: CveEntry[];
  owaspCves: CveEntry[];
  zap: { alerts_high: number; alerts_medium: number; alerts_count: number };
  build: { status: string; number: number };
  tests: { total: number; failures: number };
  docker: { build_status: string; image_tag: string; push_status: string };
  deploy: { status: string; namespace: string };
  incidents: { open: number; analyzing: number; resolved: number };
  incidentTitles: { open: string[]; analyzing: string[]; resolved: string[] };
  bugTemplates: BugTemplate[];
}

// ─────────────────────────────────────────────────────────────────
// Dérivation des compteurs CVE : TOUJOURS depuis le tableau réel
// (filter().length), jamais écrits à la main. Utilisé par seed.ts.
// ─────────────────────────────────────────────────────────────────
export function deriveCveBlock(cves: CveEntry[]) {
  return {
    critical: cves.filter(c => c.severity === 'CRITICAL').length,
    high: cves.filter(c => c.severity === 'HIGH').length,
    cves_count: cves.length,
    cves,
  };
}

export function riskLevelFor(score: number): string {
  if (score >= 80) return 'LOW';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'HIGH';
  return 'CRITICAL';
}

// ─────────────────────────────────────────────────────────────────
// palmyra-core-banking — healthy / prod / score 92
// CVE cible : 0 crit / 1 high / 4 med (trivy+owasp)
// ─────────────────────────────────────────────────────────────────
const palmyra: DemoProjectDef = {
  jenkinsJobName: 'palmyra-core-banking',
  name: 'palmyra-core-banking',
  description: 'Cœur bancaire — comptes, soldes, intérêts (démo)',
  environment: ProjectEnvironment.PROD,
  status: ProjectStatus.HEALTHY,
  securityScore: 92,
  sonar: {
    bugs: 3, vulnerabilities: 1, code_smells: 40, coverage: 78,
    quality_gate: 'OK', status: 'SUCCESS',
    issues: [
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Unused import in LedgerService', component: 'src/main/java/com/palmyra/banking/ledger/LedgerService.java', line: 12, effort: '2min' },
      { severity: 'MAJOR', type: 'BUG', message: 'Possible null dereference in AccountBalanceCalculator', component: 'src/main/java/com/palmyra/banking/account/AccountBalanceCalculator.java', line: 88, effort: '15min' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Method too long in TransactionProcessor', component: 'src/main/java/com/palmyra/banking/transaction/TransactionProcessor.java', line: 44, effort: '30min' },
      { severity: 'MAJOR', type: 'VULNERABILITY', message: 'SQL built via string concatenation in AuditQueryRepository', component: 'src/main/java/com/palmyra/banking/audit/AuditQueryRepository.java', line: 67, effort: '20min' },
      { severity: 'MINOR', type: 'BUG', message: 'Redundant null check in InterestAccrualJob', component: 'src/main/java/com/palmyra/banking/jobs/InterestAccrualJob.java', line: 62, effort: '5min' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Magic number in FeeCalculator', component: 'src/main/java/com/palmyra/banking/fees/FeeCalculator.java', line: 18, effort: '5min' },
    ],
  },
  trivyCves: [
    { id: 'CVE-2024-6119', severity: 'HIGH', pkg: 'openssl', installedVersion: '3.0.13-0ubuntu3', fixedVersion: '3.0.14-0ubuntu3', title: 'X.509 name constraint check DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-6119', cvss: 7.5, source: 'TRIVY' },
    { id: 'CVE-2024-33599', severity: 'MEDIUM', pkg: 'libc6', installedVersion: '2.39-1ubuntu1', fixedVersion: '2.39-2ubuntu1', title: 'nscd buffer overflow via crafted request', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-33599', cvss: 5.9, source: 'TRIVY' },
    { id: 'CVE-2025-6021', severity: 'MEDIUM', pkg: 'libgcrypt20', installedVersion: '1.10.3-2', fixedVersion: '1.10.3-3', title: 'Timing side-channel in ECDSA', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-6021', cvss: 4.7, source: 'TRIVY' },
  ],
  owaspCves: [
    { id: 'CVE-2023-2976', severity: 'MEDIUM', pkg: 'com.google.guava:guava', installedVersion: '30.1-jre', fixedVersion: '32.0.0-jre', title: 'Temp directory information disclosure', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-2976', cvss: 5.5, source: 'OWASP' },
    { id: 'CVE-2020-13956', severity: 'MEDIUM', pkg: 'org.apache.httpcomponents:httpclient', installedVersion: '4.5.6', fixedVersion: '4.5.13', title: 'Incorrect URI validation allows SSRF', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2020-13956', cvss: 5.4, source: 'OWASP' },
  ],
  zap: { alerts_high: 0, alerts_medium: 2, alerts_count: 2 },
  build: { status: 'SUCCESS', number: 214 },
  tests: { total: 180, failures: 0 },
  docker: { build_status: 'SUCCESS', image_tag: 'palmyra-core-banking:214', push_status: 'SUCCESS' },
  deploy: { status: 'SUCCESS', namespace: 'palmyra-prod' },
  incidents: { open: 0, analyzing: 0, resolved: 5 },
  incidentTitles: {
    open: [],
    analyzing: [],
    resolved: [
      'Vulnérabilité SonarQube résolue : accès base dans AccountBalanceCalculator',
      'CVE-2024-6119 (openssl) corrigée sur image palmyra-core-banking',
      'CVE-2020-13956 (httpclient) mise à jour appliquée',
      'Quality Gate SonarQube repassé au vert après nettoyage code_smells',
      'Alerte ZAP DAST moyenne traitée sur endpoint /accounts',
    ],
  },
  bugTemplates: [
    { severity: BugSeverity.HIGH, title: 'Possible null dereference in AccountBalanceCalculator', filePath: 'src/main/java/com/palmyra/banking/account/AccountBalanceCalculator.java', line: 88 },
    { severity: BugSeverity.MEDIUM, title: 'Redundant null check in InterestAccrualJob', filePath: 'src/main/java/com/palmyra/banking/jobs/InterestAccrualJob.java', line: 62 },
    { severity: BugSeverity.LOW, title: 'Unused import in LedgerService', filePath: 'src/main/java/com/palmyra/banking/ledger/LedgerService.java', line: 12 },
  ],
};

// ─────────────────────────────────────────────────────────────────
// megara-settlement — warning / prod / score 71
// CVE cible : 1 crit / 5 high / 9 med
// ─────────────────────────────────────────────────────────────────
const megara: DemoProjectDef = {
  jenkinsJobName: 'megara-settlement',
  name: 'megara-settlement',
  description: 'Moteur de règlement interbancaire (démo)',
  environment: ProjectEnvironment.PROD,
  status: ProjectStatus.WARNING,
  securityScore: 71,
  sonar: {
    bugs: 12, vulnerabilities: 4, code_smells: 120, coverage: 61,
    quality_gate: 'ERROR', status: 'SUCCESS',
    issues: [
      { severity: 'CRITICAL', type: 'VULNERABILITY', message: 'Hardcoded API key in SettlementGatewayClient', component: 'src/main/java/com/megara/settlement/gateway/SettlementGatewayClient.java', line: 41, effort: '20min' },
      { severity: 'MAJOR', type: 'VULNERABILITY', message: 'Weak random used for settlement reference IDs', component: 'src/main/java/com/megara/settlement/reference/ReferenceGenerator.java', line: 27, effort: '25min' },
      { severity: 'MAJOR', type: 'BUG', message: 'Race condition in BatchSettlementWorker', component: 'src/main/java/com/megara/settlement/batch/BatchSettlementWorker.java', line: 134, effort: '1h' },
      { severity: 'MAJOR', type: 'BUG', message: 'NullPointerException risk in CounterpartyResolver', component: 'src/main/java/com/megara/settlement/counterparty/CounterpartyResolver.java', line: 59, effort: '15min' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Duplicated block in SettlementValidationRules', component: 'src/main/java/com/megara/settlement/rules/SettlementValidationRules.java', line: 210, effort: '30min' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Cognitive complexity too high in ReconciliationEngine', component: 'src/main/java/com/megara/settlement/reconciliation/ReconciliationEngine.java', line: 88, effort: '1h' },
    ],
  },
  trivyCves: [
    { id: 'CVE-2025-32414', severity: 'CRITICAL', pkg: 'qemu-utils', installedVersion: '1:8.2.2+ds-0ubuntu1', fixedVersion: '1:8.2.2+ds-0ubuntu1.4', title: 'QEMU disk image parsing buffer overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-32414', cvss: 9.1, source: 'TRIVY' },
    { id: 'CVE-2026-27456', severity: 'HIGH', pkg: 'bsdutils', installedVersion: '1:2.41.3-3ubuntu2', fixedVersion: '1:2.41.4-1', title: 'util-linux mount TOCTOU privilege escalation', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-27456', cvss: 7.8, source: 'TRIVY' },
    { id: 'CVE-2024-2961', severity: 'HIGH', pkg: 'libc-bin', installedVersion: '2.41-1ubuntu2', fixedVersion: '2.41-3ubuntu1', title: 'iconv ISO-2022-CN-EXT buffer overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-2961', cvss: 8.8, source: 'TRIVY' },
    { id: 'CVE-2024-6387', severity: 'HIGH', pkg: 'openssh-client', installedVersion: '1:9.6p1-3ubuntu13', fixedVersion: '1:9.6p1-3ubuntu13.5', title: 'regreSSHion — signal handler race condition RCE', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-6387', cvss: 8.1, source: 'TRIVY' },
    { id: 'CVE-2026-6238', severity: 'MEDIUM', pkg: 'libc-bin', installedVersion: '2.43-2ubuntu2', fixedVersion: '2.44-1ubuntu1', title: 'Deprecated ns_printrr DNS record parsing memory leak', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-6238', cvss: 5.9, source: 'TRIVY' },
    { id: 'CVE-2024-28182', severity: 'MEDIUM', pkg: 'libnghttp2-14', installedVersion: '1.59.0-1ubuntu1', fixedVersion: '1.61.0-1ubuntu1', title: 'HTTP/2 CONTINUATION frame flood DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-28182', cvss: 5.3, source: 'TRIVY' },
    { id: 'CVE-2025-27587', severity: 'MEDIUM', pkg: 'busybox', installedVersion: '1:1.36.1-3ubuntu1', fixedVersion: '1:1.36.1-3ubuntu2', title: 'tar path traversal on extraction', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-27587', cvss: 5.5, source: 'TRIVY' },
    { id: 'CVE-2024-45490', severity: 'MEDIUM', pkg: 'libxml2', installedVersion: '2.9.14+dfsg-1.2', fixedVersion: '2.9.14+dfsg-1.3', title: 'xmllint null pointer dereference', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-45490', cvss: 5.5, source: 'TRIVY' },
    { id: 'CVE-2023-52425', severity: 'MEDIUM', pkg: 'libexpat1', installedVersion: '2.5.0-1', fixedVersion: '2.6.0-1', title: 'XML entity expansion DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-52425', cvss: 6.5, source: 'TRIVY' },
  ],
  owaspCves: [
    { id: 'CVE-2020-9548', severity: 'HIGH', pkg: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.9.10.3', fixedVersion: '2.9.10.4', title: 'Polymorphic type handling deserialization RCE', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2020-9548', cvss: 8.1, source: 'OWASP' },
    { id: 'CVE-2023-34462', severity: 'HIGH', pkg: 'io.netty:netty-handler', installedVersion: '4.1.86.Final', fixedVersion: '4.1.94.Final', title: 'SniHandler unbounded buffer OOM DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-34462', cvss: 7.5, source: 'OWASP' },
    { id: 'CVE-2022-25647', severity: 'MEDIUM', pkg: 'com.google.code.gson:gson', installedVersion: '2.8.8', fixedVersion: '2.8.9', title: 'Deserialization allows DoS via crafted JSON', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-25647', cvss: 6.1, source: 'OWASP' },
    { id: 'CVE-2021-29425', severity: 'MEDIUM', pkg: 'commons-io:commons-io', installedVersion: '2.6', fixedVersion: '2.7', title: 'Path traversal outside intended directory', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2021-29425', cvss: 5.3, source: 'OWASP' },
    { id: 'CVE-2022-1471', severity: 'MEDIUM', pkg: 'org.yaml:snakeyaml', installedVersion: '1.30', fixedVersion: '2.0', title: 'Unsafe deserialization via Constructor class', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-1471', cvss: 5.9, source: 'OWASP' },
    { id: 'CVE-2024-22243', severity: 'MEDIUM', pkg: 'org.springframework:spring-web', installedVersion: '5.3.31', fixedVersion: '5.3.32', title: 'URL parsing inconsistency enables auth bypass', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-22243', cvss: 5.3, source: 'OWASP' },
  ],
  zap: { alerts_high: 2, alerts_medium: 5, alerts_count: 7 },
  build: { status: 'SUCCESS', number: 98 },
  tests: { total: 260, failures: 2 },
  docker: { build_status: 'SUCCESS', image_tag: 'megara-settlement:98', push_status: 'SUCCESS' },
  deploy: { status: 'SUCCESS', namespace: 'megara-prod' },
  incidents: { open: 2, analyzing: 1, resolved: 4 },
  incidentTitles: {
    open: [
      'CVE-2025-32414 (qemu-utils) critique détectée sur image megara-settlement',
      'Build Jenkins megara-settlement en échec — tests de règlement KO',
    ],
    analyzing: [
      'Analyse IA en cours : hardcoded API key dans SettlementGatewayClient',
    ],
    resolved: [
      'CVE-2020-9548 (jackson-databind) corrigée',
      'Race condition BatchSettlementWorker corrigée par PR',
      'Quality Gate SonarQube — vulnérabilités réduites de 6 à 4',
      'Alerte ZAP DAST élevée traitée sur endpoint /settlements',
    ],
  },
  bugTemplates: [
    { severity: BugSeverity.CRITICAL, title: 'Hardcoded API key in SettlementGatewayClient', filePath: 'src/main/java/com/megara/settlement/gateway/SettlementGatewayClient.java', line: 41 },
    { severity: BugSeverity.HIGH, title: 'Weak random used for settlement reference IDs', filePath: 'src/main/java/com/megara/settlement/reference/ReferenceGenerator.java', line: 27 },
    { severity: BugSeverity.HIGH, title: 'Race condition in BatchSettlementWorker', filePath: 'src/main/java/com/megara/settlement/batch/BatchSettlementWorker.java', line: 134 },
    { severity: BugSeverity.MEDIUM, title: 'NullPointerException risk in CounterpartyResolver', filePath: 'src/main/java/com/megara/settlement/counterparty/CounterpartyResolver.java', line: 59 },
    { severity: BugSeverity.MEDIUM, title: 'Unclosed JDBC connection in SettlementAuditDao', filePath: 'src/main/java/com/megara/settlement/audit/SettlementAuditDao.java', line: 97 },
    { severity: BugSeverity.LOW, title: 'Magic number in FeeCalculator', filePath: 'src/main/java/com/megara/settlement/fees/FeeCalculator.java', line: 18 },
  ],
};

// ─────────────────────────────────────────────────────────────────
// kyc-onboarding-svc — critical / staging / score 46 (validé précédemment)
// CVE cible : 4 crit / 11 high / 18 med
// ─────────────────────────────────────────────────────────────────
const kyc: DemoProjectDef = {
  jenkinsJobName: 'kyc-onboarding-svc',
  name: 'kyc-onboarding-svc',
  description: 'Service d\'onboarding KYC — vérification documentaire (démo)',
  environment: ProjectEnvironment.STAGING,
  status: ProjectStatus.CRITICAL,
  securityScore: 46,
  sonar: {
    bugs: 34, vulnerabilities: 14, code_smells: 310, coverage: 38,
    quality_gate: 'ERROR', status: 'FAILED',
    issues: [
      { severity: 'CRITICAL', type: 'VULNERABILITY', message: 'Hardcoded password used in KycAuthService.java', component: 'src/main/java/com/kyc/onboarding/auth/KycAuthService.java', line: 52, effort: '20min' },
      { severity: 'CRITICAL', type: 'VULNERABILITY', message: 'Weak cipher mode (ECB) used for PII encryption', component: 'src/main/java/com/kyc/onboarding/crypto/DocumentCipher.java', line: 34, effort: '45min' },
      { severity: 'MAJOR', type: 'BUG', message: 'NullPointerException possible on unchecked Optional.get()', component: 'src/main/java/com/kyc/onboarding/service/DocumentValidationService.java', line: 118, effort: '10min' },
      { severity: 'MAJOR', type: 'BUG', message: 'Resource leak: InputStream not closed on exception path', component: 'src/main/java/com/kyc/onboarding/upload/FileIngestController.java', line: 76, effort: '15min' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Cognitive complexity of method too high (32, max 15)', component: 'src/main/java/com/kyc/onboarding/rules/RiskScoringEngine.java', line: 201, effort: '1h' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Duplicated block of 42 lines', component: 'src/main/java/com/kyc/onboarding/dto/KycRequestMapper.java', line: 88, effort: '30min' },
    ],
  },
  trivyCves: [
    { id: 'CVE-2016-1000031', severity: 'CRITICAL', pkg: 'commons-fileupload', installedVersion: '1.3.1', fixedVersion: '1.3.3', title: 'Apache Commons FileUpload RCE via crafted upload', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2016-1000031', cvss: 9.8, source: 'TRIVY' },
    { id: 'CVE-2025-32414', severity: 'CRITICAL', pkg: 'qemu-utils', installedVersion: '1:8.2.2+ds-0ubuntu1', fixedVersion: '1:8.2.2+ds-0ubuntu1.4', title: 'QEMU disk image parsing buffer overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-32414', cvss: 9.1, source: 'TRIVY' },
    { id: 'CVE-2023-24998', severity: 'HIGH', pkg: 'commons-fileupload', installedVersion: '1.3.1', fixedVersion: '1.5', title: 'DoS via unlimited multipart parts', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-24998', cvss: 7.5, source: 'TRIVY' },
    { id: 'CVE-2026-27456', severity: 'HIGH', pkg: 'bsdutils', installedVersion: '1:2.41.3-3ubuntu2', fixedVersion: '1:2.41.4-1', title: 'util-linux mount TOCTOU privilege escalation', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-27456', cvss: 7.8, source: 'TRIVY' },
    { id: 'CVE-2024-6119', severity: 'HIGH', pkg: 'openssl', installedVersion: '3.0.13-0ubuntu3', fixedVersion: '3.0.14-0ubuntu3', title: 'X.509 name constraint check DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-6119', cvss: 7.5, source: 'TRIVY' },
    { id: 'CVE-2024-2961', severity: 'HIGH', pkg: 'libc-bin', installedVersion: '2.41-1ubuntu2', fixedVersion: '2.41-3ubuntu1', title: 'iconv ISO-2022-CN-EXT buffer overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-2961', cvss: 8.8, source: 'TRIVY' },
    { id: 'CVE-2025-4802', severity: 'HIGH', pkg: 'libc6', installedVersion: '2.41-1ubuntu2', fixedVersion: '2.41-2ubuntu1', title: 'Static setuid binary dlopen LD_LIBRARY_PATH issue', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-4802', cvss: 7.0, source: 'TRIVY' },
    { id: 'CVE-2023-45853', severity: 'HIGH', pkg: 'zlib1g', installedVersion: '1:1.3.dfsg-3', fixedVersion: '1:1.3.dfsg-3.1', title: 'MiniZip integer overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-45853', cvss: 7.5, source: 'TRIVY' },
    { id: 'CVE-2024-6387', severity: 'HIGH', pkg: 'openssh-client', installedVersion: '1:9.6p1-3ubuntu13', fixedVersion: '1:9.6p1-3ubuntu13.5', title: 'regreSSHion — signal handler race condition RCE', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-6387', cvss: 8.1, source: 'TRIVY' },
    { id: 'CVE-2026-6238', severity: 'MEDIUM', pkg: 'libc-bin', installedVersion: '2.43-2ubuntu2', fixedVersion: '2.44-1ubuntu1', title: 'Deprecated ns_printrr DNS record parsing memory leak', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-6238', cvss: 5.9, source: 'TRIVY' },
    { id: 'CVE-2024-28182', severity: 'MEDIUM', pkg: 'libnghttp2-14', installedVersion: '1.59.0-1ubuntu1', fixedVersion: '1.61.0-1ubuntu1', title: 'HTTP/2 CONTINUATION frame flood DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-28182', cvss: 5.3, source: 'TRIVY' },
    { id: 'CVE-2025-27587', severity: 'MEDIUM', pkg: 'busybox', installedVersion: '1:1.36.1-3ubuntu1', fixedVersion: '1:1.36.1-3ubuntu2', title: 'tar path traversal on extraction', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-27587', cvss: 5.5, source: 'TRIVY' },
    { id: 'CVE-2024-45490', severity: 'MEDIUM', pkg: 'libxml2', installedVersion: '2.9.14+dfsg-1.2', fixedVersion: '2.9.14+dfsg-1.3', title: 'xmllint null pointer dereference', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-45490', cvss: 5.5, source: 'TRIVY' },
    { id: 'CVE-2023-52425', severity: 'MEDIUM', pkg: 'libexpat1', installedVersion: '2.5.0-1', fixedVersion: '2.6.0-1', title: 'XML entity expansion DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-52425', cvss: 6.5, source: 'TRIVY' },
    { id: 'CVE-2024-33599', severity: 'MEDIUM', pkg: 'libc6', installedVersion: '2.39-1ubuntu1', fixedVersion: '2.39-2ubuntu1', title: 'nscd buffer overflow via crafted request', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-33599', cvss: 5.9, source: 'TRIVY' },
    { id: 'CVE-2025-6021', severity: 'MEDIUM', pkg: 'libgcrypt20', installedVersion: '1.10.3-2', fixedVersion: '1.10.3-3', title: 'Timing side-channel in ECDSA', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-6021', cvss: 4.7, source: 'TRIVY' },
    { id: 'CVE-2024-41996', severity: 'MEDIUM', pkg: 'libtasn1-6', installedVersion: '4.19.0-3', fixedVersion: '4.19.0-3+deb12u1', title: 'Recursive ASN.1 decoding stack overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-41996', cvss: 5.3, source: 'TRIVY' },
    { id: 'CVE-2023-6237', severity: 'MEDIUM', pkg: 'libksba8', installedVersion: '1.6.3-2', fixedVersion: '1.6.6-1', title: 'Integer overflow in certificate parsing', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-6237', cvss: 5.7, source: 'TRIVY' },
    { id: 'CVE-2025-0725', severity: 'MEDIUM', pkg: 'libcurl4', installedVersion: '8.5.0-2ubuntu10', fixedVersion: '8.5.0-4ubuntu10', title: 'gzip decompression heap overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-0725', cvss: 5.9, source: 'TRIVY' },
    { id: 'CVE-2024-56171', severity: 'MEDIUM', pkg: 'libxml2', installedVersion: '2.9.14+dfsg-1.3', fixedVersion: '2.9.14+dfsg-1.4', title: 'XML schema use-after-free', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-56171', cvss: 6.3, source: 'TRIVY' },
  ],
  owaspCves: [
    { id: 'CVE-2021-44228', severity: 'CRITICAL', pkg: 'org.apache.logging.log4j:log4j-core', installedVersion: '2.14.1', fixedVersion: '2.17.1', title: 'Log4Shell — JNDI lookup RCE', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228', cvss: 10.0, source: 'OWASP' },
    { id: 'CVE-2022-22965', severity: 'CRITICAL', pkg: 'org.springframework:spring-beans', installedVersion: '5.3.17', fixedVersion: '5.3.18', title: 'Spring4Shell — data binding RCE', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-22965', cvss: 9.8, source: 'OWASP' },
    { id: 'CVE-2020-9548', severity: 'HIGH', pkg: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.9.10.3', fixedVersion: '2.9.10.4', title: 'Polymorphic type handling deserialization RCE', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2020-9548', cvss: 8.1, source: 'OWASP' },
    { id: 'CVE-2022-42003', severity: 'HIGH', pkg: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.13.3', fixedVersion: '2.13.4', title: 'Deeply nested resource DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-42003', cvss: 7.5, source: 'OWASP' },
    { id: 'CVE-2023-34462', severity: 'HIGH', pkg: 'io.netty:netty-handler', installedVersion: '4.1.86.Final', fixedVersion: '4.1.94.Final', title: 'SniHandler unbounded buffer OOM DoS', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-34462', cvss: 7.5, source: 'OWASP' },
    { id: 'CVE-2021-22119', severity: 'HIGH', pkg: 'org.springframework:spring-web', installedVersion: '5.2.14.RELEASE', fixedVersion: '5.2.15.RELEASE', title: 'CORS configuration bypass on error responses', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2021-22119', cvss: 7.1, source: 'OWASP' },
    { id: 'CVE-2022-25647', severity: 'MEDIUM', pkg: 'com.google.code.gson:gson', installedVersion: '2.8.8', fixedVersion: '2.8.9', title: 'Deserialization allows DoS via crafted JSON', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-25647', cvss: 6.1, source: 'OWASP' },
    { id: 'CVE-2023-2976', severity: 'MEDIUM', pkg: 'com.google.guava:guava', installedVersion: '30.1-jre', fixedVersion: '32.0.0-jre', title: 'Temp directory information disclosure', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-2976', cvss: 5.5, source: 'OWASP' },
    { id: 'CVE-2021-29425', severity: 'MEDIUM', pkg: 'commons-io:commons-io', installedVersion: '2.6', fixedVersion: '2.7', title: 'Path traversal outside intended directory', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2021-29425', cvss: 5.3, source: 'OWASP' },
    { id: 'CVE-2020-13956', severity: 'MEDIUM', pkg: 'org.apache.httpcomponents:httpclient', installedVersion: '4.5.6', fixedVersion: '4.5.13', title: 'Incorrect URI validation allows SSRF', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2020-13956', cvss: 5.4, source: 'OWASP' },
    { id: 'CVE-2022-1471', severity: 'MEDIUM', pkg: 'org.yaml:snakeyaml', installedVersion: '1.30', fixedVersion: '2.0', title: 'Unsafe deserialization via Constructor class', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-1471', cvss: 5.9, source: 'OWASP' },
    { id: 'CVE-2023-33201', severity: 'MEDIUM', pkg: 'org.bouncycastle:bcprov-jdk15on', installedVersion: '1.69', fixedVersion: '1.73', title: 'Timing side-channel in DSA/ECDSA signing', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-33201', cvss: 5.3, source: 'OWASP' },
    { id: 'CVE-2024-22243', severity: 'MEDIUM', pkg: 'org.springframework:spring-web', installedVersion: '5.3.31', fixedVersion: '5.3.32', title: 'URL parsing inconsistency enables auth bypass', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-22243', cvss: 5.3, source: 'OWASP' },
  ],
  zap: { alerts_high: 3, alerts_medium: 6, alerts_count: 9 },
  build: { status: 'FAILURE', number: 187 },
  tests: { total: 214, failures: 9 },
  docker: { build_status: 'FAILURE', image_tag: 'kyc-onboarding-svc:186', push_status: 'FAILURE' },
  deploy: { status: 'FAILED', namespace: 'kyc-staging' },
  incidents: { open: 5, analyzing: 2, resolved: 2 },
  incidentTitles: {
    open: [
      'CVE-2021-44228 (Log4Shell) détectée sur log4j-core — action immédiate requise',
      'CVE-2022-22965 (Spring4Shell) détectée sur spring-beans',
      'Build Jenkins kyc-onboarding-svc en échec — Quality Gate KO',
      'Hardcoded password détecté dans KycAuthService',
      'Couverture de tests sous le seuil (38%) sur kyc-onboarding-svc',
    ],
    analyzing: [
      'Analyse IA en cours : cipher ECB dans DocumentCipher',
      'Analyse IA en cours : SSRF potentiel dans ExternalVerificationClient',
    ],
    resolved: [
      'CVE-2023-24998 (commons-fileupload) corrigée',
      'Alerte ZAP DAST moyenne résolue sur endpoint /kyc/documents',
    ],
  },
  bugTemplates: [
    { severity: BugSeverity.CRITICAL, title: 'Hardcoded password in KycAuthService', filePath: 'src/main/java/com/kyc/onboarding/auth/KycAuthService.java', line: 52 },
    { severity: BugSeverity.CRITICAL, title: 'Weak cipher mode (ECB) for PII encryption in DocumentCipher', filePath: 'src/main/java/com/kyc/onboarding/crypto/DocumentCipher.java', line: 34 },
    { severity: BugSeverity.HIGH, title: 'Missing input validation in DocumentUploadController', filePath: 'src/main/java/com/kyc/onboarding/upload/DocumentUploadController.java', line: 71 },
    { severity: BugSeverity.HIGH, title: 'SSRF risk via unchecked redirect URL in ExternalVerificationClient', filePath: 'src/main/java/com/kyc/onboarding/verification/ExternalVerificationClient.java', line: 112 },
    { severity: BugSeverity.MEDIUM, title: 'NullPointerException possible on unchecked Optional.get()', filePath: 'src/main/java/com/kyc/onboarding/service/DocumentValidationService.java', line: 118 },
    { severity: BugSeverity.MEDIUM, title: 'Resource leak: InputStream not closed on exception path', filePath: 'src/main/java/com/kyc/onboarding/upload/FileIngestController.java', line: 76 },
    { severity: BugSeverity.LOW, title: 'Cognitive complexity too high in RiskScoringEngine', filePath: 'src/main/java/com/kyc/onboarding/rules/RiskScoringEngine.java', line: 201 },
    { severity: BugSeverity.LOW, title: 'Duplicated block in KycRequestMapper', filePath: 'src/main/java/com/kyc/onboarding/dto/KycRequestMapper.java', line: 88 },
  ],
};

// ─────────────────────────────────────────────────────────────────
// reporting-gateway — healthy / staging / score 84
// CVE cible : 0 crit / 2 high / 6 med
// ─────────────────────────────────────────────────────────────────
const reportingGateway: DemoProjectDef = {
  jenkinsJobName: 'reporting-gateway',
  name: 'reporting-gateway',
  description: 'Passerelle d\'export et d\'agrégation de rapports (démo)',
  environment: ProjectEnvironment.STAGING,
  status: ProjectStatus.HEALTHY,
  securityScore: 84,
  sonar: {
    bugs: 6, vulnerabilities: 2, code_smells: 70, coverage: 71,
    quality_gate: 'OK', status: 'SUCCESS',
    issues: [
      { severity: 'MAJOR', type: 'VULNERABILITY', message: 'CORS wildcard origin in ReportExportController', component: 'src/main/java/com/reporting/gateway/export/ReportExportController.java', line: 45, effort: '20min' },
      { severity: 'MINOR', type: 'VULNERABILITY', message: 'Verbose error messages leak stack trace in GlobalExceptionHandler', component: 'src/main/java/com/reporting/gateway/error/GlobalExceptionHandler.java', line: 29, effort: '15min' },
      { severity: 'MAJOR', type: 'BUG', message: 'Off-by-one in PaginationHelper', component: 'src/main/java/com/reporting/gateway/util/PaginationHelper.java', line: 33, effort: '10min' },
      { severity: 'MINOR', type: 'BUG', message: 'Resource not closed in CsvExportWriter', component: 'src/main/java/com/reporting/gateway/export/CsvExportWriter.java', line: 58, effort: '10min' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Duplicated block in ReportQueryBuilder', component: 'src/main/java/com/reporting/gateway/query/ReportQueryBuilder.java', line: 140, effort: '25min' },
      { severity: 'MINOR', type: 'CODE_SMELL', message: 'Long parameter list in DashboardAggregationService', component: 'src/main/java/com/reporting/gateway/dashboard/DashboardAggregationService.java', line: 22, effort: '20min' },
    ],
  },
  trivyCves: [
    { id: 'CVE-2023-45853', severity: 'HIGH', pkg: 'zlib1g', installedVersion: '1:1.3.dfsg-3', fixedVersion: '1:1.3.dfsg-3.1', title: 'MiniZip integer overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-45853', cvss: 7.5, source: 'TRIVY' },
    { id: 'CVE-2024-56171', severity: 'MEDIUM', pkg: 'libxml2', installedVersion: '2.9.14+dfsg-1.3', fixedVersion: '2.9.14+dfsg-1.4', title: 'XML schema use-after-free', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-56171', cvss: 6.3, source: 'TRIVY' },
    { id: 'CVE-2023-6237', severity: 'MEDIUM', pkg: 'libksba8', installedVersion: '1.6.3-2', fixedVersion: '1.6.6-1', title: 'Integer overflow in certificate parsing', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-6237', cvss: 5.7, source: 'TRIVY' },
    { id: 'CVE-2025-0725', severity: 'MEDIUM', pkg: 'libcurl4', installedVersion: '8.5.0-2ubuntu10', fixedVersion: '8.5.0-4ubuntu10', title: 'gzip decompression heap overflow', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-0725', cvss: 5.9, source: 'TRIVY' },
  ],
  owaspCves: [
    { id: 'CVE-2021-22119', severity: 'HIGH', pkg: 'org.springframework:spring-web', installedVersion: '5.2.14.RELEASE', fixedVersion: '5.2.15.RELEASE', title: 'CORS configuration bypass on error responses', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2021-22119', cvss: 7.1, source: 'OWASP' },
    { id: 'CVE-2023-33201', severity: 'MEDIUM', pkg: 'org.bouncycastle:bcprov-jdk15on', installedVersion: '1.69', fixedVersion: '1.73', title: 'Timing side-channel in DSA/ECDSA signing', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-33201', cvss: 5.3, source: 'OWASP' },
    { id: 'CVE-2023-2976', severity: 'MEDIUM', pkg: 'com.google.guava:guava', installedVersion: '30.1-jre', fixedVersion: '32.0.0-jre', title: 'Temp directory information disclosure', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-2976', cvss: 5.5, source: 'OWASP' },
    { id: 'CVE-2020-13956', severity: 'MEDIUM', pkg: 'org.apache.httpcomponents:httpclient', installedVersion: '4.5.6', fixedVersion: '4.5.13', title: 'Incorrect URI validation allows SSRF', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2020-13956', cvss: 5.4, source: 'OWASP' },
  ],
  zap: { alerts_high: 1, alerts_medium: 3, alerts_count: 4 },
  build: { status: 'SUCCESS', number: 56 },
  tests: { total: 150, failures: 0 },
  docker: { build_status: 'SUCCESS', image_tag: 'reporting-gateway:56', push_status: 'SUCCESS' },
  deploy: { status: 'SUCCESS', namespace: 'reporting-staging' },
  incidents: { open: 1, analyzing: 0, resolved: 3 },
  incidentTitles: {
    open: [
      'CORS wildcard origin détecté dans ReportExportController',
    ],
    analyzing: [],
    resolved: [
      'CVE-2021-22119 (spring-web) corrigée',
      'CVE-2023-45853 (zlib1g) corrigée sur image reporting-gateway',
      'Quality Gate SonarQube repassé au vert',
    ],
  },
  bugTemplates: [
    { severity: BugSeverity.HIGH, title: 'CORS wildcard origin in ReportExportController', filePath: 'src/main/java/com/reporting/gateway/export/ReportExportController.java', line: 45 },
    { severity: BugSeverity.MEDIUM, title: 'Verbose error messages leak stack trace in GlobalExceptionHandler', filePath: 'src/main/java/com/reporting/gateway/error/GlobalExceptionHandler.java', line: 29 },
    { severity: BugSeverity.MEDIUM, title: 'Off-by-one in PaginationHelper', filePath: 'src/main/java/com/reporting/gateway/util/PaginationHelper.java', line: 33 },
    { severity: BugSeverity.LOW, title: 'Resource not closed in CsvExportWriter', filePath: 'src/main/java/com/reporting/gateway/export/CsvExportWriter.java', line: 58 },
    { severity: BugSeverity.LOW, title: 'Duplicated block in ReportQueryBuilder', filePath: 'src/main/java/com/reporting/gateway/query/ReportQueryBuilder.java', line: 140 },
    { severity: BugSeverity.LOW, title: 'Long parameter list in DashboardAggregationService', filePath: 'src/main/java/com/reporting/gateway/dashboard/DashboardAggregationService.java', line: 22 },
  ],
};

export const DEMO_PROJECTS: DemoProjectDef[] = [palmyra, megara, kyc, reportingGateway];

// cicdTool est identique pour les 4 (imposé par la matrice) — pas la peine de le
// répéter dans chaque objet.
export const DEMO_CICD_TOOL = CicdTool.JENKINS;

// ─────────────────────────────────────────────────────────────────
// Assemble l'enrichedData v2.1 complet pour un projet démo, avec
// critical/high/cves_count TOUJOURS dérivés des tableaux cves[].
// ─────────────────────────────────────────────────────────────────
export function buildEnrichedData(def: DemoProjectDef, buildNumber: number, buildTimestamp: number, buildUrl: string) {
  return {
    build: { status: def.build.status, number: buildNumber, url: buildUrl },
    tests: { total: def.tests.total, failures: def.tests.failures, coverage: def.sonar.coverage },
    docker: { build_status: def.docker.build_status, image_tag: def.docker.image_tag, push_status: def.docker.push_status },
    deploy: { status: def.deploy.status, namespace: def.deploy.namespace },
    sonar: {
      quality_gate: def.sonar.quality_gate,
      bugs: def.sonar.bugs,
      vulnerabilities: def.sonar.vulnerabilities,
      code_smells: def.sonar.code_smells,
      coverage: def.sonar.coverage,
      status: def.sonar.status,
      issues: def.sonar.issues,
    },
    trivy: deriveCveBlock(def.trivyCves),
    owasp: deriveCveBlock(def.owaspCves),
    zap: def.zap,
  };
}
