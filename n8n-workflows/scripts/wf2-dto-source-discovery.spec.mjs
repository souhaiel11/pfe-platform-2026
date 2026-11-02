// Teste le composant « wf2-dto-source-discovery » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const offline = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.DTO-SOURCE-DISCOVERY.PROMOTION-TARGET-OFFLINE.json', import.meta.url)))[0];
const execFixture = JSON.parse(readFileSync(new URL('./fixtures/wf2-execution-2032-corrective-target.json', import.meta.url)));

/** Prépare les données nécessaires à ce scénario. */
const baseNode = name => baseline.nodes.find(n => n.name === name);
/** Prépare les données nécessaires à ce scénario. */
const offlineNode = name => offline.nodes.find(n => n.name === name);

const TASKDTO_PATH = 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java';
const TASK_PATH = 'src/main/java/com/pfe/devsecops/model/Task.java';
const CONTROLLER_PATH = 'src/main/java/com/pfe/devsecops/controller/TaskController.java';

const taskDtoContent = execFixture.sourceSnapshots.find(s => s.file === TASKDTO_PATH).content;
const taskContent = execFixture.sourceSnapshots.find(s => s.file === TASK_PATH).content;
const controllerContent = execFixture.sourceSnapshots.find(s => s.file === CONTROLLER_PATH).content;

const existingFiles = execFixture.tree_resp.tree.filter(t => t.path && t.path.endsWith('.java')).map(t => t.path);
assert.ok(existingFiles.includes(TASKDTO_PATH) && existingFiles.includes(TASK_PATH), 'fixture repository tree really contains both TaskDTO.java and Task.java');

/** Prépare les données nécessaires à ce scénario. */
function expand(nodeFn, items, ctx) {
  return new Function('$input', '$', 'Buffer', nodeFn('Expand Referenced API Sources').parameters.jsCode)(
    { 
    /** Renvoie tous les éléments disponibles. */
    all: () => items },
    () => ({ 
    /** Renvoie le premier élément disponible. */
    first: () => ({ json: ctx }) }),
    Buffer);
}

const baseCtx = { batchId: 'b', repositoryPolicy: { existingFiles } };
const dtoItem = { json: { path: TASKDTO_PATH, content: Buffer.from(taskDtoContent).toString('base64') } };

/** Prépare les données nécessaires à ce scénario. */
function preparePatch(sourceApiContext, targetPath = TASKDTO_PATH, targetContent = taskDtoContent) {
  const plan = {
    findingId: 'f', target: { file: targetPath, line: 10 }, filesToModify: [targetPath], filesToCreate: [],
    requiredChanges: ['Explicit DTO to entity mapping'], remediationIntent: 'Explicit DTO to entity mapping',
    relationshipOperations: [], requiredRelationshipApis: [],
  };
  const planned = { target_file_path: targetPath, fileOperation: 'MODIFY', remediationPlans: [plan], plannedFiles: [targetPath] };
  return new Function('$json', '$', 'Buffer', baseNode('Prepare - Code Patch Body').parameters.jsCode)(
    { path: targetPath, content: Buffer.from(targetContent).toString('base64') },
    name => ({
      /** Renvoie le premier élément disponible. */
      first: () => ({
        json: name === 'Prepare Generic Remediation Plan'
          ? { remediationContract: { sourceSnapshots: sourceApiContext, sourceGrounding: { groundedRelationshipApis: [] } } }
          : baseCtx,
      }),
      /** Renvoie tous les éléments disponibles. */
      all: () => [{ json: planned }],
    }),
    Buffer).json;
}

