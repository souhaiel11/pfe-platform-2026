import * as assert from 'node:assert/strict';
import { detectForbiddenGeneratedCommentMarkers } from './generated-comment-guard';
import { assertCandidateStillValidForWrite } from './write-guard';
import { CandidateManifest, CandidateVerification } from './candidate-verification.types';
import { computeGitBlobSha1 } from './candidate-digest';

// R81.3 — every MODIFY fixture below must supply a real, matching
// `originalBlobSha` (GitHub's own git blob SHA for `sourceContent`) now that
// the write-guard cryptographically binds the two. This helper is the only
// thing that changed about how these fixtures are built; the assertions
// themselves are unchanged from R81.2 unless a comment says otherwise.
const blobSha = (source: string) => computeGitBlobSha1(source);

// R81 — proves the deterministic guard distinguishes comment text from
// ordinary code/identifiers/string literals using a small tokenizer (never
// a naive whole-line grep), and only ever flags NEWLY INTRODUCED comment
// content, never a pre-existing comment the candidate didn't touch.

// A. Added line comment "// TODO: handle later" -> REJECT
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'class X {}\n',
    'class X {\n  // TODO: handle later\n}\n',
    'src/main/java/com/example/X.java', 'MODIFY',
  );
  assert.equal(violations.length, 1, 'A: a newly introduced // TODO line comment is rejected');
  assert.match(violations[0], /TODO/);
}

// B. Added line comment "// FIXME later" -> REJECT
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'class X {}\n',
    'class X {\n  // FIXME later\n}\n',
    'src/main/java/com/example/X.java', 'MODIFY',
  );
  assert.equal(violations.length, 1, 'B: a newly introduced // FIXME line comment is rejected');
}

// C. Added Javadoc/block comment containing TODO -> REJECT where the
// language adapter supports block comments (Java does).
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'class X {}\n',
    '/**\n * TODO: finish this later\n */\nclass X {}\n',
    'src/main/java/com/example/X.java', 'MODIFY',
  );
  assert.equal(violations.length, 1, 'C: a newly introduced Javadoc block comment with TODO is rejected');
}

// D. Executable code referencing an enum member literally named TODO -> ACCEPT
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'class X {}\n',
    'class X {\n  void m() { task.setStatus(TaskStatus.TODO); }\n}\n',
    'src/main/java/com/example/X.java', 'MODIFY',
  );
  assert.deepEqual(violations, [], 'D: TaskStatus.TODO in executable code is never flagged');
}

// E. Enum declaration "TODO," -> ACCEPT
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'class X {}\n',
    'enum TaskStatus {\n  TODO, IN_PROGRESS, DONE, CANCELLED\n}\n',
    'src/main/java/com/example/TaskStatus.java', 'CREATE',
  );
  assert.deepEqual(violations, [], 'E: an enum member declaration is code, never flagged, even on CREATE');
}

// F. String/value literal "TODO" required by application behavior -> ACCEPT
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'class X {}\n',
    'class X {\n  String s = "TODO";\n}\n',
    'src/main/java/com/example/X.java', 'MODIFY',
  );
  assert.deepEqual(violations, [], 'F: a string literal "TODO" is never comment text, never flagged');
}

// G. Comment rephrased without the marker -> ACCEPT
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'class X {}\n',
    'class X {\n  // reset to the default task status\n}\n',
    'src/main/java/com/example/X.java', 'MODIFY',
  );
  assert.deepEqual(violations, [], 'G: a rephrased comment with no marker is accepted');
}

