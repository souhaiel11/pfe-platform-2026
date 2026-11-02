// Construit une modification ciblée du propriétaire de version dans pom.xml, par exemple la version du parent, en évitant les autres balises version.
import { RemediationPlan } from './remediation-plan';

export interface OwnerPomEditResult {
  ok: boolean;
  content: string | null;
  reason: string;
}

/** Applique parent version Edit. */
function applyParentVersionEdit(pomXmlText: string, groupId: string, artifactId: string, newVersion: string): OwnerPomEditResult {
  const parentMatch = pomXmlText.match(/<parent>([\s\S]*?)<\/parent>/);
  if (!parentMatch) return { ok: false, content: null, reason: 'NO_PARENT_BLOCK_FOUND' };
  const block = parentMatch[1];
  if (!block.includes(`<groupId>${groupId}</groupId>`) || !block.includes(`<artifactId>${artifactId}</artifactId>`)) {
    return { ok: false, content: null, reason: `PARENT_BLOCK_DOES_NOT_MATCH_OWNER:${groupId}:${artifactId}` };
  }
  const versionMatch = block.match(/<version>([^<]+)<\/version>/);
  if (!versionMatch) return { ok: false, content: null, reason: 'PARENT_VERSION_ELEMENT_NOT_FOUND' };
  const newBlock = block.replace(`<version>${versionMatch[1]}</version>`, `<version>${newVersion}</version>`);
  const newParentSection = `<parent>${newBlock}</parent>`;
  const content = pomXmlText.replace(parentMatch[0], newParentSection);
  return { ok: true, content, reason: 'PARENT_VERSION_REPLACED' };
}

/** Applique BOM version Edit. */
function applyBomVersionEdit(pomXmlText: string, groupId: string, artifactId: string, newVersion: string): OwnerPomEditResult {
  const dmMatch = pomXmlText.match(/<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/);
  if (!dmMatch) return { ok: false, content: null, reason: 'NO_DEPENDENCY_MANAGEMENT_BLOCK_FOUND' };
  const depBlockRe = /<dependency>([\s\S]*?)<\/dependency>/g;
  let match: RegExpExecArray | null;
  let found: { whole: string; inner: string } | null = null;
  let matchCount = 0;
  while ((match = depBlockRe.exec(dmMatch[1]))) {
    const inner = match[1];
    if (inner.includes(`<groupId>${groupId}</groupId>`) && inner.includes(`<artifactId>${artifactId}</artifactId>`) && /<scope>\s*import\s*<\/scope>/.test(inner)) {
      found = { whole: match[0], inner };
      matchCount++;
    }
  }
  if (matchCount === 0) return { ok: false, content: null, reason: `BOM_IMPORT_ENTRY_NOT_FOUND:${groupId}:${artifactId}` };
  if (matchCount > 1) return { ok: false, content: null, reason: `AMBIGUOUS_BOM_IMPORT_ENTRY:${groupId}:${artifactId}:${matchCount}_MATCHES` };
  const versionMatch = found!.inner.match(/<version>([^<]+)<\/version>/);
  if (!versionMatch) return { ok: false, content: null, reason: 'BOM_VERSION_ELEMENT_NOT_FOUND' };
  const newInner = found!.inner.replace(`<version>${versionMatch[1]}</version>`, `<version>${newVersion}</version>`);
  const content = pomXmlText.replace(found!.whole, `<dependency>${newInner}</dependency>`);
  return { ok: true, content, reason: 'BOM_VERSION_REPLACED' };
}

/** Applique propriétaire version Edit. */
export function applyOwnerVersionEdit(pomXmlText: string, plan: Pick<RemediationPlan, 'editType' | 'editCoordinate'>, newOwnerVersion: string): OwnerPomEditResult {
  const [groupId, artifactId] = plan.editCoordinate.split(':');
  if (!groupId || !artifactId) return { ok: false, content: null, reason: `INVALID_EDIT_COORDINATE:${plan.editCoordinate}` };
  if (plan.editType === 'PARENT_VERSION') return applyParentVersionEdit(pomXmlText, groupId, artifactId, newOwnerVersion);
  if (plan.editType === 'BOM_VERSION') return applyBomVersionEdit(pomXmlText, groupId, artifactId, newOwnerVersion);
  return { ok: false, content: null, reason: `UNSUPPORTED_EDIT_TYPE_FOR_OWNER_EDIT:${plan.editType}` };
}
