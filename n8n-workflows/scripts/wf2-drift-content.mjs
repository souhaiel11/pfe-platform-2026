// Extrait le contenu exécutable sans les annotations visuelles.
import { createHash } from 'node:crypto';

// Conservative exclusion list: unknown node/setting fields remain executable.
// Node names/IDs remain because connections and expressions reference them.
const editorFields = new Set(['position', 'notes', 'notesInFlow', 'color']);
const editorSettings = new Set(['editor']);
/** Vérifie l’état suivant : Sticky. */
export const isSticky = n => n.type === 'n8n-nodes-base.stickyNote';
/** Retrouve les paramètres exécutables du nœud. */
export const executableNode = n => Object.fromEntries(Object.entries(n).filter(([k]) => !editorFields.has(k)));
/** Choisit la cible d’édition correspondant au correctif. */
const pickEditor = n => Object.fromEntries(Object.entries(n).filter(([k]) => editorFields.has(k)));
/** Extrait le contenu exécutable sans les annotations visuelles. */
export function executableContent(w) {
  return {
    nodes: w.nodes.filter(n => !isSticky(n)).map(executableNode).sort((a,b) => a.id.localeCompare(b.id)),
    connections: w.connections,
    settings: Object.fromEntries(Object.entries(w.settings || {}).filter(([k]) => !editorSettings.has(k))),
  };
}
/** Extrait les éléments visuels du workflow. */
export function presentationContent(w) {
  return {
    nodes: w.nodes.filter(n => !isSticky(n)).map(n => ({ id:n.id, ...pickEditor(n) })).sort((a,b) => a.id.localeCompare(b.id)),
    stickyNotes: w.nodes.filter(isSticky).sort((a,b) => a.id.localeCompare(b.id)),
    name: w.name ?? null, description: w.description ?? null,
    settings: Object.fromEntries(Object.entries(w.settings || {}).filter(([k]) => editorSettings.has(k))),
  };
}
/** Convertit les données en forme canonique. */
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
/** Calcule l’empreinte SHA-256 du contenu. */
export const sha256 = value => createHash('sha256').update(canonical(value)).digest('hex');
/** Compare les éléments visuels sans modifier l’exécution. */
export function presentationDiff(reference, current) {
  const old = new Map(reference.nodes.map(n => [n.id,n]));
  const now = new Map(current.nodes.map(n => [n.id,n]));
  const ids = [...new Set([...old.keys(),...now.keys()])].sort();
  return {
    positions: ids.filter(id => canonical(old.get(id)?.position ?? null) !== canonical(now.get(id)?.position ?? null)).map(id => now.get(id)?.name || old.get(id).name),
    stickyNotes: ids.filter(id => (isSticky(old.get(id) || {}) || isSticky(now.get(id) || {})) && canonical(old.get(id) ?? null) !== canonical(now.get(id) ?? null)).map(id => now.get(id)?.name || old.get(id).name),
  };
}
