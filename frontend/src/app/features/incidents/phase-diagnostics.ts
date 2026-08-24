// ─────────────────────────────────────────────────────────────
//  MIROIR FRONTEND de backend/src/common/phase-diagnostics.ts — même
//  patron que project-cleanliness.ts (pas de package partagé backend/
//  frontend dans ce repo). Gardé IDENTIQUE ligne à ligne au fichier
//  backend ; toute modification doit être répercutée des deux côtés.
//
//  Couche d'interprétation — transforme un statut brut ("UNKNOWN") en
//  diagnostic actionnable. Fonction pure, zéro appel réseau/LLM, zéro
//  nouvelle collecte : elle lit uniquement des champs qui existent déjà
//  (enrichedData.*, incident.errorReason/errorStep, enrichedData.build.url).
//
//  NE DÉCIDE PAS si le déploiement est bloqué (ça reste project-cleanliness.ts,
//  inchangé) — ce module produit seulement le TEXTE explicatif que Bloc C
//  affiche à la place d'un "UNKNOWN" nu.
//
//  Trois niveaux de certitude, jamais mélangés dans le texte final :
//   - CONFIRMÉ   : prouvé par les données de CE run — soit technicalCode
//     posé par WF1 avec preuve (voir scanner-diagnostics.ts), soit déduit
//     directement des champs du bloc (ex. Sonar a trouvé des issues réelles
//     mais le quality gate spécifiquement n'a pas répondu).
//   - HYPOTHÈSE  : dette déjà diagnostiquée dans une session précédente
//     (nvd-api-key, timeout ZAP) — probable, PAS reprouvée sur ce run
//     précis (on n'a pas le log du stage OWASP/ZAP pour ce build). Ce n'est
//     qu'un FILET DE REPLI : si le bloc porte un technicalCode confirmé
//     pour ce run (ticket QA-WF1-SCANNER-DIAGNOSTIC-HARDENING §9), cette
//     hypothèse générique n'est jamais affichée à sa place.
//   - INCONNU    : rien d'exploitable → filet honnête, jamais un UNKNOWN nu.
// ─────────────────────────────────────────────────────────────

export type DiagnosticActor = 'agent' | 'humain' | null;
export type DiagnosticConfidence = 'confirmé' | 'probable' | 'hypothèse' | 'inconnu';

export interface PhaseDiagnostic {
  phase: string;
  green: boolean;
  actor: DiagnosticActor;
  confidence: DiagnosticConfidence;
  message: string; // (a) constat (b) cause (c) qui (d) quoi faire — une seule phrase actionnable
}

// Contexte Incident (errorReason/errorStep) — colonnes DB sur Incident,
// PAS dans enrichedData (vérifié : incident.entity.ts). Optionnel : un appel
// depuis un contexte Report seul (sans Incident associé) reste honnête, juste
// moins précis sur la cause exacte du cascade.
export interface IncidentContext {
  errorReason?: string | null;
  errorStep?: string | null;
}

const BAD_BUILD_STATUSES = ['FAILURE', 'FAILED', 'UNSTABLE', 'ABORTED'];

function buildUrl(enrichedData: any): string | null {
  return enrichedData?.build?.url || null;
}

function honestFallback(phase: string, actor: DiagnosticActor, extra: string, enrichedData: any): PhaseDiagnostic {
  const url = buildUrl(enrichedData);
  const link = url ? ` Consultez le log Jenkins : ${url}` : ' Aucun lien de build disponible pour ce run — consultez Jenkins directement.';
  return { phase, green: false, actor, confidence: 'inconnu', message: `${extra} Cause non identifiée automatiquement.${link}` };
}

