// Tests pour project-cleanliness.ts — même style assert/ts-node que
// report-normalizer.spec.ts (pas de framework de test installé).
//   npx ts-node src/common/project-cleanliness.spec.ts
//
// Couvre spécifiquement le fix QA-WF1-SCANNER-DIAGNOSTIC-HARDENING §8 :
// suppression de l'exception ZAP (auparavant non-bloquant tant que non
// complété) — ZAP doit maintenant bloquer comme Trivy/OWASP.
import * as assert from 'assert';
import { evaluateProjectCleanliness } from './project-cleanliness';

let passed = 0;
function check(label: string, condition: boolean) {
  assert.ok(condition, `ÉCHEC: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const CLEAN_BASE = {
  build: { status: 'SUCCESS' },
  docker: { build_status: 'SUCCESS' },
  sonar: { quality_gate: 'OK' },
  trivy: { status: 'COMPLETED', critical: 0, high: 0 },
  owasp: { status: 'COMPLETED', critical: 0, high: 0 },
  zap: { status: 'COMPLETED', alerts_high: 0 },
  tests: { status: 'SUCCESS', failures: 0 },
};

console.log('Test 1 — projet entièrement propre (tous scanners COMPLETED, 0 finding)');
{
  const c = evaluateProjectCleanliness(CLEAN_BASE);
  check('clean = true', c.clean === true);
  check('blockingPhases vide', c.blockingPhases.length === 0);
}

console.log('Test 2 — ZAP non complété (timeout/config) -> bloquant, PAS nonExecutedPhases (§8)');
{
  const enrichedData = { ...CLEAN_BASE, zap: { status: 'FAILED', technicalCode: 'DOCKER_CONFIGURATION_ERROR' } };
  const c = evaluateProjectCleanliness(enrichedData);
  check('clean = false', c.clean === false);
  check('ZAP présent dans blockingPhases', c.blockingPhases.some(p => p.phase === 'DAST (ZAP)'));
  check('ZAP absent de nonExecutedPhases (plus d\'exception)', !c.nonExecutedPhases.some(p => p.phase === 'DAST (ZAP)'));
  check('raison mentionne le technicalCode', c.blockingPhases.find(p => p.phase === 'DAST (ZAP)')!.raison.includes('DOCKER_CONFIGURATION_ERROR'));
}

console.log('Test 3 — ZAP COMPLETED avec alertes hautes -> bloquant (comportement inchangé)');
{
  const enrichedData = { ...CLEAN_BASE, zap: { status: 'COMPLETED', alerts_high: 2 } };
  const c = evaluateProjectCleanliness(enrichedData);
  check('clean = false', c.clean === false);
  check('ZAP bloquant pour alertes hautes', c.blockingPhases.some(p => p.phase === 'DAST (ZAP)' && p.raison.includes('2 alerte')));
}

console.log('Test 4 — Sonar quality gate API_ERROR (build #11) -> bloquant même si issues=[]');
{
  const enrichedData = { ...CLEAN_BASE, sonar: { quality_gate: 'API_ERROR' } };
  const c = evaluateProjectCleanliness(enrichedData);
  check('clean = false', c.clean === false);
  check('SonarQube bloquant', c.blockingPhases.some(p => p.phase === 'SonarQube'));
}

console.log(`\n${passed} assertions passées.`);
