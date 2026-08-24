// ─────────────────────────────────────────────────────────────
//  MIROIR FRONTEND de backend/src/common/project-cleanliness.ts.
//  Le frontend et le backend sont deux packages npm séparés dans ce repo
//  (pas de package "shared" — même patron déjà en place pour les CVE, voir
//  cve-table.component.ts::NormCve qui réimplémente sa propre normalisation
//  plutôt que d'importer report-normalizer.ts du backend). Fonction pure,
//  gardée IDENTIQUE ligne à ligne au fichier backend — toute modification
//  de logique doit être répercutée des deux côtés.
//
//  Calcul déterministe "projet propre" — brique pour le verrou de
//  déploiement (Couche 3). Opère directement sur enrichedData BRUT
//  (incident.metadata.enrichedData, déjà chargé tel quel dans
//  IncidentDetailComponent.enrichedData).
//
//  Philosophie fail-closed : une phase dont le statut est absent/inattendu
//  est BLOQUANTE par défaut, jamais assimilée à "ok". ZAP suivait
//  auparavant une exception (non bloquant tant que non complété) —
//  supprimée (ticket QA-WF1-SCANNER-DIAGNOSTIC-HARDENING §8) : ZAP est un
//  scanner requis au même titre que Trivy/OWASP.
//  Seule la sévérité CRITICAL bloque sur Trivy/OWASP (décision explicite) ;
//  HIGH/MEDIUM/LOW sont signalées (nonBlockingFindings), jamais bloquantes.
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
