// Empêche un patch de remédiation automatique d'introduire un marqueur de travail inachevé (TODO/FIXME) dans un commentaire qu'il génère ou modifie.

import { computeGitBlobSha1, isFullGitSha } from './candidate-digest';

export interface CommentSyntax {
  line?: string;
  block?: [string, string];
}

// Table d'association extension -> syntaxe de commentaire (ligne/bloc).
const EXTENSION_COMMENT_SYNTAX: Record<string, CommentSyntax> = {
  '.java': { line: '//', block: ['/*', '*/'] },
  '.kt': { line: '//', block: ['/*', '*/'] },
  '.scala': { line: '//', block: ['/*', '*/'] },
  '.ts': { line: '//', block: ['/*', '*/'] },
  '.tsx': { line: '//', block: ['/*', '*/'] },
  '.js': { line: '//', block: ['/*', '*/'] },
  '.jsx': { line: '//', block: ['/*', '*/'] },
  '.go': { line: '//', block: ['/*', '*/'] },
  '.c': { line: '//', block: ['/*', '*/'] },
  '.h': { line: '//', block: ['/*', '*/'] },
  '.cpp': { line: '//', block: ['/*', '*/'] },
  '.hpp': { line: '//', block: ['/*', '*/'] },
  '.cs': { line: '//', block: ['/*', '*/'] },
  '.py': { line: '#' },
  '.rb': { line: '#' },
  '.sh': { line: '#' },
  '.yml': { line: '#' },
  '.yaml': { line: '#' },
};

// Déduit la syntaxe de commentaire (ligne/bloc) à partir de l'extension du chemin, ou `null` si le langage n'est pas reconnu.
export function commentSyntaxForPath(path: string): CommentSyntax | null {
  const match = /\.[^./\\]+$/.exec(String(path || ''));
  const ext = match ? match[0].toLowerCase() : '';
  return EXTENSION_COMMENT_SYNTAX[ext] ?? null;
}

/** Extrait tous les segments de commentaire d'un fichier source, en distinguant correctement le code, les chaînes/littéraux et les commentaires réels. */
export function extractCommentSegments(source: string, syntax: CommentSyntax): string[] {
  const text = String(source || '');
  const segments: string[] = [];
  const lineStart = syntax.line;
  const [blockStart, blockEnd] = syntax.block ?? [undefined, undefined];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const three = text.slice(i, i + 3);
    if (three === '"""' || three === "'''") {
      const close = text.indexOf(three, i + 3);
      i = close === -1 ? n : close + 3;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      while (i < n && text[i] !== ch) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (blockStart && text.startsWith(blockStart, i)) {
      const close = blockEnd ? text.indexOf(blockEnd, i + blockStart.length) : -1;
      const end = close === -1 ? n : close;
      segments.push(text.slice(i + blockStart.length, end));
      i = close === -1 ? n : close + (blockEnd as string).length;
      continue;
    }
    if (lineStart && text.startsWith(lineStart, i)) {
      const eol = text.indexOf('\n', i + lineStart.length);
      const end = eol === -1 ? n : eol;
      segments.push(text.slice(i + lineStart.length, end));
      i = end;
      continue;
    }
    i++;
  }
  return segments;
}

const UNFINISHED_WORK_MARKER = /\b(TODO|FIXME)\b/i;

// Construit une table texte -> nombre d'occurrences de chaque segment de commentaire
// extrait de `content` (un multiset, pas un simple ensemble, pour détecter aussi la duplication).
function commentOccurrenceCounts(content: string, syntax: CommentSyntax): Map<string, number> {
  const counts = new Map<string, number>();
  for (const segment of extractCommentSegments(content, syntax)) {
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }
  return counts;
}

/** Compare les commentaires de oldContent et newContent (en multiset) et renvoie un message par occurrence de commentaire VRAIMENT nouvelle qui contient un marqueur TODO/FIXME. */
export function detectForbiddenGeneratedCommentMarkers(
  oldContent: string | null | undefined,
  newContent: string,
  path: string,
  operation: 'CREATE' | 'MODIFY' | string,
): string[] {
  const syntax = commentSyntaxForPath(path);
  if (!syntax) return [];
  if (operation === 'MODIFY' && (oldContent === null || oldContent === undefined)) return [];

  const newCounts = commentOccurrenceCounts(newContent, syntax);
  const oldCounts = operation === 'CREATE' ? new Map<string, number>() : commentOccurrenceCounts(String(oldContent ?? ''), syntax);

  const violations: string[] = [];
  for (const [segment, newCount] of newCounts) {
    const oldCount = oldCounts.get(segment) ?? 0;
    const excessOccurrences = newCount - oldCount;
    if (excessOccurrences <= 0) continue;
    if (UNFINISHED_WORK_MARKER.test(segment)) {
      const times = excessOccurrences > 1 ? ` (${excessOccurrences} new occurrences)` : '';
      violations.push(`${path}: newly introduced comment contains an unfinished-work marker${times}: "${segment.trim().slice(0, 160)}"`);
    }
  }
  return violations;
}

export type GeneratedCommentGuardFileVerdict =
  | { ok: true }
  | { ok: false; reason: 'INPUT_INCOMPLETE' }
  | { ok: false; reason: 'INTEGRITY_MISMATCH' }
  | { ok: false; reason: 'MARKER_FORBIDDEN'; violations: string[] };

/** Verdict complet pour un fichier candidat. */
export function evaluateGeneratedCommentGuardForFile(file: {
  path: string;
  operation: 'CREATE' | 'MODIFY' | string;
  content: string;
  sourceContent?: string | null;
  originalBlobSha?: string | null;
}): GeneratedCommentGuardFileVerdict {
  const syntax = commentSyntaxForPath(file.path);
  if (!syntax) return { ok: true };
  if (file.operation === 'MODIFY') {
    if (typeof file.sourceContent !== 'string') {
      return { ok: false, reason: 'INPUT_INCOMPLETE' };
    }
    if (!isFullGitSha(file.originalBlobSha)) {
      return { ok: false, reason: 'INPUT_INCOMPLETE' };
    }
    if (computeGitBlobSha1(file.sourceContent).toLowerCase() !== file.originalBlobSha.toLowerCase()) {
      return { ok: false, reason: 'INTEGRITY_MISMATCH' };
    }
  }
  const violations = detectForbiddenGeneratedCommentMarkers(file.sourceContent, file.content, file.path, file.operation);
  return violations.length > 0 ? { ok: false, reason: 'MARKER_FORBIDDEN', violations } : { ok: true };
}