// H. CRITICAL: an unrelated, pre-existing TODO comment elsewhere in the same
// file (untouched by this candidate's edit) must NOT cause a rejection.
{
  const oldContent = 'class X {\n  // TODO: pre-existing note, never touched by this patch\n  int a;\n}\n';
  const newContent = 'class X {\n  // TODO: pre-existing note, never touched by this patch\n  int a;\n  int b; // new field, no marker here\n}\n';
  const violations = detectForbiddenGeneratedCommentMarkers(oldContent, newContent, 'src/main/java/com/example/X.java', 'MODIFY');
  assert.deepEqual(violations, [], 'H: a pre-existing comment the candidate did not introduce/modify must never fail the guard');
}
// H (continued): the same pre-existing comment, if genuinely MODIFIED by the
// candidate (its exact text changes), IS newly-introduced text and is checked.
{
  const oldContent = 'class X {\n  // TODO: pre-existing note\n  int a;\n}\n';
  const newContent = 'class X {\n  // TODO: pre-existing note, now edited\n  int a;\n}\n';
  const violations = detectForbiddenGeneratedCommentMarkers(oldContent, newContent, 'src/main/java/com/example/X.java', 'MODIFY');
  assert.equal(violations.length, 1, 'H continued: an actually-edited comment (different exact text) is re-evaluated as new content');
}

// R81.1 — occurrence-aware hardening: a plain "have I seen this exact text
// before" Set check silently accepts a DUPLICATED marker-bearing comment
// (same text, added again elsewhere) because the string itself is not new.
// Multiset (count-based) comparison must catch it: the count for that exact
// text strictly increases, so the excess occurrence is checked. This is the
// exact gap called out in R81.1's own example (a second identical
// "// TODO legacy issue" appended below an untouched original).
{
  const oldContent = 'class X {\n  // TODO legacy issue\n  int a;\n}\n';
  const newContent = 'class X {\n  // TODO legacy issue\n  int a;\n  // TODO legacy issue\n  int b;\n}\n';
  const violations = detectForbiddenGeneratedCommentMarkers(oldContent, newContent, 'src/main/java/com/example/X.java', 'MODIFY');
  assert.equal(violations.length, 1, 'R81.1: a duplicated occurrence of an already-existing TODO comment is rejected, even though its text is not "new"');
}

// Additional scope-boundary proofs -----------------------------------------

// Unrecognized extension -> never a false rejection (stated scope boundary).
{
  const violations = detectForbiddenGeneratedCommentMarkers(null, '# TODO: unknown language\n', 'infra/unknown.weirdext', 'CREATE');
  assert.deepEqual(violations, [], 'unrecognized file extension is skipped entirely, never a false rejection');
}

// MODIFY without sourceContent supplied -> skipped (backward compatible
// with a caller that has not been upgraded to send it yet), never a false
// rejection and never silently treated as CREATE (which would flag everything).
{
  const violations = detectForbiddenGeneratedCommentMarkers(undefined, 'class X {\n  // TODO: whole file is "new" to this function\n}\n', 'src/main/java/com/example/X.java', 'MODIFY');
  assert.deepEqual(violations, [], 'MODIFY without sourceContent supplied is skipped, not treated as CREATE');
}

// A genuine CREATE (no prior file at all) flags every TODO/FIXME comment,
// since by definition all of it is newly introduced.
{
  const violations = detectForbiddenGeneratedCommentMarkers(null, 'class X {\n  // TODO: brand new file\n}\n', 'src/main/java/com/example/X.java', 'CREATE');
  assert.equal(violations.length, 1, 'a genuine CREATE flags a TODO comment in the new file');
}

// Case-insensitivity.
{
  const violations = detectForbiddenGeneratedCommentMarkers('', '// todo lowercase\n', 'src/main/java/com/example/X.java', 'CREATE');
  assert.equal(violations.length, 1, 'marker detection is case-insensitive');
}

// Python (# line comments) is recognized identically -- proves the rule is
// not Java-specific.
{
  const violations = detectForbiddenGeneratedCommentMarkers('', '# TODO: python file\nx = 1\n', 'app/service.py', 'CREATE');
  assert.equal(violations.length, 1, 'Python line comments (#) are recognized identically to Java //');
  const clean = detectForbiddenGeneratedCommentMarkers('', 'x = "TODO"\n', 'app/service.py', 'CREATE');
  assert.deepEqual(clean, [], 'a Python string literal "TODO" is never flagged');
}

