// Invariant générique : une migration entité/objet-requête -> DTO doit préserver le comportement observable de valeur par défaut quand un champ JSON entrant est ABSENT.

export type DefaultValueSemanticsVerdict = 'PROVEN_DEFECT' | 'VERIFICATION_REQUIRED' | 'NO_DEFECT';

export interface DefaultValueSemanticsEvidence {
  sourceType: string;
  sourceField: string;
  sourceDefault: string | null;
  candidateType: string;
  candidateField: string;
  candidateDefault: string | null;
  baselineAbsentBehavior: string;
  candidateAbsentBehavior: string;
  mappingPath: string;
  sourceFile?: string;
  candidateFile?: string;
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
  sourceTypeSource: string;
  candidateType: string;
  candidateField: string;
  candidateTypeSource: string;
  mappingSource: string;
  mappingLabel?: string;
  externalBindingEvidence?: string | null;
  sourceFile?: string | null;
  candidateFile?: string | null;
  mappingFile?: string | null;
}

interface FieldDeclaration {
  found: boolean;
  hasInitializer: boolean;
  initializerText: string | null;
}

// Échappe les caractères spéciaux pour une utilisation littérale dans une RegExp.
function escapeForRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cherche la déclaration d'un champ simple (avec éventuel initialiseur) dans un
// texte source. Trop ambigu (champs multiples, classes imbriquées) -> non trouvé
// plutôt que deviné.
function findFieldDeclaration(source: string, fieldName: string): FieldDeclaration {
  const pattern = new RegExp(
    '(?:private|protected|public)\\s+[\\w.<>\\[\\],\\s]+?\\b' + escapeForRegex(fieldName) + '\\s*(=\\s*([^;]+))?;',
  );
  const match = pattern.exec(source);
  if (!match) return { found: false, hasInitializer: false, initializerText: null };
  const initializerText = match[2] ? match[2].trim() : null;
  return { found: true, hasInitializer: initializerText !== null, initializerText };
}

// Réduit un initialiseur à un jeton comparable (sans guillemets, sans préfixe
// d'énumération, en majuscules) pour comparer deux défauts conceptuellement
// équivalents même écrits différemment.
function normalizeDefaultToken(initializer: string): string {
  const unquoted = initializer.trim().replace(/^["']|["']$/g, '');
  const lastSegment = unquoted.includes('.') ? unquoted.slice(unquoted.lastIndexOf('.') + 1) : unquoted;
  return lastSegment.trim().toUpperCase();
}

// Met en majuscule la première lettre (pour construire un nom de getter/setter).
function capitalize(name: string): string {
  return name.length ? name[0].toUpperCase() + name.slice(1) : name;
}

interface PropagationScan {
  found: boolean;
  unconditional: boolean;
  snippet: string | null;
}

/** Prépare le résultat lié à scan Propagation. */
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
    if (!getterRef.test(statement)) continue;
    found = true;

    const guardPattern = new RegExp('if\\s*\\([^)]*' + escapeForRegex(getterName) + '\\s*\\(\\)\\s*!=\\s*null[^)]*\\)', 'g');
    let guarded = false;
    let guardMatch: RegExpExecArray | null;
    while ((guardMatch = guardPattern.exec(mappingSource))) {
      const guardEnd = guardMatch.index + guardMatch[0].length;
      if (guardEnd > match.index) continue;
      const between = mappingSource.slice(guardEnd, match.index + statement.length);
      const openBrace = between.indexOf('{');
      if (openBrace === -1) {
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

/** Prépare le résultat lié à analyze par défaut valeur sémantique. */
export function analyzeDefaultValueSemantics(input: DefaultValueSemanticsInput): DefaultValueSemanticsResult {
  const source = findFieldDeclaration(input.sourceTypeSource, input.sourceField);
  if (!source.found) {
    return { verdict: 'NO_DEFECT', reason: `Source type ${input.sourceType} does not declare a field named ${input.sourceField}; there is no baseline default to preserve.`, evidence: null };
  }
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
    const propagation = scanPropagation(input.mappingSource, input.candidateField);
    if (!propagation.found) {
      return { verdict: 'NO_DEFECT', reason: 'Candidate default differs from source default, but no call site in the supplied mapping source ever reads this field into a persisted/target object, so the divergence is never observable.', evidence: null };
    }
    if (!propagation.unconditional) {
      return { verdict: 'NO_DEFECT', reason: 'Candidate default differs from source default, but every propagation site is guarded by a present-value check, so the divergent default is never observably written.', evidence: null };
    }
    return buildProvenDefect(input, sourceDefault, candidateDefault, propagation.snippet!, 'a different explicit default value');
  }

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

// Construit le verdict PROVEN_DEFECT avec toute l'évidence nécessaire (défauts
// source/candidat, comportements absents, chemin de mapping).
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
