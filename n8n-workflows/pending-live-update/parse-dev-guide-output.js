const response = $input.first().json;
const content = response.content?.[0]?.text || '';

// QA-BUILD-132-FINAL-ANALYSIS-HARDENING-R1 §6 : quand le LLM ne renvoie rien
// d'exploitable, le plan de correction ne doit pas disparaître -- repli
// déterministe construit à partir de la vérité des stages déjà calculée par
// "Merge All Fetched Data". Ordre causal : (1) restaurer la vérité d'un stage
// bloqué par un problème technique/config avant tout le reste, (2) tests réels
// en échec (jamais un skip délibéré, cf. stages.tests.blocking), (3) findings
// produit bloquants/réels restants (Sonar/Trivy/OWASP/ZAP), par nombre de
// findings. Ne jamais inventer de PR pour un blocage infrastructure -- route
// reprise telle quelle depuis la vérité de stage (jamais WF2 pour un
// TECHNICAL_BLOCKER).
const buildDeterministicFallback = (reason, raw) => {
  let stages = {};
  try { stages = $('Merge All Fetched Data').first()?.json?.enrichedData?.stages || {}; }
  catch (e) { stages = {}; }

  const order = [];
  let priority = 1;

  for (const name of ['sonar', 'trivy', 'owasp', 'zap', 'docker', 'build']) {
    const s = stages[name];
    if (!s) continue;
    if (s.problemClass === 'TECHNICAL_BLOCKER' || s.problemClass === 'FIXABLE_CONFIGURATION') {
      order.push({
        priority: priority++,
        category: 'RESTORE_STAGE_TRUTH',
        title: `Restaurer la fiabilité du stage ${name.toUpperCase()}${s.technicalCode ? ' (' + s.technicalCode + ')' : ''}`,
        detail: s.message || '',
        owner: s.owner || 'INFRASTRUCTURE/ADMIN',
        route: s.route || 'NONE',
        source: 'DETERMINISTIC_FALLBACK',
      });
    }
  }

  if (stages.tests && stages.tests.blocking) {
    order.push({
      priority: priority++,
      category: 'REQUIRED_VALIDATION',
      title: 'Corriger les tests en échec',
      detail: stages.tests.message || '',
      owner: 'developer',
      route: 'NONE',
      source: 'DETERMINISTIC_FALLBACK',
    });
  }

  for (const name of ['sonar', 'trivy', 'owasp', 'zap']) {
    const s = stages[name];
    if (!s || typeof s.findingCount !== 'number' || s.findingCount <= 0) continue;
    order.push({
      priority: priority++,
      category: 'PRODUCT_FINDINGS',
      title: `${s.findingCount} finding(s) ${name.toUpperCase()} à traiter`,
      detail: `Voir la liste des findings ${name} pour le détail (fichier/ligne/CVE).`,
      owner: name === 'sonar' ? 'agent' : 'developer',
      route: 'NONE',
      source: 'DETERMINISTIC_FALLBACK',
    });
  }

  return [{ json: {
    incidentId: 'unknown',
    summaryForDeveloper: `Guide développeur généré automatiquement (agent IA indisponible : ${reason}). Ordre causal déterministe fondé sur la vérité des stages.`,
    issues: [], quickWins: [], fixOrder: order, totalEstimatedMinutes: 0,
    confidence: 0.0, parseError: true, deterministicFallback: true,
    raw: (raw || '').substring(0, 500),
  }}];
};

if (!content) return buildDeterministicFallback('Developer Guidance agent returned empty response', '');
let clean = content.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
if (start === -1 || end === -1) return buildDeterministicFallback('No JSON found in agent output', clean);
try {
  const parsed = JSON.parse(clean.substring(start, end + 1));
  parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  // Tri de sécurité : toujours par priorité croissante
  parsed.issues.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  return [{ json: parsed }];
} catch (e) {
  return buildDeterministicFallback('JSON parse failed: ' + e.message, clean);
}
