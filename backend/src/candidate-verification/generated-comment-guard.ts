// R81 — prevents an automated remediation patch from introducing an
// unfinished-work marker (TODO/FIXME) into COMMENT text it generates or
// modifies. Deliberately narrow and honest about its own limits:
//
//   - Comment syntax is looked up by file EXTENSION only (a small, explicit
//     table below) — never by rule ID, project name, or file path. Adding a
//     new language/extension never requires touching any other function in
//     this file, computeMergeAuthorization, or any rule-specific policy.
//   - For an extension this table doesn't recognize, the check is SKIPPED
//     for that file (never a false rejection on unfamiliar syntax) — this is
//     a real, stated scope boundary, not a "supports every language" claim.
//   - This is a small hand-written tokenizer, NOT a real parser/AST: it only
//     needs to track "am I inside a string/char/text-block literal, a line
//     comment, or a block comment" well enough that a domain identifier like
//     `TaskStatus.TODO` (code), `"TODO"` (string literal), or `TODO,` (enum
//     member) is never misclassified as comment text — proven by the tests
//     alongside this file, not assumed.
//   - Only NEWLY INTRODUCED comment text is ever flagged: a comment segment
//     that already existed verbatim in the pre-edit file is never re-flagged
//     just because the candidate happens to also touch the same file
//     elsewhere (see detectForbiddenGeneratedCommentMarkers below).
//   - R81.2 SCOPE DECLARATION, not a defect: guaranteed coverage is "TODO/
//     FIXME markers in recognized comment syntax/Javadoc-style comments for
//     supported extensions" — `//` and `/* */` for the C-family list below,
//     `#` for Python/Ruby/Shell/YAML. Python (and Java) triple-quoted
//     `"""..."""`/`'''...'''` spans are always treated as string/text-block
//     literals, never as comments (this is correct for a Java text block,
//     which carries no documentation convention) — so a Python DOCSTRING
//     containing TODO/FIXME is NOT detected today. PYTHON_DOCSTRING_
//     PROTECTION = NOT_IMPLEMENTED, proven (not just claimed) by this file's
//     own test suite; adding it would need docstring-position awareness
//     (immediately after a `def`/`class` line) this tokenizer doesn't have,
//     deliberately deferred rather than bolted on as a fragile regex.

import { isFullGitSha } from '../incidents/incidents.service';
import { computeGitBlobSha1 } from './candidate-digest';

export interface CommentSyntax {
  /** Prefix that starts a line comment running to end-of-line (e.g. '//', '#'). Absent if the language has none. */
  line?: string;
  /** [start, end] delimiters of a block/multi-line comment (e.g. ['/*','*\/']). Absent if the language has none. */
  block?: [string, string];
}

// Extension -> comment syntax. Additive-only: a future language is a new
// entry here, never a change to the tokenizer or the guard logic below.
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

export function commentSyntaxForPath(path: string): CommentSyntax | null {
  const match = /\.[^./\\]+$/.exec(String(path || ''));
  const ext = match ? match[0].toLowerCase() : '';
  return EXTENSION_COMMENT_SYNTAX[ext] ?? null;
}

/**
 * Tokenizes `source` far enough to tell comment text apart from string/char/
 * text-block literals and ordinary code, and returns every comment segment's
 * text (delimiters stripped). Never throws on malformed/unterminated input —
 * an unterminated string or comment simply runs to end-of-file, exactly like
 * a real compiler would report it, and whatever was collected is returned.
 */