// Textes canoniques pour les technicalCode prouvés par WF1 sur CE run (voir
// scanner-diagnostics.ts::TechnicalCode) — priorité absolue sur cascade/
// honestFallback, qui restent un repli pour les runs sans preuve technique
// posée (incidents/reports antérieurs à ce fix, ou scanner qui n'a jamais
// démarré). N'invente rien : ne lit que block.technicalCode/owner/evidence/
// route, déjà posés par WF1 avec preuve.
const TECHNICAL_CODE_MESSAGES: Record<string, (evidence: string, route: string) => string> = {
  SCANNER_CREDENTIAL_INVALID: (evidence) =>
    `Le scanner a démarré mais la credential requise a été rejetée — l'analyse n'a pas pu se terminer.${evidence} `
      + `ACTION (admin/infrastructure) : renouvelez/corrigez la credential dans Jenkins (Manage Credentials). PR non applicable — ce n'est pas un défaut de code.`,
  SCANNER_TIMEOUT: (evidence, route) =>
    `Le scanner a démarré (téléchargement/scan lancé) mais n'a pas terminé dans le délai imparti — timeout technique confirmé, pas une absence de résultat.${evidence} `
      + `ACTION : vérifiez la ressource/réseau du stage${route}.`,
  SCANNER_DATABASE_DOWNLOAD_FAILED: (evidence) =>
    `Le scanner a démarré mais le téléchargement de sa base de données a échoué.${evidence} ACTION : vérifiez la connectivité réseau du stage vers la source de la base.`,
  SONAR_CE_TASK_ID_MISSING: (evidence) =>
    `Sonar a bien soumis l'analyse au serveur (ANALYSIS SUCCESSFUL côté Sonar) mais Jenkins n'a pas pu obtenir le ceTaskId au moment requis — la corrélation quality gate est donc indisponible pour ce build, ce n'est pas un défaut du code analysé.${evidence} `
      + `ACTION : le statut du quality gate affiché n'est pas fiable pour ce build précis — revalidez après correction de la corrélation.`,
  DOCKER_CONFIGURATION_ERROR: (evidence, route) =>
    `L'application a démarré normalement (conteneur up, code de sortie 0) mais le scanner n'a pas pu l'atteindre — mésappariement de topologie Docker/Jenkins (le Docker-in-Docker et l'agent Jenkins sont sur des réseaux distincts malgré le même nom), pas un défaut applicatif.${evidence} `
      + `ACTION : corrigez la configuration Docker/Jenkins${route}.`,
  TARGET_UNAVAILABLE: (evidence, route) =>
    `La cible du scan n'était pas disponible/joignable au moment du stage.${evidence} ACTION : vérifiez que la cible démarre et répond avant ce stage${route}.`,
  NETWORK_FAILURE: (evidence) =>
    `Le scanner a démarré mais une défaillance réseau a empêché l'analyse de se terminer.${evidence} ACTION : vérifiez la connectivité réseau du stage.`,
  RESOURCE_FAILURE: (evidence) =>
    `Le scanner a démarré mais a échoué par manque de ressources (mémoire/disque/CPU) sur l'agent Jenkins.${evidence} ACTION : vérifiez les ressources allouées à l'agent.`,
  SCANNER_REPORT_MISSING: (evidence) =>
    `Le scanner a démarré mais son rapport n'a pas été retrouvé/transmis à la plateforme.${evidence} ACTION : vérifiez la publication du rapport (chemin/volume partagé Jenkins→n8n).`,
};

// route='WF4'/'WF5' : correction possible via un agent d'optimisation
// (Jenkinsfile/Dockerfile) → actor 'agent'. Tout le reste (ADMIN_ACTION_
// REQUIRED, NONE, WF2 credential humaine) reste 'humain' : aucune de ces
// causes n'est un défaut de code auto-corrigeable par le judge/PR flow.
function technicalCodeDiagnostic(phase: string, block: any): PhaseDiagnostic | null {
  const code = block?.technicalCode;
  if (!code || typeof code !== 'string') return null;
  const evidence = Array.isArray(block?.evidence) && block.evidence.length ? ` Preuve : ${block.evidence.join(' ; ')}.` : '';
  const route = block?.route && block.route !== 'NONE' ? ` (routage recommandé : ${block.route})` : '';
  const actor: DiagnosticActor = (block?.route === 'WF4' || block?.route === 'WF5') ? 'agent' : 'humain';
  const build = TECHNICAL_CODE_MESSAGES[code];
  const message = build
    ? build(evidence, route)
    : `Échec technique confirmé (${code}), pas une absence de résultat ni un défaut de code présumé.${evidence} ACTION (${block?.owner || actor}) : voir la preuve ci-dessus${route}.`;
  return { phase, green: false, actor, confidence: 'confirmé', message };
}

