// Constat de merge sans l'API GitHub : le flux Atom public des commits de la branche par défaut n'entame pas le quota
// de l'API (60 requêtes/heure sans jeton). Utilisé seulement en secours, quand l'API refuse ou ne répond pas.

/** Cherche, dans un flux Atom de commits, le commit « Merge pull request #N from <owner>/… » ; null s'il n'y figure pas. */
export function findMergeInCommitFeed(feed: string, prNumber: number, owner: string): { mergeCommitSha: string; mergedAt: string } | null {
  for (const entry of feed.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const title = entry.match(/<title>\s*([\s\S]*?)\s*<\/title>/)?.[1] || '';
    if (!title.startsWith(`Merge pull request #${prNumber} from ${owner}/`)) continue;
    const sha = entry.match(/Commit\/([0-9a-f]{40})</)?.[1];
    const at = entry.match(/<updated>([^<]+)<\/updated>/)?.[1];
    if (sha && at && Number.isFinite(Date.parse(at))) return { mergeCommitSha: sha, mergedAt: at };
  }
  return null;
}

/** Lit le flux des commits de la branche par défaut (HEAD) et y cherche le merge de la PR ; null si introuvable ou injoignable. */
export async function mergeFromCommitFeed(repository: string, prNumber: number) {
  try {
    const res = await fetch(`https://github.com/${repository}/commits/HEAD.atom`, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? findMergeInCommitFeed(await res.text(), prNumber, repository.split('/')[0]) : null;
  } catch {
    return null;
  }
}
