"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalScannerReportStore = exports.LOCAL_SCANNERS = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
exports.LOCAL_SCANNERS = ['trivy', 'owasp', 'zap'];
const FILES = { trivy: 'trivy-report.json', owasp: 'dependency-check-report.json', zap: 'zap-report.json' };
const MAX_BYTES = 25 * 1024 * 1024;
function safePart(value) {
    return !!value && value !== '.' && value !== '..' && /^[A-Za-z0-9_.%@-]+$/.test(value);
}
function jobParts(value) {
    return String(value || '').split('/').filter(p => p && p !== 'job');
}
function sameCommit(expected, actual) {
    return /^[a-f0-9]{7,40}$/i.test(expected) && /^[a-f0-9]{7,40}$/i.test(actual)
        && (expected.toLowerCase().startsWith(actual.toLowerCase()) || actual.toLowerCase().startsWith(expected.toLowerCase()));
}
class LocalScannerReportStore {
    constructor(root = process.env.LOCAL_SCANNER_REPORT_ROOT || '/run/local-scanner-reports') {
        this.root = root;
    }
    async confined(file) {
        const root = await fs_1.promises.realpath(this.root);
        const actual = await fs_1.promises.realpath(file);
        const rel = (0, path_1.relative)(root, actual);
        if (!rel || rel === '..' || rel.startsWith('..' + path_1.sep) || rel.startsWith(path_1.sep))
            throw Error('UNSAFE_PATH');
        const expected = (0, path_1.resolve)(root, (0, path_1.relative)((0, path_1.resolve)(this.root), (0, path_1.resolve)(file)));
        if (actual !== expected)
            throw Error('UNSAFE_PATH');
        return actual;
    }
    async payloadMatches(dir, ctx) {
        try {
            const file = await this.confined((0, path_1.join)(dir, 'payload.json'));
            const stat = await fs_1.promises.stat(file);
            if (!stat.isFile() || stat.size > 1024 * 1024)
                return false;
            const payload = JSON.parse(await fs_1.promises.readFile(file, 'utf8'));
            if (Number(payload.build_number ?? payload.buildNumber) !== ctx.buildNumber || jobParts(payload.job).join('/') !== jobParts(ctx.job).join('/'))
                return false;
            return !ctx.commitSha || sameCommit(ctx.commitSha, String(payload.commitSha || payload.commit || ''));
        }
        catch {
            return false;
        }
    }
    async directory(ctx) {
        const parts = jobParts(ctx.job);
        if (!parts.length || !parts.every(safePart) || !Number.isSafeInteger(ctx.buildNumber) || ctx.buildNumber < 1)
            return null;
        const exact = (0, path_1.resolve)(this.root, ...parts, String(ctx.buildNumber));
        try {
            await this.confined(exact);
            const payloadPresent = await fs_1.promises.stat((0, path_1.join)(exact, 'payload.json')).then(() => true, () => false);
            if (payloadPresent && !await this.payloadMatches(exact, ctx))
                return null;
            return exact;
        }
        catch { }
        if (parts.length !== 1)
            return null;
        let dirs;
        try {
            dirs = await fs_1.promises.readdir(await this.confined((0, path_1.join)(this.root, parts[0])), { withFileTypes: true });
        }
        catch {
            return null;
        }
        if (dirs.length > 300)
            return null;
        const matches = [];
        for (const entry of dirs) {
            if (!entry.isDirectory() || !safePart(entry.name))
                continue;
            const dir = (0, path_1.join)(this.root, parts[0], entry.name, String(ctx.buildNumber));
            if (await this.payloadMatches(dir, ctx))
                matches.push(dir);
        }
        return matches.length === 1 ? matches[0] : null;
    }
    async list(ctx) {
        const dir = await this.directory(ctx);
        return Promise.all(exports.LOCAL_SCANNERS.map(async (scanner) => {
            const base = { scanner, filename: FILES[scanner], available: false, sourcePath: null, bytes: null };
            if (!dir)
                return { ...base, reason: 'Aucun dossier local rattaché sans ambiguïté à ce job et à ce build.' };
            try {
                const file = await this.confined((0, path_1.join)(dir, FILES[scanner]));
                const stat = await fs_1.promises.stat(file);
                if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES)
                    return { ...base, reason: 'Fichier vide, non régulier ou supérieur à 25 Mo.' };
                return { ...base, available: true, sourcePath: file,
                    relativePath: (0, path_1.relative)(await fs_1.promises.realpath(this.root), file).split(path_1.sep).join('/'), bytes: stat.size, reason: null };
            }
            catch {
                return { ...base, reason: 'Rapport local absent pour ce build.' };
            }
        }));
    }
    async read(ctx, scanner) {
        if (!exports.LOCAL_SCANNERS.includes(scanner))
            throw Error('INVALID_SCANNER');
        const info = (await this.list(ctx)).find(r => r.scanner === scanner);
        if (!info?.available || !info.sourcePath)
            throw Error('REPORT_NOT_FOUND');
        const file = await this.confined(info.sourcePath);
        const handle = await fs_1.promises.open(file, 'r');
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES)
                throw Error('INVALID_REPORT');
            const bytes = await handle.readFile();
            if (bytes.length > MAX_BYTES)
                throw Error('INVALID_REPORT');
            const content = bytes.toString('utf8');
            const parsed = JSON.parse(content);
            if (!parsed || typeof parsed !== 'object')
                throw Error('INVALID_REPORT');
            return { ...info, bytes: bytes.length, projectId: ctx.projectId, incidentId: ctx.incidentId, buildNumber: ctx.buildNumber,
                commitSha: ctx.commitSha || null, sha256: (0, crypto_1.createHash)('sha256').update(bytes).digest('hex'), content };
        }
        finally {
            await handle.close();
        }
    }
}
exports.LocalScannerReportStore = LocalScannerReportStore;
//# sourceMappingURL=local-scanner-reports.js.map