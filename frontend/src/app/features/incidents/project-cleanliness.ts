// Calcule si le pipeline rend le projet propre à partir du build, de Docker, de SonarQube, des scanners et des tests.
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

/** Vrai si le bloc scanner donné porte au moins une vulnérabilité CRITICAL ouverte. */
function hasOpenCritical(block: any): boolean {
  return (block?.critical || 0) > 0;
}

/** Calcule si un projet est "propre" en passant chaque phase (build Jenkins, build Docker, SonarQube, Trivy, OWASP, ZAP, tests) au crible. */
export function evaluateProjectCleanliness(enrichedData: any): ProjectCleanliness {
  const blockingPhases: BlockingPhase[] = [];
  const nonExecutedPhases: NonExecutedPhase[] = [];
  const nonBlockingFindings: NonBlockingFinding[] = [];

  const buildStatus = String(enrichedData?.build?.status || '').toUpperCase();
  if (BAD_BUILD_STATUSES.includes(buildStatus)) {
    blockingPhases.push({ phase: 'Jenkinsfile', raison: `Build Jenkins en échec (${buildStatus})`, type: 'agent' });
  } else if (!GOOD_BUILD_STATUSES.includes(buildStatus)) {
    blockingPhases.push({ phase: 'Jenkinsfile', raison: `Statut de build inconnu (${buildStatus || 'absent'})`, type: 'agent' });
  }

  const dockerStatus = String(enrichedData?.docker?.build_status || '').toUpperCase();
  if (BAD_BUILD_STATUSES.includes(dockerStatus)) {
    blockingPhases.push({ phase: 'Docker', raison: `Build image Docker en échec (${dockerStatus})`, type: 'agent' });
  } else if (!GOOD_BUILD_STATUSES.includes(dockerStatus)) {
    blockingPhases.push({ phase: 'Docker', raison: `Statut de build Docker inconnu (${dockerStatus || 'absent'})`, type: 'agent' });
  }

  const qualityGate = String(enrichedData?.sonar?.quality_gate || '').toUpperCase();
  if (!OK_QUALITY_GATES.includes(qualityGate)) {
    blockingPhases.push({ phase: 'SonarQube', raison: `Quality gate ${qualityGate || 'indéterminée'}`, type: 'agent' });
  }

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

  const zap = enrichedData?.zap;
  if (zap?.status !== 'COMPLETED') {
    blockingPhases.push({ phase: 'DAST (ZAP)', raison: `Scanner non exécuté ou incomplet (statut ${zap?.status || 'absent'}${zap?.technicalCode ? `, cause : ${zap.technicalCode}` : ''}) — résultat DAST indisponible, bloquant par défaut.`, type: 'humain' });
  } else if ((zap.alerts_high || 0) > 0) {
    blockingPhases.push({ phase: 'DAST (ZAP)', raison: `${zap.alerts_high} alerte(s) haute(s) ouverte(s)`, type: 'humain' });
  }

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
