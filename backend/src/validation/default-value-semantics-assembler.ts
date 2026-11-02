// Réunit les fichiers et correspondances nécessaires pour analyser la propagation des valeurs par défaut, avec leur provenance et leur lien au candidat.

import {
  analyzeDefaultValueSemantics,
  DefaultValueSemanticsEvidence,
  DefaultValueSemanticsVerdict,
} from './default-value-semantics';

export interface FetchedFile {
  path: string;
  content: string;
  blobSha: string;
}

export interface CandidateFileRecord {
  targetFile: string;
  fileOperation: string;
  oldSha: string | null;
  newSha: string;
}

export interface AssemblyProvenance {
  fixRequestId: string;
  batchId: string;
  attemptCount: number;
  candidateId: string;
  candidateDigest: string | null;
  candidateBaseSha: string;
  prHeadSha: string;
}

export interface DefaultValueSemanticsCheckedPair {
  sourceType: string;
  sourceField: string;
  candidateType: string;
  candidateField: string;
  verdict: DefaultValueSemanticsVerdict;
  source?: 'STATIC_ANALYSIS' | 'EXECUTED_TEST';
  ruleType?: string;
  [key: string]: unknown;
}

export interface DefaultValueSemanticsAudit {
  verdict: DefaultValueSemanticsVerdict;
  evaluatedSha: string;
  candidateId: string;
  candidateDigest: string | null;
  fixRequestId: string;
  batchId: string;
  attemptCount: number;
  evidence: DefaultValueSemanticsEvidence[];
  checkedPairs: number;
  checkedFieldPairs: DefaultValueSemanticsCheckedPair[];
  computedAt: string;
}

// Échappe les caractères spéciaux pour une utilisation littérale dans une RegExp.
function escapeForRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface RequestBodyBinding {
  method: string;
  type: string;
}

// Trouve chaque déclaration de méthode liée à un `@RequestBody`, forme simple à un
// seul paramètre annoté.
function findRequestBodyBindings(source: string): RequestBodyBinding[] {
  const pattern = /\b(\w+)\s*\([^)]*@RequestBody\s+(\w+)\s+\w+[^)]*\)/g;
  const out: RequestBodyBinding[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    out.push({ method: match[1], type: match[2] });
  }
  return out;
}

// Extrait le corps d'une classe par appariement d'accolades ; `null` si non trouvée
// ou déséquilibrée (ne devine jamais).
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
  return null;
}

/** Extrait méthode Bodies. */
function extractMethodBodies(source: string, methodName: string, paramType: string): string[] {
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

/** Renvoie le chemin du SEUL fichier parmi ceux déjà récupérés qui satisfait le prédicat. */
function resolveUniqueFile(files: readonly FetchedFile[], predicate: (content: string) => boolean): string | undefined {
  const matches = files.filter(f => predicate(f.content));
  return matches.length === 1 ? matches[0].path : undefined;
}

// Liste les noms de champs déclarés directement dans un corps de classe (un seul
// niveau d'imbrication).
function listFieldNames(classBody: string): string[] {
  const pattern = /(?:private|protected|public)\s+[\w.<>[\],\s]+?\s+(\w+)\s*(?:=[^;]+)?;/g;
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(classBody))) names.add(match[1]);
  return [...names];
}

/** Retrouve le chemin du fichier déclarant typeName via l'instruction import qui le référence et la convention standard de layout Maven/Gradle. */
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

// Détecte chaque migration de type `@RequestBody` pour une même méthode entre le
// texte baseline et candidat.
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

/** Découvre chaque migration de DTO puis lance l'analyse default-value-semantics sur chaque champ partagé entre type source et candidat. */
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

    const methodBodies = extractMethodBodies(candidateText, migration.method, migration.candidateType);
    if (methodBodies.length === 0) { anyVerificationRequired = true; continue; }
    const mappingSource = methodBodies.join('\n');

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

// Même borne que celle déjà utilisée pour les sourceSnapshots ailleurs dans le
// pipeline — un lot inhabituellement grand saute ce contrôle plutôt que de lancer
// des entrées/sorties non bornées depuis un callback webhook.
const MAX_FILES = 12;

/** Construit par défaut valeur sémantique preuve. */
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

  // Le type source dont on migre n'est souvent PAS parmi les fichiers écrits du
  // tout (cas fréquent : seuls le contrôleur/service/nouveau DTO ont été écrits) ;
  // on le résout via la convention Maven/Gradle import -> chemin et on le récupère,
  // borné aux seuls types non résolus dont ces migrations ont besoin.
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
      // Dégrade à VERIFICATION_REQUIRED pour ce type dans evaluateDefaultValueSemantics() ci-dessous — jamais fabriqué.
    }
  }

  return evaluateDefaultValueSemantics(baselineFiles, candidateFiles, provenance);
}
