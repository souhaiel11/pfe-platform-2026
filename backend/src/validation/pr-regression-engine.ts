// Analyse de régression déterministe sur une PR : la tête de PR validée introduit-elle de NOUVEAUX findings bloquants par rapport à la baseline de remédiation immuable ?

import { computeFindingFingerprint } from './finding-fingerprint';

export interface RegressionFinding {
  source: string;
  rule: string;
  path: string;
  message?: string | null;
  severity?: string | null;
  line?: number | null;
}

export interface IdentifiedFinding extends RegressionFinding {
  fingerprint: string | null;
}

export interface RegressionSnapshot {
  sha: string | null;
  findings: readonly RegressionFinding[];
  complete: boolean;
}

export interface RegressionPolicy {
  /** Vérifie l’état suivant : Blocking. */
  isBlocking(finding: RegressionFinding): boolean;
}

export interface RegressionInput {
  expectedCandidateSha: string;
  baseline: RegressionSnapshot;
  candidate: RegressionSnapshot;
  policy: RegressionPolicy;
}

export type RegressionResult = 'CLEAN' | 'CHANGES_REQUIRED' | 'INCONCLUSIVE';

export interface RegressionOutput {
  baselineSha: string | null;
  candidateSha: string | null;
  baselineSnapshotComplete: boolean;
  candidateSnapshotComplete: boolean;
  preExistingFindings: IdentifiedFinding[];
  resolvedFindings: IdentifiedFinding[];
  introducedFindings: IdentifiedFinding[];
  ambiguousFindings: IdentifiedFinding[];
  blockingIntroducedFindings: IdentifiedFinding[];
  preExistingCount: number;
  resolvedCount: number;
  introducedCount: number;
  ambiguousCount: number;
  warnings: string[];
  result: RegressionResult;
}

// Politique par défaut, maximalement conservatrice : tout finding nouvellement
// introduit est bloquant, sans exception — la seule politique utilisée en
// production tant qu'aucune classification de sévérité/règle officielle n'existe.
export const conservativeRegressionPolicy: RegressionPolicy = {
/** Vérifie l’état suivant : Blocking. */
isBlocking: () => true };

// Construit un résultat INCONCLUSIVE vide, utilisé dès qu'une preuve requise (SHA,
// complétude) manque avant toute comparaison.
function inconclusive(baseline: RegressionSnapshot, candidate: RegressionSnapshot, warnings: string[]): RegressionOutput {
  return {
    baselineSha: baseline.sha ?? null, candidateSha: candidate.sha ?? null,
    baselineSnapshotComplete: baseline.complete === true, candidateSnapshotComplete: candidate.complete === true,
    preExistingFindings: [], resolvedFindings: [], introducedFindings: [], ambiguousFindings: [], blockingIntroducedFindings: [],
    preExistingCount: 0, resolvedCount: 0, introducedCount: 0, ambiguousCount: 0,
    warnings, result: 'INCONCLUSIVE',
  };
}

// Normalise le message d'un finding pour servir de preuve secondaire de
// désambiguïsation (chaîne vide si absent).
function normalizedMessage(finding: RegressionFinding): string {
  return String(finding.message ?? '').trim();
}

// Attache à un finding son empreinte canonique (ou `null` si elle n'a pas pu être calculée).
function identify(finding: RegressionFinding): IdentifiedFinding {
  return { ...finding, fingerprint: computeFindingFingerprint(finding) };
}

