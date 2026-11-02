export declare const LOCAL_SCANNERS: readonly ["trivy", "owasp", "zap"];
export type LocalScanner = typeof LOCAL_SCANNERS[number];
export interface LocalReportContext {
    projectId: string;
    incidentId: string;
    projectName: string;
    job: string;
    buildNumber: number;
    commitSha?: string | null;
}
export interface LocalReportInfo {
    scanner: LocalScanner;
    available: boolean;
    sourcePath: string | null;
    relativePath?: string | null;
    filename: string;
    bytes: number | null;
    reason: string | null;
}
export declare class LocalScannerReportStore {
    private readonly root;
    constructor(root?: string);
    private confined;
    private payloadMatches;
    private directory;
    list(ctx: LocalReportContext): Promise<LocalReportInfo[]>;
    read(ctx: LocalReportContext, scanner: string): Promise<{
        bytes: number;
        projectId: string;
        incidentId: string;
        buildNumber: number;
        commitSha: string;
        sha256: string;
        content: string;
        scanner: LocalScanner;
        available: boolean;
        sourcePath: string | null;
        relativePath?: string | null;
        filename: string;
        reason: string | null;
    }>;
}
