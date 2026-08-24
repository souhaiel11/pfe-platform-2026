// ─────────────────────────────────────────────────────────────
//  Calcul déterministe "projet propre" — brique pour le verrou de
//  déploiement (Couche 3). Fonction pure : aucun accès DB.
//
//  Opère directement sur enrichedData BRUT (incident.metadata.enrichedData
//  ou report.rawData.enrichedData — même forme, écrite par WF1, vérifié en
//  base), PAS via normalizeReport()/EnrichedData (report-normalizer.ts) :
//  ce normalizer ne conserve que {trivy, owasp, sonar, zap} et perd
//  build/docker/tests/deploy en route (normalizeV21 retourne un littéral
//  fermé) — or ce sont exactement les phases "agent" (build/docker) et
//  "tests" dont on a besoin ici.
//
//  Philosophie fail-closed héritée de azure-deploy-readiness.service.ts :
//  une phase dont le statut est absent/inattendu est BLOQUANTE par défaut,
//  jamais assimilée à "ok". ZAP suivait auparavant une exception (non
//  bloquant tant que non complété) — supprimée (ticket
//  QA-WF1-SCANNER-DIAGNOSTIC-HARDENING §8) : ZAP est un scanner requis au
//  même titre que Trivy/OWASP, un DAST non complété (timeout, blocage
//  Docker/Jenkins, etc.) est une vraie inconnue de sécurité, pas un motif
//  pour laisser passer un déploiement.
// ─────────────────────────────────────────────────────────────

export type PhaseType = 'agent' | 'humain';

export interface BlockingPhase {
  phase: string;
  raison: string;
  type: PhaseType;
}

export interface NonExecutedPhase {
  phase: string;
  raison: string;
}

// Constat réel mais volontairement NON bloquant (ex: CVE HIGH/MEDIUM/LOW —
// seule CRITICAL bloque, décision explicite). Distinct de NonExecutedPhase
// (qui documente une phase qui n'a pas tourné) : ici la phase A tourné et
// A trouvé quelque chose, on choisit juste de ne pas bloquer dessus.
export interface NonBlockingFinding {
  phase: string;
  raison: string;
}

export interface ProjectCleanliness {
  clean: boolean;
  blockingPhases: BlockingPhase[];
  nonExecutedPhases: NonExecutedPhase[];
  nonBlockingFindings: NonBlockingFinding[];
}

// Aligné sur azure-deploy-readiness.service.ts::OK_QUALITY_GATES — même
// vocabulaire, ne pas diverger sans raison.
const OK_QUALITY_GATES = ['OK', 'PASSED'];
const GOOD_BUILD_STATUSES = ['SUCCESS'];
const BAD_BUILD_STATUSES = ['FAILURE', 'FAILED', 'UNSTABLE', 'ABORTED'];
const GOOD_TEST_STATUSES = ['SUCCESS', 'PASSED', 'COMPLETED'];

function hasOpenCritical(block: any): boolean {
  return (block?.critical || 0) > 0;
}

