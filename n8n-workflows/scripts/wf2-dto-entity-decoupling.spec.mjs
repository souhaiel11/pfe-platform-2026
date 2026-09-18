// Offline contract tests for the S4684 DTO/entity-decoupling hardening in
// the canonical promotion artifact:
//   n8n-workflows/pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json
//
// Context: real fixRequest 591853f3-9538-4df7-9b2d-7df1f8fca1f8 (batch
// cc610d36782e1d115fb997dad92312e78ce92c0c575d698702ef288f2ec77666,
// java:S4684 TaskController.java:34), execution 1998 (WF2 version
// b03fdfec-ef53-445b-8338-cbe239190665, the promoted R23 workflow). Both
// candidate files generated: TaskController.java (MODIFY, passed
// Independent Semantic Review) and TaskDTO.java (CREATE, REJECTED by
// Independent Semantic Review because the generated field was typed
// `Task.TaskStatus` -- a direct import of and reference to the JPA entity's
// nested persistence enum). Ground truth for the real entity, read from the
// same frozen baseSha (4c9537d51ab6c560c0e1c53a7e07e922a844f3e6) execution
// 1998 itself fetched:
//   enum Task.TaskStatus { TODO, IN_PROGRESS, DONE, CANCELLED }
//   getStatus()/setStatus(TaskStatus) via Lombok @Data.
//
// This spec: (a) proves the exact real execution-1998 rejected candidate is
// caught by the new deterministic "Generic Candidate Preflight" check before
// ever reaching Independent Semantic Review; (b) proves a decoupled
// candidate carrying the real enum values is not flagged by the new check;
// (c) proves a legitimate non-DTO file that imports the entity is
// unaffected; (d) proves the planner and patch-generation prompts were
// strengthened; (e) proves no existing R23/patch hardening regressed;
// (f) proves the PLACEHOLDER_MARKER guard scans Java comments contextually,
// compares work markers with the frozen baseline, and never treats enum
// declarations, enum references, identifiers, or strings as unfinished work.
//
// No n8n execution, network, or business action. No fixRequest retried.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const node = name => wf.nodes.find(n => n.name === name);

// ── 0. Node count unchanged: no new node was required for this hardening. ──
{
  assert.equal(wf.nodes.length, 186, 'DTO checks, digest bridge and bounded cross-file verification nodes are retained');
}

// ── Real execution-1998 candidates (verbatim, not paraphrased) ─────────────
const REAL_BAD_TASKDTO_JAVA = `package com.pfe.devsecops.dto;

import com.pfe.devsecops.model.Task;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TaskDTO {

    private Long id;

    private String title;

    private String description;

    private Task.TaskStatus status;

    private Integer priority;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private Long userId;
}
`;

// Independently declared status representation carrying the REAL Task.java
// enum values verbatim (TODO, IN_PROGRESS, DONE, CANCELLED) -- no import
// of, or reference to, com.pfe.devsecops.model.Task. Prior to the
// PLACEHOLDER_MARKER fix below, this exact fixture (faithfully preserving
// the real "TODO" value, as required) was incorrectly rejected; it now
// PASSes because the check is comment-scoped.
const GOOD_DECOUPLED_TASKDTO_JAVA = `package com.pfe.devsecops.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TaskDTO {

    public enum TaskStatus {
        TODO, IN_PROGRESS, DONE, CANCELLED
    }

    private Long id;

    private String title;

    private String description;

    private TaskStatus status;

    private Integer priority;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private Long userId;
}
`;

const repositoryPolicy = {
  policyVersion: '1.0',
  existingFiles: [
    'src/main/java/com/pfe/devsecops/controller/TaskController.java',
    'src/main/java/com/pfe/devsecops/model/Task.java',
    'src/main/java/com/pfe/devsecops/service/TaskService.java',
  ],
  permittedRoots: ['src/main/java/'],
};

