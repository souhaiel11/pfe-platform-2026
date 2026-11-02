// Regroupe les traitements de local scanner rapports.
import { promises as fs } from 'fs';
import { resolve, relative, sep, join } from 'path';
import { createHash } from 'crypto';

export const LOCAL_SCANNERS = ['trivy', 'owasp', 'zap'] as const;
export type LocalScanner = typeof LOCAL_SCANNERS[number];
const FILES: Record<LocalScanner, string> = { trivy: 'trivy-report.json', owasp: 'dependency-check-report.json', zap: 'zap-report.json' };
const MAX_BYTES = 25 * 1024 * 1024;
export interface LocalReportContext {
  projectId: string; incidentId: string; projectName: string; job: string;
  buildNumber: number; commitSha?: string | null;
}
export interface LocalReportInfo {
  scanner: LocalScanner; available: boolean; sourcePath: string | null;
  relativePath?: string | null;
  filename: string; bytes: number | null; reason: string | null;
}

/** Un segment de chemin est "sûr" s'il ne contient ni traversée de répertoire ni caractère hors d'une liste blanche. */
function safePart(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && /^[A-Za-z0-9_.%@-]+$/.test(value);
}

/** Découpe un nom de job Jenkins ("job/a/job/b") en segments réels, sans les littéraux "job". */
function jobParts(value: string): string[] {
  return String(value || '').split('/').filter(p => p && p !== 'job');
}

/** Deux SHA de commit sont considérés identiques si l'un est un préfixe hexadécimal valide de l'autre. */
function sameCommit(expected: string, actual: string): boolean {
  return /^[a-f0-9]{7,40}$/i.test(expected) && /^[a-f0-9]{7,40}$/i.test(actual)
    && (expected.toLowerCase().startsWith(actual.toLowerCase()) || actual.toLowerCase().startsWith(expected.toLowerCase()));
}

export class LocalScannerReportStore {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly root = process.env.LOCAL_SCANNER_REPORT_ROOT || '/run/local-scanner-reports') {}

  /** Résout le chemin réel (symlinks suivis) et refuse tout fichier qui sortirait de la racine autorisée. */
  private async confined(file: string): Promise<string> {
    const root = await fs.realpath(this.root);
    const actual = await fs.realpath(file);
    const rel = relative(root, actual);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith(sep)) throw Error('UNSAFE_PATH');
    const expected = resolve(root, relative(resolve(this.root), resolve(file)));
    if (actual !== expected) throw Error('UNSAFE_PATH');
    return actual;
  }

  /** Vérifie que le payload.json d'un dossier candidat correspond bien au build/job (et au commit s'il est connu) demandés. */
  private async payloadMatches(dir: string, ctx: LocalReportContext): Promise<boolean> {
    try {
      const file = await this.confined(join(dir, 'payload.json'));
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 1024 * 1024) return false;
      const payload = JSON.parse(await fs.readFile(file, 'utf8'));
      if (Number(payload.build_number ?? payload.buildNumber) !== ctx.buildNumber || jobParts(payload.job).join('/') !== jobParts(ctx.job).join('/')) return false;
      return !ctx.commitSha || sameCommit(ctx.commitSha, String(payload.commitSha || payload.commit || ''));
    } catch { return false; }
  }

  /** Localise le dossier de rapports du build : chemin exact job/build en priorité, sinon repli sur un unique dossier de branche legacy dont le payload correspond sans ambiguïté. */
  private async directory(ctx: LocalReportContext): Promise<string | null> {
    const parts = jobParts(ctx.job);
    if (!parts.length || !parts.every(safePart) || !Number.isSafeInteger(ctx.buildNumber) || ctx.buildNumber < 1) return null;
    const exact = resolve(this.root, ...parts, String(ctx.buildNumber));
    try {
      await this.confined(exact);
      const payloadPresent = await fs.stat(join(exact, 'payload.json')).then(() => true, () => false);
      if (payloadPresent && !await this.payloadMatches(exact, ctx)) return null;
      return exact;
    } catch { /* repli : ancien pipeline partagé à un seul dossier de branche */ }
    if (parts.length !== 1) return null;
    let dirs;
    try { dirs = await fs.readdir(await this.confined(join(this.root, parts[0])), { withFileTypes: true }); } catch { return null; }
    if (dirs.length > 300) return null;
    const matches: string[] = [];
    for (const entry of dirs) {
      if (!entry.isDirectory() || !safePart(entry.name)) continue;
      const dir = join(this.root, parts[0], entry.name, String(ctx.buildNumber));
      if (await this.payloadMatches(dir, ctx)) matches.push(dir);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  /** Renvoie la disponibilité (ou la raison d'absence) des trois rapports locaux (Trivy/OWASP/ZAP) pour ce build. */
  async list(ctx: LocalReportContext): Promise<LocalReportInfo[]> {
    const dir = await this.directory(ctx);
    return Promise.all(LOCAL_SCANNERS.map(async scanner => {
      const base = { scanner, filename: FILES[scanner], available: false, sourcePath: null, bytes: null } as LocalReportInfo;
      if (!dir) return { ...base, reason: 'Aucun dossier local rattaché sans ambiguïté à ce job et à ce build.' };
      try {
        const file = await this.confined(join(dir, FILES[scanner]));
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return { ...base, reason: 'Fichier vide, non régulier ou supérieur à 25 Mo.' };
        return { ...base, available: true, sourcePath: file,
          relativePath: relative(await fs.realpath(this.root), file).split(sep).join('/'), bytes: stat.size, reason: null };
      } catch { return { ...base, reason: 'Rapport local absent pour ce build.' }; }
    }));
  }

  /** Lit et valide le contenu JSON brut d'un rapport local précis, avec son empreinte SHA-256 pour traçabilité. */
  async read(ctx: LocalReportContext, scanner: string) {
    if (!LOCAL_SCANNERS.includes(scanner as LocalScanner)) throw Error('INVALID_SCANNER');
    const info = (await this.list(ctx)).find(r => r.scanner === scanner);
    if (!info?.available || !info.sourcePath) throw Error('REPORT_NOT_FOUND');
    const file = await this.confined(info.sourcePath);
    const handle = await fs.open(file, 'r');
    try {
      const stat = await handle.stat(); if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw Error('INVALID_REPORT');
      const bytes = await handle.readFile(); if (bytes.length > MAX_BYTES) throw Error('INVALID_REPORT');
      const content = bytes.toString('utf8');
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object') throw Error('INVALID_REPORT');
      return { ...info, bytes: bytes.length, projectId: ctx.projectId, incidentId: ctx.incidentId, buildNumber: ctx.buildNumber,
        commitSha: ctx.commitSha || null, sha256: createHash('sha256').update(bytes).digest('hex'), content };
    } finally { await handle.close(); }
  }
}
