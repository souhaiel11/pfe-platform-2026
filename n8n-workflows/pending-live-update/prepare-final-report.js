const judge    = $('Judge - Parse Output').first().json;
const incident = $('Extract Project Config').first().json;
const enriched = $('Merge All Fetched Data').first().json.enrichedData || {};

const decision      = (judge.decision || 'NOTIFY_ONLY').toUpperCase();
const securityLevel = (judge.securityLevel || 'LOW').toUpperCase();
const projectId     = incident.projectId || null;

// QA-BUILD-132-FINAL-ANALYSIS-HARDENING-R1 §4 : source canonique unique --
// "Prepare - Judge Body" a déjà calculé securityScore/riskLevel de façon
// déterministe (criticalCves, blockers, etc. -- jamais une valeur LLM). Ne
// JAMAIS recalculer séparément ici : ça a produit securityScore=10/riskLevel=
// low alors que le calcul canonique disait 0/critical pour le même build (33
// CVE critiques réelles). judge.securityLevel est un LABEL DE CONFIANCE de
// l'agent LLM, PAS une mesure de risque -- ne jamais l'utiliser comme tel.
let canonicalRisk = {};
try {
  const judgeBodyRaw = $('Prepare - Judge Body').first()?.json?.judgeInput;
  canonicalRisk = judgeBodyRaw ? JSON.parse(judgeBodyRaw) : {};
} catch (e) { canonicalRisk = {}; }

const decisionToStatus = {
  'FIX_PROPOSED': 'analyzed',
  'BLOCK':        'blocked',
  'NOTIFY_ONLY':  'completed',
  'AUTO_FIX':     'analyzed',
};
const statusForBackend = decisionToStatus[decision] || 'analyzed';

const computeScore = (level, dec) => {
  if (level === 'CRITICAL' || dec === 'BLOCK') return 10;
  if (level === 'HIGH')                         return 30;
  if (level === 'MEDIUM')                       return 60;
  if (level === 'LOW')                          return 90;
  return 75;
};

const _devGuide = $('Parse - Dev Guide Output').first()?.json || {};

// ── Classification AUTO / MANUEL — alignée sur la policy réelle du WF2 ──
// WF2 auto-corrige : SonarQube CRITICAL/MAJOR (BUG/VULN/CODE_SMELL) du fichier cible,
// BLOCKER exclus (revue humaine), CVE/ZAP/tests jamais auto-corrigés.
const _issuesRaw = Array.isArray(_devGuide.issues) ? _devGuide.issues : [];
const _annotated = _issuesRaw.map(i => {
  const sev = String(i.severity || '').toUpperCase();
  const src = String(i.source || '').toUpperCase();
  const targetFile = String(i.file || '').trim();
  const auto = src === 'SONARQUBE' && ['CRITICAL', 'MAJOR'].includes(sev) && targetFile.length > 0;
  const remediationType = auto ? 'AUTO_FIX_ELIGIBLE' : 'DEVELOPER_ACTION_REQUIRED';
  const blocking = ['BLOCKER', 'CRITICAL'].includes(sev);
  let reason;
  if (auto)                                   reason = "Correction automatisable proposée ; aucune approbation, modification Git ou Pull Request n'est implicite";
  else if (src === 'SONARQUBE' && sev === 'BLOCKER') reason = "BLOCKER exclu de l'auto-fix par sécurité : revue et correction humaines obligatoires";
  else if (src === 'OWASP')                   reason = "CVE de dépendance : mise à jour manuelle du pom.xml requise (voir démarche ci-dessous)";
  else if (src === 'TRIVY')                   reason = "CVE conteneur/dépendance : mise à jour de l'image de base ou du pom.xml requise (manuel)";
  else if (src === 'ZAP')                     reason = "Alerte DAST : correction applicative manuelle requise";
  else if (src === 'TESTS' || src === 'BUILD') reason = "Échec de test/build : intervention développeur requise";
  else if (decision !== 'AUTO_FIX')           reason = `Décision ${decision} : aucune correction automatique lancée sur ce build`;
  else                                        reason = "Hors périmètre de l'auto-fix : correction manuelle recommandée";
  return { ...i, blocking, remediationType, resolution: auto ? 'AUTO' : 'MANUEL', resolutionReason: reason };
});
_devGuide.issues = _annotated;
const _autoCount   = _annotated.filter(i => i.resolution === 'AUTO').length;
const _manualCount = _annotated.length - _autoCount;
const aiSummary = JSON.stringify({
  build:  enriched.build?.number,
  job:    enriched.build?.job,
  status: enriched.build?.status,
  ...judge,
  developerGuide: {
    summaryForDeveloper:   _devGuide.summaryForDeveloper ?? '',
    autoCount:             _autoCount,
    manualCount:           _manualCount,
    issues:                Array.isArray(_devGuide.issues) ? _devGuide.issues : [],
    quickWins:             _devGuide.quickWins ?? [],
    fixOrder:              _devGuide.fixOrder ?? [],
    totalEstimatedMinutes: _devGuide.totalEstimatedMinutes ?? 0,
    confidence:            _devGuide.confidence ?? 0,
  },
});

