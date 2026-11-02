// Assemble les emplacements de preuve ("Voir dans la source") à partir de lignes déjà lues (projet, build, scanner, artefact, remédiation).
import {
  SourceEvidence, advisoryEvidence, azureResourceEvidence, commitEvidence, dockerfileEvidence,
  evidence, fileEvidence, jenkinsBuildEvidence, jenkinsConsoleEvidence, jenkinsJobEvidence, n8nExecutionEvidence,
  publishedImageEvidence, pullRequestEvidence, rebaseOnto, repositoryEvidence,
  resolveJenkinsBrowserUrl, resolveN8nBrowserUrl, resolveSonarqubeBrowserUrl,
  scannerReportEvidence, sonarIssueEvidence, sonarProjectEvidence, sonarRuleEvidence,
} from '../common/source-evidence';

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

/** Renvoie le chemin de job Jenkins du projet (jenkinsJobPath en priorité, sinon jenkinsJobName). */
function jobPathOf(project: ProjectEvidenceRow): string | null {
  return project.jenkinsJobPath || project.jenkinsJobName || null;
}

const PLATFORM_DEFAULT_DOCKERFILE = 'Dockerfile';

export interface EvidenceEnv {
  sonarBaseUrl: string | null;
  jenkinsBaseUrl: string | null;
  n8nBaseUrl: string | null;
  wf2WorkflowId: string | null;
  wf6WorkflowId: string | null;
}

/** Résout les URL de base navigateur (Sonar/Jenkins/n8n) et les identités de workflow pour un projet donné. */
export function evidenceEnv(project: ProjectEvidenceRow, env: NodeJS.ProcessEnv = process.env): EvidenceEnv {
  return {
    sonarBaseUrl: resolveSonarqubeBrowserUrl(project, env),
    jenkinsBaseUrl: resolveJenkinsBrowserUrl(project, env),
    n8nBaseUrl: resolveN8nBrowserUrl(env),
    wf2WorkflowId: String(env.N8N_WF2_ID || '').trim() || null,
    wf6WorkflowId: String(env.N8N_WF6_ID || '').trim() || null,
  };
}

const SCANNER_LABEL = { trivy: 'Voir le rapport Trivy', owasp: 'Voir le rapport OWASP', zap: 'Voir le rapport ZAP' } as const;

/** Construit les emplacements de preuve des rapports Trivy/OWASP/ZAP, en préférant le chemin constaté par le pipeline pour ce build au chemin simplement configuré pour le projet. */
function scannerSlots(
  project: ProjectEvidenceRow,
  recorded: { paths: Record<string, string | null>; available?: Record<string, boolean | null>; buildNumber?: number | null } | null,
  zapBlock: Record<string, any> | null,
): Record<string, SourceEvidence> {
  const configuredOf = { trivy: project.trivyReportPath, owasp: project.owaspReportPath, zap: project.zapReportPath } as const;
  const reportTypeOf = { trivy: 'trivy-report', owasp: 'dependency-check-report', zap: 'zap-report' } as const;
  const slots: Record<string, SourceEvidence> = {};
  for (const scanner of ['trivy', 'owasp', 'zap'] as const) {
    const key = `${scanner.toUpperCase()}_REPORT`;
    const unproduced = recorded?.available?.[scanner] === false;
    if (unproduced) {
      slots[key] = evidence({
        provider: scanner.toUpperCase() as 'TRIVY' | 'OWASP' | 'ZAP',
        kind: key,
        label: SCANNER_LABEL[scanner],
        reason: 'Le pipeline rapporte ce scanner sans rapport produit pour ce build : aucune source à désigner.',
      });
      continue;
    }
    slots[key] = scannerReportEvidence({
      provider: scanner.toUpperCase() as 'TRIVY' | 'OWASP' | 'ZAP',
      buildNumber: recorded?.paths?.[scanner] ? (recorded.buildNumber ?? null) : null,
      configuredPath: configuredOf[scanner],
      recordedPath: (scanner === 'zap' ? zapBlock?.diagnostic_path : null) || recorded?.paths?.[scanner] || null,
      recordedUrl: scanner === 'zap' ? zapBlock?.diagnostic_url || null : null,
      reportType: reportTypeOf[scanner],
    });
  }
  return slots;
}