// R81.1 §6 — explicit numbered matrix (items already proven above by A-H and
// the scope-boundary proofs are re-asserted here by number for direct
// traceability to the required list; nothing here is a new code path).
{
  // 1. CREATE // TODO -> REJECT
  assert.equal(detectForbiddenGeneratedCommentMarkers(null, '// TODO\nclass X{}\n', 'X.java', 'CREATE').length, 1, '6.1');
  // 2. MODIFY adding // TODO -> REJECT
  assert.equal(detectForbiddenGeneratedCommentMarkers('class X{}\n', 'class X{\n// TODO\n}\n', 'X.java', 'MODIFY').length, 1, '6.2');
  // 3. MODIFY adding // FIXME -> REJECT
  assert.equal(detectForbiddenGeneratedCommentMarkers('class X{}\n', 'class X{\n// FIXME\n}\n', 'X.java', 'MODIFY').length, 1, '6.3');
  // 4. pre-existing untouched TODO -> ACCEPT
  assert.deepEqual(detectForbiddenGeneratedCommentMarkers('// TODO\nclass X{}\n', '// TODO\nclass X{ int a; }\n', 'X.java', 'MODIFY'), [], '6.4');
  // 5. duplicate newly-added TODO identical to an old TODO comment -> REJECT
  assert.equal(detectForbiddenGeneratedCommentMarkers('// TODO\nclass X{}\n', '// TODO\nclass X{}\n// TODO\n', 'X.java', 'MODIFY').length, 1, '6.5');
  // 6. changed old comment introducing TODO -> REJECT
  assert.equal(detectForbiddenGeneratedCommentMarkers('// clean\nclass X{}\n', '// clean, TODO added\nclass X{}\n', 'X.java', 'MODIFY').length, 1, '6.6');
  // 7. TaskStatus.TODO executable code -> ACCEPT
  assert.deepEqual(detectForbiddenGeneratedCommentMarkers('class X{}\n', 'class X{ void m(){ s.setStatus(TaskStatus.TODO); } }\n', 'X.java', 'MODIFY'), [], '6.7');
  // 8. enum TODO -> ACCEPT
  assert.deepEqual(detectForbiddenGeneratedCommentMarkers(null, 'enum TaskStatus { TODO, DONE }\n', 'TaskStatus.java', 'CREATE'), [], '6.8');
  // 9. "TODO" string -> ACCEPT
  assert.deepEqual(detectForbiddenGeneratedCommentMarkers('class X{}\n', 'class X{ String s = "TODO"; }\n', 'X.java', 'MODIFY'), [], '6.9');
  // 10. clean explanatory comment -> ACCEPT
  assert.deepEqual(detectForbiddenGeneratedCommentMarkers('class X{}\n', 'class X{\n// resets to the default value\n}\n', 'X.java', 'MODIFY'), [], '6.10');
  // 11. unsupported extension -> existing fail-safe preserved
  assert.deepEqual(detectForbiddenGeneratedCommentMarkers(null, '// TODO\n', 'notes.unknownext', 'CREATE'), [], '6.11');
  console.log('R81.1 §6 numbered matrix (1-11): PASS');
}

console.log('generated-comment-guard: PASS (A-H + scope-boundary proofs)');

// --- End-to-end through the real write-guard entry point -------------------

function passingVerification(): CandidateVerification {
  return {
    mode: 'FULL_TEST',
    identity: { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0, candidateBaseSha: 'a'.repeat(40), candidateDigest: 'digest-1' },
    workspace: { workspaceId: 'r1/b1/attempt-0', requestedSha: 'a'.repeat(40), checkoutSha: 'a'.repeat(40), exactShaVerified: true, created: true, cleaned: true },
    manifestValidation: { status: 'PASS', errors: [] },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 100, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' }, regression: { status: 'SUCCESS', total: 22, failures: 0, errors: 0, skipped: 0, durationMs: 100, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS',
    verificationLevel: 'COMPILE_TEST_VERIFIED',
    failureClass: null,
  };
}
function manifest(files: CandidateManifest['files']): CandidateManifest {
  return { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0, repository: 'x/y', candidateBaseSha: 'a'.repeat(40), files, candidateDigest: 'digest-1' };
}

// An otherwise fully-valid, verified candidate is still rejected for a
// generated TODO comment -- and the reason is exactly GENERATED_COMMENT_MARKER_FORBIDDEN.
{
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'CREATE', content: 'class X {\n  // TODO: forbidden\n}\n', contentSha256: 'x'.repeat(64) },
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'GENERATED_COMMENT_MARKER_FORBIDDEN');
  assert.equal(result.generatedCommentViolations.length, 1);
}