/** Prépare le résultat lié à analyze régression. */
export function analyzeRegression(input: RegressionInput): RegressionOutput {
  const { baseline, candidate, policy, expectedCandidateSha } = input;

  if (!baseline.sha) return inconclusive(baseline, candidate, ['BASELINE_SHA_UNAVAILABLE']);
  if (!baseline.complete) return inconclusive(baseline, candidate, ['BASELINE_SNAPSHOT_INCOMPLETE']);
  if (!candidate.sha) return inconclusive(baseline, candidate, ['CANDIDATE_SHA_UNAVAILABLE']);
  if (!candidate.complete) return inconclusive(baseline, candidate, ['CANDIDATE_SNAPSHOT_INCOMPLETE']);
  if (!expectedCandidateSha || candidate.sha.toLowerCase() !== String(expectedCandidateSha).toLowerCase()) {
    return inconclusive(baseline, candidate, ['CANDIDATE_SHA_MISMATCH']);
  }

  const warnings: string[] = [];

  const baselineIdentified = baseline.findings.map(identify);
  const candidateIdentified = candidate.findings.map(identify);

  /** Classe le résultat dans la catégorie correspondante. */
  const bucket = (findings: IdentifiedFinding[]) => {
    const map = new Map<string, IdentifiedFinding[]>();
    for (const finding of findings) {
      if (finding.fingerprint == null) continue;
      const existing = map.get(finding.fingerprint);
      if (existing) existing.push(finding); else map.set(finding.fingerprint, [finding]);
    }
    return map;
  };
  const baselineBuckets = bucket(baselineIdentified);
  const candidateBuckets = bucket(candidateIdentified);
  const baselineUnfingerprintable = baselineIdentified.filter(f => f.fingerprint == null);
  if (baselineUnfingerprintable.length > 0) warnings.push('BASELINE_FINDING_UNFINGERPRINTABLE');

  const preExistingFindings: IdentifiedFinding[] = [];
  const introducedFindings: IdentifiedFinding[] = [];
  const ambiguousFindings: IdentifiedFinding[] = [
    ...baselineUnfingerprintable,
    ...candidateIdentified.filter(f => f.fingerprint == null),
  ];
  const blockingIntroducedFindings: IdentifiedFinding[] = [];
  const resolvedFindings: IdentifiedFinding[] = [];

  // Enregistre un finding comme « introduit », et en plus comme « bloquant » si la
  // politique fournie le juge bloquant.
  const introduce = (finding: IdentifiedFinding) => {
    introducedFindings.push(finding);
    if (policy.isBlocking(finding)) blockingIntroducedFindings.push(finding);
  };

  const allFingerprints = new Set([...baselineBuckets.keys(), ...candidateBuckets.keys()]);
  for (const fingerprint of allFingerprints) {
    const baselineOccurrences = baselineBuckets.get(fingerprint) ?? [];
    const candidateOccurrences = candidateBuckets.get(fingerprint) ?? [];

    if (baselineOccurrences.length <= 1 && candidateOccurrences.length <= 1) {
      const matched = Math.min(baselineOccurrences.length, candidateOccurrences.length);
      for (let i = 0; i < matched; i++) preExistingFindings.push(candidateOccurrences[i]);
      for (let i = matched; i < candidateOccurrences.length; i++) introduce(candidateOccurrences[i]);
      for (let i = matched; i < baselineOccurrences.length; i++) resolvedFindings.push(baselineOccurrences[i]);
      continue;
    }

    // Sous-regroupe une collision d'empreinte par texte de message (preuve
    // secondaire) pour désambiguïser ce qui peut l'être, sans jamais deviner le reste.
    const groupByMessage = (findings: IdentifiedFinding[]) => {
      const groups = new Map<string, IdentifiedFinding[]>();
      const noEvidence: IdentifiedFinding[] = [];
      for (const finding of findings) {
        const message = normalizedMessage(finding);
        if (!message) { noEvidence.push(finding); continue; }
        const group = groups.get(message);
        if (group) group.push(finding); else groups.set(message, [finding]);
      }
      return { groups, noEvidence };
    };
    const baselineByMessage = groupByMessage(baselineOccurrences);
    const candidateByMessage = groupByMessage(candidateOccurrences);
    const baselineLeftover: IdentifiedFinding[] = [...baselineByMessage.noEvidence];
    const candidateLeftover: IdentifiedFinding[] = [...candidateByMessage.noEvidence];

    const allMessages = new Set([...baselineByMessage.groups.keys(), ...candidateByMessage.groups.keys()]);
    for (const message of allMessages) {
      const baselineGroup = baselineByMessage.groups.get(message) ?? [];
      const candidateGroup = candidateByMessage.groups.get(message) ?? [];
      const matched = Math.min(baselineGroup.length, candidateGroup.length);
      for (let i = 0; i < matched; i++) preExistingFindings.push(candidateGroup[i]);
      for (let i = matched; i < candidateGroup.length; i++) candidateLeftover.push(candidateGroup[i]);
      for (let i = matched; i < baselineGroup.length; i++) baselineLeftover.push(baselineGroup[i]);
    }

    if (baselineLeftover.length > 0 && candidateLeftover.length > 0) {
      ambiguousFindings.push(...baselineLeftover, ...candidateLeftover);
    } else if (candidateLeftover.length > 0) {
      for (const finding of candidateLeftover) introduce(finding);
    } else if (baselineLeftover.length > 0) {
      resolvedFindings.push(...baselineLeftover);
    }
  }

  const result: RegressionResult = ambiguousFindings.length > 0
    ? 'INCONCLUSIVE'
    : blockingIntroducedFindings.length > 0
    ? 'CHANGES_REQUIRED'
    : 'CLEAN';

  return {
    baselineSha: baseline.sha, candidateSha: candidate.sha,
    baselineSnapshotComplete: baseline.complete === true, candidateSnapshotComplete: candidate.complete === true,
    preExistingFindings, resolvedFindings, introducedFindings, ambiguousFindings, blockingIntroducedFindings,
    preExistingCount: preExistingFindings.length, resolvedCount: resolvedFindings.length,
    introducedCount: introducedFindings.length, ambiguousCount: ambiguousFindings.length,
    warnings, result,
  };
}
