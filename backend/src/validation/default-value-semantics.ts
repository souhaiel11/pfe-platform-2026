// R66 — generic invariant: an entity/request-object -> DTO migration must
// preserve OBSERVABLE default-value/deserialization semantics for the case
// where an incoming JSON field is ABSENT. This module is deliberately
// technology-neutral in the same sense as pr-regression-engine.ts: it never
// mentions a specific rule, framework annotation family, project entity, or
// field name in its logic — every identifier it reasons about is supplied by
// the caller as plain source text.
//
// WHY THIS EXISTS (see PR #34 offline review): a candidate replaced a
// directly-bound `@RequestBody <Entity>` controller parameter with a new
// `@RequestBody <Dto>` type. The entity field being replaced carried an
// explicit initializer (its "baseline default"); the new DTO field did not.
// Jackson's bean deserialization contract (no `@JsonSetter`/`@JsonInclude`
// tricks assumed — the common case in this codebase) is: a JSON property
// ABSENT from the request body never has its setter called, so the field
// keeps whatever value the no-args constructor gave it (its field
// initializer, or the Java language default if it has none); a JSON
// property explicitly present as `null` DOES have its setter called, with
// `null`. This module does not re-derive that Jackson contract at runtime —
// it is a fixed, well-known library invariant — it only compares the two
// types' field-initializer text to decide whether that invariant produces a
// DIFFERENT absent-field value for the candidate than for the baseline, and
// whether that difference is actually observable (i.e. unconditionally
// propagated into the persisted/target object, not filtered by a
// present-value guard).
//
// DELIBERATELY CONSERVATIVE, NOT A REAL PARSER (same posture as
// wf2-cross-file-type-coherence.mjs): every check below either finds
// unambiguous textual evidence or reports VERIFICATION_REQUIRED. It never
// upgrades an unresolved case to PROVEN_DEFECT.

export type DefaultValueSemanticsVerdict = 'PROVEN_DEFECT' | 'VERIFICATION_REQUIRED' | 'NO_DEFECT';

export interface DefaultValueSemanticsEvidence {
  sourceType: string;
  sourceField: string;
  /** Textual RHS of the source field's initializer, e.g. "TaskStatus.TODO". Null iff the source field has no initializer (nothing to preserve). */
  sourceDefault: string | null;
  candidateType: string;
  candidateField: string;
  /** Textual RHS of the candidate field's initializer, or null if the field has none (language default applies). */
  candidateDefault: string | null;
  /** What the baseline-absent case observably produces, in plain language. */
  baselineAbsentBehavior: string;
  /** What the candidate-absent case observably produces, in plain language. */
  candidateAbsentBehavior: string;
  /** Where the divergent default is propagated into the persisted/target object. */
  mappingPath: string;
  /** R70 — repository-relative file path declaring sourceType, when the caller could resolve it unambiguously. Never fabricated; absent (not guessed) when the caller could not prove a single file. */
  sourceFile?: string;
  /** R70 — repository-relative file path declaring candidateType, under the same unambiguity rule as sourceFile. */
  candidateFile?: string;
  /** R70 — repository-relative file path containing the specific mapping method body evidence.mappingPath was derived from, under the same unambiguity rule. */
  mappingFile?: string;
}

export interface DefaultValueSemanticsResult {
  verdict: DefaultValueSemanticsVerdict;
  reason: string;
  evidence: DefaultValueSemanticsEvidence | null;
}