// A clean candidate (rephrased comment, no marker) is accepted end-to-end.
{
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'CREATE', content: 'class X {\n  // reset to the default value\n}\n', contentSha256: 'x'.repeat(64) },
  ]));
  assert.equal(result.ok, true);
}

// An unrelated pre-existing TODO elsewhere in a MODIFY file, with
// sourceContent supplied AND its real originalBlobSha, must not fail an
// otherwise-clean candidate.
{
  const source = 'class X {\n  // TODO: old, pre-existing\n}\n';
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    {
      path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X {\n  // TODO: old, pre-existing\n  int b;\n}\n',
      contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source),
    },
  ]));
  assert.equal(result.ok, true, 'an untouched pre-existing TODO must not fail an otherwise-clean candidate end-to-end');
}

// Existing SHA/digest/verification checks still take priority over the
// generated-comment check -- a candidate failing an earlier check is
// rejected for THAT reason even if it also has a forbidden comment.
{
  const verification = passingVerification();
  verification.overall = 'FAIL';
  const result: any = assertCandidateStillValidForWrite(verification, manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'CREATE', content: '// TODO: forbidden\n', contentSha256: 'x'.repeat(64) },
  ]));
  assert.equal(result.reason, 'VERIFICATION_NOT_PASS', 'an earlier identity/verification failure is reported before the comment-quality check ever runs');
}

console.log('write-guard + generated-comment-guard integration: PASS');

// ============================================================================
// R81.2 §4 — FAIL-CLOSED test matrix (A-K)
// ============================================================================
import { evaluateGeneratedCommentGuardForFile } from './generated-comment-guard';

// A. MODIFY supported .java + sourceContent missing -> REJECT, INPUT_INCOMPLETE
{
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X {}\n', contentSha256: 'x'.repeat(64) },
  ]));
  assert.equal(result.ok, false, 'R81.2 A');
  assert.equal(result.reason, 'GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE', 'R81.2 A: missing sourceContent on a supported-extension MODIFY is rejected, not silently skipped');
}

// B. MODIFY supported .ts + sourceContent null -> REJECT
{
  const verdict = evaluateGeneratedCommentGuardForFile({ path: 'src/app.ts', operation: 'MODIFY', content: 'const x = 1;\n', sourceContent: null });
  assert.deepEqual(verdict, { ok: false, reason: 'INPUT_INCOMPLETE' }, 'R81.2 B');
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/app.ts', operation: 'MODIFY', content: 'const x = 1;\n', contentSha256: 'x'.repeat(64), sourceContent: null },
  ]));
  assert.equal(result.reason, 'GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE', 'R81.2 B end-to-end');
}

// C. CREATE supported file + no sourceContent -> allowed to proceed to normal marker inspection (not INPUT_INCOMPLETE)
{
  const verdict = evaluateGeneratedCommentGuardForFile({ path: 'src/main/java/com/example/X.java', operation: 'CREATE', content: 'class X {}\n' });
  assert.deepEqual(verdict, { ok: true }, 'R81.2 C: CREATE never requires sourceContent');
  const dirty = evaluateGeneratedCommentGuardForFile({ path: 'src/main/java/com/example/X.java', operation: 'CREATE', content: 'class X { // TODO }\n' });
  assert.equal(dirty.ok, false);
  assert.equal((dirty as any).reason, 'MARKER_FORBIDDEN', 'R81.2 C: CREATE still runs normal marker inspection, just never gates on sourceContent presence');
}

// D. MODIFY supported file + valid sourceContent (+ matching originalBlobSha) + added // TODO -> GENERATED_COMMENT_MARKER_FORBIDDEN
{
  const source = 'class X {}\n';
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X {\n// TODO added\n}\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'GENERATED_COMMENT_MARKER_FORBIDDEN', 'R81.2 D');
}

// E. MODIFY supported file + valid sourceContent (+ matching originalBlobSha) + clean comment -> ACCEPT
{
  const source = 'class X {}\n';
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X {\n// clean note\n}\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
  ]));
  assert.equal(result.ok, true, 'R81.2 E');
}

