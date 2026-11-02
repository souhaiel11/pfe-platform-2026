// Provenance de la PUBLICATION d'un artefact (a-t-il réellement été poussé dans le registre, par qui), gardée strictement séparée de l'identité du CODE SOURCE.

const MANIFEST_DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;

export type PublicationChannel = 'CI_CALLBACK' | 'MANUAL_ADMIN';

export type ArtifactPublicationSource = 'PIPELINE_VERIFIED' | 'MANUAL_ATTESTED' | 'UNKNOWN';

export type ArtifactIdentitySource = 'PIPELINE_BUILT' | 'UNKNOWN';

export type PublicationFailureCode =
  | 'PUSH_RECEIPT_MISSING'
  | 'PUSH_RECEIPT_MALFORMED'
  | 'PUSH_RECEIPT_DIGEST_UNCONFIRMED'
  | 'PUSH_RECEIPT_DIGEST_MISMATCH'
  | 'PUSH_RECEIPT_BUILD_MISMATCH'
  | 'PIPELINE_DID_NOT_PUBLISH'
  | 'PUBLICATION_ATTESTATION_MISSING';

/** Reçu de poussée qu'un run CI doit fournir pour être cru : digest de manifeste, build, URL Jenkins. */
export interface ArtifactPushReceipt {
  manifestDigest: string;
  buildNumber: number;
  jenkinsBuildUrl: string;
}

/** Entrée de l'évaluation de publication : canal d'appel, reçu de poussée, et faits re-dérivés indépendamment par le backend. */
export interface PublicationEvaluationInput {
  channel: PublicationChannel;
  pushReceipt?: ArtifactPushReceipt | null;
  registryConfirmedDigest: string | null;
  resolvedBuildNumber: number | null;
  reportedPushStatus: string | null;
  attestedByUserId?: string | null;
}

/** Résultat de l'évaluation de publication : verdict, raison d'échec éventuelle, preuve lisible et éléments comparés. */
export interface PublicationEvaluationResult {
  publicationSource: ArtifactPublicationSource;
  failureCode: PublicationFailureCode | null;
  evidence: string;
  receipt: {
    channel: PublicationChannel;
    claimedManifestDigest: string | null;
    registryConfirmedDigest: string | null;
    claimedBuildNumber: number | null;
    resolvedBuildNumber: number | null;
    reportedPushStatus: string | null;
    jenkinsBuildUrl: string | null;
    attestedByUserId: string | null;
  };
}

const PUSH_STATUS_PROVING_PUBLICATION = ['SUCCESS'];

