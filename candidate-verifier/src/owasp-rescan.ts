// Relance OWASP et collecte les preuves de sécurité après correction.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactRuntimeError, trackedSourceDigest } from './security-artifact-validator';

export interface OwaspEvidence {
  scanner: 'OWASP'; scannerVersion: string; sourceDigest: string;
  reportDigest: string; targetCves: string[]; targetFindingRemoved: true; report: any;
}
const ENGINE_VERSION = '12.2.2';
/** Prépare le contenu XML utilisé par le traitement. */
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));

/** Valide OWASP rapport. */
export function validateOwaspReport(report: any, targets: string[]): void {
  if (!targets.length || targets.some(x => typeof x !== 'string' || !x.trim())
    || report?.reportSchema !== '1.1' || report.scanInfo?.engineVersion !== ENGINE_VERSION
    || !Array.isArray(report.scanInfo?.dataSource) || !report.scanInfo.dataSource.length
    || !Array.isArray(report.dependencies) || !report.dependencies.length
    || !report.dependencies.some((d: any) => typeof d.sha256 === 'string' && /\.jar$/i.test(d.fileName))) {
    throw new ArtifactRuntimeError('INCOMPLETE_SCANNER_REPORT', 'OWASP_REPORT');
  }
  if (report.scanInfo.analysisExceptions?.length || report.analysisExceptions?.length) {
    throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'OWASP_ANALYSIS');
  }
  for (const d of report.dependencies) {
    if (!d || typeof d.fileName !== 'string' || d.analysisExceptions?.length) {
      throw new ArtifactRuntimeError('INCOMPLETE_SCANNER_REPORT', 'OWASP_REPORT');
    }
    for (const field of ['vulnerabilities', 'suppressedVulnerabilities']) {
      if (d[field] !== undefined && !Array.isArray(d[field])) throw new ArtifactRuntimeError('MALFORMED_SCANNER_JSON', 'OWASP_REPORT');
      for (const v of d[field] || []) {
        if (typeof v?.name !== 'string') throw new ArtifactRuntimeError('INCOMPLETE_SCANNER_REPORT', 'OWASP_REPORT');
        if (targets.includes(v.name)) throw new Error('OWASP_TARGET_FINDING_STILL_PRESENT');
      }
    }
  }
}

export class OwaspRescanner {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly command: typeof execFileSync = execFileSync,
    private readonly dataDirectory: string | undefined = process.env.OWASP_DATA_DIRECTORY) {}

  /** Inspecte les données ou l’artefact pour en tirer des preuves. */
  inspect(workspace: string, targets: string[], budgetMs: number): OwaspEvidence {
    if (!this.dataDirectory || !fs.existsSync(path.join(this.dataDirectory, 'odc.mv.db'))) {
      throw new ArtifactRuntimeError('RUNTIME_IO_FAILED', 'OWASP_DATABASE');
    }
    if (!Number.isFinite(budgetMs) || budgetMs < 1000) throw new ArtifactRuntimeError('WORKER_DEADLINE_EXCEEDED', 'OWASP_RESCAN');
    const sourceDigest = trackedSourceDigest(workspace), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'owasp-rescan-'));
    try {
      // Trusted scanner-only project: candidate plugin configuration cannot skip,
      // suppress, redirect or otherwise weaken this independent rescan.
      const config = `<project><modelVersion>4.0.0</modelVersion><groupId>security.validation</groupId><artifactId>artifact-rescan</artifactId><version>1</version><build><plugins><plugin><groupId>org.owasp</groupId><artifactId>dependency-check-maven</artifactId><version>${ENGINE_VERSION}</version><configuration><autoUpdate>false</autoUpdate><failOnError>true</failOnError><skip>false</skip><dataDirectory>${xml(this.dataDirectory)}</dataDirectory><formats><format>JSON</format></formats><outputDirectory>${xml(temp)}</outputDirectory><ossindexAnalyzerEnabled>false</ossindexAnalyzerEnabled><retireJsAnalyzerEnabled>false</retireJsAnalyzerEnabled><nodeAuditAnalyzerEnabled>false</nodeAuditAnalyzerEnabled><scanSet><fileSet><directory>${xml(workspace)}</directory><includes><include>**/*.jar</include></includes><excludes><exclude>**/.git/**</exclude></excludes></fileSet></scanSet></configuration></plugin></plugins></build></project>`;
      const configPath = path.join(temp, 'scanner.xml'); fs.writeFileSync(configPath, config);
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH','HOME','JAVA_HOME','M2_HOME','MAVEN_HOME','LANG','LC_ALL']) if (process.env[key]) env[key] = process.env[key];
      try {
        this.command('mvn', ['-B', '-ntp', '-f', configPath, `org.owasp:dependency-check-maven:${ENGINE_VERSION}:check`],
          {cwd: temp, encoding: 'utf8', env, timeout: Math.floor(budgetMs), killSignal: 'SIGKILL', stdio: ['ignore','pipe','pipe']});
      } catch (err: any) {
        throw new ArtifactRuntimeError(err?.code === 'ETIMEDOUT' || err?.signal === 'SIGKILL' ? 'RUNTIME_OPERATION_TIMEOUT' : 'RUNTIME_COMMAND_FAILED', 'OWASP_RESCAN', typeof err?.status === 'number' ? err.status : undefined);
      }
      let raw: Buffer, report: any;
      try { raw = fs.readFileSync(path.join(temp, 'dependency-check-report.json')); report = JSON.parse(raw.toString()); }
      catch { throw new ArtifactRuntimeError('MALFORMED_SCANNER_JSON', 'OWASP_REPORT'); }
      if (trackedSourceDigest(workspace) !== sourceDigest) throw new ArtifactRuntimeError('SCANNER_MUTATED_SOURCE', 'OWASP_SOURCE_CHECK');
      validateOwaspReport(report, targets);
      const evidence: OwaspEvidence = {scanner:'OWASP', scannerVersion:ENGINE_VERSION, sourceDigest,
        reportDigest:createHash('sha256').update(raw).digest('hex'), targetCves:[...targets], targetFindingRemoved:true, report};
      console.log(JSON.stringify({event:'OWASP_RESCAN_COMPLETED',scannerVersion:ENGINE_VERSION,sourceDigest,reportDigest:evidence.reportDigest,targetCves:targets,targetFindingRemoved:true}));
      return evidence;
    } finally { fs.rmSync(temp, {recursive:true, force:true}); }
  }
}