// F. pre-existing untouched TODO -> ACCEPT
{
  const source = '// TODO old\nclass X {}\n';
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: '// TODO old\nclass X { int b; }\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
  ]));
  assert.equal(result.ok, true, 'R81.2 F');
}

// G. new duplicate existing TODO -> REJECT
{
  const source = '// TODO old\nclass X {}\n';
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: '// TODO old\nclass X {}\n// TODO old\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
  ]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'GENERATED_COMMENT_MARKER_FORBIDDEN', 'R81.2 G');
}

// H. TaskStatus.TODO code -> ACCEPT
{
  const source = 'class X {}\n';
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X { void m(){ s.setStatus(TaskStatus.TODO); } }\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
  ]));
  assert.equal(result.ok, true, 'R81.2 H');
}

// I. "TODO" string -> ACCEPT
{
  const source = 'class X {}\n';
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X { String s = "TODO"; }\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
  ]));
  assert.equal(result.ok, true, 'R81.2 I');
}

// J. enum TODO -> ACCEPT (CREATE, no sourceContent required)
{
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'src/main/java/com/example/TaskStatus.java', operation: 'CREATE', content: 'enum TaskStatus { TODO, DONE }\n', contentSha256: 'x'.repeat(64) },
  ]));
  assert.equal(result.ok, true, 'R81.2 J');
}

// K. unsupported extension -> documented unsupported-language behavior preserved (never INPUT_INCOMPLETE, never a false rejection)
{
  const verdict = evaluateGeneratedCommentGuardForFile({ path: 'infra/notes.weirdext', operation: 'MODIFY', content: '# TODO\n' });
  assert.deepEqual(verdict, { ok: true }, 'R81.2 K: an unsupported extension is never gated on sourceContent -- it never claimed comment-analysis coverage in the first place');
  const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
    { path: 'infra/notes.weirdext', operation: 'MODIFY', content: '# TODO\n', contentSha256: 'x'.repeat(64) },
  ]));
  assert.equal(result.ok, true, 'R81.2 K end-to-end');
}

console.log('R81.2 §4 fail-closed test matrix (A-K): PASS');

// ============================================================================
// R81.2 §5 — offline canonical WF2 contract replay (no n8n execution, no
// network). Grounded in real data from historical execution 2038 (batch
// 833de3d1..., attempt 13): the real pre-edit TaskService.java content,
// truncated to the update-method region for test size, with a real vs.
// forbidden vs. missing sourceContent scenario run through the REAL,
// unmodified backend write-guard.
// ============================================================================
{
  const realPreEditExcerpt =
    'public void updateStatus(Task existing, Task updated) {\n' +
    '  existing.setStatus(updated.getStatus());\n' +
    '}\n';

  // NORMAL MODIFY: sourceContent available -> originalContent(now sourceContent) populated -> clean patch passes.
  {
    const cleanPatch = realPreEditExcerpt.replace(
      'existing.setStatus(updated.getStatus());',
      'existing.setStatus(updated.getStatus()); // reset to the default value when absent',
    );
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/pfe/devsecops/service/TaskService.java', operation: 'MODIFY', content: cleanPatch, contentSha256: 'x'.repeat(64), sourceContent: realPreEditExcerpt, originalBlobSha: blobSha(realPreEditExcerpt) },
    ]));
    console.log('R81.2 §5 NORMAL MODIFY ->', JSON.stringify({ ok: result.ok }));
    assert.equal(result.ok, true, 'R81.2 §5 NORMAL MODIFY: clean patch passes with sourceContent available');
  }

  // FORBIDDEN MODIFY: sourceContent available -> added TODO comment rejected.
  {
    const forbiddenPatch = realPreEditExcerpt.replace(
      'existing.setStatus(updated.getStatus());',
      'existing.setStatus(updated.getStatus()); // TODO: verify this later',
    );
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/pfe/devsecops/service/TaskService.java', operation: 'MODIFY', content: forbiddenPatch, contentSha256: 'x'.repeat(64), sourceContent: realPreEditExcerpt, originalBlobSha: blobSha(realPreEditExcerpt) },
    ]));
    console.log('R81.2 §5 FORBIDDEN MODIFY ->', JSON.stringify({ ok: result.ok, reason: result.reason }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'GENERATED_COMMENT_MARKER_FORBIDDEN', 'R81.2 §5 FORBIDDEN MODIFY');
  }

  // BROKEN UPSTREAM REFERENCE: sourceContent missing entirely (simulates a
  // future upstream rename/breakage that drops the field) -> no fabrication,
  // no fallback to candidate content -> deterministic rejection, no write path.
  {
    const forbiddenPatch = realPreEditExcerpt.replace(
      'existing.setStatus(updated.getStatus());',
      'existing.setStatus(updated.getStatus()); // clean, no marker at all',
    );
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/pfe/devsecops/service/TaskService.java', operation: 'MODIFY', content: forbiddenPatch, contentSha256: 'x'.repeat(64) /* sourceContent deliberately absent */ },
    ]));
    console.log('R81.2 §5 BROKEN UPSTREAM REFERENCE ->', JSON.stringify({ ok: result.ok, reason: result.reason }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE', 'R81.2 §5 BROKEN UPSTREAM: missing sourceContent rejects even a textually-clean patch -- never falls back to skip-and-allow');
  }
}
console.log('R81.2 §5 offline canonical WF2 contract replay: PASS');