// ── T1: bug reproduced on baseline, fixed on offline candidate ─────────────
{
  const before = expand(baseNode, [dtoItem], baseCtx);
  assert.deepEqual(before.map(i => i.json.target_file_path), [TASKDTO_PATH],
    'TASK_JAVA_DISCOVERED (baseline) = NO -- reproduces the gap: a correctly decoupled DTO alone never pulls in Task.java');

  const after = expand(offlineNode, [dtoItem], baseCtx);
  const afterPaths = after.map(i => i.json.target_file_path).sort();
  assert.deepEqual(afterPaths, [TASKDTO_PATH, TASK_PATH].sort(),
    'DISCOVERED_ADDITIONAL_SOURCE = src/main/java/com/pfe/devsecops/model/Task.java');

  assert.throws(() => preparePatch([{ file: TASKDTO_PATH, content: taskDtoContent }]),
    /SOURCE_API_CONTEXT_REQUIRED/,
    'SOURCE_API_CONTEXT_REQUIRED_REPRODUCED = YES with only TaskDTO.java in sourceApiContext (gate itself untouched)');

  const enriched = [{ file: TASKDTO_PATH, content: taskDtoContent }, { file: TASK_PATH, content: taskContent }];
  const result = preparePatch(enriched);
  assert.equal(result.requiresPatch, true, 'SOURCE_API_CONTEXT_REQUIRED after enrichment = NOT_TRIGGERED_FOR_MISSING_SECOND_SOURCE');
  assert.deepEqual(result.completePlan.sourceApiContext, enriched, 'sourceApiContext reaching the gate now carries both TaskDTO.java and Task.java');
  console.log('T1 PASS: TaskDTO-only reproduces SOURCE_API_CONTEXT_REQUIRED on baseline; offline discovery of Task.java clears the gate without touching it.');
}

// ── T2: DTO/entity decoupling preserved ─────────────────────────────────────
{
  assert.doesNotMatch(taskDtoContent, /import\s+com\.pfe\.devsecops\.model\.Task\b/,
    'TaskDTO.java itself is never modified by this fix and still imports nothing from the entity package');
  const repositoryPolicy = { policyVersion: '1.0', existingFiles: [TASK_PATH, CONTROLLER_PATH], permittedRoots: ['src/main/java/'] };
  const patchFixture = {
    targetFile: TASKDTO_PATH, fileOperation: 'CREATE', sourceContent: '', patchedCode: taskDtoContent,
    repositoryPolicy,
    completePlan: { allPlannedFiles: [{ path: TASKDTO_PATH }] },
    approvedFindingsForFile: [{ findingId: 'f', source: 'SONARQUBE', rule: 'java:S4684', file: TASKDTO_PATH, line: 10, scannerEvidence: {} }],
    applicablePlans: [{ requiredChanges: ['Explicit DTO to entity mapping'], forbiddenChanges: [] }],
  };
  const fn = new Function('$json', offlineNode('Generic Candidate Preflight').parameters.jsCode);
  const result = fn(patchFixture);
  assert.equal(result.json.genericPreflightPassed, true, 'DTO_ENTITY_TYPE_COUPLING = NO: the unchanged decoupled TaskDTO still passes preflight after the discovery fix');
  console.log('T2 PASS: DTO/entity decoupling guard is unaffected by the new discovery rule.');
}

// ── T3: import-based discovery behavior unchanged (regression) ─────────────
{
  const item = { json: { path: CONTROLLER_PATH, content: Buffer.from(controllerContent).toString('base64') } };
  const beforeSet = expand(baseNode, [item], baseCtx).map(i => i.json.target_file_path).sort();
  const afterSet = expand(offlineNode, [item], baseCtx).map(i => i.json.target_file_path).sort();
  assert.deepEqual(afterSet, beforeSet, 'IMPORT_DISCOVERY_REGRESSION = NO: a file with real imports (not *DTO.java) discovers exactly the same sources before and after the fix');
  assert.ok(beforeSet.length > 1, 'sanity: TaskController.java really does trigger import-based discovery');
  console.log('T3 PASS: import-based discovery for non-DTO files is byte-for-byte unchanged.');
}

// ── T4: nonexistent domain counterpart -> fail closed, no invented path ────
{
  const fooDtoContent = 'package com.pfe.devsecops.dto;\n\npublic class FooDTO {\n  private String status;\n}\n';
  const fooPath = 'src/main/java/com/pfe/devsecops/dto/FooDTO.java';
  const fooCtx = { batchId: 'b', repositoryPolicy: { existingFiles: [fooPath] } };
  const item = { json: { path: fooPath, content: Buffer.from(fooDtoContent).toString('base64') } };
  let result;
  assert.doesNotThrow(() => { result = expand(offlineNode, [item], fooCtx); }, 'no uncontrolled resolution exception when no counterpart exists');
  assert.deepEqual(result.map(i => i.json.target_file_path), [fooPath], 'no path invented; context stays insufficient (fail closed)');
  assert.throws(() => preparePatch([{ file: fooPath, content: fooDtoContent }], fooPath, fooDtoContent), /SOURCE_API_CONTEXT_REQUIRED/,
    'SOURCE_API_CONTEXT_REQUIRED still blocks downstream when no real counterpart exists to enrich the context');
  console.log('T4 PASS: FooDTO.java with no Foo.java anywhere fails closed, no invented path.');
}

