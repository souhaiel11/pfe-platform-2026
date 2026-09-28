// Increment 1 — multi-CVE remediation, ONE candidate file for N findings.
//
// Deliberately does NOT modify writeSecurityPatch() (maven-security-patch-
// writer.ts) at all: this file only CHAINS it, calling it once per finding
// with the previous finding's output content threaded in as the next
// finding's input `sourceContent`. Every one of writeSecurityPatch()'s
// existing fail-closed checks (OLD_VERSION_MISMATCH, ambiguous
// declarations, cross-major rejection, ...) keeps running unmodified on
// each link of the chain.
//
// ★ Conflict detection is a DIRECT CONSEQUENCE of chaining, not a separate
// mechanism: if finding B's controlling declaration/property was already
// touched by an EARLIER finding A in the chain (same dependency, or a
// shared <properties> entry), the text writeSecurityPatch() locates for B
// no longer equals B's own grounded `installedVersion` -> B fails
// OLD_VERSION_MISMATCH (or an ambiguity/absence code), which this file
// reports as a NAMED conflict. No new comparison logic was needed for this
// -- see the design cadrage this increment implements.
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
  // Atomic: ANY conflict means NOTHING is applied -- the caller never sees
  // a partially-patched file, only the full list of named conflicts (every
  // finding is checked, not just the first failure, so a caller gets the
  // complete picture in one round-trip rather than fixing conflicts one at
  // a time).
  | { ok: false; conflicts: SecurityPatchBatchConflict[] };

/**
 * Pure. All items MUST share the same controllingFile and the same
 * (pre-batch) sourceContent -- V1 only ever produces ONE candidate file
 * (pom.xml), exactly like the singular writer. Items are applied in a
 * deterministic order (sorted by cveId) so the result — and any conflict —
 * never depends on caller-supplied array order.
 */
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
    // Thread the chain's CURRENT content in as this finding's own
    // sourceContent -- everything else about the request (installedVersion,
    // targetVersion, provenanceKind, ...) is this finding's OWN grounded
    // evidence, untouched.
    const threaded: SecurityPatchRequest = { ...request, sourceContent: content };
    const result = writeSecurityPatch(threaded);
    if (result.ok !== true) {
      conflicts.push({ cveId, findingIdentity: request.findingIdentity, reason: result.reason, detail: result.detail });
      continue; // keep checking the rest -- report every conflicting CVE, not just the first
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