// Rule 1 — cascade : le build de CE run a échoué/est instable, donc une
// phase en aval n'a probablement pas eu l'occasion de tourner. On ne prétend
// PAS savoir avec certitude qu'elle a été sautée (pas de liste stage-par-
// stage horodatée dans les données actuelles) — d'où "probable", pas
// "confirmé". On réutilise errorReason/errorStep du MÊME incident plutôt que
// d'inventer une nouvelle cause pour cette phase.
function cascadeDiagnostic(phase: string, enrichedData: any, ctx: IncidentContext | undefined): PhaseDiagnostic | null {
  const status = String(enrichedData?.build?.status || '').toUpperCase();
  if (!BAD_BUILD_STATUSES.includes(status)) return null;

  const cause = ctx?.errorReason || null;
  const step = ctx?.errorStep || null;
  const url = buildUrl(enrichedData);
  const link = url ? ` (log : ${url})` : '';

  if (cause) {
    return {
      phase, green: false, actor: 'agent', confidence: 'probable',
      message: `${phase} n'a pas produit de résultat exploitable : le build Jenkins de ce run est en échec (${step ? step + ' — ' : ''}${cause})${link}. `
        + `ACTION (agent) : corrigez d'abord le build — ${phase} sera réévalué au prochain build réussi.`,
    };
  }
  // Build FAILURE/UNSTABLE confirmé, mais AUCUNE cause capturée pour ce run
  // précis (ex. build UNSTABLE : l'extraction de log ne se déclenche
  // aujourd'hui que sur FAILURE stricte, pas UNSTABLE — vu en base sur de
  // vrais incidents récents, filet honnête plutôt qu'invention).
  return {
    phase, green: false, actor: 'agent', confidence: 'hypothèse',
    message: `${phase} n'a pas produit de résultat exploitable : le build Jenkins de ce run est en échec/instable (statut ${status}) mais la cause précise n'a pas été capturée pour ce run.${link} `
      + `ACTION (agent ou vous) : vérifiez le log Jenkins ci-dessus avant d'agir sur ${phase} spécifiquement.`,
  };
}

export function diagnoseTrivy(enrichedData: any, ctx?: IncidentContext): PhaseDiagnostic {
  const t = enrichedData?.trivy;
  if (t?.status === 'COMPLETED') return { phase: 'Trivy', green: true, actor: null, confidence: 'confirmé', message: 'Trivy a tourné et produit un résultat exploitable.' };

  const tech = technicalCodeDiagnostic('Trivy', t);
  if (tech) return tech;

  const cascade = cascadeDiagnostic('Trivy', enrichedData, ctx);
  if (cascade) return cascade;

  // Build vert mais Trivy quand même UNKNOWN : câblage plateforme le plus
  // probable (volume shared_reports Jenkins→n8n), PAS un problème Trivy
  // lui-même — hypothèse, pas prouvée sur ce run précis.
  return honestFallback(
    'Trivy',
    'humain',
    `Trivy n'a pas produit de résultat exploitable alors que le build a réussi (source: ${t?._source || 'aucune'}). `
      + `Hypothèse la plus probable : le rapport n'a pas été transmis à la plateforme (volume partagé Jenkins→n8n) — pas un vrai résultat de scan absent.`,
    enrichedData,
  );
}

