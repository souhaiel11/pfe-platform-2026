import { securityFindingFingerprint } from './security-finding-fingerprint';
import { SecurityRemediationTask } from './security-remediation.types';
export interface SecurityFindingRow {
  id: string; pkg: string; source: string;
  findingTaskId?: string | null;
  severity?: string; installedVersion?: string; fixedVersion?: string;
  historical?: boolean; title?: string; description?: string; primaryUrl?: string;
  cvss?: number | null;
}
/** Exact canonical facts used by backend findingFingerprint (versions excluded).
 * OWASP raw package is legacyPackage, never the resolved Maven coordinate.
 * No substring matching, package inference, or CVE-only association.
 */
function rowKey(row: SecurityFindingRow): string {
  if (!row.id || !row.pkg) throw new Error('Identité exacte du finding indisponible');
  return securityFindingFingerprint(row.source, row.id, row.pkg);
}
function taskRow(task: SecurityRemediationTask): SecurityFindingRow {
  const snapshot = task.findingSnapshot;
  return { id: snapshot?.ruleOrCve || task.ruleOrCve || '',
    pkg: (task.source === 'OWASP' ? snapshot?.legacyPackage || snapshot?.component : snapshot?.component) || '',
    source: task.source, findingTaskId: task.id, historical: true,
    severity: snapshot?.severity || task.severity || 'UNKNOWN', title: snapshot?.title || task.title || '',
    installedVersion: '', fixedVersion: '' };
}
export function mergeSecurityFindings(current: SecurityFindingRow[], tasks: SecurityRemediationTask[], source: string): SecurityFindingRow[] {
  const relevant = tasks.filter(t => t.source === source);
  const byId = new Map(relevant.map(t => [t.id, t]));
  const byKey = new Map<string, SecurityRemediationTask>();
  const taskKeys = (task: SecurityRemediationTask): string[] => {
    const snapshot = task.findingSnapshot;
    const keys = task.findingFingerprint ? [task.findingFingerprint] : [];
    if (task.source !== 'OWASP' || snapshot?.legacyPackage) keys.push(rowKey(taskRow(task)));
    // Exact aliases already used by backend taskFingerprintAliases/owaspLegacyFingerprint.
    if (task.source === 'OWASP' && snapshot?.packageType === 'maven' && snapshot.pkg) {
      keys.push(securityFindingFingerprint('OWASP', snapshot.ruleOrCve || task.ruleOrCve || '', snapshot.pkg));
    }
    if (!keys.length) throw new Error('Identité exacte du finding indisponible');
    return [...new Set(keys)];
  };
  for (const task of relevant) for (const key of taskKeys(task)) {
    if (byKey.has(key) && byKey.get(key)?.id !== task.id) throw new Error('Identité du finding ambiguë');
    byKey.set(key, task);
  }
  const out = new Map<string, SecurityFindingRow>();
  const seenTasks = new Set<string>();
  for (const raw of current) {
    const row = { ...raw, source };
    const key = rowKey(row);
    const task = row.findingTaskId ? byId.get(row.findingTaskId) : byKey.get(key);
    if (task && !taskKeys(task).includes(key)) throw new Error('Identité du finding incohérente');
    // A known server task ID must never silently fall back to another task.
    if (row.findingTaskId && !task && byKey.has(key)) throw new Error('Identité du finding incohérente');
    if (task) seenTasks.add(task.id);
    out.set(key, { ...row, findingTaskId: task?.id ?? row.findingTaskId, historical: false });
  }
  for (const task of relevant) if (!seenTasks.has(task.id)) {
    const row = taskRow(task);
    const key = taskKeys(task)[0];
    if (out.has(key)) throw new Error('Identité du finding incohérente');
    out.set(key, row);
  }
  const identities = new Set<string>();
  return [...out.values()].filter(row => {
    const identity = row.findingTaskId ? `task:${row.findingTaskId}` : rowKey(row);
    if (identities.has(identity)) return false;
    identities.add(identity); return true;
  });
}
