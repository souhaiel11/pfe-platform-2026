import * as assert from 'node:assert/strict';
import { evaluateDefaultValueSemantics, FetchedFile, AssemblyProvenance } from './default-value-semantics-assembler';
import { extractBlockingCauses } from './corrective-context';

// R70 §3/§6/§9/§11 — proves the assembler can ground evidence to exact file
// paths using data it already fetches (no new IO), that it never guesses
// under ambiguity, and that corrective-context.ts carries the grounded
// paths through to a BlockingCause unchanged.

const provenance: AssemblyProvenance = {
  fixRequestId: 'req-r70', batchId: 'batch-r70', attemptCount: 4,
  candidateId: 'candidate-r70', candidateDigest: null,
  candidateBaseSha: 'a'.repeat(40), prHeadSha: 'b'.repeat(40),
};

// ── Real PR34 shape (method-name/param-type collision between a controller
// pass-through and the real service-layer mapping) — proves mappingFile
// resolves to the SERVICE file, not ambiguously to both.
{
  const controller = [
    'package com.pfe.devsecops.controller;',
    'public class TaskController {',
    '  public ResponseEntity<TaskDTO> updateTask(@PathVariable Long id, @RequestBody TaskDTO task) {',
    '    return ResponseEntity.ok(taskService.updateTask(id, task));',
    '  }',
    '}',
  ].join('\n');
  const baselineEntity = [
    'package com.pfe.devsecops.model;',
    'public class Task {',
    '  private TaskStatus status = TaskStatus.TODO;',
    '}',
  ].join('\n');
  const candidateDto = [
    'package com.pfe.devsecops.dto;',
    'public class TaskDTO {',
    '  private String status;',
    '}',
  ].join('\n');
  const service = [
    'package com.pfe.devsecops.service;',
    'public class TaskService {',
    '  public TaskDTO updateTask(Long id, TaskDTO updatedTask) {',
    '    Task existing = taskRepository.findById(id).orElseThrow();',
    '    existing.setStatus(parseStatus(updatedTask.getStatus()));',
    '    return toDto(taskRepository.save(existing));',
    '  }',
    '}',
  ].join('\n');

  const baselineFiles: FetchedFile[] = [
    { path: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', content: controller, blobSha: 'a'.repeat(40) },
    { path: 'src/main/java/com/pfe/devsecops/model/Task.java', content: baselineEntity, blobSha: 'b'.repeat(40) },
  ];
  const candidateFiles: FetchedFile[] = [
    { path: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', content: controller, blobSha: 'c'.repeat(40) },
    { path: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', content: candidateDto, blobSha: 'd'.repeat(40) },
    { path: 'src/main/java/com/pfe/devsecops/service/TaskService.java', content: service, blobSha: 'e'.repeat(40) },
  ];
  // discoverMigrations needs a baseline @RequestBody Task binding for the SAME
  // method name to detect the migration in the first place.
  const baselineControllerWithBinding = controller.replace('@RequestBody TaskDTO task', '@RequestBody Task task');
  const audit = evaluateDefaultValueSemantics(
    [{ ...baselineFiles[0], content: baselineControllerWithBinding }, baselineFiles[1]],
    candidateFiles, provenance,
  );
  assert.equal(audit.verdict, 'PROVEN_DEFECT');
  const ev = audit.evidence[0];
  assert.equal(ev.sourceFile, 'src/main/java/com/pfe/devsecops/model/Task.java', 'sourceFile resolved uniquely');
  assert.equal(ev.candidateFile, 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', 'candidateFile resolved uniquely');
  assert.equal(ev.mappingFile, 'src/main/java/com/pfe/devsecops/service/TaskService.java',
    'mappingFile resolves to the SERVICE file, not the controller pass-through that shares the same (method, paramType) shape');

  const causes = extractBlockingCauses({
    checkoutSha: provenance.prHeadSha,
    mergeAuthorization: { blockingReasons: ['DEFAULT_VALUE_SEMANTICS_REGRESSION'] },
    defaultValueSemantics: { verdict: 'PROVEN_DEFECT', evaluatedSha: provenance.prHeadSha, evidence: audit.evidence },
  });
  const cause = causes.find(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT');
  assert.ok(cause);
  assert.equal(cause!.mappingFile, ev.mappingFile, 'grounded mappingFile survives corrective-context extraction unchanged');
  assert.equal(cause!.sourceFile, ev.sourceFile);
  assert.equal(cause!.candidateFile, ev.candidateFile);
  console.log('R70_MAPPING_FILE_DISAMBIGUATION: PASS');
}

// ── Negative test C — ambiguous class declaration (two candidate files both
// declare `class TaskDTO`) must NEVER be resolved to either file; candidateFile
// stays absent rather than guessed.
{
  const dtoA = 'package a;\npublic class TaskDTO {\n  private String status;\n}';
  const dtoB = 'package b;\npublic class TaskDTO {\n  private String status;\n}';
  const controllerWithBaselineBinding = 'public class TaskController {\n  public void x(@RequestBody Task t){}\n}';
  const controllerWithCandidateBinding = 'public class TaskController {\n  public void x(@RequestBody TaskDTO t){}\n}';
  const entity = 'public class Task {\n  private TaskStatus status = TaskStatus.TODO;\n}';
  const mapping = 'public class Owner {\n  public TaskDTO x(TaskDTO t) {\n    existing.setStatus(t.getStatus());\n    return null;\n  }\n}';

  const audit = evaluateDefaultValueSemantics(
    [
      { path: 'Controller.java', content: controllerWithBaselineBinding, blobSha: 'a'.repeat(40) },
      { path: 'Task.java', content: entity, blobSha: 'b'.repeat(40) },
    ],
    [
      { path: 'Controller.java', content: controllerWithCandidateBinding, blobSha: 'c'.repeat(40) },
      { path: 'DtoA.java', content: dtoA, blobSha: 'd'.repeat(40) },
      { path: 'DtoB.java', content: dtoB, blobSha: 'e'.repeat(40) },
      { path: 'Owner.java', content: mapping, blobSha: 'f'.repeat(40) },
    ],
    provenance,
  );
  assert.equal(audit.verdict, 'PROVEN_DEFECT', 'the semantic verdict itself is unaffected by path ambiguity');
  assert.equal(audit.evidence[0].candidateFile, undefined, 'ambiguous class declaration across two files must never be guessed');
  console.log('R70_AMBIGUOUS_CANDIDATE_FILE_NOT_GUESSED: PASS');
}

// ── sourceFile/candidateFile omitted entirely (0 matches) must not appear as
// null/empty-string on the evidence or the corrective cause — genuinely absent.
{
  const controller = 'public class TaskController {\n  public void x(@RequestBody Task t){}\n}';
  const controllerCandidate = 'public class TaskController {\n  public void x(@RequestBody TaskDTO t){\n    existing.setStatus(t.getStatus());\n  }\n}';
  const dto = 'public class TaskDTO {\n  private String status;\n}';
  const audit = evaluateDefaultValueSemantics(
    [{ path: 'Controller.java', content: controller, blobSha: 'a'.repeat(40) }],
    [
      { path: 'Controller.java', content: controllerCandidate, blobSha: 'c'.repeat(40) },
      { path: 'TaskDTO.java', content: dto, blobSha: 'd'.repeat(40) },
    ],
    provenance,
  );
  assert.equal(audit.verdict, 'VERIFICATION_REQUIRED', 'Task entity never declared in any fetched baseline file');
  console.log('R70_UNRESOLVED_SOURCE_FILE_STAYS_VERIFICATION_REQUIRED: PASS');
}

console.log('default-value-semantics-r70-target-grounding: PASS');
