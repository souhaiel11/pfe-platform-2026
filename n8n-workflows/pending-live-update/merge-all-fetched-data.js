const PLACEHOLDER = /(not[_ -]?run|not[_ -]?run[_ -]?yet|missing|unreachable|failed|error|skipped|placeholder)/i;
const okArray = (v) => Array.isArray(v);
const upper = (v) => String(v || '').toUpperCase();
const count = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

const nodeResult = (nodeName) => {
  try {
    const item = $(nodeName).first();
    const raw = item?.json?.data && typeof item.json.data === 'object' ? item.json.data : item?.json;
    if (!raw) {
      return { data: null, executed: false, malformed: false, error: null };
    }
    if (typeof raw !== 'object' || Array.isArray(raw) || raw.error || raw.errors) {
      return { data: null, executed: true, malformed: true, error: raw?.error || raw?.errors || 'Invalid scanner response' };
    }
    return { data: raw, executed: true, malformed: false, error: null };
  } catch (e) {
    return { data: null, executed: false, malformed: false, error: e.message };
  }
};

const classify = ({ enabled, executed, valid, findingCount, marker, technicalError }) => {
  if (!enabled) return 'NOT_RUN';
  if (!executed) return 'MISSING';
  if (technicalError || (marker && PLACEHOLDER.test(marker))) return 'FAILED';
  if (!valid) return 'FAILED';
  return findingCount > 0 ? 'COMPLETED_WITH_FINDINGS' : 'COMPLETED_ZERO_FINDINGS';
};
const legacyStatus = (state) => state.startsWith('COMPLETED_') ? 'COMPLETED' : state;
const remediationType = ({ source, severity, file, type }) => {
  const src = upper(source); const sev = upper(severity); const kind = upper(type);
  const identifiable = typeof file === 'string' && file.trim().length > 0;
  const codeFinding = src === 'SONARQUBE' && ['BUG','VULNERABILITY','CODE_SMELL'].includes(kind);
  return identifiable && codeFinding && ['CRITICAL','MAJOR'].includes(sev)
    ? 'AUTO_FIX_ELIGIBLE' : 'DEVELOPER_ACTION_REQUIRED';
};
const isBlockingSeverity = (severity) => ['BLOCKER','CRITICAL'].includes(upper(severity));

