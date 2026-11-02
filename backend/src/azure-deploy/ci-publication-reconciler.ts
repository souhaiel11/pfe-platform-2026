// Reçu de poussée d'une image publiée par le pipeline, reconstitué côté plateforme.
// La bibliothèque partagée (R59) pousse l'image puis rapporte provenance_status=PENDING sans digest :
// elle n'envoie plus de reçu. Le digest de MANIFESTE imprimé par `docker push` reste lisible dans le
// log console du build ; on le relit dans le Jenkins configuré du projet (garde SSRF + lecture
// authentifiée), puis registerArtifact() le recoupe indépendamment avec le registre.

/** Digest de manifeste imprimé par `docker push` pour ce tag (« <tag>: digest: sha256:… size: … »), ou null. */
export function extractPushedManifestDigest(consoleText: string, publishedTag: string): string | null {
  if (!publishedTag || !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(publishedTag)) return null;
  const escaped = publishedTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...String(consoleText || '').matchAll(new RegExp(`^${escaped}: digest: (sha256:[a-f0-9]{64}) size: \\d+`, 'gim'))]
    .map(m => m[1].toLowerCase());
  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0] : null;
}

/** Publication en attente d'enregistrement décrite par l'incident ingéré par WF1, ou null si elle n'est pas exploitable. */
export function pendingPublicationOf(incident: { buildNumber?: number | null; metadata?: any } | null | undefined) {
  const meta = incident?.metadata || {};
  const docker = meta?.enrichedData?.docker || {};
  const commitSha = String(meta?.sourceCommitSha || '');
  const buildNumber = Number(incident?.buildNumber);
  if (String(docker.provenance_status || '').toUpperCase() !== 'PENDING' || String(docker.push_status || '').toUpperCase() !== 'SUCCESS') return null;
  if (!/^[0-9a-f]{40}$/i.test(commitSha) || !Number.isInteger(buildNumber) || buildNumber < 1) return null;
  if (!docker.published_tag || !docker.repository || !meta.build_url) return null;
  return { buildNumber, commitSha: commitSha.toLowerCase(), repository: String(docker.repository), tag: String(docker.published_tag), buildUrl: String(meta.build_url) };
}