// R81.2 §6 — HONEST SCOPE BOUNDARY, proven not just declared: a Python
// docstring is a STRING LITERAL syntactically (triple-quoted), never a `#`
// comment, so it is never inspected -- PYTHON_DOCSTRING_PROTECTION is
// NOT_IMPLEMENTED. This is a stated scope declaration ("TODO/FIXME markers
// in recognized comment syntax/Javadoc-style comments for supported
// extensions"), not a failure of the Java correction, and not silently
// claimed otherwise anywhere in this file's documentation.
{
  const violations = detectForbiddenGeneratedCommentMarkers(
    'def f():\n    pass\n',
    'def f():\n    """TODO: implement this properly"""\n    pass\n',
    'app/service.py', 'MODIFY',
  );
  assert.deepEqual(violations, [], 'R81.2 §6: a Python docstring is a string literal, not a comment -- PYTHON_DOCSTRING_PROTECTION = NOT_IMPLEMENTED, proven here rather than assumed');
  // The exact same file's `#` line comments ARE still protected -- the gap
  // is specifically triple-quoted docstrings, not Python support overall.
  const hashViolations = detectForbiddenGeneratedCommentMarkers(
    'def f():\n    pass\n',
    'def f():\n    # TODO: implement this properly\n    pass\n',
    'app/service.py', 'MODIFY',
  );
  assert.equal(hashViolations.length, 1, 'R81.2 §6: ordinary Python # comments remain fully protected -- only triple-quoted docstrings are the stated gap');
}
console.log('R81.2 §6 Python docstring scope boundary (NOT_IMPLEMENTED, proven): PASS');

// ============================================================================
// R81.3 — TRUST-BIND ORIGINAL CONTENT: sourceContent must now be
// cryptographically bound to `originalBlobSha` (GitHub's own blob SHA for
// that path/ref, captured before the writer LLM ran) before it is trusted
// as "old content" for the comment-marker diff. R81.2 only asked "is SOME
// string present" -- it could not detect a candidate/caller supplying its
// OWN fabricated "pre-edit" text. §4 below proves the missing-trust-anchor
// precondition; §6 proves the actual forgery attack is now caught.
// ============================================================================