function runPreflight(patchFixture) {
  const jsCode = node('Generic Candidate Preflight').parameters.jsCode;
  const fn = new Function('$json', jsCode);
  return fn(patchFixture);
}

const wrap = body => `package com.pfe.devsecops.dto;\npublic class Fixture {\n${body}\n}\n`;

const basePatch = (overrides) => ({
  targetFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java',
  fileOperation: 'CREATE',
  sourceContent: '',
  repositoryPolicy,
  completePlan: {
    allPlannedFiles: [
      { path: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' },
      { path: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java' },
    ],
  },
  approvedFindingsForFile: [
    { findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', source: 'SONARQUBE', rule: 'java:S4684', file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 34, scannerEvidence: {} },
  ],
  applicablePlans: [{ requiredChanges: ['Introduce independent DTO'], forbiddenChanges: [] }],
  ...overrides,
});

// ── Test A (bad-candidate regression, section 8): the EXACT real
// execution-1998 rejected candidate must be caught deterministically, fail
// closed, before any LLM review call. ──────────────────────────────────────
{
  assert.throws(
    () => runPreflight(basePatch({ patchedCode: REAL_BAD_TASKDTO_JAVA })),
    (e) => {
      assert.match(e.message, /^WF2_CANDIDATE_QUALITY_REJECTED:/);
      const meta = JSON.parse(e.message.slice('WF2_CANDIDATE_QUALITY_REJECTED:'.length));
      assert.deepEqual(meta.violations, ['DTO_ENTITY_TYPE_COUPLING']);
      return true;
    },
    'real execution-1998 TaskDTO.java candidate must be rejected deterministically for entity coupling',
  );
  console.log('wf2-dto-entity-decoupling Test A (real exec-1998 bad candidate -> REJECT DTO_ENTITY_TYPE_COUPLING): PASS');
}

// ── Test B (good-candidate, sections 6/9): a decoupled DTO carrying the
// REAL Task.java enum values (TODO, IN_PROGRESS, DONE, CANCELLED)
// independently is not flagged by either DTO_ENTITY_TYPE_COUPLING or
// PLACEHOLDER_MARKER. ───────────────────────────────────────────────────────
{
  const result = runPreflight(basePatch({ patchedCode: GOOD_DECOUPLED_TASKDTO_JAVA }));
  assert.equal(result.json.genericPreflightPassed, true, 'DTO_ENTITY_TYPE_COUPLING = PASS, PLACEHOLDER_MARKER = PASS, GOOD_FIXTURE = PASS');
  console.log('wf2-dto-entity-decoupling Test B (decoupled DTO, real enum values incl. TODO -> PASS preflight): PASS');
}

// ── Test C: a legitimate non-DTO file that imports the entity (the
// controller itself, which must import Task to talk to TaskService) is not
// affected by the new check -- it only applies to newly CREATEd files under
// a /dto/ path. ─────────────────────────────────────────────────────────────
{
  const controllerPatch = {
    targetFile: 'src/main/java/com/pfe/devsecops/controller/TaskController.java',
    fileOperation: 'MODIFY',
    sourceContent: 'package com.pfe.devsecops.controller;\nimport com.pfe.devsecops.model.Task;\npublic class TaskController { private Task t; }\n',
    repositoryPolicy,
    completePlan: { allPlannedFiles: [{ path: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' }] },
    approvedFindingsForFile: [{ findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', source: 'SONARQUBE', rule: 'java:S4684', file: 'x', line: 1, scannerEvidence: {} }],
    applicablePlans: [{ requiredChanges: [], forbiddenChanges: [] }],
    patchedCode: 'package com.pfe.devsecops.controller;\nimport com.pfe.devsecops.dto.TaskDTO;\nimport com.pfe.devsecops.model.Task;\nimport com.pfe.devsecops.service.TaskService;\npublic class TaskController { private TaskService taskService; }\n',
  };
  const result = runPreflight(controllerPatch);
  assert.equal(result.json.genericPreflightPassed, true, 'legitimate controller import of the entity must not be flagged -- the rule targets newly created DTOs only');
  console.log('wf2-dto-entity-decoupling Test C (controller MODIFY legitimately importing entity -> no false positive): PASS');
}

// ── Test D: isolated unit coverage of the exact predicate (operation +
// path + import-source), independent of unrelated preflight checks. ───────
{
  const jsCode = node('Generic Candidate Preflight').parameters.jsCode;
  assert.match(jsCode, /DTO_ENTITY_TYPE_COUPLING/);
  assert.match(jsCode, /operation===['"]CREATE['"]/);
  assert.match(jsCode, /\\\/dto\\\//);
  assert.match(jsCode, /model\|entity\|entities\|domain\|persistence/);
  assert.match(jsCode, /workMarkerOccurrences/, 'PLACEHOLDER_MARKER must use contextual comment occurrences');
  assert.match(jsCode, /inheritedWorkMarkers/, 'PLACEHOLDER_MARKER must compare against the frozen baseline');
  assert.match(jsCode, /PLACEHOLDER_MARKER/);
}

// ── Test H: extractComments() robustness -- string/char literals, escaped
// quotes, triple-quote text blocks, and comment detection immediately
// following a string literal must all be handled correctly by the same
// minimal lexer (no broader parser rewrite). ───────────────────────────────
{
  const PASS_CASES = [
    ['enum Status { TODO, DONE }', wrap('enum Status {\n    TODO,\n    DONE\n}')],
    ['dto.setStatus(TaskDTO.TaskStatus.TODO);', wrap('void m(){ dto.setStatus(TaskDTO.TaskStatus.TODO); }')],
    ['String a = "TODO";', wrap('String a = "TODO";')],
    ['String b = "// TODO not a comment";', wrap('String b = "// TODO not a comment";')],
    ['String c = "/* FIXME not a comment */";', wrap('String c = "/* FIXME not a comment */";')],
    ['String escaped = "value \\" // TODO";', wrap('String escaped = "value \\" // TODO";')],
    ['text block containing TODO (not a Java comment)', wrap('String tb = """\n    TODO not a comment, just text\n    """;')],
  ];
  const BLOCK_CASES = [
    ['comment AFTER a plain string literal still detected', wrap('String s = "no marker here"; // TODO after string\nvoid m(){}')],
    ['comment AFTER an escaped-quote string literal still detected', wrap('String s = "a \\" b"; // FIXME after escaped string\nvoid m(){}')],
  ];
  for (const [label, code] of PASS_CASES) {
    const result = runPreflight(basePatch({ patchedCode: code }));
    assert.equal(result.json.genericPreflightPassed, true, `${label} must PASS -- not inside a Java comment`);
  }
  for (const [label, code] of BLOCK_CASES) {
    assert.throws(() => runPreflight(basePatch({ patchedCode: code })), /PLACEHOLDER_MARKER/, `${label} must BLOCK`);
  }
  console.log('wf2-dto-entity-decoupling Test H (extractComments robustness: strings, escapes, text blocks, post-string comments): PASS');
}

// ── Test E (fix regression, sections 2/5): PLACEHOLDER_MARKER now scans
// only Java comment text. The false positive on the real "TODO" enum value
// (previously documented here as a known limitation) is fixed: legitimate
// Java tokens pass; real unfinished-code comment markers still fail closed.
{
  const PASS_CASES = [
    ['C: real enum constant (TaskStatus { TODO, IN_PROGRESS, DONE, CANCELLED })', wrap('enum TaskStatus {\n  TODO,\n  IN_PROGRESS,\n  DONE,\n  CANCELLED\n}')],
    ['D: enum reference (TaskDTO.TaskStatus.TODO)', wrap('void m(){ dto.setStatus(TaskDTO.TaskStatus.TODO); }')],
    ['E: identifier containing word (TODO_COUNT)', wrap('private int TODO_COUNT;')],
    ['F: string literal ("TODO")', wrap('String x = "TODO";')],
  ];
  const BLOCK_CASES = [
    ['A: line comment (// TODO implement conversion)', wrap('// TODO implement conversion\nvoid m(){}')],
    ['A: line comment (// FIXME mapping)', wrap('// FIXME mapping\nvoid m(){}')],
    ['B: block comment (/* TODO implement */)', wrap('/* TODO implement */\nvoid m(){}')],
    ['B: multiline block comment (FIXME later)', wrap('/*\n * FIXME later\n */\nvoid m(){}')],
  ];
  for (const [label, code] of PASS_CASES) {
    const result = runPreflight(basePatch({ patchedCode: code }));
    assert.equal(result.json.genericPreflightPassed, true, `${label} must PASS -- legitimate Java token, not a placeholder comment`);
  }
  for (const [label, code] of BLOCK_CASES) {
    assert.throws(
      () => runPreflight(basePatch({ patchedCode: code })),
      /PLACEHOLDER_MARKER/,
      `${label} must BLOCK -- genuine unfinished-code comment marker`,
    );
  }
  console.log('wf2-dto-entity-decoupling Test E (PLACEHOLDER_MARKER comment-scoped fix, cases A/A2/B/B2/C/D/E/F): PASS');
}

// ── Test G (section 7): the exact bad entity-coupled fixture given in the
// task must still be blocked -- the TODO/FIXME fix must not affect this
// guard. ────────────────────────────────────────────────────────────────────
{
  const EXACT_BAD_SNIPPET = `import com.pfe.devsecops.model.Task;

public class TaskDTO {
    private Task.TaskStatus status;
}
`;
  assert.throws(
    () => runPreflight(basePatch({ patchedCode: EXACT_BAD_SNIPPET })),
    (e) => {
      assert.match(e.message, /^WF2_CANDIDATE_QUALITY_REJECTED:/);
      const meta = JSON.parse(e.message.slice('WF2_CANDIDATE_QUALITY_REJECTED:'.length));
      assert.ok(meta.violations.includes('DTO_ENTITY_TYPE_COUPLING'), 'DTO_ENTITY_TYPE_COUPLING must still fire');
      return true;
    },
  );
  console.log('wf2-dto-entity-decoupling Test G (exact section-7 bad entity-coupled snippet -> still BLOCKED): PASS');
}

// ── Test F: planner ("Prepare Generic Remediation Plan") and patch-body
// ("Prepare - Code Patch Body") prompts were strengthened with a generic
// (non-Task-specific) DTO/entity decoupling rule. ──────────────────────────
{
  const planCode = node('Prepare Generic Remediation Plan').parameters.jsCode;
  assert.match(planCode, /decoupled from persistence entities/);
  assert.match(planCode, /must not import a persistence entity class/);
  assert.match(planCode, /nested inside a persistence entity/);
  assert.match(planCode, /DTO-specific enum, an existing shared non-persistence enum, or a String/);
  assert.doesNotMatch(planCode, /\bTask\.TaskStatus\b/, 'rule must stay generic -- not hardcoded to Task');
  assert.doesNotMatch(planCode, /\bTaskDTO\b/, 'rule must stay generic -- not hardcoded to TaskDTO');

  const patchCode = node('Prepare - Code Patch Body').parameters.jsCode;
  assert.match(patchCode, /do not import or reference the persistence entity from the DTO/);
  assert.match(patchCode, /Entity\.SomeEnum/);
  assert.match(patchCode, /map DTO to entity and entity to DTO explicitly and null-safely/);
  assert.match(patchCode, /preserve every enum value/);
  assert.match(patchCode, /do not use BeanUtils or reflection/);
  assert.match(patchCode, /never invent an accessor/);
  assert.doesNotMatch(patchCode, /\bTask\.TaskStatus\b/, 'rule must stay generic -- not hardcoded to Task');
  console.log('wf2-dto-entity-decoupling Test F (planner + patch-body prompts strengthened, generically worded): PASS');
}

// ── Section 10/11: R23 + prior patch hardening unchanged by this edit. ────
{
  const gate = node('Validate Source Context Completeness');
  assert.ok(gate, 'R23 completeness gate node still present');
  const fetch = node('Fetch Referenced API Sources');
  assert.equal(fetch.retryOnFail, true);
  assert.equal(fetch.maxTries, 3);
  assert.equal(fetch.waitBetweenTries, 1000);
  const planner = node('Generate Remediation Plan');
  assert.equal(planner.retryOnFail, true);
  assert.equal(planner.maxTries, 3);
  assert.equal(planner.waitBetweenTries, 1000);

  const patchHttp = node('de Patch - HTTP Request');
  assert.equal(patchHttp.retryOnFail, true);
  assert.equal(patchHttp.maxTries, 3);
  assert.equal(patchHttp.waitBetweenTries, 1000);

  const patchBodyCode = node('Prepare - Code Patch Body').parameters.jsCode;
  assert.match(patchBodyCode, /claude-opus-5/);
  assert.match(patchBodyCode, /max_tokens:32768/);
  assert.match(patchBodyCode, /thinking:\{type:'adaptive'\}/);
  assert.match(patchBodyCode, /effort:'medium'/);
  assert.match(patchBodyCode, /SOURCE_API_CONTEXT_LIMIT_EXCEEDED/);

  const parseCode = node('Parse - Code Patch Output').parameters.jsCode;
  assert.match(parseCode, /PATCH_LLM_RESPONSE_TRUNCATED|LLM_RESPONSE_TRUNCATED/i);

  const preflightCode = node('Generic Candidate Preflight').parameters.jsCode;
  assert.match(preflightCode, /OBVIOUS_RAW_CAST_WORKAROUND/, 'raw-cast preflight protection intact');
  assert.match(preflightCode, /instanceof/, 'guarded-cast false-positive fix (R75) intact');
  assert.match(preflightCode, /PLACEHOLDER_IMPLEMENTATION/, 'unrelated placeholder-implementation heuristic untouched');
  assert.match(preflightCode, /SCANNER_SUPPRESSION/, 'scanner-suppression check untouched');
  assert.match(preflightCode, /POSSIBLE_SECRET/, 'secret-detection check untouched');
  assert.match(preflightCode, /COMMENTED_OUT_EXECUTABLE/, 'commented-out-executable check untouched');
  assert.match(preflightCode, /WF2_PATCH_SCOPE_VIOLATION/, 'patch target/scope validation untouched');
  assert.match(preflightCode, /UNBALANCED_STRUCTURE/, 'structural balance check untouched');

  assert.ok(node('Independent Semantic Review'), 'semantic review node still present');
  assert.ok(node('Enforce Independent Review'), 'semantic review enforcement still present');
  assert.ok(node('Persist WF2 Failure Status'), 'failure status persistence still present');

  const MUTATING_NODES = [
    'Update File in Branch', 'Create Pull Request1', 'Create Missing Branch', 'Create File in Branch',
    'Save Execution Result to Backend', 'Log Fetch Error', 'Persist File Update Failure',
    'Persist PR Creation Failure', 'Persist WF2 Failure Status',
  ];
  for (const name of MUTATING_NODES) {
    const n = node(name);
    if (n) assert.notEqual(n.retryOnFail, true, `${name}: mutating node must NOT receive automatic retry`);
  }
  console.log('wf2-dto-entity-decoupling Section 10/11 (R23 + patch hardening unchanged): PASS');
}

console.log('WF2 S4684 DTO/entity decoupling hardening (canonical promotion artifact), all cases: PASS');