export function diagnoseOwasp(enrichedData: any, ctx?: IncidentContext): PhaseDiagnostic {
  const o = enrichedData?.owasp;
  if (o?.status === 'COMPLETED') return { phase: 'OWASP', green: true, actor: null, confidence: 'confirmé', message: 'OWASP Dependency-Check a tourné et produit un résultat exploitable.' };

  const tech = technicalCodeDiagnostic('OWASP', o);
  if (tech) return tech;

  const cascade = cascadeDiagnostic('OWASP', enrichedData, ctx);
  if (cascade) return cascade;

  return honestFallback(
    'OWASP',
    'humain',
    `OWASP Dependency-Check n'a pas produit de résultat exploitable alors que le build a réussi (source: ${o?._source || 'aucune'}). `
      + `Hypothèse la plus probable (dette connue de ce projet) : la credential 'nvd-api-key' est absente dans Jenkins (Manage Credentials), ce qui empêche le stage de télécharger la base NVD et de produire un rapport.`,
    enrichedData,
  );
}

export function diagnoseZap(enrichedData: any, ctx?: IncidentContext): PhaseDiagnostic {
  const z = enrichedData?.zap;
  if (z?.status === 'COMPLETED') {
    if ((z.alerts_high || 0) > 0) {
      return {
        phase: 'ZAP', green: false, actor: 'humain', confidence: 'confirmé',
        message: `ZAP a bien scanné (cible : ${z.target_url || 'inconnue'}) et trouvé ${z.alerts_high} alerte(s) à risque élevé. `
          + `ACTION (vous) : corrigez la vulnérabilité applicative signalée — voir la carte DAST (ZAP) ci-dessus pour le détail par alerte.`,
      };
    }
    return { phase: 'ZAP', green: true, actor: null, confidence: 'confirmé', message: 'ZAP a tourné et produit un résultat exploitable.' };
  }

  const tech = technicalCodeDiagnostic('ZAP', z);
  if (tech) return tech;

  const cascade = cascadeDiagnostic('ZAP', enrichedData, ctx);
  if (cascade) return cascade;

  const target = z?.target_url ? ` (cible : ${z.target_url})` : '';
  return honestFallback(
    'ZAP',
    'humain',
    `ZAP n'a pas pu scanner${target} alors que le build a réussi. `
      + `Hypothèse la plus probable (dette connue de ce projet) : le conteneur applicatif ne répond pas sur son port dans le délai imparti (timeout DAST) — vérifiez que l'application démarre correctement avant le stage ZAP.`,
    enrichedData,
  );
}

export function diagnoseSonar(enrichedData: any, ctx?: IncidentContext): PhaseDiagnostic {
  const s = enrichedData?.sonar;
  const gate = String(s?.quality_gate || '').toUpperCase();
  if (gate === 'OK' || gate === 'PASSED') {
    return { phase: 'SonarQube', green: true, actor: null, confidence: 'confirmé', message: 'Quality gate SonarQube au vert.' };
  }
  if (gate === 'ERROR' || gate === 'FAILED') {
    return {
      phase: 'SonarQube', green: false, actor: 'agent', confidence: 'confirmé',
      message: `Quality gate SonarQube en échec (${gate}) — ${s?.vulnerabilities || 0} vulnérabilité(s), ${s?.bugs || 0} bug(s), ${s?.code_smells || 0} code smell(s) réels détectés. `
        + `ACTION (agent) : corrigez via WF2 (carte SonarQube).`,
    };
  }
  // gate ni OK/PASSED ni ERROR/FAILED (typiquement UNKNOWN) — priorité au
  // technicalCode posé par WF1 avec preuve (ex. SONAR_CE_TASK_ID_MISSING :
  // analyse soumise, corrélation ceTaskId jamais faite) sur l'heuristique
  // générique ci-dessous, qui reste un repli pour les runs sans cette preuve.
  const tech = technicalCodeDiagnostic('SonarQube', s);
  if (tech) return tech;

  // Distinction CONFIRMÉE par les données elles-mêmes, pas une hypothèse :
  // si des issues réelles existent, Sonar A tourné (l'appel Issues a
  // marché), donc c'est spécifiquement l'appel quality-gate qui a échoué
  // (dette connue : "Text must not be null" côté SonarQube), pas un
  // problème d'accès Sonar en général.
  if ((s?.issues?.length || 0) > 0 || (s?.bugs || 0) + (s?.vulnerabilities || 0) + (s?.code_smells || 0) > 0) {
    return {
      phase: 'SonarQube', green: false, actor: 'humain', confidence: 'confirmé',
      message: `SonarQube a bien analysé le code (${s.issues?.length || 0} issue(s) réelle(s) détectée(s)) mais l'appel quality gate n'a renvoyé aucun statut exploitable (${gate || 'absent'}). `
        + `Le scan fonctionne, c'est l'appel gate spécifiquement qui échoue (dette connue : "Text must not be null"). `
        + `ACTION (vous) : vérifiez la configuration du quality gate dans SonarQube pour ce projet.`,
    };
  }
  const cascade = cascadeDiagnostic('SonarQube', enrichedData, ctx);
  if (cascade) return cascade;
  return honestFallback('SonarQube', 'humain', `SonarQube n'a renvoyé ni issues ni quality gate exploitable (${gate || 'absent'}).`, enrichedData);
}