// ── T5: ambiguous domain counterpart -> not selected, fail closed ──────────
{
  const fooDtoContent = 'package com.pfe.devsecops.dto;\n\npublic class FooDTO {\n  private String status;\n}\n';
  const fooPath = 'src/main/java/com/pfe/devsecops/dto/FooDTO.java';
  const ambiguousExisting = [fooPath, 'src/main/java/com/pfe/devsecops/model/Foo.java', 'src/main/java/com/pfe/devsecops/entity/Foo.java'];
  const ctx = { batchId: 'b', repositoryPolicy: { existingFiles: ambiguousExisting } };
  const item = { json: { path: fooPath, content: Buffer.from(fooDtoContent).toString('base64') } };
  const result = expand(offlineNode, [item], ctx);
  assert.deepEqual(result.map(i => i.json.target_file_path), [fooPath],
    'AMBIGUOUS_DOMAIN_COUNTERPART = FAIL_CLOSED / NOT_SELECTED: two plausible Foo.java candidates in different packages must not trigger a guess');
  console.log('T5 PASS: ambiguous counterpart (two plausible Foo.java) is not guessed.');
}

// ── T6: nested enum never requires its own standalone file ─────────────────
{
  const after = expand(offlineNode, [dtoItem], baseCtx);
  assert.ok(!after.some(i => /Status\.java$/i.test(i.json.target_file_path)),
    'no attempt is ever made to fetch a nested enum as its own file (e.g. no TaskStatus.java request)');
  assert.match(taskContent, /enum TaskStatus/, 'the nested enum is visible only via the discovered Task.java counterpart');
  assert.doesNotMatch(offlineNode('Expand Referenced API Sources').parameters.jsCode, /TaskStatus/,
    'HARDCODED_TASK_SPECIFIC_LOGIC = NO: the fix never mentions TaskStatus, Task.java or TaskDTO literally');
  console.log('T6 PASS: nested enum (Task.TaskStatus) requires no standalone file and is never hardcoded.');
}

// ── T7: 12-file bound still enforced with the new discovery active ─────────
{
  const padding = Array.from({ length: 11 }, (_, i) => ({ json: { path: `pad/${i}.java`, content: '' } }));
  assert.throws(() => expand(offlineNode, [...padding, dtoItem], baseCtx), /SOURCE_API_CONTEXT_LIMIT_EXCEEDED/,
    'the new discovery still respects the existing 12-file SOURCE_API_CONTEXT_LIMIT_EXCEEDED bound');
  console.log('T7 PASS: SOURCE_API_CONTEXT_LIMIT_EXCEEDED is not bypassed by the new discovery.');
}

// ── T8: path safety -- no traversal / absolute / URL path can be trusted ───
{
  const maliciousPaths = [
    '../../../etc/FooDTO.java',
    '/etc/passwd/FooDTO.java',
    'src/main/java/com/pfe/devsecops/dto/../../../etc/FooDTO.java',
    'http://evil.example.com/src/main/java/com/pfe/devsecops/dto/FooDTO.java',
  ];
  const trustedCounterpart = 'src/main/java/com/pfe/devsecops/model/Foo.java';
  for (const maliciousPath of maliciousPaths) {
    const fooDtoContent = 'package com.pfe.devsecops.dto;\n\npublic class FooDTO {\n  private String status;\n}\n';
    const ctx = { batchId: 'b', repositoryPolicy: { existingFiles: [maliciousPath, trustedCounterpart] } };
    const item = { json: { path: maliciousPath, content: Buffer.from(fooDtoContent).toString('base64') } };
    let result;
    assert.doesNotThrow(() => { result = expand(offlineNode, [item], ctx); }, `no uncontrolled exception for malicious path ${maliciousPath}`);
    const produced = result.map(i => i.json.target_file_path);
    // The node has always echoed the input item's own path verbatim (pre-existing,
    // unrelated to this fix -- unchanged from baseline, see T3). What this fix must
    // guarantee is that such a path can never be used to DERIVE and unlock an
    // additional candidate: no new path beyond the input item itself may appear.
    assert.deepEqual(produced, [maliciousPath], `no additional/invented path is derived from an unsafe DTO path (${maliciousPath})`);
    assert.ok(!produced.includes(trustedCounterpart), `malicious/unsafe DTO path ${maliciousPath} must never unlock a counterpart fetch`);
  }
  console.log('T8 PASS: no traversal, absolute, or URL-shaped path can be fetched; every candidate must equal a real existingFiles entry.');
}

