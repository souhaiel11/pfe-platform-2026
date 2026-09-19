import * as assert from 'node:assert/strict';
import { analyzeDefaultValueSemantics, DefaultValueSemanticsInput } from './default-value-semantics';

// Pure unit tests — no DB, no IO, no LLM. Exercises the generic invariant in
// isolation from any specific rule/entity/field: every fixture below uses
// synthetic type/field names, EXCEPT the PR #34 offline-revalidation fixture
// (case marked below), which intentionally uses the real, exact source text
// recovered from the PR so the module is proven against the real defect it
// was built for — never hardcoded into the module itself (see
// default-value-semantics.ts: no rule/entity/field name appears there).

function run(overrides: Partial<DefaultValueSemanticsInput>): ReturnType<typeof analyzeDefaultValueSemantics> {
  const base: DefaultValueSemanticsInput = {
    sourceType: 'Widget',
    sourceField: 'mode',
    sourceTypeSource: 'public class Widget { private Mode mode = Mode.STANDARD; }',
    candidateType: 'WidgetDto',
    candidateField: 'mode',
    candidateTypeSource: 'public class WidgetDto { private String mode; }',
    mappingSource: 'existing.setMode(parseMode(updated.getMode()));',
    mappingLabel: 'WidgetService.update(Long, WidgetDto)',
    externalBindingEvidence: '@RequestBody WidgetDto body',
  };
  return analyzeDefaultValueSemantics({ ...base, ...overrides });
}

// ── CASE 1 — source default enum + DTO no default => PROVEN_DEFECT ────────
{
  const result = run({});
  assert.equal(result.verdict, 'PROVEN_DEFECT');
  assert.ok(result.evidence);
  assert.equal(result.evidence!.sourceDefault, 'Mode.STANDARD');
  assert.equal(result.evidence!.candidateDefault, null);
  assert.match(result.evidence!.mappingPath, /existing\.setMode/);
}

// ── CASE 2 — source default enum + DTO equivalent String default => NO_DEFECT
{
  const result = run({
    candidateTypeSource: 'public class WidgetDto { private String mode = "STANDARD"; }',
  });
  assert.equal(result.verdict, 'NO_DEFECT');
  assert.equal(result.evidence, null);
}

// ── CASE 3 — source default String + DTO same default => NO_DEFECT ────────
{
  const result = run({
    sourceTypeSource: 'public class Widget { private String mode = "STANDARD"; }',
    candidateTypeSource: 'public class WidgetDto { private String mode = "STANDARD"; }',
  });
  assert.equal(result.verdict, 'NO_DEFECT');
}

// ── CASE 4 — source default + candidate explicitly changes default => PROVEN_DEFECT
{
  const result = run({
    candidateTypeSource: 'public class WidgetDto { private String mode = "ADVANCED"; }',
  });
  assert.equal(result.verdict, 'PROVEN_DEFECT');
  assert.equal(result.evidence!.candidateDefault, '"ADVANCED"');
}

// ── CASE 5 — no source default => do not invent a defect ──────────────────
{
  const result = run({
    sourceTypeSource: 'public class Widget { private Mode mode; }',
  });
  assert.equal(result.verdict, 'NO_DEFECT');
  assert.match(result.reason, /no explicit initializer/);
}

// ── CASE 6 — insufficient deserialization evidence => VERIFICATION_REQUIRED
// Reserved for the two structural preconditions this invariant cannot do
// without: proof the candidate type is itself externally deserialized, and
// a well-formed request to check a candidate field that isn't even declared
// (a config/input error, not "this field is new"). A source field that
// simply isn't declared (CASE 5's sibling — no default to preserve) and a
// mapping method proven to never read the field at all (definitively
// non-observable, not merely unknown) are both NO_DEFECT, tested below.
{
  const result = run({ externalBindingEvidence: undefined });
  assert.equal(result.verdict, 'VERIFICATION_REQUIRED');
  assert.match(result.reason, /bound directly from an external request body/);
}
{
  const result = run({ candidateField: 'doesNotExist' });
  assert.equal(result.verdict, 'VERIFICATION_REQUIRED');
}
{
  // Source field not declared at all (e.g. a relationship flattened to an
  // ID, or a genuinely new field) => nothing to preserve, same conclusion
  // as CASE 5, not an unresolved unknown.
  const result = run({ sourceField: 'doesNotExist' });
  assert.equal(result.verdict, 'NO_DEFECT');
  assert.match(result.reason, /does not declare a field/);
}
{
  // Mapping proven to never read this field into any persisted/target
  // object at all: even stronger evidence than "guarded", not weaker —
  // the divergent default can never be observed.
  const result = run({ mappingSource: 'existing.setOther(updated.getOther());' });
  assert.equal(result.verdict, 'NO_DEFECT');
  assert.match(result.reason, /ever reads this field/);
}

// ── CASE 7 — explicit null semantics preserved (guarded propagation) => NO_DEFECT
{
  const result = run({
    mappingSource: 'if (updated.getMode() != null) { existing.setMode(parseMode(updated.getMode())); }',
  });
  assert.equal(result.verdict, 'NO_DEFECT');
  assert.match(result.reason, /guarded by a present-value check/);
}
{
  // Single-statement (braceless) guard form.
  const result = run({
    mappingSource: 'if (updated.getMode() != null)\n  existing.setMode(parseMode(updated.getMode()));',
  });
  assert.equal(result.verdict, 'NO_DEFECT');
}