// ── Vérité scanner orthogonale au statut (ticket QA-WF1-SCANNER-DIAGNOSTIC-HARDENING) ──
// Miroir de la table de repli backend/src/common/scanner-diagnostics.ts::deriveScannerTruth
// (même sémantique, dupliquée ici car n8n ne peut pas importer le module TS backend).
// Ne fabrique jamais un findingCount pour un scan non complété : 0 = "complété, rien
// trouvé", null = "inconnu" (§5/§6 du ticket). MISSING/FAILED démarrent à executed=null
// (incertitude honnête) ; passé à true seulement si un signal brut existe (§6).
const truthFromState = (state, realFindingCount) => {
  switch (state) {
    case 'NOT_RUN': return { executed: false, completed: false, resultAvailable: false, findingCount: null };
    case 'COMPLETED_ZERO_FINDINGS': return { executed: true, completed: true, resultAvailable: true, findingCount: 0 };
    case 'COMPLETED_WITH_FINDINGS': return { executed: true, completed: true, resultAvailable: true, findingCount: realFindingCount ?? null };
    case 'MISSING':
    case 'FAILED':
      return { executed: null, completed: false, resultAvailable: false, findingCount: null };
    default:
      return { executed: null, completed: false, resultAvailable: false, findingCount: null };
  }
};
const hasSignal = (obj) => !!obj && typeof obj === 'object' && Object.keys(obj).length > 0;
// N'attribue un technicalCode QUE si un signal brut existe (webhook Jenkins ou réponse
// d'erreur réelle) — jamais sur la seule absence de fichier ("no file found"/"binary
// file 'data'"), qui est un artefact de plomberie n8n (readWriteFile/extractFromFile),
// pas une preuve que le scanner a démarré (cf. §9 : ne pas afficher binary-file-missing
// comme cause principale quand ce n'est pas la preuve la plus riche disponible).
const detectTechnicalCode = (text) => {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (/credential|unauthorized|forbidden|\b401\b|\b403\b|nvd[_ -]?api[_ -]?key|api[_ -]?key.*(invalid|missing|rejected|expired)/.test(t)) return 'SCANNER_CREDENTIAL_INVALID';
  if (/context deadline exceeded|deadline exceeded|\btimeout\b|timed out/.test(t)) return 'SCANNER_TIMEOUT';
  if (/database.*download|db.*download.*(fail|error)|vulnerability database/.test(t)) return 'SCANNER_DATABASE_DOWNLOAD_FAILED';
  if (/econnrefused|enotfound|\bdns\b|connection refused|network (error|failure)/.test(t)) return 'NETWORK_FAILURE';
  if (/enomem|out of memory|no space left|disk (full|space)/.test(t)) return 'RESOURCE_FAILURE';
  if (/no file\(s\) found|binary file .* not found|report (not found|unavailable|missing)/.test(t)) return 'SCANNER_REPORT_MISSING';
  return null;
};
const TECHNICAL_CODE_META = {
  SCANNER_CREDENTIAL_INVALID: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'ADMIN_ACTION_REQUIRED' },
  SCANNER_TIMEOUT: { problemClass: 'FIXABLE_CONFIGURATION', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
  SCANNER_DATABASE_DOWNLOAD_FAILED: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
  NETWORK_FAILURE: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
  RESOURCE_FAILURE: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
  SCANNER_REPORT_MISSING: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
  // ZAP : mésappariement de topologie Docker/Jenkins (DinD vs réseau hôte) — infra hors
  // dépôt analysé, pas un défaut applicatif. Jamais auto-routé (§3/§10 : NOT_APPLICATION_DEFECT).
  DOCKER_CONFIGURATION_ERROR: { problemClass: 'FIXABLE_CONFIGURATION', owner: 'INFRASTRUCTURE/ADMIN', route: 'ADMIN_ACTION_REQUIRED' },
  TARGET_UNAVAILABLE: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
  // ZAP (voie Kubernetes, ex. pfe-app-test) : kubectl absent/injoignable côté agent Jenkins --
  // même famille que TARGET_UNAVAILABLE (infra hors dépôt analysé) mais mécanisme distinct
  // (pas de mésappariement réseau Docker/DinD ici, l'outil kubectl lui-même manque). Jamais
  // auto-routé, même logique que TARGET_UNAVAILABLE.
  K8S_TARGET_UNREACHABLE: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
  // Sonar : analyse soumise, corrélation ceTaskId jamais faite côté Jenkins — dette de
  // timing/retry dans le Jenkinsfile, donc WF4-éligible (agent), pas un défaut de code.
  SONAR_CE_TASK_ID_MISSING: { problemClass: 'FIXABLE_CONFIGURATION', owner: 'agent', route: 'WF4' },
  // ZAP (voie Kubernetes) : le pod zap-scan-<build> a été créé (kubectl fonctionnel,
  // scan/spider lancés) mais a disparu avant la fin du scan -- kubectl logs/cp
  // retournent "pod not found", rapport stub zap_report_missing. Mécanisme distinct de
  // K8S_TARGET_UNREACHABLE (ici kubectl ET la cible ont fonctionné, seul le pod de scan a
  // disparu en cours de route -- éviction/terminaison Kubernetes probable, jamais
  // affirmée sans preuve directe -- QA-BUILD-132-FINAL-ANALYSIS-HARDENING-R1 §3). Jamais
  // auto-routé, jamais imputé à l'application.
  ZAP_SCAN_POD_DISAPPEARED: { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' },
};
const truthFromCode = (code, evidence) => {
  if (!code) return { technicalCode: null, problemClass: null, owner: null, evidence: [], route: 'NONE' };
  const meta = TECHNICAL_CODE_META[code] || { problemClass: 'TECHNICAL_BLOCKER', owner: 'INFRASTRUCTURE/ADMIN', route: 'NONE' };
  return { technicalCode: code, problemClass: meta.problemClass, owner: meta.owner, evidence: (evidence || []).filter(Boolean), route: meta.route };
};

const incident = $('Extract Project Config').first().json || {};
const jenkins = incident.jenkins || {};
const reports = incident.reports || jenkins.reports || {};
const available = reports.available || {};
const projectConfig = incident.projectConfig || {};

// ── Portée réelle déclarée par Jenkins (finalisation §1) ──────────────────
// PREUVE (n8n execution #1866, build #11) : le webhook Jenkins envoie
// `requiredStages: ['build','tests','sonar','trivy','owasp','zap','docker']`
// — Jenkins déclare LUI-MÊME trivy/owasp/zap comme requis pour ce pipeline.
// Mais `Normalize Incident Payload` ne lit jamais ce champ (confirmé : absent
// de son code et de sa sortie), donc `Extract Project Config` retombe sur
// projectConfig.<scanner>Enabled — qui n'est PAS une configuration projet
// (Lookup Project/l'entité Project n'a aucun champ de ce nom) mais un calcul
// dérivé de `reportsAvailable.X || XData.report_path/report_url` : "a-t-on
// reçu un pointeur de rapport dans CE webhook", pas "ce scanner est-il
// activé". Quand Jenkins ne renvoie ni `body.trivy` ni `body.owasp` ni
// `body.reports` (le cas sur build #11), ce proxy vaut toujours false — et
// classify() le lit comme "définitivement jamais exécuté" (executed=false),
// alors que la vérité est "aucune preuve exploitable" (executed=null).
// Fix : lire `requiredStages` directement depuis le node webhook d'origine
// (contourne la perte côté Normalize), et l'utiliser comme signal de portée
// prioritaire quand disponible — repli sur l'ancien proxy sinon (payloads/
// chemins d'exécution antérieurs à ce champ, ex. Normalize status BLOCKED/
// RESOLVED qui ne portent pas forcément un body Jenkins frais).
let rawWebhookBody = {};
try { rawWebhookBody = $('Incident Webhook').first()?.json?.body || {}; } catch (e) {}
const requiredStagesList = Array.isArray(rawWebhookBody.requiredStages)
  ? rawWebhookBody.requiredStages.map((s) => String(s).toLowerCase())
  : null;
const inScope = (name, legacyFallback) => (requiredStagesList ? requiredStagesList.includes(name) : legacyFallback);
// zapState/sonarQualityGate : seuls champs où Jenkins envoie un statut par-scanner
// explicite et de première main (pas de trivyState/owaspState équivalent constaté
// à ce jour — instrumentation Jenkinsfile incomplète pour ces deux-là). Quand
// présent, ce signal est AUTORITAIRE (Jenkins l'affirme lui-même), prioritaire
// sur toute déduction locale.
const explicitScannerState = (key) => {
  const v = rawWebhookBody[key];
  return typeof v === 'string' && v ? upper(v) : null;
};
const incidentUUID = $('Prepare Fetch URLs').first()?.json?.incidentUUID || null;

let sonarRaw = {};
let sonarFetchError = null;
try { sonarRaw = $('Fetch SonarQube Issues').first()?.json || {}; }
catch (e) { sonarFetchError = e.message; }
const sonarHttp = count(sonarRaw?.statusCode || sonarRaw?.httpCode || sonarRaw?.error?.statusCode);
const sonarValid = okArray(sonarRaw?.issues) && Number.isFinite(Number(sonarRaw?.total));
const sonarTechnicalError = !!sonarFetchError || !!sonarRaw?.error || okArray(sonarRaw?.errors) || [401,403,404].includes(sonarHttp) || sonarHttp >= 500;
const sonarIssues = sonarValid ? sonarRaw.issues : [];
const sonarState = classify({ enabled: !!projectConfig.sonarqubeKey, executed: !!sonarRaw && Object.keys(sonarRaw).length > 0, valid: sonarValid, findingCount: sonarIssues.length, marker: sonarRaw?.status, technicalError: sonarTechnicalError });

let gateRaw = {}; let gateFetchError = null;
try { gateRaw = $('Resolve Exact Sonar Correlation').first()?.json || {}; }
catch (e) { gateFetchError = e.message; }
const gateStatus = upper(gateRaw?.qualityGate || gateRaw?.projectStatus?.status);
const gateHttp = count(gateRaw?.statusCode || gateRaw?.httpCode || gateRaw?.error?.statusCode);
const gateText = JSON.stringify(gateRaw?.error || gateRaw?.errors || gateFetchError || '');
let qualityGate = 'QUALITY_GATE_NOT_COMPUTED';
if (!projectConfig.sonarqubeKey || gateHttp === 404 || /project.*(not found|does not exist)|not found.*project/i.test(gateText)) qualityGate = 'QUALITY_GATE_UNAVAILABLE';
else if (gateFetchError || [401,403].includes(gateHttp) || gateHttp >= 500 || gateRaw?.error || okArray(gateRaw?.errors)) qualityGate = 'API_ERROR';
else if (['OK','ERROR','SONAR_ANALYSIS_FAILED','SONAR_ANALYSIS_CANCELED','SONAR_ANALYSIS_TIMEOUT','API_ERROR','QUALITY_GATE_UNAVAILABLE','QUALITY_GATE_NOT_COMPUTED'].includes(gateStatus)) qualityGate = gateStatus;

const sonarFindings = sonarIssues.map((i, index) => {
  const file = String(i.component || '').includes(':') ? String(i.component).split(':').slice(1).join(':') : (i.component || null);
  const finding = { id: i.key || `sonar-${index}`, stage: 'sonar', source: 'SONARQUBE', severity: upper(i.severity), category: i.type || null, title: i.message || i.rule || 'SonarQube finding', message: i.message || null, description: i.message || null, file, line: i.line || i.textRange?.startLine || null, rule: i.rule || null, recommendation: null, evidence: i.key || null };
  return { ...finding, blocking: isBlockingSeverity(finding.severity), remediationType: remediationType({ ...finding, type: i.type }) };
});
// Sonar seul : deux étapes distinctes — (1) l'analyse soumise au serveur Sonar
// (prouvée par un appel Issues API structurellement valide, sonarValid), (2) la
// corrélation ceTaskId → quality gate côté Jenkins (prouvée par qualityGate ∈
// {OK,ERROR}). Les deux peuvent diverger (évidence confirmée : appel corrélation
// répond 400 "Valid ceTaskId is required" alors que l'analyse elle-même est bien
// indexée) — ne JAMAIS les fusionner dans un seul "completed" sans distinction.
const sonarCeTaskIdAbsent = !gateRaw?.ceTaskId && !incident.jenkins?.sonar?.ceTaskId && !rawWebhookBody.ceTaskId;
const sonarAnalysisSubmitted = sonarValid;
const sonarQualityGateResolved = ['OK','ERROR'].includes(qualityGate);
const sonarCeTaskMissing = sonarAnalysisSubmitted && !sonarQualityGateResolved && (sonarCeTaskIdAbsent || /cetaskid/i.test(gateText));
const sonarTechCode = sonarCeTaskMissing
  ? 'SONAR_CE_TASK_ID_MISSING'
  : (sonarAnalysisSubmitted && !sonarQualityGateResolved ? detectTechnicalCode(gateText) : null);
const sonarTruth = truthFromCode(sonarTechCode, [
  sonarAnalysisSubmitted ? `Sonar Issues API a retourné une réponse valide (${count(sonarRaw.total)} issue(s) au total) — l'analyse est bien indexée côté serveur.` : null,
  gateText && gateText !== '""' ? `Appel de corrélation quality gate : ${gateText}` : null,
  sonarCeTaskIdAbsent ? 'Aucun ceTaskId disponible côté Jenkins au moment de la corrélation.' : null,
]);
// completed=false tant que les DEUX étapes n'ont pas positivement réussi : un
// "0 issue" sur une analyse dont le quality gate n'est pas résolu n'est jamais
// un résultat de confiance (§5 — false zero findings, confirmé sur build #11 :
// scanState disait COMPLETED_ZERO_FINDINGS avec quality_gate=API_ERROR).
const sonarCompleted = sonarAnalysisSubmitted && sonarQualityGateResolved;
const sonarResultAvailable = sonarCompleted;
// QA-BUILD-132-FINAL-ANALYSIS-HARDENING-R1 §2 : findingsAvailable distingue
// "les issues Sonar existent et sont exploitables" (preuve : Issues API valide,
// sonarAnalysisSubmitted) de resultAvailable ("la corrélation quality gate est
// résolue") — les deux sont vraies indépendamment, ne jamais les confondre.
// findingCount doit refléter les 18 issues réellement récupérées même quand la
// quality gate reste non résolue (ancien bug : findingCount=null alors que
// issues.length=18 dans le même objet).
const sonarFindingsAvailable = sonarAnalysisSubmitted;
const sonarFindingCount = sonarFindingsAvailable ? sonarIssues.length : null;
const sonar = { status: legacyStatus(sonarState), scanState: sonarState, ceTaskId: gateRaw?.ceTaskId || incident.jenkins?.sonar?.ceTaskId || rawWebhookBody.ceTaskId || null, analysisId: gateRaw?.analysisId || incident.jenkins?.sonar?.analysisId || rawWebhookBody.analysisId || null, correlationVerified: gateRaw?.correlationVerified === true, quality_gate: qualityGate, bugs: sonarIssues.filter(i=>i.type==='BUG').length, vulnerabilities: sonarIssues.filter(i=>i.type==='VULNERABILITY').length, code_smells: sonarIssues.filter(i=>i.type==='CODE_SMELL').length, coverage: count(sonarRaw.coverage), issues_count: sonarValid ? count(sonarRaw.total) : 0, issues: sonarFindings, error: sonarState.startsWith('COMPLETED_') ? '' : (sonarFetchError || gateFetchError || 'Sonar result unavailable'), analysisSubmitted: sonarAnalysisSubmitted, qualityGateResolved: sonarQualityGateResolved, findingsAvailable: sonarFindingsAvailable, executed: sonarAnalysisSubmitted || null, completed: sonarCompleted, resultAvailable: sonarResultAvailable, findingCount: sonarFindingCount, ...sonarTruth };

const parse = { trivy: nodeResult('Parse Trivy JSON'), zap: nodeResult('Parse ZAP JSON'), owasp: nodeResult('Parse OWASP JSON') };
const webhookTrivy = jenkins.trivy || {}; const webhookZap = jenkins.zap || {}; const webhookOwasp = jenkins.owasp || {};

const trivyRaw = parse.trivy.data;
const trivyValidFile = !!trivyRaw && okArray(trivyRaw.Results) && !PLACEHOLDER.test(String(trivyRaw.status || ''));
let trivyCves = [];
if (trivyValidFile) for (const r of trivyRaw.Results) for (const v of (r.Vulnerabilities || [])) if (['CRITICAL','HIGH','MEDIUM'].includes(upper(v.Severity))) {
  const f = { id:v.VulnerabilityID, stage:'trivy', source:'TRIVY', severity:upper(v.Severity), category:'VULNERABILITY', title:(v.Title||v.VulnerabilityID||'Trivy finding').substring(0,120), description:(v.Description||'').substring(0,400), file:null, line:null, package:v.PkgName||null, dependency:v.PkgName||null, cve:v.VulnerabilityID||null, recommendation:v.FixedVersion ? `Upgrade to ${v.FixedVersion}` : null, evidence:v.PrimaryURL||null, installedVersion:v.InstalledVersion||null, fixedVersion:v.FixedVersion||null, primaryUrl:v.PrimaryURL||null, cvss:v.CVSS?.nvd?.V3Score ?? v.CVSS?.redhat?.V3Score ?? null };
  trivyCves.push({ ...f, pkg:f.package, blocking:f.severity==='CRITICAL', remediationType:'DEVELOPER_ACTION_REQUIRED' });
}
const trivyWebhookCount = count(webhookTrivy.critical)+count(webhookTrivy.high)+(okArray(webhookTrivy.cves)?webhookTrivy.cves.length:0);
const trivyWebhookValid = ['SUCCESS','PASSED','COMPLETED'].includes(upper(webhookTrivy.status)) || trivyWebhookCount>0;
if (!trivyValidFile && trivyWebhookValid && okArray(webhookTrivy.cves)) trivyCves = webhookTrivy.cves.map((v,i)=>({ ...v, id:v.id||`trivy-webhook-${i}`, stage:'trivy', source:'TRIVY', blocking:upper(v.severity)==='CRITICAL', remediationType:'DEVELOPER_ACTION_REQUIRED' }));
const trivyLegacyEnabled = available.trivy !== false && (projectConfig.trivyEnabled !== false);
const trivyInScope = inScope('trivy', trivyLegacyEnabled);
const trivyState = classify({ enabled: trivyInScope, executed: parse.trivy.executed || trivyWebhookValid, valid: trivyValidFile || trivyWebhookValid, findingCount: trivyValidFile ? trivyCves.length : trivyWebhookCount, marker: trivyRaw?.status || webhookTrivy.status, technicalError: parse.trivy.malformed || (!!parse.trivy.error && parse.trivy.executed) });
// technicalCode UNIQUEMENT si Jenkins a lui-même rapporté un signal sur trivy
// (webhookTrivy non vide) — l'erreur de plomberie n8n seule ("no file found")
// ne prouve pas que le scanner a démarré (§6/§9 : executed=null si pas de preuve).
const trivyHasSignal = hasSignal(webhookTrivy);
const trivyEvidenceText = [webhookTrivy.message, webhookTrivy.error, webhookTrivy.status, webhookTrivy.state, trivyHasSignal ? null : parse.trivy.error].filter(Boolean).join(' | ');
// Priorité (finalisation R1 §3) : diagnostic producteur structuré (posé
// directement par le Jenkinsfile — preuve de première main, plus fiable que
// toute re-déduction locale) > détection texte générique > incertitude
// honnête. webhookTrivy.technicalCode/executed/completed/resultAvailable
// n'existent que sur les payloads produits par un Jenkinsfile à jour ;
// absents sur les payloads antérieurs (repli sur l'ancien comportement).
const trivyStructuredCode = typeof webhookTrivy.technicalCode === 'string' && webhookTrivy.technicalCode ? webhookTrivy.technicalCode : null;
const trivyTechCode = trivyStructuredCode || ((trivyState === 'FAILED' || trivyState === 'MISSING') ? detectTechnicalCode(trivyEvidenceText) : null);
const trivyTruthBase = truthFromState(trivyState, trivyCves.length || trivyWebhookCount);
const trivyTruth = truthFromCode(trivyTechCode, [trivyEvidenceText || null]);
const trivyStructExecuted = typeof webhookTrivy.executed === 'boolean' ? webhookTrivy.executed : null;
const trivyStructCompleted = typeof webhookTrivy.completed === 'boolean' ? webhookTrivy.completed : null;
const trivyStructResultAvailable = typeof webhookTrivy.resultAvailable === 'boolean' ? webhookTrivy.resultAvailable : null;
const trivyExecuted = trivyStructExecuted !== null ? trivyStructExecuted : (trivyTruthBase.executed !== null ? trivyTruthBase.executed : (trivyHasSignal || !!trivyTechCode ? true : null));
const trivyCompleted = trivyStructCompleted !== null ? trivyStructCompleted : trivyTruthBase.completed;
const trivyResultAvailable = trivyStructResultAvailable !== null ? trivyStructResultAvailable : trivyTruthBase.resultAvailable;
const trivyFindingCount = trivyResultAvailable ? (trivyCves.length || trivyWebhookCount || 0) : null;
const trivy = { status:legacyStatus(trivyState), scanState:trivyState, critical:trivyCves.filter(v=>upper(v.severity)==='CRITICAL').length || count(webhookTrivy.critical), high:trivyCves.filter(v=>upper(v.severity)==='HIGH').length || count(webhookTrivy.high), cves_count:trivyCves.length || trivyWebhookCount, cves:trivyCves, _source:trivyValidFile?'local_file':(trivyWebhookValid?'webhook':'none'), error:trivyState.startsWith('COMPLETED_')?'':(parse.trivy.error||String(trivyRaw?.status||'Trivy report unavailable')), executed: trivyExecuted, completed: trivyCompleted, resultAvailable: trivyResultAvailable, findingCount: trivyFindingCount, ...trivyTruth };

const owaspRaw = parse.owasp.data;
const owaspValidFile = !!owaspRaw && okArray(owaspRaw.dependencies) && !PLACEHOLDER.test(String(owaspRaw.status || ''));
let owaspCves=[];
if (owaspValidFile) for (const dep of owaspRaw.dependencies) for (const v of (dep.vulnerabilities||[])) if (['CRITICAL','HIGH','MEDIUM'].includes(upper(v.severity))) {
  const sev=upper(v.severity); owaspCves.push({ id:v.name, stage:'owasp', source:'OWASP', severity:sev, category:'DEPENDENCY', title:v.name||'Dependency vulnerability', description:(v.description||'').substring(0,400), file:dep.fileName||null, line:null, package:dep.fileName||null, dependency:dep.fileName||null, cve:v.name||null, recommendation:null, evidence:v.references?.[0]?.url||null, pkg:dep.fileName, installedVersion:dep.version||null, fixedVersion:null, primaryUrl:v.references?.[0]?.url||null, cvss:v.cvssv3?.baseScore??v.cvssv2?.score??null, blocking:sev==='CRITICAL', remediationType:'DEVELOPER_ACTION_REQUIRED' });
}
const owaspWebhookCount=count(webhookOwasp.critical)+count(webhookOwasp.high)+(okArray(webhookOwasp.cves)?webhookOwasp.cves.length:0);
const owaspWebhookValid=['SUCCESS','PASSED','COMPLETED'].includes(upper(webhookOwasp.status))||owaspWebhookCount>0;
if (!owaspValidFile && owaspWebhookValid && okArray(webhookOwasp.cves)) owaspCves=webhookOwasp.cves.map((v,i)=>({ ...v,id:v.id||`owasp-webhook-${i}`,stage:'owasp',source:'OWASP',blocking:upper(v.severity)==='CRITICAL',remediationType:'DEVELOPER_ACTION_REQUIRED' }));
const owaspLegacyEnabled = available.owasp !== false && projectConfig.owaspEnabled !== false;
const owaspInScope = inScope('owasp', owaspLegacyEnabled);
const owaspState=classify({ enabled:owaspInScope, executed:parse.owasp.executed||owaspWebhookValid, valid:owaspValidFile||owaspWebhookValid, findingCount:owaspValidFile?owaspCves.length:owaspWebhookCount, marker:owaspRaw?.status||webhookOwasp.status, technicalError:parse.owasp.malformed||!!(parse.owasp.error&&parse.owasp.executed) });
// Ne JAMAIS logger/exposer une valeur de credential ici — seulement le texte
// d'erreur déjà renvoyé par Jenkins/NVD (ex: rejet 401/403), jamais la clé elle-même.
const owaspHasSignal = hasSignal(webhookOwasp);
const owaspEvidenceText = [webhookOwasp.message, webhookOwasp.error, webhookOwasp.status, webhookOwasp.state, owaspHasSignal ? null : parse.owasp.error].filter(Boolean).join(' | ');
// Priorité (finalisation R1 §3) : même patron que Trivy ci-dessus — le
// technicalCode/executed/completed/resultAvailable posés par le Jenkinsfile
// priment sur toute re-déduction locale quand présents.
const owaspStructuredCode = typeof webhookOwasp.technicalCode === 'string' && webhookOwasp.technicalCode ? webhookOwasp.technicalCode : null;
const owaspTechCode = owaspStructuredCode || ((owaspState === 'FAILED' || owaspState === 'MISSING') ? detectTechnicalCode(owaspEvidenceText) : null);
const owaspTruthBase = truthFromState(owaspState, owaspCves.length || owaspWebhookCount);
const owaspTruth = truthFromCode(owaspTechCode, [owaspEvidenceText || null]);
const owaspStructExecuted = typeof webhookOwasp.executed === 'boolean' ? webhookOwasp.executed : null;
const owaspStructCompleted = typeof webhookOwasp.completed === 'boolean' ? webhookOwasp.completed : null;
const owaspStructResultAvailable = typeof webhookOwasp.resultAvailable === 'boolean' ? webhookOwasp.resultAvailable : null;
const owaspExecuted = owaspStructExecuted !== null ? owaspStructExecuted : (owaspTruthBase.executed !== null ? owaspTruthBase.executed : (owaspHasSignal || !!owaspTechCode ? true : null));
const owaspCompleted = owaspStructCompleted !== null ? owaspStructCompleted : owaspTruthBase.completed;
const owaspResultAvailable = owaspStructResultAvailable !== null ? owaspStructResultAvailable : owaspTruthBase.resultAvailable;
const owaspFindingCount = owaspResultAvailable ? (owaspCves.length || owaspWebhookCount || 0) : null;
const owasp={ status:legacyStatus(owaspState),scanState:owaspState,critical:owaspCves.filter(v=>upper(v.severity)==='CRITICAL').length||count(webhookOwasp.critical),high:owaspCves.filter(v=>upper(v.severity)==='HIGH').length||count(webhookOwasp.high),cves_count:owaspCves.length||owaspWebhookCount,cves:owaspCves,_source:owaspValidFile?'local_file':(owaspWebhookValid?'webhook':'none'),error:owaspState.startsWith('COMPLETED_')?'':(parse.owasp.error||String(owaspRaw?.status||'OWASP report unavailable')), executed: owaspExecuted, completed: owaspCompleted, resultAvailable: owaspResultAvailable, findingCount: owaspFindingCount, ...owaspTruth };

const zapRaw=parse.zap.data;
const zapValidFile=!!zapRaw&&okArray(zapRaw.site)&&!PLACEHOLDER.test(String(zapRaw.status||''));
let zapAlerts=[];
if(zapValidFile) for(const site of zapRaw.site) for(const a of (site.alerts||[])){const risk=String(a.riskdesc||a.risk||'').split(' ')[0]; if(['High','Medium','Low'].includes(risk)) zapAlerts.push({id:a.pluginid||`zap-${zapAlerts.length}`,stage:'zap',source:'ZAP',severity:upper(risk),category:'DAST',title:a.name||'ZAP alert',message:a.desc||null,description:a.desc||null,file:null,line:null,recommendation:a.solution||null,evidence:a.reference||null,risk,blocking:risk==='High',remediationType:'DEVELOPER_ACTION_REQUIRED'});}
const zapWebhookCount=count(webhookZap.alerts_high)+count(webhookZap.alerts_medium)+count(webhookZap.alerts_low)+(okArray(webhookZap.alerts)?webhookZap.alerts.length:0);
const zapTargetUnavailable=['TARGET_UNAVAILABLE','FAILED_TECHNICAL'].includes(upper(webhookZap.state||webhookZap.status));
const zapTechnicalFinding=zapTargetUnavailable?{id:`zap-target-${jenkins.build_number||incident.build_number||'unknown'}`,stage:'zap',source:'ZAP',severity:'HIGH',category:'DAST_TECHNICAL',title:'ZAP target application unavailable',message:webhookZap.error||'Target application did not become ready',description:webhookZap.error||'Target application did not become ready',file:null,line:null,recommendation:'Review the captured application startup diagnostic before retrying DAST',evidence:webhookZap.diagnostic_url||webhookZap.diagnostic_path||null,rootCause:webhookZap.technical_evidence||webhookZap.error||'Application target unavailable',impact:'DAST could not execute; the dynamic security state is unknown',blocking:true,remediationType:'DEVELOPER_ACTION_REQUIRED'}:null;
const zapWebhookValid=['SUCCESS','PASSED','COMPLETED'].includes(upper(webhookZap.status))||zapWebhookCount>0;
if(!zapValidFile&&zapWebhookValid&&okArray(webhookZap.alerts)) zapAlerts=webhookZap.alerts.map((a,i)=>({...a,id:a.id||`zap-webhook-${i}`,stage:'zap',source:'ZAP',blocking:upper(a.severity||a.risk)==='HIGH',remediationType:'DEVELOPER_ACTION_REQUIRED'}));
const zapLegacyEnabled = available.zap !== false && projectConfig.zapEnabled !== false;
const zapInScope = inScope('zap', zapLegacyEnabled);
// zapState='NOT_RUN' envoyé explicitement par Jenkins == preuve directe et
// autoritaire (pas une déduction locale) : prime sur zapInScope quand présent.
const zapExplicitNotRun = explicitScannerState('zapState') === 'NOT_RUN';
const zapState=zapTargetUnavailable?'FAILED':classify({enabled:zapInScope&&!zapExplicitNotRun,executed:parse.zap.executed||zapWebhookValid,valid:zapValidFile||zapWebhookValid,findingCount:zapValidFile?zapAlerts.length:zapWebhookCount,marker:zapRaw?.status||webhookZap.status,technicalError:parse.zap.malformed||!!(parse.zap.error&&parse.zap.executed)});
// Distinction NOT_APPLICATION_DEFECT : conteneur applicatif démarré normalement
// (exit code 0) mais le scanner ZAP ne peut pas l'atteindre — mésappariement de
// topologie Docker/Jenkins (DOCKER_HOST=tcp://docker:2376 vs réseau hôte, deux
// daemons Docker distincts malgré le même nom de réseau "pfe-network"). Détecté
// via root_cause_category (déjà posé par Jenkins) OU motif dans le texte de preuve
// technique — jamais assimilé à un défaut applicatif (§3/§10).
const zapEvidenceText = [webhookZap.technical_evidence, webhookZap.error, webhookZap.root_cause_category].filter(Boolean).join(' | ');
const zapRootCauseCat = upper(webhookZap.root_cause_category || '');
const zapDockerTopologyPattern = /docker[_ -]?host|docker-in-docker|\bdind\b|network topology|different (docker )?network|network id/i;
const zapK8sUnreachable = !zapTargetUnavailable && /zap_k8s_unreachable/i.test(String(zapRaw?.status || webhookZap.status || ''));
// QA-BUILD-132-FINAL-ANALYSIS-HARDENING-R1 §3 : distinct de zapK8sUnreachable --
// ici kubectl a fonctionné (le pod a été créé et le scan lancé), il a seulement
// disparu avant la fin (kubectl logs/cp -> "pod not found"). Ne jamais confondre
// avec "kubectl injoignable" (mécanisme différent, cause différente).
const zapPodDisappeared = !zapTargetUnavailable && !zapK8sUnreachable && /zap_report_missing/i.test(String(zapRaw?.status || webhookZap.status || ''));
const zapTechCode = zapTargetUnavailable
  ? (zapRootCauseCat.includes('DOCKER') || zapDockerTopologyPattern.test(zapEvidenceText) ? 'DOCKER_CONFIGURATION_ERROR' : 'TARGET_UNAVAILABLE')
  : (zapK8sUnreachable ? 'K8S_TARGET_UNREACHABLE' : (zapPodDisappeared ? 'ZAP_SCAN_POD_DISAPPEARED' : null));
const zapTruth = truthFromCode(zapTechCode, [
  zapTargetUnavailable ? 'Conteneur applicatif démarré (exit code 0), Tomcat up sur :8080, mais healthcheck ZAP en échec.' : null,
  zapK8sUnreachable ? 'Pipeline Kubernetes-based ZAP : kubectl injoignable/absent côté agent Jenkins, cible jamais interrogée (rapport stub zap_k8s_unreachable).' : null,
  zapPodDisappeared ? 'Pod ZAP créé et scan lancé (kubectl fonctionnel) ; le pod a disparu avant la fin du scan -- kubectl logs/cp ont retourné "pod not found" (rapport stub zap_report_missing). Cause probable : terminaison/éviction du pod côté Kubernetes -- à investiguer via kubectl describe/get events sur le namespace, jamais imputé à l\'application sans preuve directe.' : null,
  zapEvidenceText || null,
]);
// executed=true : le stage ZAP a bien tenté d'atteindre la cible (l'appli a
// démarré) — ce n'est PAS un scanner jamais invoqué, contrairement à l'ancien
// calcul (zapTargetUnavailable?false:...) qui confondait "cible injoignable" et
// "scanner non exécuté" (bug corrigé — §3 : executed=true, completed=false).
// QA-BUILD-132-FINAL-ANALYSIS-HARDENING-R1 §3 : zapPodDisappeared est une preuve
// directe d'exécution (pod créé, scan/spider lancés -- kubectl a fonctionné) au
// même titre que zapTargetUnavailable ; executed=true n'est jamais fabriqué sans
// cette preuve (cf. truthFromState qui reste executed=null par défaut sur FAILED).
const zapTruthBase = (zapTargetUnavailable || zapPodDisappeared)
  ? { executed: true, completed: false, resultAvailable: false, findingCount: null }
  : truthFromState(zapState, zapAlerts.length || zapWebhookCount);
const zap={status:legacyStatus(zapState),scanState:zapState,executed:zapTruthBase.executed,alerts_high:zapAlerts.filter(a=>upper(a.severity||a.risk)==='HIGH').length||count(webhookZap.alerts_high),alerts_medium:zapAlerts.filter(a=>upper(a.severity||a.risk)==='MEDIUM').length||count(webhookZap.alerts_medium),alerts_low:zapAlerts.filter(a=>upper(a.severity||a.risk)==='LOW').length||count(webhookZap.alerts_low),alerts_count:zapAlerts.length||zapWebhookCount,alerts:zapAlerts,findings:zapTechnicalFinding?[zapTechnicalFinding]:zapAlerts,target_url:webhookZap.target_url||projectConfig.zapTargetUrl||'',diagnostic_path:webhookZap.diagnostic_path||null,diagnostic_url:webhookZap.diagnostic_url||null,rootCauseCategory:webhookZap.root_cause_category||null,_source:zapTargetUnavailable?'webhook_diagnostic':(zapValidFile?'local_file':(zapWebhookValid?'webhook':'none')),error:zapState.startsWith('COMPLETED_')?'':(webhookZap.error||parse.zap.error||String(zapRaw?.status||'ZAP report unavailable')), completed: zapTruthBase.completed, resultAvailable: zapTruthBase.resultAvailable, findingCount: zapTruthBase.findingCount, ...zapTruth};

const webhookTests=jenkins.tests||{};
const tests={total:count(webhookTests.total),failures:count(webhookTests.failures),skipped:count(webhookTests.skipped),status:upper(webhookTests.status)||'UNKNOWN',coverage:count(webhookTests.coverage)};
const build={job:jenkins.job||incident.job||'',number:jenkins.build_number||incident.build_number||'',status:upper(jenkins.build_stage_status||jenkins.status||incident.status)||'UNKNOWN',url:jenkins.build_url||''};
const deploy={status:upper(jenkins.deploy?.status)||'UNKNOWN',app_url:jenkins.deploy?.app_url||''};
const dockerInput=jenkins.docker||{}; const docker={image_tag:dockerInput.image||dockerInput.image_tag||'',build_status:upper(dockerInput.build_status)||'UNKNOWN',push_status:upper(dockerInput.push_status)||'UNKNOWN'};

// findingCount : plus jamais un défaut ??0 masquant un scan non complété (bug
// confirmé sur build #11 — §5). resultAvailable===true est la SEULE condition
// qui autorise un nombre réel ; sinon null ("inconnu"), jamais 0 par défaut.
const stageFromScan=(stage,scan,blockingCount,warningCount)=>{let status='NOT_RUN',blocking=false,reason=scan.error||''; if(scan.scanState==='FAILED'||scan.scanState==='MISSING'){status='FAILED';blocking=true;} else if(scan.scanState==='NOT_RUN')status='NOT_RUN'; else if(blockingCount>0){status='FAILED';blocking=true;} else if(warningCount>0)status='WARNING'; else if(scan.scanState?.startsWith('COMPLETED_'))status='PASSED'; const rawCount=scan.issues_count??scan.cves_count??scan.alerts_count; /* QA-BUILD-132-FINAL-ANALYSIS-HARDENING-R1 §2 : findingsAvailable (Sonar) compte comme resultAvailable pour l'exposition du nombre de findings -- l'analyse est exploitable même si la quality gate ne l'est pas. */ const scanFindingCountAvailable = scan.resultAvailable===true || scan.findingsAvailable===true; return {stage,status,blocking,executed:scan.executed??(scan.scanState?.startsWith('COMPLETED_')||scan.scanState==='FAILED'),findings:scan.findings||scan.issues||scan.cves||scan.alerts||[],findingCount:scanFindingCountAvailable?(rawCount??0):null,source:stage.toUpperCase(),message:reason,completed:scan.completed??null,resultAvailable:scan.resultAvailable??null,technicalCode:scan.technicalCode??null,problemClass:scan.problemClass??null,owner:scan.owner??null,evidence:scan.evidence??[],route:scan.route??'NONE'};};
const buildFailed=['FAILURE','FAILED','ABORTED'].includes(build.status);
const stages={
  build:{stage:'build',status:buildFailed?'FAILED':(['SUCCESS','PASSED'].includes(build.status)?'PASSED':'NOT_RUN'),blocking:buildFailed,executed:build.status!=='UNKNOWN',findings:[],findingCount:0,source:'JENKINS',message:build.status},
  tests:{stage:'tests',status:buildFailed&&tests.status==='UNKNOWN'?'NOT_REACHED':(tests.status==='UNKNOWN'||tests.status==='SKIPPED'?'NOT_RUN':(tests.failures>0||['FAILED','FAILURE'].includes(tests.status)?'FAILED':'PASSED')),blocking:tests.failures>0||['FAILED','FAILURE'].includes(tests.status),executed:!['UNKNOWN','SKIPPED'].includes(tests.status),findings:[],findingCount:tests.failures,source:'JENKINS',message:tests.status},
  sonar:stageFromScan('sonar',sonar,sonarFindings.filter(f=>f.blocking).length,sonarFindings.filter(f=>!f.blocking).length),
  trivy:stageFromScan('trivy',trivy,trivy.critical,trivy.high),
  owasp:stageFromScan('owasp',owasp,owasp.critical,owasp.high),
  zap:stageFromScan('zap',zap,zap.alerts_high,zap.alerts_medium),
  docker:{stage:'docker',status:buildFailed&&docker.build_status==='UNKNOWN'?'NOT_REACHED':(['SUCCESS','PASSED','COMPLETED'].includes(docker.build_status)?'PASSED':(['FAILED','FAILURE'].includes(docker.build_status)?'FAILED':'NOT_RUN')),blocking:['FAILED','FAILURE'].includes(docker.build_status),executed:docker.build_status!=='UNKNOWN',findings:[],findingCount:0,source:'DOCKER',message:docker.build_status},
  deploy:{stage:'deploy',status:buildFailed&&deploy.status==='UNKNOWN'?'NOT_REACHED':(['SUCCESS','PASSED','DEPLOYED'].includes(deploy.status)?'PASSED':(['FAILED','FAILURE'].includes(deploy.status)?'FAILED':'NOT_RUN')),blocking:['FAILED','FAILURE'].includes(deploy.status),executed:deploy.status!=='UNKNOWN',findings:[],findingCount:0,source:'JENKINS',message:deploy.status}
};
if(qualityGate==='ERROR'){stages.sonar.status='FAILED';stages.sonar.blocking=true;stages.sonar.message='Sonar Quality Gate ERROR';}
if(!['OK','ERROR'].includes(qualityGate)){stages.sonar.status='FAILED';stages.sonar.blocking=true;stages.sonar.message=`Quality Gate ${qualityGate}`;}
for(const key of ['sonar','trivy','owasp','zap','docker','deploy']) if(buildFailed&&['NOT_RUN','FAILED'].includes(stages[key].status)&&!stages[key].executed){stages[key].status='NOT_REACHED';stages[key].blocking=false;stages[key].message='Upstream build failure';}

return [{json:{enrichedData:{sonar,trivy,zap,owasp,tests,build,deploy,docker,stages,stageModelVersion:'1.1'},incidentUUID,projectConfig}}];