export interface DefaultValueSemanticsInput {
  sourceType: string;
  sourceField: string;
  /** Full source text of the baseline class declaring `sourceField`. */
  sourceTypeSource: string;
  candidateType: string;
  candidateField: string;
  /** Full source text of the candidate (replacement request/DTO) class declaring `candidateField`. */
  candidateTypeSource: string;
  /** Source text of the code that maps the deserialized candidate object into the persisted/source-typed target (e.g. a service method body). */
  mappingSource: string;
  /** Human-readable label for evidence.mappingPath, e.g. "TaskService.updateTask(Long, TaskDTO)". */
  mappingLabel?: string;
  /**
   * Proof that `candidateType` is itself bound directly from an external
   * request body via bean deserialization (e.g. the controller source
   * containing `@RequestBody <candidateType>`). Required: the
   * absent-vs-explicit-null distinction this module reasons about is a
   * property of that binding, not of `candidateType` in general — without
   * this evidence the invariant cannot be asserted at all.
   */
  externalBindingEvidence?: string | null;
  /**
   * R70 — optional repository-relative file paths the ASSEMBLER (the only
   * layer with per-file provenance) has already proven, when it could
   * resolve them unambiguously among the files it fetched. This function
   * never derives or validates these itself (it only sees concatenated
   * source text, not file boundaries) — it only carries them through
   * verbatim into the returned evidence when a PROVEN_DEFECT is found, so
   * WF2's corrective target grounding does not have to re-derive them from
   * a weaker, in-workflow text search when the assembler already knows them
   * for free.
   */
  sourceFile?: string | null;
  candidateFile?: string | null;
  mappingFile?: string | null;
}

// ── Field-declaration scanning ──────────────────────────────────────────

interface FieldDeclaration {
  found: boolean;
  hasInitializer: boolean;
  initializerText: string | null;
}

function escapeForRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds `<modifiers> <type> <fieldName> [= <initializer>];` for a single,
 * simple field declaration. Deliberately narrow: multi-field declarations
 * (`private String a, b;`) and fields inside nested types with the same name
 * are out of scope — callers get `found: false` (VERIFICATION_REQUIRED),
 * never a guessed answer.
 */
function findFieldDeclaration(source: string, fieldName: string): FieldDeclaration {
  const pattern = new RegExp(
    '(?:private|protected|public)\\s+[\\w.<>\\[\\],\\s]+?\\b' + escapeForRegex(fieldName) + '\\s*(=\\s*([^;]+))?;',
  );
  const match = pattern.exec(source);
  if (!match) return { found: false, hasInitializer: false, initializerText: null };
  const initializerText = match[2] ? match[2].trim() : null;
  return { found: true, hasInitializer: initializerText !== null, initializerText };
}

/**
 * Reduces an initializer expression to a comparable token: strips quotes,
 * takes the last `.`-segment (so an enum-qualified constant like
 * `TaskStatus.TODO` compares equal to a string literal `"TODO"`), and
 * normalizes case. This is intentionally shallow — it proves EQUIVALENCE for
 * the common "same conceptual constant, different type" case this invariant
 * targets, and nothing more.
 */
