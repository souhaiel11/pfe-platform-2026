/** Calcule des alias d'empreinte pour retrouver une tâche OWASP même après un renommage de package, sans jamais réécrire les identités déjà persistées. */
import { findingFingerprint } from './finding-fingerprint';

/** Calcule les empreintes alternatives (dont l'ancien nom de package) sous lesquelles une tâche OWASP peut déjà exister. */
export function taskFingerprintAliases(task: any): string[] {
  const aliases = [task.findingFingerprint];
  if (task.source === 'OWASP' && task.findingSnapshot?.packageType === 'maven' && task.findingSnapshot?.pkg) {
    aliases.push(findingFingerprint('OWASP', { id: task.findingSnapshot.ruleOrCve, pkg: task.findingSnapshot.pkg }));
  }
  return [...new Set(aliases)];
}

/** Calcule l'ancienne empreinte OWASP (avant renommage de package) pour retrouver une tâche créée sous le nom legacy. */
export function owaspLegacyFingerprint(finding: any): string | null {
  return finding.packageType === 'maven' && finding.legacyPackage
    ? findingFingerprint('OWASP', { id: finding.id, pkg: finding.legacyPackage }) : null;
}