/** Prépare les données nécessaires à ce scénario. */

function expandPath(dtoPath, existingFiles) {
  const fooDtoContent = 'package com.acme.dto;\n\npublic class FooDTO {\n  private String status;\n}\n';
  const ctx = { batchId: 'b', repositoryPolicy: { existingFiles } };
  const item = { json: { path: dtoPath, content: Buffer.from(fooDtoContent).toString('base64') } };
  return expand(offlineNode, [item], ctx).map(i => i.json.target_file_path);
}

// ── PATH-T1: baseline shape (dto directly under package root) ─────────────
{
  const dtoPath = 'src/main/java/com/acme/dto/FooDTO.java';
  const counterpart = 'src/main/java/com/acme/model/Foo.java';
  const result = expandPath(dtoPath, [dtoPath, counterpart]).sort();
  assert.deepEqual(result, [counterpart, dtoPath].sort(), 'PATH-T1: dto/FooDTO.java -> model/Foo.java');
  console.log('PATH-T1 PASS: src/main/java/com/acme/dto/FooDTO.java -> src/main/java/com/acme/model/Foo.java');
}

// ── PATH-T2: dto nested one level under an intermediate package (api) ─────
{
  const dtoPath = 'src/main/java/com/acme/api/dto/FooDTO.java';
  const counterpart = 'src/main/java/com/acme/api/model/Foo.java';
  const result = expandPath(dtoPath, [dtoPath, counterpart]).sort();
  assert.deepEqual(result, [counterpart, dtoPath].sort(), 'PATH-T2: api/dto/FooDTO.java -> api/model/Foo.java');
  console.log('PATH-T2 PASS: src/main/java/com/acme/api/dto/FooDTO.java -> src/main/java/com/acme/api/model/Foo.java');
}

// ── PATH-T3 (TASK_CASE_PASS): dto with a subnamespace below it ────────────
{
  const dtoPath = 'src/main/java/com/acme/dto/task/FooDTO.java';
  const counterpart = 'src/main/java/com/acme/model/Foo.java';
  const wrongRootCounterpart = 'src/main/java/com/acme/dto/model/Foo.java';
  const result = expandPath(dtoPath, [dtoPath, counterpart]).sort();
  assert.deepEqual(result, [counterpart, dtoPath].sort(),
    'PATH-T3 / TASK_CASE_PASS: dto/task/FooDTO.java -> model/Foo.java (NOT dto/model/Foo.java)');
  assert.ok(!result.includes(wrongRootCounterpart), 'PATH-T3: "task" subnamespace must never be kept in the computed root');
  console.log('PATH-T3 PASS (TASK_CASE_PASS): src/main/java/com/acme/dto/task/FooDTO.java -> src/main/java/com/acme/model/Foo.java');
}

// ── PATH-T4 (FEATURE_FIRST_CASE_PASS): feature-first layout ───────────────
{
  const dtoPath = 'src/main/java/com/acme/features/foo/dto/FooDTO.java';
  const counterpart = 'src/main/java/com/acme/features/foo/model/Foo.java';
  const wrongRootCounterpart = 'src/main/java/com/acme/model/Foo.java';
  const result = expandPath(dtoPath, [dtoPath, counterpart]).sort();
  assert.deepEqual(result, [counterpart, dtoPath].sort(),
    'PATH-T4 / FEATURE_FIRST_CASE_PASS: features/foo/dto/FooDTO.java -> features/foo/model/Foo.java');
  assert.ok(!result.includes(wrongRootCounterpart), 'PATH-T4: must not strip the feature segment that precedes dto/');
  console.log('PATH-T4 PASS (FEATURE_FIRST_CASE_PASS): src/main/java/com/acme/features/foo/dto/FooDTO.java -> src/main/java/com/acme/features/foo/model/Foo.java');
}

