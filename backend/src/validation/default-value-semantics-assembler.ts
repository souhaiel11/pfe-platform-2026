// R66 Phase 2 — assembles the bounded evidence analyzeDefaultValueSemantics()
// needs from data the platform ALREADY persists (fixRequest.fileResults'
// immutable blob SHAs + the frozen candidateBaseSha/prHeadSha), instead of
// carrying new source-snapshot payloads through WF2/WF3. Two layers,
// deliberately separated:
//
//   1. evaluateDefaultValueSemantics() — PURE, network-free, fully
//      unit-testable with injected file content. Discovers entity/DTO
//      migration field pairs from already-fetched source text and runs the
//      generic detector (default-value-semantics.ts) on each.
//   2. buildDefaultValueSemanticsEvidence() — the only IO-performing
//      function here. Fetches exact immutable content via a caller-supplied
//      `fetchFileAtSha` (bound to the existing githubFileAtSha helper in
//      production; a fake in tests), verifies each fetch's returned blob SHA
//      against the persisted oldSha/newSha before trusting it, then delegates
//      to layer 1. computeMergeAuthorization() itself stays pure — this
//      module is the boundary where IO happens, nowhere near it.
//
// Generic by construction: no rule ID, entity name, DTO name, or field name
// is hardcoded anywhere in this file.

import {
  analyzeDefaultValueSemantics,
  DefaultValueSemanticsEvidence,
  DefaultValueSemanticsVerdict,
} from './default-value-semantics';

export interface FetchedFile {
  path: string;
  content: string;
  /** The blob SHA GitHub actually returned for this content. */
  blobSha: string;
}

export interface CandidateFileRecord {
  targetFile: string;
  fileOperation: string;
  /** Baseline blob SHA (null for CREATE). */
  oldSha: string | null;
  /** Candidate blob SHA (always present for a completed write). */
  newSha: string;
}

export interface AssemblyProvenance {
  fixRequestId: string;
  batchId: string;
  attemptCount: number;
  candidateId: string;
  candidateDigest: string | null;
  candidateBaseSha: string;
  /** The exact SHA this evidence is bound to — the SAME SHA saveValidation just proved via checkoutSha === expectedPrHeadSha. */
  prHeadSha: string;
}

/**
 * R79 — a lightweight, bounded record of ONE (sourceType, sourceField,
 * candidateType, candidateField) pair this run actually analyzed, and what
 * analyzeDefaultValueSemantics() concluded for it, regardless of verdict.
 * Exists so a caller can answer "was the SPECIFIC pair a blocking cause
 * names actually checked (and found safe), or did NO_DEFECT come from
 * checking zero pairs / only unrelated ones?" — a distinction the bare
 * batch-level `verdict` cannot make on its own. Never carries the full
 * evidence object (that stays bounded to PROVEN_DEFECT only, in `evidence`).
 */
export interface DefaultValueSemanticsCheckedPair {
  sourceType: string;
  sourceField: string;
  candidateType: string;
  candidateField: string;
  verdict: DefaultValueSemanticsVerdict;
}

export interface DefaultValueSemanticsAudit {
  verdict: DefaultValueSemanticsVerdict;
  evaluatedSha: string;
  candidateId: string;
  candidateDigest: string | null;
  fixRequestId: string;
  batchId: string;
  attemptCount: number;
  /** Full evidence only for PROVEN_DEFECT pairs — bounded, never a source dump. */
  evidence: DefaultValueSemanticsEvidence[];
  checkedPairs: number;
  /** R79 — one entry per field actually analyzed, every verdict, not just PROVEN_DEFECT. */
  checkedFieldPairs: DefaultValueSemanticsCheckedPair[];
  computedAt: string;
}

// ── Layer 1 — pure, network-free ────────────────────────────────────────

function escapeForRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface RequestBodyBinding {
  method: string;
  type: string;
}

