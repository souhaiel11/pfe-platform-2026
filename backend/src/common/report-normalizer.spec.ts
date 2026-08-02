// Tests unitaires pour report-normalizer.ts — le repo n'a pas de framework de
// test installé (pas de jest), donc ce fichier s'exécute directement via
// ts-node avec `assert`, dans le même esprit que les scripts src/seed/*.
//
//   npx ts-node src/common/report-normalizer.spec.ts
import * as assert from 'assert';
import { normalizeReport } from './report-normalizer';

let passed = 0;
function check(label: string, condition: boolean) {
  assert.ok(condition, `ÉCHEC: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

// ── 1. Input legacy (comme devsecops-testbed : vulnerabilities: []) ────────
console.log('Test 1 — legacy, tableau vide (devsecops-testbed)');
{
  const raw = {
    security: {
      securitySummary: 'No security analysis',
      vulnerabilities: [],
    },
  };
  const n = normalizeReport(raw);
  check('_sourceFormat = legacy', n._sourceFormat === 'legacy');
  check('trivy.critical = 0', n.trivy.critical === 0);
  check('trivy.cves_count = 0', n.trivy.cves_count === 0);
  check('owasp.cves_count = 0', n.owasp.cves_count === 0);
  check('sonar.issues = []', n.sonar.issues.length === 0);
}

// ── 2. Input legacy avec de vraies vulnérabilités mixtes (trivy/owasp/sonar) ─
console.log('Test 2 — legacy, vulnerabilities[] peuplé (mix trivy/owasp/sonarqube)');
{
  const raw = {
    security: {
      securitySummary: 'CRITICAL RISK',
      vulnerabilities: [
        { ref: 'CVE-2026-56131', severity: 'high', source: 'trivy', component: 'libexpat-2.5.0', impact: 'integer overflow' },
        { ref: 'CVE-2022-42003', severity: 'high', source: 'owasp', component: 'jackson-databind-2.13.4.jar', impact: 'resource exhaustion' },
        { ref: 'CVE-9999-00001', severity: 'critical', source: 'owasp', component: 'somelib-1.0.0', impact: 'critical flaw' },
        { ref: 'java:S4684', severity: 'critical', source: 'sonarqube', component: 'TaskController.java:36', impact: 'entity exposed' },
        { ref: 'WEIRD-001', severity: 'medium', source: 'unknown-tool', component: 'x', impact: 'y' },
      ],
    },
  };
  const n = normalizeReport(raw);
  check('_sourceFormat = legacy', n._sourceFormat === 'legacy');
  // trivy = 1 CVE trivy réelle + 1 source inconnue routée par défaut (fallback)
  check('trivy.cves_count = 2 (1 réelle + 1 fallback source inconnue)', n.trivy.cves_count === 2);
  check('trivy.high = 1 (le fallback est MEDIUM, pas HIGH)', n.trivy.high === 1);
  check("source inconnue routée vers trivy.cves (fallback)", n.trivy.cves.some(c => c.id === 'WEIRD-001'));
  check('owasp.cves_count = 2', n.owasp.cves_count === 2);
  check('owasp.critical = 1', n.owasp.critical === 1);
  check('owasp.high = 1', n.owasp.high === 1);
  check('sonar.issues.length = 1 (S4684 routé hors CVE)', n.sonar.issues.length === 1);
  check('sonar.issues[0].line = 36', n.sonar.issues[0].line === 36);
  check('sonar.vulnerabilities = 1', n.sonar.vulnerabilities === 1);
}

// ── 3. Input v2.1 déjà structuré — retourné tel quel (+ complété si partiel) ─
console.log('Test 3 — v2.1 déjà structuré');
{
  const raw = {
    enrichedData: {
      trivy: { critical: 0, high: 10, cves_count: 10, cves: [] },
      owasp: { critical: 23, high: 58, cves_count: 81, cves: [] },
      sonar: { bugs: 0, vulnerabilities: 2, code_smells: 16, coverage: 0, quality_gate: 'ERROR', issues: [] },
      zap: { alerts_high: 0, alerts_count: 0, alerts_medium: 0 },
      note: 'note existante',
    },
  };
  const n = normalizeReport(raw);
  check('_sourceFormat = v2.1', n._sourceFormat === 'v2.1');
  check('trivy.high = 10 (inchangé)', n.trivy.high === 10);
  check('owasp.critical = 23 (inchangé)', n.owasp.critical === 23);
  check('sonar.quality_gate = ERROR (inchangé)', n.sonar.quality_gate === 'ERROR');
  check('note préservée', n.note === 'note existante');
}

// ── 4. Input v2.1 partiel — champs manquants complétés à 0/[] sans écraser ──
console.log('Test 4 — v2.1 partiel (zap manquant)');
{
  const raw = { enrichedData: { trivy: { critical: 1, high: 2, cves_count: 3, cves: [] } } };
  const n = normalizeReport(raw);
  check('_sourceFormat = v2.1', n._sourceFormat === 'v2.1');
  check('trivy.critical = 1 (préservé)', n.trivy.critical === 1);
  check('owasp complété à vide', n.owasp.cves_count === 0 && n.owasp.cves.length === 0);
  check('zap complété à vide', n.zap.alerts_high === 0);
  check('sonar complété à vide', n.sonar.issues.length === 0 && n.sonar.quality_gate === 'ERROR');
}

// ── 5. Input vide — ni enrichedData, ni vulnerabilities[] ───────────────────
console.log('Test 5 — vide (aucune clé enrichedData ni security.vulnerabilities)');
{
  const raw = { rootCause: { errorType: 'X' } };
  const n = normalizeReport(raw);
  check('_sourceFormat = empty', n._sourceFormat === 'empty');
  check('trivy à 0/[]', n.trivy.critical === 0 && n.trivy.cves.length === 0);
  check('owasp à 0/[]', n.owasp.critical === 0 && n.owasp.cves.length === 0);
  check("note = 'Aucune donnée d'analyse dans ce rapport'", n.note === "Aucune donnée d'analyse dans ce rapport");
}

// ── 6. Régression : coverage écrit comme string par n8n (bug réel trouvé) ──
console.log('Test 6 — v2.1, sonar.coverage en string (comme produit par n8n)');
{
  const raw = { enrichedData: { sonar: { coverage: '0', bugs: 3, vulnerabilities: 3, code_smells: 32, quality_gate: 'UNKNOWN', issues: [] } } };
  const n = normalizeReport(raw);
  check('sonar.coverage est bien un number (0), pas la string "0"', n.sonar.coverage === 0 && typeof n.sonar.coverage === 'number');
}

console.log(`\n${passed} assertions passées.`);
