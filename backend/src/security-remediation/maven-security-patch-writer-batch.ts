/** Chaîne le patch writer unitaire sur plusieurs CVE pour produire UN seul candidat pom.xml couvrant N findings ; tout conflit entre findings est détecté comme effet direct du chaînage. */
import { writeSecurityPatch, SecurityPatchWriteFailureReason } from './maven-security-patch-writer';
import { computeContentSha256, computeGitBlobSha1 } from '../candidate-verification/candidate-digest';
import { CandidateFile } from '../candidate-verification/candidate-verification.types';
import { SecurityPatchRequest } from './security-patch-request.types';
import { DependencyProvenanceKind } from './dependency-provenance.types';

export interface SecurityPatchBatchItem {
  cveId: string;
  request: SecurityPatchRequest;
}

export interface SecurityPatchBatchConflict {
  cveId: string;
  findingIdentity: string;
  reason: SecurityPatchWriteFailureReason;
  detail: string;
}

export interface SecurityPatchBatchFindingOutcome {
  cveId: string;
  findingIdentity: string;
  package: string;
  provenanceKind: DependencyProvenanceKind;
  oldVersion: string;
  targetVersion: string;
  controllingFile: string;
  controllingElement: string | null;
  controllingProperty: string | null;
}

export type SecurityPatchWriteBatchResult =
  | { ok: true; file: CandidateFile; perFinding: SecurityPatchBatchFindingOutcome[] }
  /** Atomique : le moindre conflit annule tout le lot — jamais de fichier partiellement patché renvoyé à l'appelant. */
  | { ok: false; conflicts: SecurityPatchBatchConflict[] };

/** Écrit sécurité patch lot. */
export function writeSecurityPatchBatch(items: SecurityPatchBatchItem[]): SecurityPatchWriteBatchResult {
  if (!items.length) return { ok: false, conflicts: [] };
  const controllingFile = items[0].request.controllingFile;
  const originalSourceContent = items[0].request.sourceContent;
  for (const item of items) {
    if (item.request.controllingFile !== controllingFile || item.request.sourceContent !== originalSourceContent) {
      return {
        ok: false,
        conflicts: items.map(i => ({
          cveId: i.cveId, findingIdentity: i.request.findingIdentity,
          reason: 'CONTROLLING_DECLARATION_NOT_FOUND',
          detail: 'All findings in a batch must be grounded against the exact same controlling file and source content.',
        })),
      };
    }
  }

  const ordered = [...items].sort((a, b) => a.cveId.localeCompare(b.cveId));
  let content = originalSourceContent;
  const conflicts: SecurityPatchBatchConflict[] = [];
  const perFinding: SecurityPatchBatchFindingOutcome[] = [];

  for (const { cveId, request } of ordered) {
    const threaded: SecurityPatchRequest = { ...request, sourceContent: content };
    const result = writeSecurityPatch(threaded);
    if (result.ok !== true) {
      conflicts.push({ cveId, findingIdentity: request.findingIdentity, reason: result.reason, detail: result.detail });
      continue;
    }
    content = result.candidate.file.content;
    perFinding.push({
      cveId, findingIdentity: request.findingIdentity, package: request.package, provenanceKind: result.candidate.provenanceKind,
      oldVersion: result.candidate.oldVersion, targetVersion: result.candidate.targetVersion,
      controllingFile: request.controllingFile, controllingElement: request.controllingElement, controllingProperty: request.controllingProperty,
    });
  }

  if (conflicts.length) return { ok: false, conflicts };

  const file: CandidateFile = {
    path: controllingFile, operation: 'MODIFY', content,
    contentSha256: computeContentSha256(content),
    sourceContent: originalSourceContent,
    originalBlobSha: computeGitBlobSha1(originalSourceContent),
  };
  return { ok: true, file, perFinding };
}