/** Finds every `... methodName(... @RequestBody TypeName varName ...)` declaration. Conservative: only the common single-@RequestBody-parameter shape. */
function findRequestBodyBindings(source: string): RequestBodyBinding[] {
  const pattern = /\b(\w+)\s*\([^)]*@RequestBody\s+(\w+)\s+\w+[^)]*\)/g;
  const out: RequestBodyBinding[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    out.push({ method: match[1], type: match[2] });
  }
  return out;
}

/** Extracts `class <name> { ... }`'s body via brace matching. Null if not found or unbalanced. */
function extractClassBody(source: string, typeName: string): string | null {
  const declPattern = new RegExp('\\bclass\\s+' + escapeForRegex(typeName) + '\\b[^{]*\\{');
  const declMatch = declPattern.exec(source);
  if (!declMatch) return null;
  const start = declMatch.index + declMatch[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null; // unbalanced — never guess
}

/**
 * Extracts the body of the specific method overload whose parameter list
 * contains `paramType` (Java allows the SAME method name overloaded on
 * parameter type — e.g. `updateTask(Long, Task)` and `updateTask(Long,
 * TaskDTO)` coexisting in the same class — so matching by name alone would
 * silently pick up the WRONG overload, or worse, conflate a
 * response-mapping method (`toDto`, which maps the ENTITY's own getters
 * into the DTO — the opposite direction from what this invariant cares
 * about) with the actual write-path mapping). Brace-matched, null if not
 * found or unbalanced — never guesses.
 */
function extractMethodBodies(source: string, methodName: string, paramType: string): string[] {
  // Overloaded across files (a controller pass-through AND a service's real
  // implementation commonly share the same name+param-type shape) — collect
  // every match, not just the first, so the real mapping body is never
  // silently missed in favor of an unrelated pass-through match earlier in
  // the concatenated batch text.
  const declPattern = new RegExp(
    '\\b' + escapeForRegex(methodName) + '\\s*\\([^)]*\\b' + escapeForRegex(paramType) + '\\b[^)]*\\)\\s*\\{', 'g',
  );
  const bodies: string[] = [];
  let declMatch: RegExpExecArray | null;
  while ((declMatch = declPattern.exec(source))) {
    const start = declMatch.index + declMatch[0].length;
    let depth = 1;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) { bodies.push(source.slice(start, i)); break; }
      }
    }
  }
  return bodies;
}

/**
 * R70 — the repository-relative path of the SINGLE fetched file whose
 * content satisfies `predicate`, or undefined when zero or more than one
 * file matches. Ambiguity is never resolved by picking the first match: an
 * unproven path is strictly better than a wrong one, since a wrong grounded
 * path would let WF2 authorize editing the wrong file with false confidence.
 */
function resolveUniqueFile(files: readonly FetchedFile[], predicate: (content: string) => boolean): string | undefined {
  const matches = files.filter(f => predicate(f.content));
  return matches.length === 1 ? matches[0].path : undefined;
}

/** Field names declared directly in a class body (shallow — one nesting level, matching default-value-semantics.ts's own field-declaration scanner). */
function listFieldNames(classBody: string): string[] {
  const pattern = /(?:private|protected|public)\s+[\w.<>[\],\s]+?\s+(\w+)\s*(?:=[^;]+)?;/g;
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(classBody))) names.add(match[1]);
  return [...names];
}

/**
 * A migrated field's OWN type is very often declared in a file this batch
 * never wrote (the common case: only the controller/service/new-DTO were
 * written; the pre-existing entity being replaced was only referenced). That
 * file is still cheaply, exactly locatable: any Java source importing it
 * carries `import <package>.<TypeName>;`, and the standard Maven/Gradle
 * source layout (package dots -> directories, rooted at `src/main/java`) is
 * a fixed, generic language/build convention — not a project-specific
 * guess. Returns null when no such import is found (fails closed).
 */
