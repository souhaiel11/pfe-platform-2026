// Garde SSRF du webhook Jenkins : le payload fournit build_url, et le backend allait lire
// `${build_url}consoleText` quelle que soit sa cible (réseau interne, métadonnées cloud…).
import { resolveJenkinsInternalUrl, resolveJenkinsPublicUrl } from '../common/jenkins-url';

type JenkinsUrlSource = Parameters<typeof resolveJenkinsInternalUrl>[0];

/** Renvoie l'URL du log console d'un build uniquement s'il appartient au Jenkins configuré du projet (toujours lue via son URL interne), sinon null. */
export function trustedJenkinsConsoleUrl(buildUrl: string, project: JenkinsUrlSource | null | undefined): string | null {
  if (!project) return null;
  let target: URL;
  try { target = new URL(String(buildUrl || '')); } catch { return null; }
  if (target.username || target.password || target.search || target.hash) return null;
  const internal = resolveJenkinsInternalUrl(project);
  if (!internal) return null;
  const allowedOrigins = new Set<string>();
  for (const base of [internal, resolveJenkinsPublicUrl(project)]) {
    try { if (base) allowedOrigins.add(new URL(base).origin); } catch { /* URL de projet invalide : ignorée */ }
  }
  if (!allowedOrigins.has(target.origin)) return null;
  // Un build Jenkins, y compris multibranche : /job/<a>[/job/<b>…]/<numéro>/
  if (!/^\/job\/[^/]+(?:\/job\/[^/]+)*\/\d+\/?$/.test(target.pathname)) return null;
  return `${internal}${target.pathname.replace(/\/?$/, '/')}consoleText`;
}
