import { SourceEvidence } from '../common/source-evidence';
export interface EvidenceSection {
    id: string;
    title: string;
    slots: string[];
}
export interface ProjectEvidenceRow {
    id: string;
    name: string;
    githubRepo?: string | null;
    sonarqubeUrl?: string | null;
    sonarqubePublicUrl?: string | null;
    sonarqubeKey?: string | null;
    jenkinsUrl?: string | null;
    jenkinsPublicUrl?: string | null;
    jenkinsJobName?: string | null;
    jenkinsJobPath?: string | null;
    trivyReportPath?: string | null;
    owaspReportPath?: string | null;
    zapReportPath?: string | null;
    dockerfilePath?: string | null;
    azureConfig?: Record<string, any> | null;
}
export interface ArtifactEvidenceRow {
    buildNumber?: number | null;
    commitSha?: string | null;
    registry?: string | null;
    repository?: string | null;
    tag?: string | null;
    digest?: string | null;
    provenanceVerified?: boolean | null;
}
export interface RemediationEvidenceRow {
    id: string;
    source?: string | null;
    findingId?: string | null;
    ruleOrCve?: string | null;
    findingSnapshot?: Record<string, any> | null;
    securityFindingRemediation?: Record<string, any> | null;
}
export interface EvidenceEnv {
    sonarBaseUrl: string | null;
    jenkinsBaseUrl: string | null;
    n8nBaseUrl: string | null;
    wf2WorkflowId: string | null;
    wf6WorkflowId: string | null;
}
export declare function evidenceEnv(project: ProjectEvidenceRow, env?: NodeJS.ProcessEnv): EvidenceEnv;
export interface ProjectSourceEvidence {
    projectId: string;
    projectName: string;
    generatedAt: string;
    jenkinsBaseUrl?: string | null;
    slots: Record<string, SourceEvidence>;
    sections: EvidenceSection[];
}
export declare function buildProjectEvidence(input: {
    project: ProjectEvidenceRow;
    latest: {
        buildNumber?: number | null;
        metadata?: Record<string, any> | null;
    } | null;
    latestReported?: {
        buildNumber?: number | null;
        metadata?: Record<string, any> | null;
    } | null;
    artifact: ArtifactEvidenceRow | null;
    env?: NodeJS.ProcessEnv;
    now?: Date;
}): ProjectSourceEvidence;
export interface SonarIssueEvidence {
    issueId: string;
    rule: string | null;
    file: string | null;
    line: number | null;
    slots: Record<string, SourceEvidence>;
}
export interface FindingEvidence {
    findingId: string;
    scanner: 'TRIVY' | 'OWASP' | 'ZAP';
    slots: Record<string, SourceEvidence>;
}
export interface RemediationChainEvidence {
    taskId: string;
    scanner: string | null;
    ruleOrCve: string | null;
    slots: Record<string, SourceEvidence>;
    sections: EvidenceSection[];
}
export interface IncidentSourceEvidence {
    incidentId: string;
    projectId: string;
    projectName: string;
    buildNumber: number | null;
    commitSha: string | null;
    generatedAt: string;
    slots: Record<string, SourceEvidence>;
    sections: EvidenceSection[];
    sonarIssues: SonarIssueEvidence[];
    findings: FindingEvidence[];
    remediations: RemediationChainEvidence[];
}
export declare function buildIncidentEvidence(input: {
    project: ProjectEvidenceRow;
    incident: {
        id: string;
        projectId: string;
        buildNumber?: number | null;
        prUrl?: string | null;
        jenkinsJobName?: string | null;
        metadata?: Record<string, any> | null;
    };
    artifact: ArtifactEvidenceRow | null;
    remediationTasks: RemediationEvidenceRow[];
    env?: NodeJS.ProcessEnv;
    now?: Date;
}): IncidentSourceEvidence;
export declare function buildRemediationEvidence(input: {
    project: ProjectEvidenceRow;
    task: RemediationEvidenceRow;
    cfg: EvidenceEnv;
    commitSha: string | null;
    buildNumber: number | null;
}): RemediationChainEvidence;