export function diagnoseTests(enrichedData: any, ctx?: IncidentContext): PhaseDiagnostic {
  const t = enrichedData?.tests;
  const status = String(t?.status || '').toUpperCase();
  if ((t?.failures || 0) > 0) {
    return {
      phase: 'Tests', green: false, actor: 'humain', confidence: 'confirmé',
      message: `${t.failures} test(s) en échec sur ${t.total || '?'} — cause applicative réelle, pas une correction de pipeline. `
        + `ACTION (vous) : corrigez les tests en échec (voir rapport de tests dans Jenkins).`,
    };
  }
  if (['SUCCESS', 'PASSED', 'COMPLETED'].includes(status)) {
    return { phase: 'Tests', green: true, actor: null, confidence: 'confirmé', message: 'Tests exécutés sans échec.' };
  }
  const cascade = cascadeDiagnostic('Tests', enrichedData, ctx);
  if (cascade) return cascade;
  return honestFallback(
    'Tests',
    'humain',
    `Le résultat des tests n'a pas été transmis à la plateforme (statut ${status || 'absent'}) alors que le build a réussi. `
      + `Hypothèse : le Jenkinsfile ne publie pas de résultats de tests exploitables pour ce stage (pas de bloc jenkins.tests dans le webhook).`,
    enrichedData,
  );
}

export function diagnoseDocker(enrichedData: any): PhaseDiagnostic {
  const d = enrichedData?.docker;
  const build = String(d?.build_status || '').toUpperCase();
  const push = String(d?.push_status || '').toUpperCase();
  if (build === 'SUCCESS' && (push === 'SUCCESS' || !push)) {
    return { phase: 'Docker', green: true, actor: null, confidence: 'confirmé', message: 'Build (et push) de l\'image Docker réussi.' };
  }
  if (['FAILURE', 'FAILED'].includes(build)) {
    return { phase: 'Docker', green: false, actor: 'agent', confidence: 'confirmé', message: `Build de l'image Docker en échec. ACTION (agent) : corrigez via WF5.` };
  }
  // CONFIRMÉ, pas une hypothèse : build_status/push_status sont câblés en
  // dur à 'UNKNOWN' dans WF1 (Merge All Fetched Data), quel que soit ce que
  // Jenkins envoie réellement — vérifié dans le code, pas une supposition.
  return {
    phase: 'Docker', green: false, actor: null, confidence: 'confirmé',
    message: `Le statut du build Docker n'est pas remonté à la plateforme — bug de câblage connu et confirmé (WF1 écrit 'UNKNOWN' en dur pour ce champ, quel que soit le résultat réel du build). `
      + `Ce n'est PAS un signal fiable sur l'état réel de Docker : ne pas bloquer un déploiement dessus sans vérifier manuellement dans Jenkins.`,
  };
}
