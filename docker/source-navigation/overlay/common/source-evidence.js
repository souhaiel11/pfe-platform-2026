"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVIDENCE_UNAVAILABLE_LABEL = void 0;
exports.isBrowserResolvableHost = isBrowserResolvableHost;
exports.browserUrl = browserUrl;
exports.evidence = evidence;
exports.normalizeCommitSha = normalizeCommitSha;
exports.resolveSonarqubeBrowserUrl = resolveSonarqubeBrowserUrl;
exports.resolveJenkinsBrowserUrl = resolveJenkinsBrowserUrl;
exports.resolveN8nBrowserUrl = resolveN8nBrowserUrl;
exports.sonarProjectEvidence = sonarProjectEvidence;
exports.sonarIssueEvidence = sonarIssueEvidence;
exports.sonarRuleEvidence = sonarRuleEvidence;
exports.jenkinsJobUrlPath = jenkinsJobUrlPath;
exports.jenkinsJobEvidence = jenkinsJobEvidence;
exports.jenkinsBuildEvidence = jenkinsBuildEvidence;
exports.jenkinsArtifactEvidence = jenkinsArtifactEvidence;
exports.jenkinsConsoleEvidence = jenkinsConsoleEvidence;
exports.rebaseOnto = rebaseOnto;
exports.scannerReportEvidence = scannerReportEvidence;
exports.githubRepositoryBase = githubRepositoryBase;
exports.repositoryEvidence = repositoryEvidence;
exports.commitEvidence = commitEvidence;
exports.fileEvidence = fileEvidence;
exports.pullRequestEvidence = pullRequestEvidence;
exports.publishedImageEvidence = publishedImageEvidence;
exports.dockerfileEvidence = dockerfileEvidence;
exports.azureResourceEvidence = azureResourceEvidence;
exports.n8nExecutionEvidence = n8nExecutionEvidence;
exports.advisoryEvidence = advisoryEvidence;
exports.EVIDENCE_UNAVAILABLE_LABEL = 'Source non disponible';
function text(value) {
    const trimmed = String(value ?? '').trim();
    return trimmed ? trimmed : null;
}
function trimSlash(value) {
    return value.replace(/\/+$/, '');
}
function integer(value) {
    if (typeof value === 'number')
        return Number.isSafeInteger(value) ? value : null;
    const raw = text(value);
    return raw && /^[0-9]{1,15}$/.test(raw) ? Number(raw) : null;
}
function isBrowserResolvableHost(host) {
    const value = host.trim().toLowerCase();
    if (!value)
        return false;
    if (value === 'localhost' || value.endsWith('.localhost'))
        return true;
    if (value.startsWith('[') && value.endsWith(']'))
        return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))
        return true;
    return value.includes('.');
}
function browserUrl(value) {
    const raw = text(value);
    if (!raw)
        return null;
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        return null;
    if (parsed.username || parsed.password)
        return null;
    if (!isBrowserResolvableHost(parsed.hostname))
        return null;
    return parsed.toString();
}
function looksLikeUrl(value) {
    return /^https?:\/\//i.test(value);
}
const PATH_WITHOUT_URL_REASON = 'Chemin de source connu ; aucune URL navigateur disponible pour cette preuve.';
function evidence(input) {
    const url = browserUrl(input.url);
    const sourcePath = text(input.sourcePath);
    const availability = url ? 'LINK' : sourcePath ? 'PATH_ONLY' : 'UNAVAILABLE';
    return {
        provider: input.provider,
        kind: input.kind,
        label: input.label,
        availability,
        url,
        sourcePath,
        reason: url ? null : (text(input.reason) || (sourcePath ? PATH_WITHOUT_URL_REASON : exports.EVIDENCE_UNAVAILABLE_LABEL)),
        buildNumber: integer(input.buildNumber),
        commitSha: normalizeCommitSha(input.commitSha),
        reportType: text(input.reportType),
        evidenceId: text(input.evidenceId),
    };
}
function normalizeCommitSha(value) {
    const raw = text(value);
    return raw && /^[0-9a-f]{7,40}$/i.test(raw) ? raw.toLowerCase() : null;
}
function resolveSonarqubeBrowserUrl(project, env = process.env) {
    return trimOrNull(browserUrl(project.sonarqubePublicUrl))
        || trimOrNull(browserUrl(env.SONARQUBE_PUBLIC_URL))
        || trimOrNull(browserUrl(project.sonarqubeUrl));
}
function resolveJenkinsBrowserUrl(project, env = process.env) {
    return trimOrNull(browserUrl(project.jenkinsPublicUrl))
        || trimOrNull(browserUrl(env.JENKINS_PUBLIC_URL))
        || trimOrNull(browserUrl(project.jenkinsUrl));
}
function resolveN8nBrowserUrl(env = process.env) {
    return trimOrNull(browserUrl(env.N8N_PUBLIC_URL)) || trimOrNull(browserUrl(env.N8N_URL));
}
function trimOrNull(value) {
    return value ? trimSlash(value) : null;
}
function sonarProjectEvidence(input) {
    const key = text(input.projectKey);
    const base = trimOrNull(input.baseUrl);
    return evidence({
        provider: 'SONARQUBE',
        kind: 'SONAR_PROJECT',
        label: 'Voir dans SonarQube',
        url: base && key ? `${base}/dashboard?id=${encodeURIComponent(key)}` : null,
        sourcePath: key,
        evidenceId: key,
        reason: !key
            ? 'Aucune clé de projet SonarQube configurée.'
            : 'Aucune URL SonarQube navigateur configurée (SONARQUBE_PUBLIC_URL ou URL publique du projet).',
    });
}
function sonarIssueEvidence(input) {
    const base = trimOrNull(input.baseUrl);
    const key = text(input.projectKey);
    const issue = text(input.issueKey);
    const rule = text(input.rule);
    const url = base && key && issue
        ? `${base}/project/issues?id=${encodeURIComponent(key)}&issues=${encodeURIComponent(issue)}&open=${encodeURIComponent(issue)}`
        : null;
    return evidence({
        provider: 'SONARQUBE',
        kind: 'SONAR_ISSUE',
        label: 'Voir l’issue dans SonarQube',
        url,
        sourcePath: issue,
        evidenceId: issue,
        reportType: rule,
        reason: !issue
            ? 'Aucune clé d’issue SonarQube enregistrée pour ce constat.'
            : !key
                ? 'Aucune clé de projet SonarQube configurée.'
                : 'Aucune URL SonarQube navigateur configurée.',
    });
}
function sonarRuleEvidence(input) {
    const base = trimOrNull(input.baseUrl);
    const rule = text(input.rule);
    return evidence({
        provider: 'SONARQUBE',
        kind: 'SONAR_RULE',
        label: 'Voir la règle SonarQube',
        url: base && rule ? `${base}/coding_rules?open=${encodeURIComponent(rule)}&rule_key=${encodeURIComponent(rule)}` : null,
        sourcePath: rule,
        evidenceId: rule,
        reason: rule ? 'Aucune URL SonarQube navigateur configurée.' : 'Aucune règle SonarQube associée à ce constat.',
    });
}
function jenkinsJobUrlPath(jobPath) {
    const raw = text(jobPath);
    if (!raw)
        return null;
    const segments = raw.split('/').map(s => s.trim()).filter(s => s.length > 0 && s !== 'job');
    if (!segments.length)
        return null;
    return segments.map(s => `/job/${encodeURIComponent(s)}`).join('');
}
function jenkinsJobEvidence(input) {
    const base = trimOrNull(input.baseUrl);
    const path = jenkinsJobUrlPath(input.jobPath);
    return evidence({
        provider: 'JENKINS',
        kind: 'JENKINS_JOB',
        label: 'Voir le job Jenkins',
        url: base && path ? `${base}${path}/` : null,
        sourcePath: text(input.jobPath),
        evidenceId: text(input.jobPath),
        reason: !text(input.jobPath)
            ? 'Aucun job Jenkins configuré pour ce projet.'
            : 'Aucune URL Jenkins navigateur configurée (URL publique du projet ou JENKINS_PUBLIC_URL).',
    });
}
function jenkinsBuildEvidence(input) {
    const base = trimOrNull(input.baseUrl);
    const number = integer(input.buildNumber);
    const jobPath = jenkinsJobUrlPath(input.jobPath);
    let url = null;
    if (base && number !== null && number > 0) {
        let recorded = null;
        try {
            const source = new URL(String(input.recordedBuildUrl || ''));
            const start = source.pathname.indexOf('/job/');
            if (start >= 0 && source.pathname.replace(/\/+$/, '').endsWith(`/${number}`)) {
                recorded = source.origin + source.pathname.slice(start);
            }
        }
        catch { }
        const rebased = rebaseOnto(base, recorded);
        url = rebased || (jobPath && number !== null ? `${base}${jobPath}/${number}/` : null);
    }
    return evidence({
        provider: 'JENKINS',
        kind: 'JENKINS_BUILD',
        label: input.label || 'Voir le build Jenkins',
        url,
        sourcePath: number !== null ? `#${number}` : null,
        buildNumber: number,
        evidenceId: number !== null ? String(number) : null,
        reason: number === null
            ? 'Aucun numéro de build enregistré pour cette preuve.'
            : 'Aucune URL Jenkins navigateur configurée.',
    });
}
function jenkinsArtifactEvidence(input) {
    const artifact = text(input.artifactPath);
    const build = jenkinsBuildEvidence({
        baseUrl: input.baseUrl,
        jobPath: input.jobPath,
        buildNumber: input.buildNumber,
        recordedBuildUrl: input.recordedBuildUrl,
    });
    const url = input.archived && artifact && build.url
        ? `${trimSlash(build.url)}/artifact/${artifact.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
        : null;
    return evidence({
        provider: input.provider,
        kind: input.kind,
        label: input.label,
        url,
        sourcePath: artifact,
        buildNumber: input.buildNumber,
        reportType: input.reportType,
        reason: !artifact
            ? 'Aucun chemin de rapport configuré pour ce scanner.'
            : !input.archived
                ? 'Rapport présent dans le workspace du build ; non publié comme artefact navigable.'
                : 'Aucune URL Jenkins navigateur configurée.',
    });
}
function jenkinsConsoleEvidence(build, label = 'Voir le journal du build') {
    return evidence({
        provider: 'JENKINS',
        kind: `${build.kind}_LOGS`,
        label,
        url: build.url ? `${build.url.replace(/\/+$/, '')}/consoleText` : null,
        sourcePath: build.url ? 'consoleText' : null,
        buildNumber: build.buildNumber,
        reason: build.buildNumber === null
            ? 'Aucun numéro de build enregistré : aucun journal à désigner.'
            : 'Aucune URL Jenkins navigateur configurée.',
    });
}
function rebaseOnto(base, recorded) {
    const raw = text(recorded);
    if (!raw)
        return null;
    let source;
    let target;
    try {
        source = new URL(raw);
        target = new URL(base);
    }
    catch {
        return null;
    }
    if (source.protocol !== 'http:' && source.protocol !== 'https:')
        return null;
    const prefix = target.pathname.replace(/\/+$/, '');
    const path = source.pathname;
    target.pathname = !prefix || path === prefix || path.startsWith(prefix + '/')
        ? path : prefix + '/' + path.replace(/^\/+/, '');
    target.search = source.search;
    target.hash = '';
    return browserUrl(target.toString());
}
const SCANNER_REPORT_LABEL = {
    TRIVY: 'Voir le rapport Trivy',
    OWASP: 'Voir le rapport OWASP',
    ZAP: 'Voir le rapport ZAP',
};
function scannerReportEvidence(input) {
    const configured = text(input.configuredPath);
    const recorded = text(input.recordedPath);
    const configuredAsUrl = configured && looksLikeUrl(configured) ? configured : null;
    const recordedAsUrl = recorded && looksLikeUrl(recorded) ? recorded : null;
    const filePath = (recordedAsUrl ? null : recorded) || (configuredAsUrl ? null : configured) || null;
    return evidence({
        provider: input.provider,
        kind: `${input.provider}_REPORT`,
        label: SCANNER_REPORT_LABEL[input.provider],
        url: input.recordedUrl || recordedAsUrl || configuredAsUrl,
        sourcePath: filePath || recordedAsUrl || configuredAsUrl,
        buildNumber: input.buildNumber,
        reportType: input.reportType,
        reason: (configured || recorded)
            ? 'Rapport produit dans le workspace du build ; aucune URL navigateur enregistrée.'
            : 'Aucun chemin de rapport configuré ni constaté pour ce scanner.',
    });
}
const GITHUB_HOST = 'https://github.com';
const GITHUB_SLUG = /^[\w.-]+\/[\w.-]+$/;
function githubRepositoryBase(repo) {
    const value = text(repo);
    if (!value)
        return null;
    if (GITHUB_SLUG.test(value))
        return `${GITHUB_HOST}/${value}`;
    const direct = browserUrl(value);
    if (!direct)
        return null;
    const parsed = new URL(direct);
    if (parsed.hostname.toLowerCase() !== 'github.com')
        return null;
    const path = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    return path.length === 2 ? `${GITHUB_HOST}/${path[0]}/${path[1]}` : null;
}
function repositoryEvidence(repo) {
    return evidence({
        provider: 'GITHUB',
        kind: 'GIT_REPOSITORY',
        label: 'Voir le dépôt',
        url: githubRepositoryBase(repo),
        sourcePath: text(repo),
        reason: text(repo)
            ? 'Dépôt configuré hors GitHub : aucun contrat de lien connu pour cet hébergeur.'
            : 'Aucun dépôt configuré pour ce projet.',
    });
}
function commitEvidence(input) {
    const base = githubRepositoryBase(input.repo);
    const sha = normalizeCommitSha(input.commitSha);
    return evidence({
        provider: 'GITHUB',
        kind: input.kind || 'GIT_COMMIT',
        label: input.label || 'Voir le commit',
        url: base && sha ? `${base}/commit/${sha}` : null,
        sourcePath: sha,
        commitSha: sha,
        evidenceId: sha,
        reason: !sha
            ? 'Aucun commit source enregistré pour cette preuve.'
            : 'Dépôt non configuré, ou hébergeur sans contrat de lien connu.',
    });
}
function fileEvidence(input) {
    const base = githubRepositoryBase(input.repo);
    const sha = normalizeCommitSha(input.commitSha);
    const file = text(input.filePath)?.replace(/^\/+/, '') || null;
    const line = integer(input.line);
    const anchor = line && line > 0 ? `#L${line}` : '';
    const url = base && sha && file
        ? `${base}/blob/${sha}/${file.split('/').map(encodeURIComponent).join('/')}${anchor}`
        : null;
    return evidence({
        provider: 'GITHUB',
        kind: input.kind || 'GIT_FILE',
        label: input.label || 'Voir le fichier source',
        url,
        sourcePath: file ? (line && line > 0 ? `${file}:${line}` : file) : null,
        commitSha: sha,
        reason: !file
            ? 'Aucun fichier source enregistré pour ce constat.'
            : !sha
                ? 'Aucun commit source enregistré : un lien de fichier sans commit désignerait un contenu différent.'
                : 'Dépôt non configuré, ou hébergeur sans contrat de lien connu.',
    });
}
function pullRequestEvidence(input) {
    const number = integer(input.prNumber);
    const base = githubRepositoryBase(input.repo);
    const url = browserUrl(input.prUrl) || (base && number !== null ? `${base}/pull/${number}` : null);
    return evidence({
        provider: 'GITHUB',
        kind: input.kind || 'PULL_REQUEST',
        label: input.label || 'Voir la Pull Request',
        url,
        sourcePath: number !== null ? `PR #${number}` : text(input.prUrl),
        evidenceId: number !== null ? String(number) : null,
        reason: 'Aucune Pull Request enregistrée pour cette preuve.',
    });
}
function publishedImageEvidence(input) {
    const reference = text(input.publishedReference) || composeImageReference(input);
    return evidence({
        provider: 'DOCKER',
        kind: 'PUBLISHED_IMAGE',
        label: 'Image publiée',
        url: null,
        sourcePath: reference,
        buildNumber: input.buildNumber,
        commitSha: input.commitSha,
        evidenceId: text(input.digest),
        reason: reference
            ? 'Référence d’image de registre : coordonnée de tirage (docker pull), non une adresse navigable.'
            : 'Aucune image publiée enregistrée pour ce build.',
    });
}
function composeImageReference(input) {
    const registry = text(input.registry);
    const repository = text(input.repository);
    const tag = text(input.tag);
    if (!repository)
        return null;
    const host = registry ? (registry.includes('.') ? registry : `${registry}.azurecr.io`) : null;
    return `${host ? host + '/' : ''}${repository}${tag ? ':' + tag : ''}`;
}
function dockerfileEvidence(input) {
    return fileEvidence({
        repo: input.repo,
        commitSha: input.commitSha,
        filePath: input.dockerfilePath,
        kind: 'DOCKERFILE',
        label: 'Voir le Dockerfile',
    });
}
const AZURE_PORTAL = 'https://portal.azure.com';
function azureResourceEvidence(input) {
    const subscription = text(input.subscriptionRef);
    const group = text(input.resourceGroup);
    const name = text(input.resourceName);
    const isGuid = !!subscription && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscription);
    const resourceId = isGuid && group && name
        ? `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(group)}/providers/${input.resourceProvider}/${input.resourceType}/${encodeURIComponent(name)}`
        : null;
    return evidence({
        provider: input.provider || 'AZURE',
        kind: input.kind,
        label: input.label,
        url: resourceId ? `${AZURE_PORTAL}/#@/resource${resourceId}/overview` : null,
        sourcePath: input.sourcePathOverride !== undefined
            ? input.sourcePathOverride
            : (name ? [group, name].filter(Boolean).join(' / ') : null),
        evidenceId: name,
        reason: !name
            ? 'Aucune cible Azure configurée pour ce projet.'
            : !isGuid
                ? 'Aucun identifiant d’abonnement Azure enregistré : un permalien de portail ne peut pas être dérivé.'
                : 'Groupe de ressources Azure non configuré.',
    });
}
function n8nExecutionEvidence(input) {
    const base = trimOrNull(input.baseUrl);
    const workflow = text(input.workflowId);
    const execution = text(input.executionId);
    const validWorkflow = workflow && /^[A-Za-z0-9_-]{1,64}$/.test(workflow) ? workflow : null;
    const validExecution = execution && /^[0-9]{1,19}$/.test(execution) ? execution : null;
    return evidence({
        provider: 'N8N',
        kind: 'N8N_EXECUTION',
        label: input.label || 'Voir l’exécution n8n',
        url: base && validWorkflow && validExecution
            ? `${base}/workflow/${encodeURIComponent(validWorkflow)}/executions/${encodeURIComponent(validExecution)}`
            : null,
        sourcePath: validExecution ? `Exécution ${validExecution}` : null,
        evidenceId: validExecution,
        reason: !validExecution
            ? 'Aucune exécution n8n enregistrée pour cette tentative.'
            : !validWorkflow
                ? 'Identifiant de workflow n8n inconnu : la route d’exécution n8n l’exige, aucun lien exact n’est dérivable.'
                : 'Aucune URL n8n navigateur configurée (N8N_PUBLIC_URL).',
    });
}
function advisoryEvidence(input) {
    const reference = text(input.reference);
    const direct = browserUrl(input.primaryUrl);
    const derived = !direct && reference
        ? (/^CVE-/i.test(reference)
            ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(reference)}`
            : /^GHSA-/i.test(reference)
                ? `${GITHUB_HOST}/advisories/${encodeURIComponent(reference)}`
                : null)
        : null;
    return evidence({
        provider: input.provider,
        kind: 'ADVISORY',
        label: 'Voir la fiche officielle',
        url: direct || derived,
        sourcePath: reference,
        evidenceId: reference,
        reason: reference
            ? 'Identifiant sans référentiel public connu (ni CVE ni GHSA).'
            : 'Aucun identifiant de vulnérabilité enregistré.',
    });
}
//# sourceMappingURL=source-evidence.js.map