export function evaluateProjectCleanliness(enrichedData: any): ProjectCleanliness {
  const blockingPhases: BlockingPhase[] = [];
  const nonExecutedPhases: NonExecutedPhase[] = [];
  const nonBlockingFindings: NonBlockingFinding[] = [];

  // ── Jenkinsfile (agent : WF4) ──
  const buildStatus = String(enrichedData?.build?.status || '').toUpperCase();
  if (BAD_BUILD_STATUSES.includes(buildStatus)) {
    blockingPhases.push({ phase: 'Jenkinsfile', raison: `Build Jenkins en échec (${buildStatus})`, type: 'agent' });
  } else if (!GOOD_BUILD_STATUSES.includes(buildStatus)) {
    blockingPhases.push({ phase: 'Jenkinsfile', raison: `Statut de build inconnu (${buildStatus || 'absent'})`, type: 'agent' });
  }

  // ── Docker (agent : WF5) ──
  const dockerStatus = String(enrichedData?.docker?.build_status || '').toUpperCase();
  if (BAD_BUILD_STATUSES.includes(dockerStatus)) {
    blockingPhases.push({ phase: 'Docker', raison: `Build image Docker en échec (${dockerStatus})`, type: 'agent' });
  } else if (!GOOD_BUILD_STATUSES.includes(dockerStatus)) {
    blockingPhases.push({ phase: 'Docker', raison: `Statut de build Docker inconnu (${dockerStatus || 'absent'})`, type: 'agent' });
  }

  // ── SonarQube (agent : WF2) ──
  const qualityGate = String(enrichedData?.sonar?.quality_gate || '').toUpperCase();
  if (!OK_QUALITY_GATES.includes(qualityGate)) {
    blockingPhases.push({ phase: 'SonarQube', raison: `Quality gate ${qualityGate || 'indéterminée'}`, type: 'agent' });
  }

  // ── Trivy — vulnérabilités conteneur (humain) ──
  // Décision explicite : SEULE la sévérité CRITICAL bloque. HIGH/MEDIUM/LOW
  // sont réelles, affichées avec instructions (Bloc A), mais signalées sans
  // bloquer — nonBlockingFindings plutôt que blockingPhases.
  const trivy = enrichedData?.trivy;
  if (trivy?.status !== 'COMPLETED') {
    blockingPhases.push({ phase: 'Vulnérabilités conteneur (Trivy)', raison: `Scanner non exécuté (statut ${trivy?.status || 'absent'})`, type: 'humain' });
  } else {
    if (hasOpenCritical(trivy)) {
      blockingPhases.push({ phase: 'Vulnérabilités conteneur (Trivy)', raison: `${trivy.critical} CVE CRITICAL ouverte(s)`, type: 'humain' });
    }
    if ((trivy.high || 0) > 0) {
      nonBlockingFindings.push({ phase: 'Vulnérabilités conteneur (Trivy)', raison: `${trivy.high} CVE HIGH signalée(s), non bloquante(s) — voir la carte détaillée` });
    }
  }

  // ── OWASP Dependency-Check — vulnérabilités dépendances (humain) ──
  const owasp = enrichedData?.owasp;
  if (owasp?.status !== 'COMPLETED') {
    blockingPhases.push({ phase: 'Vulnérabilités dépendances (OWASP)', raison: `Scanner non exécuté (statut ${owasp?.status || 'absent'})`, type: 'humain' });
  } else {
    if (hasOpenCritical(owasp)) {
      blockingPhases.push({ phase: 'Vulnérabilités dépendances (OWASP)', raison: `${owasp.critical} CVE CRITICAL ouverte(s)`, type: 'humain' });
    }
    if ((owasp.high || 0) > 0) {
      nonBlockingFindings.push({ phase: 'Vulnérabilités dépendances (OWASP)', raison: `${owasp.high} CVE HIGH signalée(s), non bloquante(s) — voir la carte détaillée` });
    }
  }

  // ── ZAP — DAST (humain) — fail-closed, même traitement que Trivy/OWASP ──
  const zap = enrichedData?.zap;
  if (zap?.status !== 'COMPLETED') {
    blockingPhases.push({ phase: 'DAST (ZAP)', raison: `Scanner non exécuté ou incomplet (statut ${zap?.status || 'absent'}${zap?.technicalCode ? `, cause : ${zap.technicalCode}` : ''}) — résultat DAST indisponible, bloquant par défaut.`, type: 'humain' });
  } else if ((zap.alerts_high || 0) > 0) {
    blockingPhases.push({ phase: 'DAST (ZAP)', raison: `${zap.alerts_high} alerte(s) haute(s) ouverte(s)`, type: 'humain' });
  }

  // ── Tests (humain) ──
  const tests = enrichedData?.tests;
  const testStatus = String(tests?.status || '').toUpperCase();
  if ((tests?.failures || 0) > 0) {
    blockingPhases.push({ phase: 'Tests', raison: `${tests.failures} test(s) en échec`, type: 'humain' });
  } else if (!GOOD_TEST_STATUSES.includes(testStatus)) {
    blockingPhases.push({ phase: 'Tests', raison: `Tests non exécutés ou statut indéterminé (${tests?.status || 'absent'})`, type: 'humain' });
  }

  return {
    clean: blockingPhases.length === 0,
    blockingPhases,
    nonExecutedPhases,
    nonBlockingFindings,
  };
}