// ── PATH-T5 (NESTED_DTO_CASE_PASS): "dtos" plural variant ─────────────────
{
  const dtoPath = 'src/main/java/com/acme/dtos/FooDTO.java';
  const counterpart = 'src/main/java/com/acme/model/Foo.java';
  const result = expandPath(dtoPath, [dtoPath, counterpart]).sort();
  assert.deepEqual(result, [counterpart, dtoPath].sort(), 'PATH-T5 / NESTED_DTO_CASE_PASS: dtos/FooDTO.java -> model/Foo.java');
  console.log('PATH-T5 PASS (NESTED_DTO_CASE_PASS): src/main/java/com/acme/dtos/FooDTO.java -> src/main/java/com/acme/model/Foo.java');
}

// ── PATH-T6 (NO_MATCH_CASE_PASS): no dto/dtos segment anywhere in the path ─
{
  const dtoPath = 'src/main/java/com/acme/api/FooDTO.java';
  const wouldBeCounterpart = 'src/main/java/com/acme/api/model/Foo.java';
  const result = expandPath(dtoPath, [dtoPath, wouldBeCounterpart]);
  assert.deepEqual(result, [dtoPath],
    'PATH-T6 / NO_MATCH_CASE_PASS: NO_COUNTERPART_SELECTED when no dto/dtos segment exists -- never guess a root');
  console.log('PATH-T6 PASS (NO_MATCH_CASE_PASS): src/main/java/com/acme/api/FooDTO.java -> NO_COUNTERPART_SELECTED.');
}

// ── PATH-T7 (AMBIGUOUS_CASE_PASS): two real, equally valid counterparts ───
{
  const dtoPath = 'src/main/java/com/acme/dto/FooDTO.java';
  const candidateA = 'src/main/java/com/acme/model/Foo.java';
  const candidateB = 'src/main/java/com/acme/entity/Foo.java';
  const result = expandPath(dtoPath, [dtoPath, candidateA, candidateB]);
  assert.deepEqual(result, [dtoPath],
    'PATH-T7 / AMBIGUOUS_CASE_PASS: two plausible counterparts -> AMBIGUOUS, no selection, fail closed');
  console.log('PATH-T7 PASS (AMBIGUOUS_CASE_PASS): model/Foo.java + entity/Foo.java both existing -> no selection.');
}

// ── PATH-T8: counterpart absent entirely -> NONE, fail closed ─────────────
{
  const dtoPath = 'src/main/java/com/acme/dto/FooDTO.java';
  const result = expandPath(dtoPath, [dtoPath]);
  assert.deepEqual(result, [dtoPath], 'PATH-T8: no counterpart anywhere in existingFiles -> NONE, fail closed');
  console.log('PATH-T8 PASS: src/main/java/com/acme/dto/FooDTO.java with no counterpart in existingFiles -> NONE.');
}

// ── PATH-T9: no new hardcoding of Foo/Task in the fixed node ──────────────
// Note: the pre-existing comment "(see TaskDTO.java)" from FIX #1 legitimately
// mentions TaskDTO.java as a repository-convention example; this check targets
// only the new segment-based resolution logic, so it looks for FooDTO (never
// present anywhere) and a standalone "Task" identifier (not the "TaskDTO" /
// "TaskStatus" substrings, which have no word boundary after "Task").
{
  const code = offlineNode('Expand Referenced API Sources').parameters.jsCode;
  assert.doesNotMatch(code, /\bFooDTO\b|\bTask\b/,
    'PATH-T9: the generalized path-resolution rule never hardcodes FooDTO or a standalone Task identifier');
  console.log('PATH-T9 PASS: no hardcoded DTO/entity names in the segment-based path resolution rule.');
}

console.log('wf2-dto-source-discovery: all T1-T8 + PATH-T1..T9 PASS (offline candidate artifact only; live pending-live-update PROMOTION-TARGET.json untouched).');