const incidentUUID = $('Prepare Fetch URLs').first().json.incidentUUID || null;

// ── Génération du HTML de l'email développeur ──
const devGuide = _devGuide;
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const sevColor = (s) => ({BLOCKER:'#d32f2f',CRITICAL:'#d32f2f',HIGH:'#f57c00',MAJOR:'#f57c00',MEDIUM:'#fbc02d'}[s] || '#757575');
const issuesRows = (devGuide.issues || []).map(i => `
  <tr>
    <td style="padding:6px;border:1px solid #ddd;text-align:center;"><b>${esc(i.priority)}</b></td>
    <td style="padding:6px;border:1px solid #ddd;"><span style="color:${sevColor(i.severity)};font-weight:bold;">${esc(i.severity)}</span><br><small>${esc(i.source)}</small><br><small style="font-weight:bold;color:${i.resolution === 'AUTO' ? '#1565c0' : '#e65100'};">${i.resolution === 'AUTO' ? '🤖 AUTO' : '🔧 MANUEL'}</small></td>
    <td style="padding:6px;border:1px solid #ddd;"><b>${esc(i.title)}</b><br><code>${esc(i.file)}${i.line ? ':' + esc(i.line) : ''}</code><br><small>${esc(i.rule)}</small></td>
    <td style="padding:6px;border:1px solid #ddd;">${esc(i.problem)}<br><i style="color:#b71c1c;">${esc(i.whyItMatters)}</i></td>
    <td style="padding:6px;border:1px solid #ddd;"><ol style="margin:0;padding-left:16px;">${(i.howToFix||[]).map(s => '<li>'+esc(s)+'</li>').join('')}</ol><small><b>Vérifier :</b> <code>${esc(i.verification)}</code> — ~${esc(i.estimatedEffortMinutes)} min</small></td>
  </tr>`).join('');
const quickWins = (devGuide.quickWins || []).length
  ? '<p><b>⚡ Quick wins (&lt;15 min) :</b> ' + devGuide.quickWins.map(esc).join(', ') + '</p>' : '';
const emailDevSection = (devGuide.issues || []).length ? `
  <h3>🛠️ Guide de correction développeur (${devGuide.issues.length} problème(s) — 🤖 ${_autoCount} auto / 🔧 ${_manualCount} manuel(s) — ~${esc(devGuide.totalEstimatedMinutes)} min)</h3>
  <p>${esc(devGuide.summaryForDeveloper)}</p>
  ${quickWins}
  <table style="border-collapse:collapse;font-size:12px;width:100%;">
    <tr style="background:#263238;color:#fff;">
      <th style="padding:6px;border:1px solid #ddd;">#</th>
      <th style="padding:6px;border:1px solid #ddd;">Sévérité</th>
      <th style="padding:6px;border:1px solid #ddd;">Problème</th>
      <th style="padding:6px;border:1px solid #ddd;">Explication &amp; risque</th>
      <th style="padding:6px;border:1px solid #ddd;">Comment corriger</th>
    </tr>
    ${issuesRows}
  </table>` : '<p><i>Aucun guide développeur généré pour ce build.</i></p>';

return [{
  json: {
    emailDevSection,
    incidentUUID,
    type:            'combined',
    projectId,
    aiSummary,
    statusForBackend,
    rawData: {
      rootCause:    $('Parse - Root Cause Output').first()?.json || {},
      security:     $('Parse - Security Output').first()?.json   || {},
      remediation:  $('Parse - Remediation Output').first()?.json || {},
      developerGuide: $('Parse - Dev Guide Output').first()?.json || {},
      enrichedData: enriched,
    },
    // Repli défensif sur l'ancienne heuristique UNIQUEMENT si le calcul
    // canonique de "Prepare - Judge Body" est indisponible (ne devrait pas
    // arriver en fonctionnement normal -- ce node s'exécute toujours après).
    securityScore: typeof canonicalRisk.securityScore === 'number' ? canonicalRisk.securityScore : computeScore(securityLevel, decision),
    riskLevel:     canonicalRisk.riskLevel || securityLevel.toLowerCase(),
    decision,
  }
}];