export function extractCommentSegments(source: string, syntax: CommentSyntax): string[] {
  const text = String(source || '');
  const segments: string[] = [];
  const lineStart = syntax.line;
  const [blockStart, blockEnd] = syntax.block ?? [undefined, undefined];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const three = text.slice(i, i + 3);
    // Triple-quoted string/text-block literal (Python docstrings, Java text
    // blocks) — never comment content, skip verbatim to its closing triple-quote.
    if (three === '"""' || three === "'''") {
      const close = text.indexOf(three, i + 3);
      i = close === -1 ? n : close + 3;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      // Ordinary quoted string/char/template literal — skip to its closing
      // quote, honoring backslash escapes so an escaped quote never ends it early.
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

/**
 * Builds a text -> occurrence-count map of every comment segment extracted
 * from `content`. A MULTISET, not a Set: this is what makes the guard
 * occurrence-aware rather than merely presence-aware (R81.1) — a segment
 * that already exists once in the old file but is DUPLICATED in the new
 * file has one new (unaccounted-for) occurrence, even though its exact text
 * is not new.
 */
function commentOccurrenceCounts(content: string, syntax: CommentSyntax): Map<string, number> {
  const counts = new Map<string, number>();
  for (const segment of extractCommentSegments(content, syntax)) {
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pure. Returns a human-readable violation string per newly-introduced
 * comment OCCURRENCE that contains an unfinished-work marker, empty when
 * clean. `oldContent` is the exact pre-edit file text the writer used as its
 * editing context (absent/null for a genuine CREATE, or for a MODIFY whose
 * caller doesn't supply it — see CandidateFile.sourceContent).
 *
 * Occurrence-aware, not merely presence-aware (R81.1 hardening): comment
 * segments are compared as a MULTISET (exact text -> count), not a Set of
 * distinct strings. For each distinct segment text, only the occurrences in
 * newContent IN EXCESS of how many times that exact text already occurred in
 * oldContent are "newly introduced" and checked for a marker — every other
 * occurrence is untouched, pre-existing content. This closes a real gap a
 * plain "have I seen this text before" Set check has: duplicating an
 * existing marker-bearing comment (same exact text, appended a second time)
 * previously produced zero new distinct strings and was silently accepted;
 * counting occurrences catches it, because the count of that exact text
 * strictly increased.
 *
 * Deliberately NOT line-position/AST-based: comment REORDERING (e.g. two
 * untouched comments swapping position during an unrelated edit elsewhere in
 * the file) must never be misread as "new" content just because a line
 * number moved — multiset comparison is naturally robust to that, which a
 * naive line-indexed diff would not be.
 *
 *   - CREATE (oldContent null/undefined): every occurrence is new by
 *     construction (old counts are implicitly all zero).
 *   - MODIFY with oldContent supplied: exact multiset-difference as above.
 *   - MODIFY with oldContent NOT supplied: the check is skipped for this
 *     file (returns []) rather than risk flagging pre-existing content this
 *     function cannot distinguish from new content — backward compatible
 *     with a caller that hasn't started supplying sourceContent yet.
 */
export function detectForbiddenGeneratedCommentMarkers(
  oldContent: string | null | undefined,
  newContent: string,
  path: string,
  operation: 'CREATE' | 'MODIFY' | string,
): string[] {
  const syntax = commentSyntaxForPath(path);
  if (!syntax) return []; // unrecognized language -- never a false rejection, see file header
  if (operation === 'MODIFY' && (oldContent === null || oldContent === undefined)) return [];

  const newCounts = commentOccurrenceCounts(newContent, syntax);
  const oldCounts = operation === 'CREATE' ? new Map<string, number>() : commentOccurrenceCounts(String(oldContent ?? ''), syntax);

  const violations: string[] = [];
  for (const [segment, newCount] of newCounts) {
    const oldCount = oldCounts.get(segment) ?? 0;
    const excessOccurrences = newCount - oldCount;
    if (excessOccurrences <= 0) continue; // every occurrence already existed pre-edit -- never flagged
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

/**
 * R81.2/R81.3 — the FAIL-CLOSED policy decision for one candidate file, on
 * top of the pure detector above. `detectForbiddenGeneratedCommentMarkers`
 * itself stays honest about what it can and can't determine (it returns []
 * for a MODIFY with no old content to compare against, because from ITS
 * narrow point of view nothing is PROVABLY new) — but a caller authorizing a
 * write must never read that "nothing provably new" as "this file is fine":
 * for a supported extension, a MODIFY without trustworthy, AUTHENTICATED
 * pre-edit content is a genuine precondition failure, not a clean bill of
 * health, and must reject the write rather than silently let it through.
 *
 *   - Unsupported extension: unchanged, honest scope boundary — this
 *     function never claims support it doesn't have, so it always accepts
 *     (comment analysis for this file was never promised in the first place).
 *   - CREATE: sourceContent is never required (there is no "before"), and no
 *     integrity check applies — there is no prior blob to bind it to.
 *   - MODIFY on a supported extension:
 *       A. sourceContent missing, null, or not a string -> INPUT_INCOMPLETE.
 *       B. R81.3: `originalBlobSha` missing or not a full 40-hex git SHA ->
 *          INPUT_INCOMPLETE. This is the caller's own claim about which real
 *          git blob `sourceContent` came from — WF2 already reports it
 *          unconditionally for every MODIFY (GitHub's OWN blob SHA for that
 *          path/ref, captured by "Fetch Repository Files" before the writer
 *          LLM ever runs — see write-guard.ts's provenance comment). Absence
 *          is precisely the "upstream broke and dropped the trust anchor"
 *          case R81.2 already fails closed on for sourceContent itself; the
 *          same posture applies to its hash.
 *       C. R81.3: sha1("blob "+len+"\0"+sourceContent) !== originalBlobSha
 *          (case-insensitive) -> INTEGRITY_MISMATCH. This is what actually
 *          closes the gap R81.2 left open: R81.2 only asked "is SOME string
 *          present", never "is this the REAL pre-edit content" — a candidate
 *          (or a compromised/buggy future caller) could satisfy R81.2 by
 *          supplying its OWN forged sourceContent (e.g. a copy of the new
 *          content with the marker pre-inserted, so the multiset diff finds
 *          nothing "new"). Binding sourceContent to a hash GitHub itself
 *          produced, independently of anything the candidate/LLM supplies,
 *          makes that forgery cryptographically detectable: the forged
 *          string's blob SHA will not match the real blob's.
 *       D/E. Only once A-C all hold does the existing multiset comment diff
 *          (detectForbiddenGeneratedCommentMarkers) run at all.
 */
export function evaluateGeneratedCommentGuardForFile(file: {
  path: string;
  operation: 'CREATE' | 'MODIFY' | string;
  content: string;
  sourceContent?: string | null;
  /** GitHub's own blob SHA for `sourceContent`'s path/ref, captured before the writer LLM ran. Required for MODIFY on a supported extension (R81.3); never checked for CREATE. */
  originalBlobSha?: string | null;
}): GeneratedCommentGuardFileVerdict {
  const syntax = commentSyntaxForPath(file.path);
  if (!syntax) return { ok: true }; // unsupported extension -- never falsely claims comment-analysis coverage
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
