import * as assert from 'node:assert/strict';
import { analyzeDefaultValueSemantics } from './default-value-semantics';
import { computeMergeAuthorization } from './merge-authorization';

// R66 — offline, read-only end-to-end simulation of what PR #34's merge
// authorization WOULD have been had the generic default-value-semantics
// invariant been wired into the live pipeline at validation time. This file
// performs NO IO: it re-derives the answer purely from (a) the exact PR #34
// source text recovered during the earlier offline review (git show / raw
// GitHub content at the base and head SHAs) and (b) the exact other
// mergeAuthorization inputs already computed and persisted by the live
// pipeline for this incident (read once, verbatim, from
// incidents.metadata.validation — never re-fetched or mutated here). It does
// not call GitHub, Jenkins, Sonar, n8n, or the database, and it never
// touches PR #34, the FixRequest, or any live record.

// ── Exact PR #34 source (unchanged from default-value-semantics.spec.ts's
// PR34 fixture) ─────────────────────────────────────────────────────────
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

// ── Step 1: run the generic semantic-review addition ────────────────────
const semanticResult = analyzeDefaultValueSemantics({
  sourceType: 'Task', sourceField: 'status', sourceTypeSource: taskEntitySource,
  candidateType: 'TaskDTO', candidateField: 'status', candidateTypeSource: taskDtoSource,
  mappingSource: taskServiceUpdateMapping,
  mappingLabel: 'TaskService.updateTask(Long, TaskDTO)',
  externalBindingEvidence: taskControllerBinding,
});
assert.equal(semanticResult.verdict, 'PROVEN_DEFECT');

// ── Step 2: the other mergeAuthorization inputs, read verbatim from the
// live incident record at the time of the offline review (2026-09-18T23:48Z
// snapshot) — NOT re-derived, NOT re-fetched here. This is exactly what
// computeMergeAuthorization() actually received and returned MERGE_READY
// for, before this R66 signal existed. ──────────────────────────────────
const liveInputsAtTimeOfReview = {
  remediationResult: 'VALIDATED' as const,
  exactCorrelationVerified: true, // checkoutSha === expectedPrHeadSha === dc1aa978719ca40e6339e075cfe52a79875b2342
  requiredStagesComplete: true,
  regressionResult: 'CLEAN' as const,
  headVerificationResult: 'PASS' as const,
  pipelineHealth: null,
  validationInProgress: false,
};

// ── Step 3: prove the ORIGINAL (already-live) outcome was MERGE_READY ────
const originalOutcome = computeMergeAuthorization(liveInputsAtTimeOfReview);
assert.equal(originalOutcome.authorization, 'MERGE_READY', 'sanity check: reproduces the actual live mergeAuthorization for PR #34 before this hardening');

// ── Step 4: prove the outcome WOULD become BLOCKED once R66 is wired in ──
const hardenedOutcome = computeMergeAuthorization({
  ...liveInputsAtTimeOfReview,
  defaultValueSemanticsResult: semanticResult.verdict,
});
assert.equal(hardenedOutcome.authorization, 'BLOCKED', 'PR #34 must not have been MERGE_READY once the omitted-status default-value regression is proven');
assert.ok(hardenedOutcome.blockingReasons.includes('DEFAULT_VALUE_SEMANTICS_REGRESSION'));
const correctiveActionAllowed = hardenedOutcome.authorization === 'BLOCKED'; // mirrors incidents.service.ts's own derivation exactly
assert.equal(correctiveActionAllowed, true, 'correct-and-revalidate must become available once this candidate is proven blocked');

console.log('PR34_OFFLINE_REVALIDATION: PASS — SEMANTIC_REVIEW=PROVEN_DEFECT, MERGE_AUTHORIZATION=BLOCKED, CORRECTIVE_ACTION_ALLOWED=true (original live outcome reproduced as MERGE_READY, confirming the gap this hardening closes)');
