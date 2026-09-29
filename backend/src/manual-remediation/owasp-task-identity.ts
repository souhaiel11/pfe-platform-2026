import { findingFingerprint } from './finding-fingerprint';

/** Add a canonical lookup alias without rewriting existing persisted identities. */
export function taskFingerprintAliases(task: any): string[] {
  const aliases = [task.findingFingerprint];
  if (task.source === 'OWASP' && task.findingSnapshot?.packageType === 'maven' && task.findingSnapshot?.pkg) {
    aliases.push(findingFingerprint('OWASP', { id: task.findingSnapshot.ruleOrCve, pkg: task.findingSnapshot.pkg }));
  }
  return [...new Set(aliases)];
}

export function owaspLegacyFingerprint(finding: any): string | null {
  return finding.packageType === 'maven' && finding.legacyPackage
    ? findingFingerprint('OWASP', { id: finding.id, pkg: finding.legacyPackage }) : null;
}