// R81.3 §4 additions to the fail-closed matrix: originalBlobSha itself is a
// required trust anchor, independently of sourceContent's own presence.
{
  const source = 'class X {}\n';
  // sourceContent present and well-formed, but originalBlobSha entirely
  // absent -> INPUT_INCOMPLETE (the trust anchor itself is missing).
  {
    const verdict = evaluateGeneratedCommentGuardForFile({ path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: source, sourceContent: source });
    assert.deepEqual(verdict, { ok: false, reason: 'INPUT_INCOMPLETE' }, 'R81.3: sourceContent without any originalBlobSha is INPUT_INCOMPLETE, not silently trusted');
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: source, contentSha256: 'x'.repeat(64), sourceContent: source },
    ]));
    assert.equal(result.reason, 'GENERATED_COMMENT_GUARD_INPUT_INCOMPLETE', 'R81.3 end-to-end: missing originalBlobSha rejects exactly like missing sourceContent');
  }
  // originalBlobSha present but malformed (not a full 40-hex SHA) -> still
  // INPUT_INCOMPLETE, never compared as if it were a real hash.
  {
    const verdict = evaluateGeneratedCommentGuardForFile({ path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: source, sourceContent: source, originalBlobSha: 'not-a-real-sha' });
    assert.deepEqual(verdict, { ok: false, reason: 'INPUT_INCOMPLETE' }, 'R81.3: a malformed originalBlobSha is treated as absent, never as a weak/partial proof');
  }
}
console.log('R81.3 §4 trust-anchor-required matrix: PASS');

// R81.3 §6 — ATTACK / BYPASS TESTS (A-H)
{
  const trueOriginal = 'class X {}\n';
  const trueHash = blobSha(trueOriginal);

  // A. Trusted original is "class X {}"; the candidate's new content has an
  // injected TODO; the CALLER also falsifies sourceContent to already
  // contain that same TODO (so a naive diff would find "nothing new") --
  // but the trusted hash on the manifest is for the TRUE original.
  // -> ORIGINAL_CONTENT_INTEGRITY_MISMATCH, not a silent pass.
  {
    const injectedNew = 'class X { // TODO injected\n}\n';
    const forgedOld = injectedNew; // caller claims the TODO was already there
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: injectedNew, contentSha256: 'x'.repeat(64), sourceContent: forgedOld, originalBlobSha: trueHash },
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'R81.3 A: forged sourceContent that "pre-contains" the injected marker is caught by the real hash, not silently accepted');
  }

  // B. Caller alters sourceContent only (any alteration, not necessarily
  // marker-related) while originalBlobSha still names the true blob ->
  // INTEGRITY_MISMATCH.
  {
    const alteredOld = 'class X { int extraField; }\n'; // does not match trueHash
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X { int extraField;\n// clean\n}\n', contentSha256: 'x'.repeat(64), sourceContent: alteredOld, originalBlobSha: trueHash },
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'R81.3 B: any sourceContent not matching the trusted blob SHA is rejected, regardless of what it contains');
  }

  // C. "Caller alters the trusted hash through candidate output" is
  // impossible BY CONSTRUCTION in the real WF2 node graph, not merely by
  // policy here: `originalBlobSha` (via CandidateFile.originalBlobSha) is
  // never taken from the writer LLM's own output object -- it is threaded,
  // in the actual proposed WF2 artifact, from oldSha := prepared.file_sha
  // (itself GitHub's own file SHA, captured by "Fetch Repository Files"
  // before the LLM runs) through an explicit spread-then-overlay in "Parse -
  // Code Patch Output" that never re-lists oldSha/sourceContent among the
  // fields copied FROM the parsed LLM JSON, AND the LLM's own JSON schema
  // (enforced in that same node) rejects any response containing an extra
  // key beyond {targetFile,processedFindingIds,patchedCode,patchDescription,
  // conformanceEvidence} -- so the LLM cannot even SUBMIT a competing
  // oldSha/sourceContent for that spread to prefer. See
  // wf2-r81-3-trust-binding.spec.mjs for the executable proof against the
  // actual workflow JSON text (not just this comment's claim).
  // At the write-guard boundary itself, the analogous invariant is: no
  // spread/merge in evaluateGeneratedCommentGuardForFile or the manifest
  // shape ever derives originalBlobSha from `content` (the candidate's own
  // new/LLM-authored text) -- proven by every case in this file where
  // `content` and `sourceContent`/`originalBlobSha` differ yet the outcome
  // still depends only on sourceContent vs. originalBlobSha, never on content.
  console.log('R81.3 C: trusted-hash-cannot-be-overridden-by-writer-output is a structural/spread-ordering proof, see wf2-r81-3-trust-binding.spec.mjs');

  // D. Correct originalContent + correct trusted hash + added TODO -> GENERATED_COMMENT_MARKER_FORBIDDEN
  {
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X {\n// TODO added\n}\n', contentSha256: 'x'.repeat(64), sourceContent: trueOriginal, originalBlobSha: trueHash },
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'GENERATED_COMMENT_MARKER_FORBIDDEN', 'R81.3 D');
  }

  // E. Correct originalContent + correct hash + clean change -> ACCEPT
  {
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X {\n// clean note\n}\n', contentSha256: 'x'.repeat(64), sourceContent: trueOriginal, originalBlobSha: trueHash },
    ]));
    assert.equal(result.ok, true, 'R81.3 E');
  }

  // F. TaskStatus.TODO executable code -> ACCEPT
  {
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: 'class X { void m(){ s.setStatus(TaskStatus.TODO); } }\n', contentSha256: 'x'.repeat(64), sourceContent: trueOriginal, originalBlobSha: trueHash },
    ]));
    assert.equal(result.ok, true, 'R81.3 F');
  }

  // G. Pre-existing untouched TODO comment with AUTHENTIC original -> ACCEPT
  {
    const source = '// TODO old\nclass X {}\n';
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: '// TODO old\nclass X { int b; }\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
    ]));
    assert.equal(result.ok, true, 'R81.3 G');
  }

  // H. Duplicate newly-added TODO (authentic original) -> REJECT
  {
    const source = '// TODO old\nclass X {}\n';
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/example/X.java', operation: 'MODIFY', content: '// TODO old\nclass X {}\n// TODO old\n', contentSha256: 'x'.repeat(64), sourceContent: source, originalBlobSha: blobSha(source) },
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'GENERATED_COMMENT_MARKER_FORBIDDEN', 'R81.3 H');
  }
}
console.log('R81.3 §6 attack/bypass tests (A-H): PASS');

