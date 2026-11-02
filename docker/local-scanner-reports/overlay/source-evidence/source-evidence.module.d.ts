import { DataSource } from 'typeorm';
import { IncidentSourceEvidence, ProjectSourceEvidence } from './source-evidence.assembler';
export declare function assertUuid(value: string, label: string): string;
export declare class SourceEvidenceService {
    private readonly db;
    private readonly localStore;
    constructor(db: DataSource);
    private localContext;
    private withLocalReports;
    localReport(incidentId: string, scanner: string): Promise<{
        bytes: number;
        projectId: string;
        incidentId: string;
        buildNumber: number;
        commitSha: string;
        sha256: string;
        content: string;
        scanner: import("./local-scanner-reports").LocalScanner;
        available: boolean;
        sourcePath: string | null;
        filename: string;
        reason: string | null;
    }>;
    private read;
    private project;
    private latestArtifact;
    private remediationTasks;
    forProject(projectId: string): Promise<ProjectSourceEvidence>;
    forIncident(incidentId: string): Promise<IncidentSourceEvidence>;
}
export declare class SourceEvidenceController {
    private readonly service;
    constructor(service: SourceEvidenceService);
    project(id: string): Promise<ProjectSourceEvidence>;
    localReport(id: string, scanner: string): Promise<{
        bytes: number;
        projectId: string;
        incidentId: string;
        buildNumber: number;
        commitSha: string;
        sha256: string;
        content: string;
        scanner: import("./local-scanner-reports").LocalScanner;
        available: boolean;
        sourcePath: string | null;
        filename: string;
        reason: string | null;
    }>;
    incident(id: string): Promise<IncidentSourceEvidence>;
}
export declare class SourceEvidenceModule {
}