export function resolveTypeSourcePath(source: string, typeName: string): string | null {
  const pattern = new RegExp('^import\\s+([\\w.]+)\\.' + escapeForRegex(typeName) + ';', 'm');
  const match = pattern.exec(source);
  if (!match) return null;
  return `src/main/java/${match[1].replace(/\./g, '/')}/${typeName}.java`;
}

interface DiscoveredMigration {
  method: string;
  baselineType: string;
  candidateType: string;
  binding: string;
}

/** Pure. Every `@RequestBody` binding whose type changed for the same method name between baseline and candidate text. */
export function discoverMigrations(baselineText: string, candidateText: string): DiscoveredMigration[] {
  const baselineBindings = findRequestBodyBindings(baselineText);
  const candidateBindings = findRequestBodyBindings(candidateText);
  const migrations: DiscoveredMigration[] = [];
  for (const candidateBinding of candidateBindings) {
    const baselineBinding = baselineBindings.find(b => b.method === candidateBinding.method);
    if (!baselineBinding || baselineBinding.type === candidateBinding.type) continue;
    const bindingSnippet = new RegExp('@RequestBody\\s+' + escapeForRegex(candidateBinding.type) + '\\s+\\w+').exec(candidateText);
    migrations.push({
      method: candidateBinding.method, baselineType: baselineBinding.type, candidateType: candidateBinding.type,
      binding: bindingSnippet ? bindingSnippet[0] : `@RequestBody ${candidateBinding.type}`,
    });
  }
  return migrations;
}

/**
 * Pure. Given already-fetched baseline and candidate file sets, discovers
 * every `@RequestBody` binding whose type changed for the SAME method
 * between baseline and candidate, then — for every field the candidate type
 * declares that the baseline type also declares — runs
 * analyzeDefaultValueSemantics(). Zero migrations found is the common case
 * (most PRs never touch this shape) and correctly yields NO_DEFECT with zero
 * checked pairs, never a fabricated finding.
 */