// R81.3 §7 offline replay addendum: the exact real TaskService.java excerpt
// used by R81.2 §5, now with its real originalBlobSha bound -- proves the
// same NORMAL/FORBIDDEN scenarios still resolve identically once integrity
// binding is enforced (i.e. R81.3 does not change behavior for HONEST
// callers, only for forged ones), and adds the forged-sourceContent case
// against this same real file.
{
  const realPreEditExcerpt =
    'public void updateStatus(Task existing, Task updated) {\n' +
    '  existing.setStatus(updated.getStatus());\n' +
    '}\n';
  const realHash = blobSha(realPreEditExcerpt);

  // Honest MODIFY, real hash supplied -> unchanged from R81.2 §5: ACCEPT.
  {
    const cleanPatch = realPreEditExcerpt.replace(
      'existing.setStatus(updated.getStatus());',
      'existing.setStatus(updated.getStatus()); // reset to the default value when absent',
    );
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/pfe/devsecops/service/TaskService.java', operation: 'MODIFY', content: cleanPatch, contentSha256: 'x'.repeat(64), sourceContent: realPreEditExcerpt, originalBlobSha: realHash },
    ]));
    assert.equal(result.ok, true, 'R81.3 §7: honest MODIFY with real hash still passes exactly as under R81.2');
  }

  // Forged sourceContent against this same real file: caller pre-bakes the
  // TODO into its claimed "original" so the multiset diff sees nothing new,
  // but supplies the TRUE file's hash (the only hash it could plausibly
  // have obtained from a real upstream fetch) -> mismatch, rejected.
  {
    const forgedOldWithPreBakedTodo = realPreEditExcerpt.replace(
      'existing.setStatus(updated.getStatus());',
      'existing.setStatus(updated.getStatus()); // TODO: verify this later',
    );
    const result: any = assertCandidateStillValidForWrite(passingVerification(), manifest([
      { path: 'src/main/java/com/pfe/devsecops/service/TaskService.java', operation: 'MODIFY', content: forgedOldWithPreBakedTodo, contentSha256: 'x'.repeat(64), sourceContent: forgedOldWithPreBakedTodo, originalBlobSha: realHash },
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'R81.3 §7: a forged sourceContent that matches its own forged "new" content, checked against the REAL file hash, is caught');
  }
}
console.log('R81.3 §7 offline canonical WF2 replay addendum: PASS');
