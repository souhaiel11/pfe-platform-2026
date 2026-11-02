// Refuse, avant tout lancement WF6, une vulnérabilité que la branche par défaut a déjà corrigée : le scan affiché
// date d'avant la fusion, et rejouer la correction retomberait sur la PR déjà fusionnée (ALREADY_MERGED) sans rien afficher.
import { ConflictException } from '@nestjs/common';

export interface DeclaredVersionTask { ruleOrCve?: string | null; findingSnapshot?: any }

/** Version déclarée d'une dépendance (groupId:artifactId) dans un pom.xml, propriété ${…} résolue ; null si la dépendance n'y est pas déclarée directement. */
export function declaredPomVersion(pom: string, component: string): string | null {
  const [groupId, artifactId] = String(component).split(':');
  if (!groupId || !artifactId) return null;
  const xml = pom.replace(/<!--[\s\S]*?-->/g, '');
  const props = new Map<string, string>();
  const propsBlock = xml.match(/<properties>([\s\S]*?)<\/properties>/);
  for (const m of (propsBlock?.[1] || '').matchAll(/<([A-Za-z0-9_.-]+)>\s*([^<\s]+)\s*<\/\1>/g)) props.set(m[1], m[2]);
  for (const m of xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = m[1];
    const tag = (name: string) => block.match(new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`))?.[1] ?? null;
    if (tag('groupId') !== groupId || tag('artifactId') !== artifactId) continue;
    const version = tag('version');
    if (!version) return null;
    const prop = version.match(/^\$\{([^}]+)\}$/);
    return prop ? props.get(prop[1]) ?? null : version;
  }
  return null;
}

/** Lève un refus lisible pour chaque tâche dont la version installée (scan) n'est plus celle déclarée sur la branche par défaut. */
export function assertNotAlreadyFixedOnDefaultBranch(pom: string, tasks: DeclaredVersionTask[], branch = 'main') {
  const fixed = tasks.flatMap(task => {
    const component = String(task.findingSnapshot?.component || '');
    const scanned = String(task.findingSnapshot?.currentVersion || '');
    const declared = declaredPomVersion(pom, component);
    return declared && scanned && declared !== scanned ? [{ cve: task.ruleOrCve, artifact: component.split(':')[1], scanned, declared }] : [];
  });
  if (!fixed.length) return;
  const detail = fixed.map(f => `${f.artifact} (${f.cve}) est déjà en ${f.declared} sur ${branch}, le scan affiché indique encore ${f.scanned}`).join(' ; ');
  throw new ConflictException({ code: 'SECURITY_FINDING_ALREADY_FIXED_ON_DEFAULT_BRANCH', status: 'ALREADY_FIXED',
    message: `Déjà corrigé sur ${branch} : ${detail}. Le résultat du scan date d’avant la fusion. Relancez un build Jenkins pour actualiser la liste, ou remettez pom.xml à son état initial. Aucune correction n’a été lancée.` });
}

/** Lit pom.xml sur la branche par défaut via l'API GitHub ; null si GitHub est injoignable (le contrôle est alors ignoré, WF6 reste protégé). */
export async function fetchDefaultBranchPom(repository: string, token?: string | null): Promise<{ pom: string; branch: string } | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!token) {
    // Sans jeton, l'API GitHub est limitée à 60 requêtes/heure : raw.githubusercontent.com (HEAD = branche par défaut) n'entame pas ce quota.
    try {
      const raw = await fetch(`https://raw.githubusercontent.com/${repository}/HEAD/pom.xml`, { signal: AbortSignal.timeout(10_000) });
      return raw.ok ? { pom: await raw.text(), branch: 'la branche par défaut' } : null;
    } catch {
      return null;
    }
  }
  try {
    const repo = await fetch(`https://api.github.com/repos/${repository}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!repo.ok) return null;
    const branch = String((await repo.json())?.default_branch || '');
    if (!branch) return null;
    const res = await fetch(`https://api.github.com/repos/${repository}/contents/pom.xml?ref=${encodeURIComponent(branch)}`,
      { headers: { ...headers, Accept: 'application/vnd.github.raw' }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? { pom: await res.text(), branch } : null;
  } catch {
    return null;
  }
}