/** Détermine QUI a prouvé avoir publié l'image, séparément de qui a prouvé l'avoir construite. */
export function evaluateArtifactPublication(input: PublicationEvaluationInput): PublicationEvaluationResult {
  const receipt: PublicationEvaluationResult['receipt'] = {
    channel: input.channel,
    claimedManifestDigest: input.pushReceipt?.manifestDigest ?? null,
    registryConfirmedDigest: input.registryConfirmedDigest ?? null,
    claimedBuildNumber: input.pushReceipt?.buildNumber ?? null,
    resolvedBuildNumber: input.resolvedBuildNumber ?? null,
    reportedPushStatus: input.reportedPushStatus ?? null,
    jenkinsBuildUrl: input.pushReceipt?.jenkinsBuildUrl ?? null,
    attestedByUserId: input.attestedByUserId ?? null,
  };
  /** Construit le résultat inconnu. */
  const unknown = (failureCode: PublicationFailureCode, evidence: string): PublicationEvaluationResult =>
    ({ publicationSource: 'UNKNOWN', failureCode, evidence, receipt });

  if (input.channel === 'MANUAL_ADMIN') {
    if (!input.attestedByUserId) {
      return unknown(
        'PUBLICATION_ATTESTATION_MISSING',
        "Enregistrement manuel sans attestation nominative — aucune identité n'est au dossier pour la publication, donc publication UNKNOWN (jamais promue en MANUAL_ATTESTED par défaut).",
      );
    }
    const pipelineClaimNote = input.pushReceipt
      ? " Un reçu de poussée a été fourni sur ce canal : il est conservé pour l'audit mais ne peut JAMAIS conférer PIPELINE_VERIFIED (le point d'entrée ne confère aucun statut)."
      : '';
    return {
      publicationSource: 'MANUAL_ATTESTED',
      failureCode: null,
      evidence:
        `Publication attestée manuellement par l'administrateur authentifié ${input.attestedByUserId} via POST /artifacts/register.`
        + " Porte sur l'acte de publication uniquement — n'affirme rien de plus que la responsabilité assumée par cette identité."
        + pipelineClaimNote,
      receipt,
    };
  }

  if (!input.pushReceipt) {
    return unknown(
      'PUSH_RECEIPT_MISSING',
      "Aucun reçu de poussée transmis par le pipeline — l'exécution n'a pas démontré avoir publié ce digest. "
        + "L'identité du code source peut rester prouvée par ailleurs : ce verdict ne porte QUE sur la publication.",
    );
  }
  const claimed = input.pushReceipt.manifestDigest;
  if (typeof claimed !== 'string' || !MANIFEST_DIGEST_RE.test(claimed)) {
    return unknown(
      'PUSH_RECEIPT_MALFORMED',
      `Reçu de poussée mal formé (manifestDigest="${claimed}") — doit être le digest de MANIFESTE sha256:<64 hex> imprimé par docker push, jamais le digest de configuration imprimé par docker build.`,
    );
  }
  if (!input.pushReceipt.jenkinsBuildUrl) {
    return unknown('PUSH_RECEIPT_MALFORMED', 'Reçu de poussée sans jenkinsBuildUrl — la preuve ne serait pas re-vérifiable par un auditeur.');
  }
  if (!input.registryConfirmedDigest || !MANIFEST_DIGEST_RE.test(input.registryConfirmedDigest)) {
    return unknown(
      'PUSH_RECEIPT_DIGEST_UNCONFIRMED',
      'Le registre ne confirme aucun digest de manifeste exploitable pour ce tag — un reçu seul ne peut pas tenir lieu de confirmation par le registre.',
    );
  }
  if (claimed.toLowerCase() !== input.registryConfirmedDigest.toLowerCase()) {
    return unknown(
      'PUSH_RECEIPT_DIGEST_MISMATCH',
      `Le digest du reçu de poussée ("${claimed}") ≠ le digest confirmé par le registre ("${input.registryConfirmedDigest}") — le pipeline a publié d'autres octets que ceux portés aujourd'hui par ce tag.`,
    );
  }
  if (!input.resolvedBuildNumber || input.pushReceipt.buildNumber !== input.resolvedBuildNumber) {
    return unknown(
      'PUSH_RECEIPT_BUILD_MISMATCH',
      `Le reçu attribue la poussée au build #${input.pushReceipt.buildNumber} alors que le build réellement résolu pour cet artefact est #${input.resolvedBuildNumber ?? 'non résolu'} — un reçu d'une autre exécution ne prouve pas celle-ci.`,
    );
  }
  const reported = String(input.reportedPushStatus || '').toUpperCase();
  if (!PUSH_STATUS_PROVING_PUBLICATION.includes(reported)) {
    return unknown(
      'PIPELINE_DID_NOT_PUBLISH',
      `Le pipeline lui-même rapporte push_status="${input.reportedPushStatus ?? 'absent'}" pour le build #${input.resolvedBuildNumber} — seule la valeur SUCCESS prouve une publication. Un reçu ne peut pas contredire la télémétrie de l'exécution qu'il prétend décrire.`,
    );
  }

  return {
    publicationSource: 'PIPELINE_VERIFIED',
    failureCode: null,
    evidence:
      `Publication prouvée : docker push du build #${input.pushReceipt.buildNumber} (${input.pushReceipt.jenkinsBuildUrl}) a rapporté le digest de manifeste ${claimed}, `
      + `identique au digest confirmé indépendamment par le registre, pour le build réellement résolu #${input.resolvedBuildNumber}, avec push_status=${reported}.`,
    receipt,
  };
}

/** Traduit le booléen provenanceVerified en vocabulaire d'identité du code source (claim A), distinct de la publication (claim C) : PIPELINE_BUILT ou UNKNOWN. */
export function deriveArtifactIdentitySource(provenanceVerified: boolean): ArtifactIdentitySource {
  return provenanceVerified ? 'PIPELINE_BUILT' : 'UNKNOWN';
}

const PUBLICATION_SOURCES_ALLOWING_DEPLOYMENT: readonly ArtifactPublicationSource[] = ['PIPELINE_VERIFIED', 'MANUAL_ATTESTED'];

/** Porte d'autorisation fail-closed : seules PIPELINE_VERIFIED et MANUAL_ATTESTED autorisent un déploiement ; UNKNOWN, null, absent ou une valeur future inconnue sont toujours refusés. */
export function publicationAllowsDeployment(source: ArtifactPublicationSource | null | undefined): boolean {
  return !!source && PUBLICATION_SOURCES_ALLOWING_DEPLOYMENT.includes(source);
}