/** Extrait les chemins de rapport constatés par le pipeline sur un build donné (metadata.validation.reports). */
function recordedReportPaths(
  source: { buildNumber?: number | null; metadata?: Record<string, any> | null } | null | undefined,
): { paths: Record<string, string | null>; available?: Record<string, boolean | null>; buildNumber: number | null } | null {
  const reports = source?.metadata?.validation?.reports;
  if (!reports || typeof reports !== 'object') return null;
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

/** Détermine la cible applicative réellement analysée par ZAP, à partir de target_url ou, à défaut, de l'origine commune des alertes. */
function observedZapTarget(zapBlock: Record<string, any> | null): string | null {
  const direct = String(zapBlock?.target_url || '').trim();
  if (direct) return direct;
  const entries = [
    ...(Array.isArray(zapBlock?.alerts) ? zapBlock.alerts : []),
    ...(Array.isArray(zapBlock?.findings) ? zapBlock.findings : []),
  ];
  const origins = new Set<string>();
  for (const entry of entries) {
    const raw = String(entry?.url || '').trim();
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // valeur non analysable, ignorée
    }
  }
  return origins.size === 1 ? [...origins][0] : null;
}

/** Construit l'emplacement de preuve de la cible applicative scannée par ZAP (distinct de l'emplacement du rapport ZAP lui-même). */
function zapTargetSlot(zapBlock: Record<string, any> | null): SourceEvidence {
  const target = observedZapTarget(zapBlock);
  return evidence({
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

/** Construit les emplacements de preuve liés à l'image Docker (image publiée, digest, Dockerfile, ACR) pour ce build. */
function dockerSlots(
  project: ProjectEvidenceRow,
  dockerBlock: Record<string, any> | null,
  artifact: ArtifactEvidenceRow | null,
  commitSha: string | null,
  buildNumber: number | null,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, SourceEvidence> {
  const azure = azureLinkConfig(project, env);
  const registry = artifact?.registry || dockerBlock?.registry || azure.registry || null;
  const repository = artifact?.repository || dockerBlock?.repository || azure.imageRepository || null;
  const tag = artifact?.tag || dockerBlock?.published_tag || null;
  const digest = artifact?.digest || dockerBlock?.digest || null;
  const imageBuilt = !!(dockerBlock || artifact);
  return {
    PUBLISHED_IMAGE: publishedImageEvidence({
      publishedReference: dockerBlock?.published_reference,
      registry, repository, tag, digest,
      buildNumber, commitSha,
    }),
    IMAGE_DIGEST: evidence({
      provider: 'ACR',
      kind: 'IMAGE_DIGEST',
      label: 'Empreinte de l’image (digest)',
      sourcePath: digest,
      commitSha,
      buildNumber,
      reason: 'Aucun digest d’image enregistré : la publication n’a pas été constatée par la plateforme.',
    }),
    DOCKERFILE: imageBuilt
      ? dockerfileEvidence({
        repo: project.githubRepo,
        commitSha,
        dockerfilePath: project.dockerfilePath || PLATFORM_DEFAULT_DOCKERFILE,
      })
      : evidence({
        provider: 'GITHUB',
        kind: 'DOCKERFILE',
        label: 'Voir le Dockerfile',
        reason: 'Aucune construction d’image constatée sur ce build : aucun Dockerfile à désigner comme source.',
      }),
    ACR_IMAGE: (() => {
      const registryName = String(registry || '').replace(/\.azurecr\.io$/i, '');
      const resource = azureResourceEvidence({
        provider: 'ACR', subscriptionRef: azure.subscriptionRef,
        resourceGroup: azure.resourceGroup,
        resourceProvider: 'Microsoft.ContainerRegistry', resourceType: 'registries',
        resourceName: registryName, kind: 'ACR_IMAGE', label: 'Voir l’image dans Azure',
      });
      const resourceId = resource.url?.split('/#@/resource')[1]?.replace(/\/overview$/, '');
      return evidence({
        provider: 'ACR', kind: 'ACR_IMAGE', label: 'Voir l’image dans Azure',
        url: resourceId && repository && (digest || tag)
          ? `https://portal.azure.com/#view/Microsoft_Azure_ContainerRegistries/RepositoryBlade/id/${encodeURIComponent(resourceId)}/repository/${encodeURIComponent(repository)}`
          : null,
        sourcePath: repository ? [registry, repository].filter(Boolean).join('/') : null,
        reason: !resourceId ? resource.reason : 'Aucune image publiée identifiée pour ce build.',
        buildNumber, commitSha, evidenceId: digest || tag,
      });
    })(),
    ACR_REGISTRY: azureResourceEvidence({
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

/** Fusionne la configuration Azure du projet avec l'identifiant d'abonnement par défaut de la plateforme. */
function azureLinkConfig(project: ProjectEvidenceRow, env: NodeJS.ProcessEnv): Record<string, any> {
  const azure = project.azureConfig || {};
  return { ...azure, subscriptionRef: azure.subscriptionRef || env.AZURE_PORTAL_SUBSCRIPTION_ID || null };
}

/** Construit les emplacements de preuve Azure (cible de déploiement, groupe de ressources) pour ce projet. */
function azureSlots(project: ProjectEvidenceRow, env: NodeJS.ProcessEnv = process.env): Record<string, SourceEvidence> {
  const azure = azureLinkConfig(project, env);
  const subscription = String(azure.subscriptionRef || '');
  const group = String(azure.resourceGroup || '');
  const groupUrl = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscription) && group
    ? `https://portal.azure.com/#@/resource/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(group)}/overview`
    : null;
  return {
    AZURE_TARGET: azureResourceEvidence({
      subscriptionRef: azure.subscriptionRef,
      resourceGroup: azure.resourceGroup,
      resourceProvider: 'Microsoft.ContainerInstance',
      resourceType: 'containerGroups',
      resourceName: azure.targetName,
      kind: 'AZURE_TARGET',
      label: 'Voir la cible dans Azure',
      sourcePathOverride: azure.targetName || null,
    }),
    AZURE_RESOURCE_GROUP: evidence({
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

export interface ProjectSourceEvidence {
  projectId: string;
  projectName: string;
  generatedAt: string;
  jenkinsBaseUrl?: string | null;
  slots: Record<string, SourceEvidence>;
  sections: EvidenceSection[];
}

/** Assemble la table de preuve complète d'un projet (code, CI, analyses, image, déploiement) à partir de ses dernières données persistées. */
export function buildProjectEvidence(input: {
  project: ProjectEvidenceRow;
  latest: { buildNumber?: number | null; metadata?: Record<string, any> | null } | null;
  latestReported?: { buildNumber?: number | null; metadata?: Record<string, any> | null } | null;
  artifact: ArtifactEvidenceRow | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): ProjectSourceEvidence {
  const { project } = input;
  const cfg = evidenceEnv(project, input.env || process.env);
  const enriched = input.latest?.metadata?.enrichedData || {};
  const buildBlock = enriched.build || null;
  const buildNumber = input.latest?.buildNumber ?? buildBlock?.number ?? null;
  const commitSha = input.latest?.metadata?.sourceCommitSha || input.artifact?.commitSha || null;

  const slots: Record<string, SourceEvidence> = {
    SONAR_PROJECT: sonarProjectEvidence({ baseUrl: cfg.sonarBaseUrl, projectKey: project.sonarqubeKey }),
    JENKINS_JOB: jenkinsJobEvidence({ baseUrl: cfg.jenkinsBaseUrl, jobPath: jobPathOf(project) }),
    JENKINS_LATEST_BUILD: jenkinsBuildEvidence({
      baseUrl: cfg.jenkinsBaseUrl,
      jobPath: jobPathOf(project),
      buildNumber,
      recordedBuildUrl: buildBlock?.url,
      label: 'Voir le dernier build Jenkins',
    }),
    GIT_REPOSITORY: repositoryEvidence(project.githubRepo),
    GIT_COMMIT: commitEvidence({ repo: project.githubRepo, commitSha, label: 'Voir le commit analysé' }),
    ...scannerSlots(
      project,
      recordedReportPaths(input.latestReported) || recordedReportPaths(input.latest),
      enriched.zap || null,
    ),
    ZAP_TARGET: zapTargetSlot(enriched.zap || null),
    ...dockerSlots(project, enriched.docker || null, input.artifact, commitSha, buildNumber, input.env || process.env),
    ...azureSlots(project, input.env || process.env),
  };

  slots.JENKINS_LATEST_BUILD_LOGS = jenkinsConsoleEvidence(slots.JENKINS_LATEST_BUILD, 'Voir le journal du dernier build');

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

/** Assemble la table de preuve complète d'un incident : origine, scanners, correction WF2, validation WF3, image, déploiement, plus le détail par issue Sonar/finding/remédiation. */
export function buildIncidentEvidence(input: {
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
}): IncidentSourceEvidence {
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
    ? rebaseOnto(cfg.sonarBaseUrl, validation.sonar.dashboard_url)
    : null;

  const slots: Record<string, SourceEvidence> = {
    JENKINS_BUILD: jenkinsBuildEvidence({
      baseUrl: cfg.jenkinsBaseUrl,
      jobPath: jobPathOf(project) || incident.jenkinsJobName,
      buildNumber,
      recordedBuildUrl: buildBlock?.url || metadata.buildUrl || metadata.build_url,
      label: 'Voir le build Jenkins d’origine',
    }),
    GIT_REPOSITORY: repositoryEvidence(project.githubRepo),
    GIT_COMMIT: commitEvidence({ repo: project.githubRepo, commitSha, label: 'Voir le commit analysé' }),
    SONAR_PROJECT: recordedSonarDashboard
      ? evidence({
        provider: 'SONARQUBE', kind: 'SONAR_PROJECT', label: 'Voir dans SonarQube',
        url: recordedSonarDashboard, sourcePath: sonarKeyForIncident, evidenceId: sonarKeyForIncident,
      })
      : sonarProjectEvidence({ baseUrl: cfg.sonarBaseUrl, projectKey: sonarKeyForIncident }),
    ...scannerSlots(project, recordedReports, enriched.zap || null),
    ZAP_TARGET: zapTargetSlot(enriched.zap || null),
    ...dockerSlots(project, enriched.docker || null, input.artifact, commitSha, buildNumber, env),
    ...azureSlots(project, env),

    FIX_PULL_REQUEST: pullRequestEvidence({
      prUrl: incident.prUrl,
      repo: project.githubRepo,
      kind: 'FIX_PULL_REQUEST',
      label: 'Voir la Pull Request de correction',
    }),
    FIX_N8N_EXECUTION: n8nExecutionEvidence({
      baseUrl: cfg.n8nBaseUrl,
      workflowId: metadata.workflowId || cfg.wf2WorkflowId,
      executionId: metadata.workflowExecutionId,
      label: 'Voir l’exécution n8n de la correction',
    }),

    VALIDATION_PULL_REQUEST: pullRequestEvidence({
      prUrl: validation.prUrl || validation.pull_request,
      prNumber: validation.prNumber,
      repo: project.githubRepo,
      kind: 'VALIDATION_PULL_REQUEST',
      label: 'Voir la Pull Request validée',
    }),
    VALIDATION_BUILD: jenkinsBuildEvidence({
      baseUrl: cfg.jenkinsBaseUrl,
      jobPath: validationJobPath,
      buildNumber: validation.jenkinsBuildNumber ?? validation.buildNumber ?? validation.build_number,
      recordedBuildUrl: validation.jenkinsBuildUrl || validation.buildUrl || validation.build_url,
      label: 'Voir le build de validation',
    }),
    VALIDATION_COMMIT: commitEvidence({
      repo: project.githubRepo,
      commitSha: validation.checkoutSha || validation.expectedPrHeadSha || validation.commit,
      kind: 'VALIDATION_COMMIT',
      label: 'Voir le commit validé',
    }),
    VALIDATION_LOGS: evidence({
      provider: 'JENKINS',
      kind: 'VALIDATION_LOGS',
      label: 'Journal du build de validation',
      url: cfg.jenkinsBaseUrl ? rebaseOnto(cfg.jenkinsBaseUrl, validation.logs_url) : null,
      sourcePath: validation.logs_url ? 'consoleText' : null,
      reason: 'Aucun journal de build enregistré pour cette validation.',
    }),
  };

  slots.JENKINS_BUILD_LOGS = jenkinsConsoleEvidence(slots.JENKINS_BUILD, 'Voir le journal du build d’origine');

  const sonarIssues: SonarIssueEvidence[] = (Array.isArray(enriched.sonar?.issues) ? enriched.sonar.issues : [])
    .map((issue: any): SonarIssueEvidence => {
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
          SONAR_ISSUE: sonarIssueEvidence({
            baseUrl: cfg.sonarBaseUrl,
            projectKey: project.sonarqubeKey,
            issueKey: issueId,
            rule,
          }),
          SONAR_RULE: sonarRuleEvidence({ baseUrl: cfg.sonarBaseUrl, rule }),
          GIT_FILE: fileEvidence({
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

  const findings: FindingEvidence[] = [];
  for (const scanner of ['trivy', 'owasp'] as const) {
    const cves = Array.isArray(enriched[scanner]?.cves) ? enriched[scanner].cves : [];
    const provider = scanner.toUpperCase() as 'TRIVY' | 'OWASP';
    for (const cve of cves) {
      const findingId = String(cve?.id || '').trim();
      if (!findingId) continue;
      findings.push({
        findingId,
        scanner: provider,
        slots: {
          ADVISORY: advisoryEvidence({ reference: findingId, primaryUrl: cve?.primaryUrl, provider }),
          REPORT: slots[`${provider}_REPORT`],
        },
      });
    }
  }
  for (const alert of (Array.isArray(enriched.zap?.alerts) ? enriched.zap.alerts : [])) {
    const findingId = String(alert?.id || alert?.pluginId || '').trim();
    if (!findingId) continue;
    findings.push({
      findingId,
      scanner: 'ZAP',
      slots: {
        ADVISORY: evidence({
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
    remediations: input.remediationTasks.map(task =>
      buildRemediationEvidence({ project, task, cfg, commitSha, buildNumber: buildNumber ?? null })),
  };
}

/** Assemble la chaîne de preuve complète d'une remédiation automatique : constat d'origine, fichier concerné, candidat vérifié, exécution n8n et Pull Request finale. */
export function buildRemediationEvidence(input: {
  project: ProjectEvidenceRow;
  task: RemediationEvidenceRow;
  cfg: EvidenceEnv;
  commitSha: string | null;
  buildNumber: number | null;
}): RemediationChainEvidence {
  const { project, task, cfg } = input;
  const remediation = task.securityFindingRemediation || {};
  const attempts = Array.isArray(remediation.attempts) ? remediation.attempts : [];
  const last: Record<string, any> = attempts.length ? attempts[attempts.length - 1] : {};
  const snapshot = task.findingSnapshot || {};
  const scanner = String(task.source || snapshot.source || '').toUpperCase() || null;
  const patch = last.patchEvidence || {};

  const slots: Record<string, SourceEvidence> = {
    ORIGINAL_FINDING: scanner === 'SONARQUBE'
      ? sonarIssueEvidence({
        baseUrl: cfg.sonarBaseUrl,
        projectKey: project.sonarqubeKey,
        issueKey: task.findingId || snapshot.id,
        rule: snapshot.rule || task.ruleOrCve,
      })
      : advisoryEvidence({
        reference: task.ruleOrCve || snapshot.ref || snapshot.id,
        primaryUrl: snapshot.primaryUrl,
        provider: scanner === 'OWASP' ? 'OWASP' : 'TRIVY',
      }),
    ORIGINAL_BUILD: jenkinsBuildEvidence({
      baseUrl: cfg.jenkinsBaseUrl,
      jobPath: jobPathOf(project),
      buildNumber: input.buildNumber,
      label: 'Voir le build du constat',
    }),
    CONTROLLING_FILE: fileEvidence({
      repo: project.githubRepo,
      commitSha: input.commitSha,
      filePath: patch.controllingFile,
      kind: 'CONTROLLING_FILE',
      label: 'Voir le fichier d’origine',
    }),
    CANDIDATE_COMMIT: commitEvidence({
      repo: project.githubRepo,
      commitSha: last.candidateSha || last.evaluatedSha,
      kind: 'CANDIDATE_COMMIT',
      label: 'Voir le commit candidat',
    }),
    CANDIDATE_EXECUTION: n8nExecutionEvidence({
      baseUrl: cfg.n8nBaseUrl,
      workflowId: last.workflowId || cfg.wf6WorkflowId,
      executionId: last.executionId,
      label: 'Voir l’exécution n8n de la correction',
    }),
    PULL_REQUEST: pullRequestEvidence({
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