export function evaluateDefaultValueSemantics(
  baselineFiles: readonly FetchedFile[],
  candidateFiles: readonly FetchedFile[],
  provenance: AssemblyProvenance,
): DefaultValueSemanticsAudit {
  const baselineText = baselineFiles.map(f => f.content).join('\n');
  const candidateText = candidateFiles.map(f => f.content).join('\n');
  const migrations = discoverMigrations(baselineText, candidateText);

  const evidence: DefaultValueSemanticsEvidence[] = [];
  const checkedFieldPairs: DefaultValueSemanticsCheckedPair[] = [];
  let checkedPairs = 0;
  let anyVerificationRequired = false;

  for (const migration of migrations) {
    const baselineClassBody = extractClassBody(baselineText, migration.baselineType);
    const candidateClassBody = extractClassBody(candidateText, migration.candidateType);
    if (!baselineClassBody || !candidateClassBody) { anyVerificationRequired = true; continue; }

    // Scoped to the SPECIFIC (method, candidateType) overload body/bodies —
    // never the whole batch text — so a reverse-direction response-mapping
    // method (e.g. `toDto(Task task)`, which propagates the ENTITY's own
    // getters INTO the DTO) can never be mistaken for this migration's
    // actual DTO-to-entity write path, and so an unrelated same-named method
    // elsewhere in the batch can never contaminate this migration's result.
    const methodBodies = extractMethodBodies(candidateText, migration.method, migration.candidateType);
    if (methodBodies.length === 0) { anyVerificationRequired = true; continue; }
    const mappingSource = methodBodies.join('\n');

    // R70 — resolve exactly which fetched file each piece of evidence came
    // from, so a proven defect can carry a grounded edit target through to
    // WF2 (corrective-context.ts / WF2's Validate Generic Remediation Plan).
    // Resolved per-file (not against the concatenated batch text) and only
    // when exactly one file matches — see resolveUniqueFile. sourceFile and
    // candidateFile are resolved here (class declaration is unambiguous per
    // compilation unit); mappingFile is NOT — a controller pass-through
    // method commonly shares the same (methodName, paramType) shape as the
    // real service-layer mapping method (both literally match
    // `updateTask(..., TaskDTO ...)`), so it is instead resolved per-FIELD
    // below, against the exact unconditional-propagation snippet each
    // PROVEN_DEFECT's own evidence already pinpoints — which the
    // pass-through method never contains.
    const sourceFile = resolveUniqueFile(baselineFiles, content => extractClassBody(content, migration.baselineType) !== null);
    const candidateFile = resolveUniqueFile(candidateFiles, content => extractClassBody(content, migration.candidateType) !== null);

    const fieldNames = listFieldNames(candidateClassBody);
    for (const fieldName of fieldNames) {
      checkedPairs++;
      const result = analyzeDefaultValueSemantics({
        sourceType: migration.baselineType, sourceField: fieldName, sourceTypeSource: baselineClassBody,
        candidateType: migration.candidateType, candidateField: fieldName, candidateTypeSource: candidateClassBody,
        mappingSource,
        mappingLabel: `${migration.method}(${migration.candidateType})`,
        externalBindingEvidence: migration.binding,
        sourceFile, candidateFile,
      });
      // R79 — record EVERY analyzed pair's verdict, not only PROVEN_DEFECT,
      // so a caller can tell "this exact (type,field) pair was checked and
      // cleared" apart from "zero pairs were checked, or only unrelated
      // ones were" — the batch-level `verdict` string alone cannot make
      // that distinction.
      checkedFieldPairs.push({
        sourceType: migration.baselineType, sourceField: fieldName,
        candidateType: migration.candidateType, candidateField: fieldName,
        verdict: result.verdict,
      });
      if (result.verdict === 'PROVEN_DEFECT' && result.evidence) {
        const separatorIndex = result.evidence.mappingPath.indexOf(': ');
        const snippet = separatorIndex === -1 ? '' : result.evidence.mappingPath.slice(separatorIndex + 2).trim();
        const mappingFile = snippet ? resolveUniqueFile(candidateFiles, content => content.includes(snippet)) : undefined;
        evidence.push(mappingFile ? { ...result.evidence, mappingFile } : result.evidence);
      } else if (result.verdict === 'VERIFICATION_REQUIRED') anyVerificationRequired = true;
    }
  }

  const verdict: DefaultValueSemanticsVerdict =
    evidence.length > 0 ? 'PROVEN_DEFECT' : anyVerificationRequired ? 'VERIFICATION_REQUIRED' : 'NO_DEFECT';

  return {
    verdict, evaluatedSha: provenance.prHeadSha, candidateId: provenance.candidateId, candidateDigest: provenance.candidateDigest,
    fixRequestId: provenance.fixRequestId, batchId: provenance.batchId, attemptCount: provenance.attemptCount,
    evidence, checkedPairs, checkedFieldPairs, computedAt: new Date().toISOString(),
  };
}

// ── Layer 2 — the only IO boundary ──────────────────────────────────────

/**
 * R66 provenance requirement: semantic evidence computed for one SHA/blob
 * MUST NOT be reusable for another. Every fetch is verified against the
 * blob SHA already persisted on fixRequest.fileResults (oldSha for the
 * baseline fetch, newSha for the candidate fetch) before its content is
 * trusted. A single mismatch or fetch failure degrades the WHOLE evaluation
 * to VERIFICATION_REQUIRED — never a partial/fabricated PROVEN_DEFECT.
 */
/** Same bound already used for sourceSnapshots elsewhere in the pipeline — an unusually large batch skips this check rather than issuing unbounded IO from a webhook callback. */
const MAX_FILES = 12;

