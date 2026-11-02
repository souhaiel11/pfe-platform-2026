"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evidenceEnv = evidenceEnv;
exports.buildProjectEvidence = buildProjectEvidence;
exports.buildIncidentEvidence = buildIncidentEvidence;
exports.buildRemediationEvidence = buildRemediationEvidence;
const source_evidence_1 = require("../common/source-evidence");
function jobPathOf(project) {
    return project.jenkinsJobPath || project.jenkinsJobName || null;
}
const PLATFORM_DEFAULT_DOCKERFILE = 'Dockerfile';
function evidenceEnv(project, env = process.env) {
    return {
        sonarBaseUrl: (0, source_evidence_1.resolveSonarqubeBrowserUrl)(project, env),
        jenkinsBaseUrl: (0, source_evidence_1.resolveJenkinsBrowserUrl)(project, env),
        n8nBaseUrl: (0, source_evidence_1.resolveN8nBrowserUrl)(env),
        wf2WorkflowId: String(env.N8N_WF2_ID || '').trim() || null,
        wf6WorkflowId: String(env.N8N_WF6_ID || '').trim() || null,
    };
}
const SCANNER_LABEL = { trivy: 'Voir le rapport Trivy', owasp: 'Voir le rapport OWASP', zap: 'Voir le rapport ZAP' };
function scannerSlots(project, recorded, zapBlock) {
    const configuredOf = { trivy: project.trivyReportPath, owasp: project.owaspReportPath, zap: project.zapReportPath };
    const reportTypeOf = { trivy: 'trivy-report', owasp: 'dependency-check-report', zap: 'zap-report' };
    const slots = {};
    for (const scanner of ['trivy', 'owasp', 'zap']) {
        const key = `${scanner.toUpperCase()}_REPORT`;
        const unproduced = recorded?.available?.[scanner] === false;
        if (unproduced) {
            slots[key] = (0, source_evidence_1.evidence)({
                provider: scanner.toUpperCase(),
                kind: key,
                label: SCANNER_LABEL[scanner],
                reason: 'Le pipeline rapporte ce scanner sans rapport produit pour ce build : aucune source à désigner.',
            });
            continue;
        }
        slots[key] = (0, source_evidence_1.scannerReportEvidence)({
            provider: scanner.toUpperCase(),
            buildNumber: recorded?.paths?.[scanner] ? (recorded.buildNumber ?? null) : null,
            configuredPath: configuredOf[scanner],
            recordedPath: (scanner === 'zap' ? zapBlock?.diagnostic_path : null) || recorded?.paths?.[scanner] || null,
            recordedUrl: scanner === 'zap' ? zapBlock?.diagnostic_url || null : null,
            reportType: reportTypeOf[scanner],
        });
    }
    return slots;
}
function recordedReportPaths(source) {
    const reports = source?.metadata?.validation?.reports;
    if (!reports || typeof reports !== 'object')
        return null;
    return {
        paths: {
            trivy: reports.trivyPath || null,
            owasp: reports.owaspPath || null,
            zap: reports.zapPath || null,
        },
        available: reports.available && typeof reports.available === 'object' ? reports.available : undefined,
        buildNumber: source?.buildNumber ?? source?.metadata?.enrichedData?.build?.number ?? null,
    };
}
function observedZapTarget(zapBlock) {
    const direct = String(zapBlock?.target_url || '').trim();
    if (direct)
        return direct;
    const entries = [
        ...(Array.isArray(zapBlock?.alerts) ? zapBlock.alerts : []),
        ...(Array.isArray(zapBlock?.findings) ? zapBlock.findings : []),
    ];
    const origins = new Set();
    for (const entry of entries) {
        const raw = String(entry?.url || '').trim();
        if (!raw)
            continue;
        try {
            origins.add(new URL(raw).origin);
        }
        catch {
        }
    }
    return origins.size === 1 ? [...origins][0] : null;
}
function zapTargetSlot(zapBlock) {
    const target = observedZapTarget(zapBlock);
    return (0, source_evidence_1.evidence)({
        provider: 'ZAP',
        kind: 'ZAP_TARGET',
        label: 'Cible analysée par ZAP',
        url: target,
        sourcePath: target,
        reason: target
            ? 'Cible interne au réseau d’analyse : non joignable depuis ce navigateur.'
            : 'Aucune cible ZAP enregistrée pour cette analyse.',
    });
}
function dockerSlots(project, dockerBlock, artifact, commitSha, buildNumber, env = process.env) {
    const azure = azureLinkConfig(project, env);
    const registry = artifact?.registry || dockerBlock?.registry || azure.registry || null;
    const repository = artifact?.repository || dockerBlock?.repository || azure.imageRepository || null;
    const tag = artifact?.tag || dockerBlock?.published_tag || null;
    const digest = artifact?.digest || dockerBlock?.digest || null;
    const imageBuilt = !!(dockerBlock || artifact);
    return {
        PUBLISHED_IMAGE: (0, source_evidence_1.publishedImageEvidence)({
            publishedReference: dockerBlock?.published_reference,
            registry, repository, tag, digest,
            buildNumber, commitSha,
        }),
        IMAGE_DIGEST: (0, source_evidence_1.evidence)({
            provider: 'ACR',
            kind: 'IMAGE_DIGEST',
            label: 'Empreinte de l’image (digest)',
            sourcePath: digest,
            commitSha,
            buildNumber,
            reason: 'Aucun digest d’image enregistré : la publication n’a pas été constatée par la plateforme.',
        }),
        DOCKERFILE: imageBuilt
            ? (0, source_evidence_1.dockerfileEvidence)({
                repo: project.githubRepo,
                commitSha,
                dockerfilePath: project.dockerfilePath || PLATFORM_DEFAULT_DOCKERFILE,
            })
            : (0, source_evidence_1.evidence)({
                provider: 'GITHUB',
                kind: 'DOCKERFILE',
                label: 'Voir le Dockerfile',
                reason: 'Aucune construction d’image constatée sur ce build : aucun Dockerfile à désigner comme source.',
            }),
        ACR_IMAGE: (() => {
            const registryName = String(registry || '').replace(/\.azurecr\.io$/i, '');
            const resource = (0, source_evidence_1.azureResourceEvidence)({
                provider: 'ACR', subscriptionRef: azure.subscriptionRef,
                resourceGroup: azure.resourceGroup,
                resourceProvider: 'Microsoft.ContainerRegistry', resourceType: 'registries',
                resourceName: registryName, kind: 'ACR_IMAGE', label: 'Voir l’image dans Azure',
            });
            const resourceId = resource.url?.split('/#@/resource')[1]?.replace(/\/overview$/, '');
            return (0, source_evidence_1.evidence)({
                provider: 'ACR', kind: 'ACR_IMAGE', label: 'Voir l’image dans Azure',
                url: resourceId && repository && (digest || tag)
                    ? `https://portal.azure.com/#blade/Microsoft_Azure_ContainerRegistries/RepositoryBlade/registryId/${encodeURIComponent(resourceId)}/repository/${encodeURIComponent(repository)}`
                    : null,
                sourcePath: repository ? [registry, repository].filter(Boolean).join('/') : null,
                reason: !resourceId ? resource.reason : 'Aucune image publiée identifiée pour ce build.',
                buildNumber, commitSha, evidenceId: digest || tag,
            });
        })(),
        ACR_REGISTRY: (0, source_evidence_1.azureResourceEvidence)({
            provider: 'ACR',
            subscriptionRef: azure.subscriptionRef,
            resourceGroup: azure.resourceGroup,
            resourceProvider: 'Microsoft.ContainerRegistry',
            resourceType: 'registries',
            resourceName: String(registry || '').replace(/\.azurecr\.io$/i, ''),
            kind: 'ACR_REGISTRY',
            label: 'Voir le registre dans Azure',
            sourcePathOverride: registry,
        }),
    };
}
function azureLinkConfig(project, env) {
    const azure = project.azureConfig || {};
    return { ...azure, subscriptionRef: azure.subscriptionRef || env.AZURE_PORTAL_SUBSCRIPTION_ID || null };
}
function azureSlots(project, env = process.env) {
    const azure = azureLinkConfig(project, env);
    const subscription = String(azure.subscriptionRef || '');
    const group = String(azure.resourceGroup || '');
    const groupUrl = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscription) && group
        ? `https://portal.azure.com/#@/resource/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(group)}/overview`
        : null;
    return {
        AZURE_TARGET: (0, source_evidence_1.azureResourceEvidence)({
            subscriptionRef: azure.subscriptionRef,
            resourceGroup: azure.resourceGroup,
            resourceProvider: 'Microsoft.ContainerInstance',
            resourceType: 'containerGroups',
            resourceName: azure.targetName,
            kind: 'AZURE_TARGET',
            label: 'Voir la cible dans Azure',
            sourcePathOverride: azure.targetName || null,
        }),
        AZURE_RESOURCE_GROUP: (0, source_evidence_1.evidence)({
            provider: 'AZURE',
            kind: 'AZURE_RESOURCE_GROUP',
            label: 'Groupe de ressources',
            url: groupUrl,
            sourcePath: azure.resourceGroup || null,
            reason: !group ? 'Aucun groupe de ressources Azure configuré pour ce projet.'
                : 'Abonnement Azure non configuré pour le lien du groupe de ressources.',
        }),
    };
}
function buildProjectEvidence(input) {
    const { project } = input;
    const cfg = evidenceEnv(project, input.env || process.env);
    const enriched = input.latest?.metadata?.enrichedData || {};
    const buildBlock = enriched.build || null;
    const buildNumber = input.latest?.buildNumber ?? buildBlock?.number ?? null;
    const commitSha = input.latest?.metadata?.sourceCommitSha || input.artifact?.commitSha || null;
    const slots = {
        SONAR_PROJECT: (0, source_evidence_1.sonarProjectEvidence)({ baseUrl: cfg.sonarBaseUrl, projectKey: project.sonarqubeKey }),
        JENKINS_JOB: (0, source_evidence_1.jenkinsJobEvidence)({ baseUrl: cfg.jenkinsBaseUrl, jobPath: jobPathOf(project) }),
        JENKINS_LATEST_BUILD: (0, source_evidence_1.jenkinsBuildEvidence)({
            baseUrl: cfg.jenkinsBaseUrl,
            jobPath: jobPathOf(project),
            buildNumber,
            recordedBuildUrl: buildBlock?.url,
            label: 'Voir le dernier build Jenkins',
        }),
        GIT_REPOSITORY: (0, source_evidence_1.repositoryEvidence)(project.githubRepo),
        GIT_COMMIT: (0, source_evidence_1.commitEvidence)({ repo: project.githubRepo, commitSha, label: 'Voir le commit analysé' }),
        ...scannerSlots(project, recordedReportPaths(input.latestReported) || recordedReportPaths(input.latest), enriched.zap || null),
        ZAP_TARGET: zapTargetSlot(enriched.zap || null),
        ...dockerSlots(project, enriched.docker || null, input.artifact, commitSha, buildNumber, input.env || process.env),
        ...azureSlots(project, input.env || process.env),
    };
    slots.JENKINS_LATEST_BUILD_LOGS = (0, source_evidence_1.jenkinsConsoleEvidence)(slots.JENKINS_LATEST_BUILD, 'Voir le journal du dernier build');
    return {
        projectId: project.id,
        projectName: project.name,
        jenkinsBaseUrl: cfg.jenkinsBaseUrl,
        generatedAt: (input.now || new Date()).toISOString(),
        slots,
        sections: [
            { id: 'code', title: 'Code source', slots: ['GIT_REPOSITORY', 'GIT_COMMIT'] },
            { id: 'ci', title: 'Intégration continue', slots: ['JENKINS_JOB', 'JENKINS_LATEST_BUILD', 'JENKINS_LATEST_BUILD_LOGS'] },
            { id: 'analysis', title: 'Analyses', slots: ['SONAR_PROJECT', 'TRIVY_REPORT', 'OWASP_REPORT', 'ZAP_REPORT', 'ZAP_TARGET'] },
            { id: 'image', title: 'Image', slots: ['ACR_IMAGE', 'PUBLISHED_IMAGE', 'IMAGE_DIGEST', 'DOCKERFILE', 'ACR_REGISTRY'] },
            { id: 'deployment', title: 'Déploiement', slots: ['AZURE_TARGET', 'AZURE_RESOURCE_GROUP'] },
        ],
    };
}
function buildIncidentEvidence(input) {
    const { project, incident } = input;
    const env = input.env || process.env;
    const cfg = evidenceEnv(project, env);
    const metadata = incident.metadata || {};
    const enriched = metadata.enrichedData || {};
    const buildBlock = enriched.build || null;
    const validation = metadata.validation || {};
    const buildNumber = incident.buildNumber ?? buildBlock?.number ?? null;
    const commitSha = metadata.sourceCommitSha || input.artifact?.commitSha || null;
    const recordedReports = recordedReportPaths({ buildNumber, metadata });
    const validationJobPath = validation.prValidationJob || validation.jenkinsJob || validation.job || null;
    const sonarKeyForIncident = validation.validationSonarProjectKey || validation.sonar?.project_key || project.sonarqubeKey;
    const recordedSonarDashboard = cfg.sonarBaseUrl && validation.sonar?.dashboard_url
        ? (0, source_evidence_1.rebaseOnto)(cfg.sonarBaseUrl, validation.sonar.dashboard_url)
        : null;
    const slots = {
        JENKINS_BUILD: (0, source_evidence_1.jenkinsBuildEvidence)({
            baseUrl: cfg.jenkinsBaseUrl,
            jobPath: jobPathOf(project) || incident.jenkinsJobName,
            buildNumber,
            recordedBuildUrl: buildBlock?.url || metadata.buildUrl || metadata.build_url,
            label: 'Voir le build Jenkins d’origine',
        }),
        GIT_REPOSITORY: (0, source_evidence_1.repositoryEvidence)(project.githubRepo),
        GIT_COMMIT: (0, source_evidence_1.commitEvidence)({ repo: project.githubRepo, commitSha, label: 'Voir le commit analysé' }),
        SONAR_PROJECT: recordedSonarDashboard
            ? (0, source_evidence_1.evidence)({
                provider: 'SONARQUBE', kind: 'SONAR_PROJECT', label: 'Voir dans SonarQube',
                url: recordedSonarDashboard, sourcePath: sonarKeyForIncident, evidenceId: sonarKeyForIncident,
            })
            : (0, source_evidence_1.sonarProjectEvidence)({ baseUrl: cfg.sonarBaseUrl, projectKey: sonarKeyForIncident }),
        ...scannerSlots(project, recordedReports, enriched.zap || null),
        ZAP_TARGET: zapTargetSlot(enriched.zap || null),
        ...dockerSlots(project, enriched.docker || null, input.artifact, commitSha, buildNumber, env),
        ...azureSlots(project, env),
        FIX_PULL_REQUEST: (0, source_evidence_1.pullRequestEvidence)({
            prUrl: incident.prUrl,
            repo: project.githubRepo,
            kind: 'FIX_PULL_REQUEST',
            label: 'Voir la Pull Request de correction',
        }),
        FIX_N8N_EXECUTION: (0, source_evidence_1.n8nExecutionEvidence)({
            baseUrl: cfg.n8nBaseUrl,
            workflowId: metadata.workflowId || cfg.wf2WorkflowId,
            executionId: metadata.workflowExecutionId,
            label: 'Voir l’exécution n8n de la correction',
        }),
        VALIDATION_PULL_REQUEST: (0, source_evidence_1.pullRequestEvidence)({
            prUrl: validation.prUrl || validation.pull_request,
            prNumber: validation.prNumber,
            repo: project.githubRepo,
            kind: 'VALIDATION_PULL_REQUEST',
            label: 'Voir la Pull Request validée',
        }),
        VALIDATION_BUILD: (0, source_evidence_1.jenkinsBuildEvidence)({
            baseUrl: cfg.jenkinsBaseUrl,
            jobPath: validationJobPath,
            buildNumber: validation.jenkinsBuildNumber ?? validation.buildNumber ?? validation.build_number,
            recordedBuildUrl: validation.jenkinsBuildUrl || validation.buildUrl || validation.build_url,
            label: 'Voir le build de validation',
        }),
        VALIDATION_COMMIT: (0, source_evidence_1.commitEvidence)({
            repo: project.githubRepo,
            commitSha: validation.checkoutSha || validation.expectedPrHeadSha || validation.commit,
            kind: 'VALIDATION_COMMIT',
            label: 'Voir le commit validé',
        }),
        VALIDATION_LOGS: (0, source_evidence_1.evidence)({
            provider: 'JENKINS',
            kind: 'VALIDATION_LOGS',
            label: 'Journal du build de validation',
            url: cfg.jenkinsBaseUrl ? (0, source_evidence_1.rebaseOnto)(cfg.jenkinsBaseUrl, validation.logs_url) : null,
            sourcePath: validation.logs_url ? 'consoleText' : null,
            reason: 'Aucun journal de build enregistré pour cette validation.',
        }),
    };
    slots.JENKINS_BUILD_LOGS = (0, source_evidence_1.jenkinsConsoleEvidence)(slots.JENKINS_BUILD, 'Voir le journal du build d’origine');
    const sonarIssues = (Array.isArray(enriched.sonar?.issues) ? enriched.sonar.issues : [])
        .map((issue) => {
        const issueId = String(issue?.id || issue?.key || '').trim();
        const file = String(issue?.file || issue?.component || '').trim() || null;
        const line = Number.isSafeInteger(issue?.line) && issue.line > 0 ? issue.line : null;
        const rule = String(issue?.rule || '').trim() || null;
        return {
            issueId,
            rule,
            file,
            line,
            slots: {
                SONAR_ISSUE: (0, source_evidence_1.sonarIssueEvidence)({
                    baseUrl: cfg.sonarBaseUrl,
                    projectKey: project.sonarqubeKey,
                    issueKey: issueId,
                    rule,
                }),
                SONAR_RULE: (0, source_evidence_1.sonarRuleEvidence)({ baseUrl: cfg.sonarBaseUrl, rule }),
                GIT_FILE: (0, source_evidence_1.fileEvidence)({
                    repo: project.githubRepo,
                    commitSha,
                    filePath: file,
                    line,
                    kind: 'GIT_FILE',
                    label: 'Voir la ligne dans le dépôt',
                }),
            },
        };
    })
        .filter(item => !!item.issueId);
    const findings = [];
    for (const scanner of ['trivy', 'owasp']) {
        const cves = Array.isArray(enriched[scanner]?.cves) ? enriched[scanner].cves : [];
        const provider = scanner.toUpperCase();
        for (const cve of cves) {
            const findingId = String(cve?.id || '').trim();
            if (!findingId)
                continue;
            findings.push({
                findingId,
                scanner: provider,
                slots: {
                    ADVISORY: (0, source_evidence_1.advisoryEvidence)({ reference: findingId, primaryUrl: cve?.primaryUrl, provider }),
                    REPORT: slots[`${provider}_REPORT`],
                },
            });
        }
    }
    for (const alert of (Array.isArray(enriched.zap?.alerts) ? enriched.zap.alerts : [])) {
        const findingId = String(alert?.id || alert?.pluginId || '').trim();
        if (!findingId)
            continue;
        findings.push({
            findingId,
            scanner: 'ZAP',
            slots: {
                ADVISORY: (0, source_evidence_1.evidence)({
                    provider: 'ZAP', kind: 'ADVISORY', label: 'Règle ZAP', sourcePath: findingId, evidenceId: findingId,
                    reason: 'Identifiant de règle ZAP : aucun référentiel public de vulnérabilité associé.',
                }),
                REPORT: slots.ZAP_REPORT,
            },
        });
    }
    return {
        incidentId: incident.id,
        projectId: incident.projectId,
        projectName: project.name,
        buildNumber: buildNumber ?? null,
        commitSha,
        generatedAt: (input.now || new Date()).toISOString(),
        slots,
        sections: [
            { id: 'origin', title: 'Constat d’origine', slots: ['JENKINS_BUILD', 'JENKINS_BUILD_LOGS', 'GIT_COMMIT', 'GIT_REPOSITORY'] },
            { id: 'scanners', title: 'Rapports de scanner', slots: ['SONAR_PROJECT', 'TRIVY_REPORT', 'OWASP_REPORT', 'ZAP_REPORT', 'ZAP_TARGET'] },
            { id: 'fix', title: 'Correction proposée', slots: ['FIX_PULL_REQUEST', 'FIX_N8N_EXECUTION'] },
            { id: 'validation', title: 'Validation post-PR', slots: ['VALIDATION_PULL_REQUEST', 'VALIDATION_BUILD', 'VALIDATION_COMMIT', 'VALIDATION_LOGS'] },
            { id: 'image', title: 'Image publiée', slots: ['ACR_IMAGE', 'PUBLISHED_IMAGE', 'IMAGE_DIGEST', 'DOCKERFILE', 'ACR_REGISTRY'] },
            { id: 'deployment', title: 'Déploiement', slots: ['AZURE_TARGET', 'AZURE_RESOURCE_GROUP'] },
        ],
        sonarIssues,
        findings,
        remediations: input.remediationTasks.map(task => buildRemediationEvidence({ project, task, cfg, commitSha, buildNumber: buildNumber ?? null })),
    };
}
function buildRemediationEvidence(input) {
    const { project, task, cfg } = input;
    const remediation = task.securityFindingRemediation || {};
    const attempts = Array.isArray(remediation.attempts) ? remediation.attempts : [];
    const last = attempts.length ? attempts[attempts.length - 1] : {};
    const snapshot = task.findingSnapshot || {};
    const scanner = String(task.source || snapshot.source || '').toUpperCase() || null;
    const patch = last.patchEvidence || {};
    const slots = {
        ORIGINAL_FINDING: scanner === 'SONARQUBE'
            ? (0, source_evidence_1.sonarIssueEvidence)({
                baseUrl: cfg.sonarBaseUrl,
                projectKey: project.sonarqubeKey,
                issueKey: task.findingId || snapshot.id,
                rule: snapshot.rule || task.ruleOrCve,
            })
            : (0, source_evidence_1.advisoryEvidence)({
                reference: task.ruleOrCve || snapshot.ref || snapshot.id,
                primaryUrl: snapshot.primaryUrl,
                provider: scanner === 'OWASP' ? 'OWASP' : 'TRIVY',
            }),
        ORIGINAL_BUILD: (0, source_evidence_1.jenkinsBuildEvidence)({
            baseUrl: cfg.jenkinsBaseUrl,
            jobPath: jobPathOf(project),
            buildNumber: input.buildNumber,
            label: 'Voir le build du constat',
        }),
        CONTROLLING_FILE: (0, source_evidence_1.fileEvidence)({
            repo: project.githubRepo,
            commitSha: input.commitSha,
            filePath: patch.controllingFile,
            kind: 'CONTROLLING_FILE',
            label: 'Voir le fichier d’origine',
        }),
        CANDIDATE_COMMIT: (0, source_evidence_1.commitEvidence)({
            repo: project.githubRepo,
            commitSha: last.candidateSha || last.evaluatedSha,
            kind: 'CANDIDATE_COMMIT',
            label: 'Voir le commit candidat',
        }),
        CANDIDATE_EXECUTION: (0, source_evidence_1.n8nExecutionEvidence)({
            baseUrl: cfg.n8nBaseUrl,
            workflowId: last.workflowId || cfg.wf6WorkflowId,
            executionId: last.executionId,
            label: 'Voir l’exécution n8n de la correction',
        }),
        PULL_REQUEST: (0, source_evidence_1.pullRequestEvidence)({
            prUrl: last.prUrl,
            prNumber: last.prNumber,
            repo: project.githubRepo,
        }),
    };
    return {
        taskId: task.id,
        scanner,
        ruleOrCve: task.ruleOrCve || null,
        slots,
        sections: [
            { id: 'finding', title: 'Constat d’origine', slots: ['ORIGINAL_FINDING', 'ORIGINAL_BUILD', 'CONTROLLING_FILE'] },
            { id: 'candidate', title: 'Correctif vérifié', slots: ['CANDIDATE_COMMIT', 'CANDIDATE_EXECUTION'] },
            { id: 'delivery', title: 'Livraison', slots: ['PULL_REQUEST'] },
        ],
    };
}
//# sourceMappingURL=source-evidence.assembler.js.map