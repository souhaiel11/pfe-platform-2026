export type EvidenceProvider = 'SONARQUBE' | 'JENKINS' | 'TRIVY' | 'OWASP' | 'ZAP' | 'GITHUB' | 'N8N' | 'AZURE' | 'ACR' | 'DOCKER';
export type EvidenceAvailability = 'LINK' | 'PATH_ONLY' | 'UNAVAILABLE';
export declare const EVIDENCE_UNAVAILABLE_LABEL = "Source non disponible";
export interface SourceEvidence {
    provider: EvidenceProvider;
    kind: string;
    label: string;
    availability: EvidenceAvailability;
    url: string | null;
    applicationPath?: string | null;
    sourcePath: string | null;
    reason: string | null;
    buildNumber: number | null;
    commitSha: string | null;
    reportType: string | null;
    evidenceId: string | null;
}
export declare function isBrowserResolvableHost(host: string): boolean;
export declare function browserUrl(value: unknown): string | null;
export interface EvidenceInput {
    provider: EvidenceProvider;
    kind: string;
    label: string;
    url?: unknown;
    sourcePath?: unknown;
    reason?: string | null;
    buildNumber?: unknown;
    commitSha?: unknown;
    reportType?: string | null;
    evidenceId?: unknown;
}
export declare function evidence(input: EvidenceInput): SourceEvidence;
export declare function normalizeCommitSha(value: unknown): string | null;
export interface SonarUrlSource {
    sonarqubePublicUrl?: string | null;
    sonarqubeUrl?: string | null;
}
export declare function resolveSonarqubeBrowserUrl(project: SonarUrlSource, env?: NodeJS.ProcessEnv): string | null;
export interface JenkinsBrowserUrlSource {
    jenkinsPublicUrl?: string | null;
    jenkinsUrl?: string | null;
}
export declare function resolveJenkinsBrowserUrl(project: JenkinsBrowserUrlSource, env?: NodeJS.ProcessEnv): string | null;
export declare function resolveN8nBrowserUrl(env?: NodeJS.ProcessEnv): string | null;
export declare function sonarProjectEvidence(input: {
    baseUrl: string | null;
    projectKey: string | null | undefined;
}): SourceEvidence;
export declare function sonarIssueEvidence(input: {
    baseUrl: string | null;
    projectKey: string | null | undefined;
    issueKey: string | null | undefined;
    rule?: string | null;
}): SourceEvidence;
export declare function sonarRuleEvidence(input: {
    baseUrl: string | null;
    rule: string | null | undefined;
}): SourceEvidence;
export declare function jenkinsJobUrlPath(jobPath: string | null | undefined): string | null;
export declare function jenkinsJobEvidence(input: {
    baseUrl: string | null;
    jobPath: string | null | undefined;
}): SourceEvidence;
export declare function jenkinsBuildEvidence(input: {
    baseUrl: string | null;
    jobPath: string | null | undefined;
    buildNumber: unknown;
    recordedBuildUrl?: string | null;
    label?: string;
}): SourceEvidence;
export declare function jenkinsArtifactEvidence(input: {
    provider: EvidenceProvider;
    kind: string;
    label: string;
    baseUrl: string | null;
    jobPath: string | null | undefined;
    buildNumber: unknown;
    recordedBuildUrl?: string | null;
    artifactPath: string | null | undefined;
    archived: boolean;
    reportType?: string | null;
}): SourceEvidence;
export declare function jenkinsConsoleEvidence(build: SourceEvidence, label?: string): SourceEvidence;
export declare function rebaseOnto(base: string, recorded: string | null | undefined): string | null;
export interface ScannerReportInput {
    provider: 'TRIVY' | 'OWASP' | 'ZAP';
    configuredPath?: string | null;
    recordedPath?: string | null;
    recordedUrl?: string | null;
    buildNumber?: unknown;
    reportType?: string | null;
}
export declare function scannerReportEvidence(input: ScannerReportInput): SourceEvidence;
export declare function githubRepositoryBase(repo: unknown): string | null;
export declare function repositoryEvidence(repo: unknown): SourceEvidence;
export declare function commitEvidence(input: {
    repo: unknown;
    commitSha: unknown;
    label?: string;
    kind?: string;
}): SourceEvidence;
export declare function fileEvidence(input: {
    repo: unknown;
    commitSha: unknown;
    filePath: unknown;
    line?: unknown;
    label?: string;
    kind?: string;
}): SourceEvidence;
export declare function pullRequestEvidence(input: {
    prUrl?: unknown;
    prNumber?: unknown;
    repo?: unknown;
    label?: string;
    kind?: string;
}): SourceEvidence;
export declare function publishedImageEvidence(input: {
    publishedReference?: unknown;
    registry?: unknown;
    repository?: unknown;
    tag?: unknown;
    digest?: unknown;
    buildNumber?: unknown;
    commitSha?: unknown;
}): SourceEvidence;
export declare function dockerfileEvidence(input: {
    repo: unknown;
    commitSha: unknown;
    dockerfilePath?: unknown;
}): SourceEvidence;
export declare function azureResourceEvidence(input: {
    subscriptionRef?: unknown;
    resourceGroup?: unknown;
    resourceProvider: string;
    resourceType: string;
    resourceName?: unknown;
    kind: string;
    label: string;
    sourcePathOverride?: string | null;
    provider?: EvidenceProvider;
}): SourceEvidence;
export declare function n8nExecutionEvidence(input: {
    baseUrl: string | null;
    workflowId?: unknown;
    executionId?: unknown;
    label?: string;
}): SourceEvidence;
export declare function advisoryEvidence(input: {
    reference?: unknown;
    primaryUrl?: unknown;
    provider: 'TRIVY' | 'OWASP';
}): SourceEvidence;