export async function buildDefaultValueSemanticsEvidence(
  files: readonly CandidateFileRecord[],
  provenance: AssemblyProvenance,
  fetchFileAtSha: (path: string, sha: string) => Promise<{ sha: string; content: string }>,
): Promise<DefaultValueSemanticsAudit> {
  if (files.length > MAX_FILES) {
    return {
      verdict: 'VERIFICATION_REQUIRED', evaluatedSha: provenance.prHeadSha, candidateId: provenance.candidateId,
      candidateDigest: provenance.candidateDigest, fixRequestId: provenance.fixRequestId, batchId: provenance.batchId,
      attemptCount: provenance.attemptCount, evidence: [], checkedPairs: 0, checkedFieldPairs: [], computedAt: new Date().toISOString(),
    };
  }
  const baselineFiles: FetchedFile[] = [];
  const candidateFiles: FetchedFile[] = [];
  let provenanceOk = true;

  for (const file of files) {
    try {
      const candidate = await fetchFileAtSha(file.targetFile, provenance.prHeadSha);
      if (candidate.sha.toLowerCase() !== String(file.newSha || '').toLowerCase()) { provenanceOk = false; continue; }
      candidateFiles.push({ path: file.targetFile, content: candidate.content, blobSha: candidate.sha });

      if (file.oldSha) {
        const baseline = await fetchFileAtSha(file.targetFile, provenance.candidateBaseSha);
        if (baseline.sha.toLowerCase() !== String(file.oldSha).toLowerCase()) { provenanceOk = false; continue; }
        baselineFiles.push({ path: file.targetFile, content: baseline.content, blobSha: baseline.sha });
      }
    } catch {
      provenanceOk = false;
    }
  }

  if (!provenanceOk) {
    return {
      verdict: 'VERIFICATION_REQUIRED', evaluatedSha: provenance.prHeadSha, candidateId: provenance.candidateId,
      candidateDigest: provenance.candidateDigest, fixRequestId: provenance.fixRequestId, batchId: provenance.batchId,
      attemptCount: provenance.attemptCount, evidence: [], checkedPairs: 0, checkedFieldPairs: [], computedAt: new Date().toISOString(),
    };
  }

  // The source type being migrated away from is very often NOT among the
  // written files at all (the common case: only the controller/service/new
  // DTO were written; the pre-existing type being replaced was only
  // referenced) — fixRequest.fileResults, and therefore `files` above, never
  // lists it. Resolve it by the fixed Maven/Gradle import->path convention
  // (resolveTypeSourcePath) and fetch it, bounded to exactly the unresolved
  // types this batch's own migrations need, deduplicated. This file has no
  // persisted oldSha to cross-check (it was never written), so its
  // provenance rests on being fetched at the already-proven, frozen
  // candidateBaseSha commit itself — the strongest guarantee available
  // without a new WF2 payload field.
  let baselineText = baselineFiles.map(f => f.content).join('\n');
  const candidateText = candidateFiles.map(f => f.content).join('\n');
  const migrations = discoverMigrations(baselineText, candidateText);
  const resolvedPaths = new Set(baselineFiles.map(f => f.path));
  for (const migration of migrations) {
    if (extractClassBody(baselineText, migration.baselineType)) continue;
    if (resolvedPaths.has(migration.baselineType)) continue;
    const importPath = resolveTypeSourcePath(baselineText, migration.baselineType)
      || resolveTypeSourcePath(candidateText, migration.baselineType);
    if (!importPath || resolvedPaths.has(importPath)) continue;
    try {
      const referenced = await fetchFileAtSha(importPath, provenance.candidateBaseSha);
      baselineFiles.push({ path: importPath, content: referenced.content, blobSha: referenced.sha });
      resolvedPaths.add(importPath);
      baselineText = baselineFiles.map(f => f.content).join('\n');
    } catch {
      // Fails closed to VERIFICATION_REQUIRED for this type inside
      // evaluateDefaultValueSemantics() below — never fabricated.
    }
  }

  return evaluateDefaultValueSemantics(baselineFiles, candidateFiles, provenance);
}