// ── CASE 8 — absent and null collapsed incorrectly (unconditional) => PROVEN_DEFECT
{
  // Same field has a GUARDED call site elsewhere (e.g. a create path) but an
  // UNGUARDED one too (e.g. an update path) — at least one unconditional
  // site is sufficient to prove the defect, mirroring the real PR34 shape
  // where create() guards and update() does not.
  const result = run({
    mappingSource:
      'if (created.getMode() != null) { entity.setMode(parseMode(created.getMode())); }\n' +
      'existing.setMode(parseMode(updated.getMode()));',
  });
  assert.equal(result.verdict, 'PROVEN_DEFECT');
  assert.match(result.evidence!.mappingPath, /existing\.setMode/);
}

// ── Section 7 — positive fixture: the minimal corrected DTO shape ─────────
{
  const result = run({
    candidateTypeSource: 'public class WidgetDto { private String mode = "STANDARD"; }',
  });
  assert.equal(result.verdict, 'NO_DEFECT');
}

// ── Section 6 — PR #34 offline regression fixture (exact real source text) ─
// Recovered verbatim from GitHub at the base SHA (6ed56ff7...) for the
// source entity and at the PR head SHA (dc1aa978...) for the candidate DTO
// and the update-path mapping code, during the earlier offline PR #34
// review. Nothing about "PR34" appears in default-value-semantics.ts itself
// — this is fixture data only, exercising the generic module.
{
  const taskEntitySource = `
package com.pfe.devsecops.model;
@Entity
@Table(name = "tasks")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Task {
    @Id
    private Long id;
    @Column(nullable = false)
    private String title;
    @Enumerated(EnumType.STRING)
    private TaskStatus status = TaskStatus.TODO;
    private Integer priority;
    public enum TaskStatus { TODO, IN_PROGRESS, DONE, CANCELLED }
}`;

  const taskDtoSource = `
package com.pfe.devsecops.dto;
public class TaskDTO {
    private Long id;
    private String title;
    private String description;
    private String status;
    private Integer priority;
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}`;

  const taskServiceUpdateMapping = `
public TaskDTO updateTask(Long id, TaskDTO updatedTask) {
    Task existing = taskRepository.findById(id)
            .orElseThrow(() -> new RuntimeException("Task not found: " + id));
    existing.setTitle(updatedTask.getTitle());
    existing.setDescription(updatedTask.getDescription());
    existing.setStatus(parseStatus(updatedTask.getStatus()));
    existing.setPriority(updatedTask.getPriority());
    existing.setUpdatedAt(LocalDateTime.now());
    return toDto(taskRepository.save(existing));
}`;

  const taskControllerBinding = `
@PutMapping("/{id}")
public ResponseEntity<TaskDTO> updateTask(@PathVariable Long id, @RequestBody TaskDTO task) {
    return ResponseEntity.ok(taskService.updateTask(id, task));
}`;

  const result = analyzeDefaultValueSemantics({
    sourceType: 'Task',
    sourceField: 'status',
    sourceTypeSource: taskEntitySource,
    candidateType: 'TaskDTO',
    candidateField: 'status',
    candidateTypeSource: taskDtoSource,
    mappingSource: taskServiceUpdateMapping,
    mappingLabel: 'TaskService.updateTask(Long, TaskDTO)',
    externalBindingEvidence: taskControllerBinding,
  });

  assert.equal(result.verdict, 'PROVEN_DEFECT', 'PR #34 offline fixture must be proven, not merely suspected');
  assert.ok(result.evidence);
  assert.equal(result.evidence!.sourceType, 'Task');
  assert.equal(result.evidence!.sourceField, 'status');
  assert.equal(result.evidence!.sourceDefault, 'TaskStatus.TODO');
  assert.equal(result.evidence!.candidateType, 'TaskDTO');
  assert.equal(result.evidence!.candidateField, 'status');
  assert.equal(result.evidence!.candidateDefault, null);
  assert.match(result.evidence!.baselineAbsentBehavior, /TaskStatus\.TODO/);
  assert.match(result.evidence!.candidateAbsentBehavior, /unconditionally propagated/);
  assert.match(result.evidence!.mappingPath, /existing\.setStatus\(parseStatus\(updatedTask\.getStatus\(\)\)\)/);

  // The create() path (guarded) must NOT by itself produce a false PASS —
  // proven by re-running against only the guarded mapping in isolation.
  const createOnly = analyzeDefaultValueSemantics({
    sourceType: 'Task', sourceField: 'status', sourceTypeSource: taskEntitySource,
    candidateType: 'TaskDTO', candidateField: 'status', candidateTypeSource: taskDtoSource,
    mappingSource: 'if (taskDto.getStatus() != null) { task.setStatus(parseStatus(taskDto.getStatus())); }',
    mappingLabel: 'TaskService.createTask(TaskDTO)',
    externalBindingEvidence: taskControllerBinding,
  });
  assert.equal(createOnly.verdict, 'NO_DEFECT', 'the guarded create() path alone must not be flagged');
}

console.log('default-value-semantics: PASS (cases 1-8, positive fixture, PR34 offline fixture)');