function normalizeDefaultToken(initializer: string): string {
  const unquoted = initializer.trim().replace(/^["']|["']$/g, '');
  const lastSegment = unquoted.includes('.') ? unquoted.slice(unquoted.lastIndexOf('.') + 1) : unquoted;
  return lastSegment.trim().toUpperCase();
}

// ── Mapping-propagation scanning ────────────────────────────────────────

function capitalize(name: string): string {
  return name.length ? name[0].toUpperCase() + name.slice(1) : name;
}

interface PropagationScan {
  /** At least one occurrence found where the candidate getter's value reaches a setter on the target. */
  found: boolean;
  /** At least one occurrence is NOT wrapped in a `get<Field>() != null` guard. */
  unconditional: boolean;
  /** The unconditional statement text, when found. */
  snippet: string | null;
}

/**
 * Scans `mappingSource` for `<target>.set<Field>(<...get<Field>()...>)` call
 * sites and classifies each as guarded or unconditional by walking brace
 * depth backward from the call to the nearest enclosing
 * `if (<...get<Field>()...> != null)`. Conservative: an occurrence this
 * cannot classify with confidence is treated as unconditional evidence only
 * when no guard is found at all within the same statement's enclosing block;
 * anything structurally ambiguous falls out as `found: false` for that
 * occurrence rather than being guessed.
 */
function scanPropagation(mappingSource: string, fieldName: string): PropagationScan {
  const setterName = 'set' + capitalize(fieldName);
  const getterName = 'get' + capitalize(fieldName);
  const getterRef = new RegExp('\\b' + escapeForRegex(getterName) + '\\s*\\(');
  const setterCall = new RegExp('\\w+\\.' + escapeForRegex(setterName) + '\\s*\\([^;]*;', 'g');

  let found = false;
  let unconditional = false;
  let snippet: string | null = null;

  let match: RegExpExecArray | null;
  while ((match = setterCall.exec(mappingSource))) {
    const statement = match[0];
    if (!getterRef.test(statement)) continue; // this setter call doesn't carry the candidate field's value
    found = true;

    const guardPattern = new RegExp('if\\s*\\([^)]*' + escapeForRegex(getterName) + '\\s*\\(\\)\\s*!=\\s*null[^)]*\\)', 'g');
    let guarded = false;
    let guardMatch: RegExpExecArray | null;
    while ((guardMatch = guardPattern.exec(mappingSource))) {
      const guardEnd = guardMatch.index + guardMatch[0].length;
      if (guardEnd > match.index) continue; // guard must precede the call
      // Walk braces from the guard's condition to the setter call; if net
      // depth never returns to (or below) the depth at the guard's own
      // opening brace before reaching the call, the call is still inside it.
      const between = mappingSource.slice(guardEnd, match.index + statement.length);
      const openBrace = between.indexOf('{');
      if (openBrace === -1) {
        // single-statement if with no braces: guard covers only the very
        // next statement, which is exactly this one iff nothing else
        // (statement-separating `;`) appears before the call starts.
        const beforeCall = mappingSource.slice(guardEnd, match.index);
        if (!/;/.test(beforeCall)) guarded = true;
        continue;
      }
      let depth = 0;
      let stillInside = true;
      for (let i = 0; i < between.length; i++) {
        if (between[i] === '{') depth++;
        else if (between[i] === '}') {
          depth--;
          if (depth === 0) {
            // block closed; is the call before or after this point?
            const closeAbsolute = guardEnd + i;
            if (match.index >= closeAbsolute) stillInside = false;
            break;
          }
        }
      }
      if (stillInside) guarded = true;
    }
    if (!guarded) {
      unconditional = true;
      snippet = statement.trim();
    }
  }

  return { found, unconditional, snippet };
}

// ── The invariant ────────────────────────────────────────────────────────

/**
 * Pure. Deterministic. No IO, no LLM. Decides whether a candidate DTO/
 * request-object field observably diverges from its source field's default
 * behavior for an ABSENT JSON property, and whether that divergence is
 * actually reachable (unconditionally propagated).
 */
export function analyzeDefaultValueSemantics(input: DefaultValueSemanticsInput): DefaultValueSemanticsResult {
  const source = findFieldDeclaration(input.sourceTypeSource, input.sourceField);
  // A field this checker was asked about that the source type simply does
  // not declare at all (e.g. a relationship flattened to an ID, or a
  // genuinely new field) has, by construction, no baseline default to
  // preserve — same conclusion as CASE 5, not an unresolved unknown. This
  // assumes `sourceTypeSource` is a COMPLETE class body (the assembler only
  // calls this once class-body extraction has already succeeded); a
  // truncated/unavailable source is caught upstream, before this function
  // is ever called.
  if (!source.found) {
    return { verdict: 'NO_DEFECT', reason: `Source type ${input.sourceType} does not declare a field named ${input.sourceField}; there is no baseline default to preserve.`, evidence: null };
  }
  // CASE 5 — no source default at all: nothing to preserve, never invent a defect.
  if (!source.hasInitializer) {
    return { verdict: 'NO_DEFECT', reason: `Source field ${input.sourceType}.${input.sourceField} has no explicit initializer; there is no baseline default to preserve.`, evidence: null };
  }

  const candidate = findFieldDeclaration(input.candidateTypeSource, input.candidateField);
  if (!candidate.found) {
    return { verdict: 'VERIFICATION_REQUIRED', reason: `Candidate field ${input.candidateType}.${input.candidateField} not found in supplied source.`, evidence: null };
  }

  if (!input.externalBindingEvidence || !input.externalBindingEvidence.includes(input.candidateType)) {
    return {
      verdict: 'VERIFICATION_REQUIRED',
      reason: `No evidence supplied that ${input.candidateType} is itself bound directly from an external request body — the absent-vs-explicit-null distinction this invariant relies on cannot be asserted without it.`,
      evidence: null,
    };
  }

  const sourceDefault = source.initializerText as string;
  const sourceToken = normalizeDefaultToken(sourceDefault);
  const candidateDefault = candidate.initializerText;

  if (candidateDefault !== null) {
    const candidateToken = normalizeDefaultToken(candidateDefault);
    if (candidateToken === sourceToken) {
      return {
        verdict: 'NO_DEFECT',
        reason: `Candidate field carries an equivalent default ("${candidateDefault}") to the source field's ("${sourceDefault}"); an absent JSON field produces the same observable value in both.`,
        evidence: null,
      };
    }
    // CASE 4 — candidate explicitly changed the default away from the source's.
    const propagation = scanPropagation(input.mappingSource, input.candidateField);
    if (!propagation.found) {
      // No call site anywhere in the supplied (complete-for-this-mapping)
      // source reads this field's value into a persisted/target object at
      // all — whatever the divergent default is, it is never observable,
      // exactly like the guarded case below, only with even stronger
      // evidence (zero read sites, not merely conditional ones).
      return { verdict: 'NO_DEFECT', reason: 'Candidate default differs from source default, but no call site in the supplied mapping source ever reads this field into a persisted/target object, so the divergence is never observable.', evidence: null };
    }
    if (!propagation.unconditional) {
      return { verdict: 'NO_DEFECT', reason: 'Candidate default differs from source default, but every propagation site is guarded by a present-value check, so the divergent default is never observably written.', evidence: null };
    }
    return buildProvenDefect(input, sourceDefault, candidateDefault, propagation.snippet!, 'a different explicit default value');
  }

  // Candidate field has NO initializer at all — its absent-field value is the
  // Java language default (null for reference types), which by construction
  // cannot equal a non-default explicit source initializer already proven
  // above, UNLESS the source default textually IS the language default.
  if (sourceToken === 'NULL') {
    return { verdict: 'NO_DEFECT', reason: 'Source default is itself the language default (null); the candidate field having no initializer preserves the same absent-field value.', evidence: null };
  }

  const propagation = scanPropagation(input.mappingSource, input.candidateField);
  if (!propagation.found) {
    return { verdict: 'NO_DEFECT', reason: 'Candidate field has no initializer, but no call site in the supplied mapping source ever reads this field into a persisted/target object, so the missing default is never observable.', evidence: null };
  }
  if (!propagation.unconditional) {
    return { verdict: 'NO_DEFECT', reason: 'Candidate field has no initializer, but every propagation site is guarded by a present-value check, so the missing default is never observably written.', evidence: null };
  }
  return buildProvenDefect(input, sourceDefault, null, propagation.snippet!, 'the language default (no initializer)');
}

function buildProvenDefect(
  input: DefaultValueSemanticsInput,
  sourceDefault: string,
  candidateDefault: string | null,
  snippet: string,
  candidateAbsentDescription: string,
): DefaultValueSemanticsResult {
  const mappingPath = `${input.mappingLabel || `${input.candidateType} -> ${input.sourceType}`}: ${snippet}`;
  const evidence: DefaultValueSemanticsEvidence = {
    sourceType: input.sourceType, sourceField: input.sourceField, sourceDefault,
    candidateType: input.candidateType, candidateField: input.candidateField, candidateDefault,
    baselineAbsentBehavior: `Field kept at its declared initializer: ${sourceDefault}`,
    candidateAbsentBehavior: `Field kept at ${candidateAbsentDescription}${candidateDefault ? `: ${candidateDefault}` : ''}, unconditionally propagated`,
    mappingPath,
    ...(input.sourceFile ? { sourceFile: input.sourceFile } : {}),
    ...(input.candidateFile ? { candidateFile: input.candidateFile } : {}),
    ...(input.mappingFile ? { mappingFile: input.mappingFile } : {}),
  };
  return {
    verdict: 'PROVEN_DEFECT',
    reason: 'Baseline absent-field behavior differs from candidate absent-field behavior, and the divergent value is unconditionally propagated into the persisted/target field.',
    evidence,
  };
}
