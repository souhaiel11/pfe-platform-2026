import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL(
  '../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R70-CORRECTIVE-TARGET-GROUNDING.json',
  import.meta.url,
)))[0];
const baseline = JSON.parse(readFileSync(new URL(
  '../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',
  import.meta.url,
)))[0];
const node = name => wf.nodes.find(n => n.name === name);
const baselineNode = name => baseline.nodes.find(n => n.name === name);

function run(name, jsonInput, refs = {}) {
  const $ = key => {
    assert.ok(refs[key], 'unexpected reference ' + key);
    const items = refs[key];
    return { first: () => ({ json: items[0] }), all: () => items.map(json => ({ json })) };
  };
  const env = { N8N_INTERNAL_SECRET: 'secret-r70' };
  return new Function('$input', '$json', '$', 'Buffer', '$env',
    node(name).parameters.jsCode,
  )({ first: () => ({ json: jsonInput }), all: () => [{ json: jsonInput }] }, jsonInput, $, Buffer, env);
}

// ── Section 12 — node count and every OTHER node's jsCode is byte-identical
// to the pre-R70 promotion target (no unrelated regression, no behavior
// change anywhere R70 did not intend to touch).
{
  assert.equal(wf.nodes.length, baseline.nodes.length, 'R70 must not add/remove nodes');
  const touched = new Set([
    'Adapt Webhook Payload', 'Build Independent Repository Policy',
    'Expand Finding Source Files', 'Prepare Generic Remediation Plan',
    'Validate Generic Remediation Plan',
  ]);
  let untouchedIdentical = 0;
  for (const n of wf.nodes) {
    if (touched.has(n.name)) continue;
    const b = baselineNode(n.name);
    assert.ok(b, 'node must exist in baseline: ' + n.name);
    assert.deepEqual(n, b, 'unrelated node must be byte-identical: ' + n.name);
    untouchedIdentical++;
  }
  assert.equal(untouchedIdentical, wf.nodes.length - touched.size);
  // WF2_PATCH_NOT_EFFECTIVE gate (Generic Candidate Preflight) explicitly unchanged.
  assert.deepEqual(node('Generic Candidate Preflight'), baselineNode('Generic Candidate Preflight'));
  console.log('R70_UNTOUCHED_NODES_IDENTICAL: PASS');
}

// ── Section 1/9 — Adapt Webhook Payload: correctiveAttempt/correctiveContext
// now survive into incidentData (THE proven root cause of execution 2028).
{
  const blockingCauses = [{
    type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateSha: 'd'.repeat(40),
    sourceType: 'Task', sourceField: 'status', sourceDefault: 'TaskStatus.TODO',
    candidateType: 'TaskDTO', candidateField: 'status', candidateDefault: null,
    mappingPath: 'updateTask(TaskDTO): existing.setStatus(parseStatus(updatedTask.getStatus()));',
    mappingFile: 'src/main/java/com/pfe/devsecops/service/TaskService.java',
  }];
  const correctiveContext = { previousAttempt: 3, blockingCauses, reasonCodes: ['DEFAULT_VALUE_SEMANTICS_REGRESSION'] };
  const body = {
    incidentId: 'i1', projectId: 'p1', requestId: 'r1', remediationType: 'AUTO_FIX_ELIGIBLE',
    repository: 'https://github.com/souhaiel11/pfe-app-test', defaultBranch: 'main',
    correctiveAttempt: true, correctiveContext,
    findingId: 'f1', findingIds: ['f1'],
    finding: { findingId: 'f1', remediationType: 'AUTO_FIX_ELIGIBLE', source: 'SONARQUBE', stage: 'sonar', file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 34 },
    findings: [{ findingId: 'f1', remediationType: 'AUTO_FIX_ELIGIBLE', source: 'SONARQUBE', stage: 'sonar', file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 34 }],
  };
  const input = { headers: { 'x-internal-secret': 'secret-r70' }, body, correlationEnvelope: { incidentId: 'i1', requestId: 'r1', attemptCount: 4 } };
  const [out] = run('Adapt Webhook Payload', input);
  assert.equal(out.json.incidentData.correctiveAttempt, true);
  assert.deepEqual(out.json.incidentData.correctiveContext, correctiveContext);
  console.log('R70_ADAPT_WEBHOOK_PAYLOAD_PROPAGATES_CORRECTIVE_CONTEXT: PASS');

  // Non-corrective flow: field absent on body -> deterministic false/null, never undefined/truthy.
  const ordinaryBody = { ...body, correctiveAttempt: undefined, correctiveContext: undefined };
  const [ordinaryOut] = run('Adapt Webhook Payload', { ...input, body: ordinaryBody });
  assert.equal(ordinaryOut.json.incidentData.correctiveAttempt, false);
  assert.equal(ordinaryOut.json.incidentData.correctiveContext, null);
  console.log('R70_NEGATIVE_E_ORDINARY_WEBHOOK_PAYLOAD_UNCHANGED: PASS');
}

// ── Section 2/9 — Build Independent Repository Policy: corrective grounded
// files widen targetFiles/permittedRoots; a cause file absent from the repo
// tree is silently excluded (never thrown); ordinary flow is a pure passthrough.
{
  const tree = [
    { type: 'blob', path: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' },
    { type: 'blob', path: 'src/main/java/com/pfe/devsecops/service/TaskService.java' },
    { type: 'blob', path: 'pom.xml' },
  ];
  const correctiveCtx = (ctx) => ({
    findings: [{ file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' }],
    correctiveAttempt: true,
    correctiveContext: { blockingCauses: [{ mappingFile: 'src/main/java/com/pfe/devsecops/service/TaskService.java', ...ctx }] },
  });
  const [out] = run('Build Independent Repository Policy', { tree }, { 'Prepare Batch Context': [correctiveCtx({})] });
  assert.ok(out.json.repositoryPolicy.targetFiles.includes('src/main/java/com/pfe/devsecops/service/TaskService.java'), 'grounded file widens targetFiles');
  assert.ok(out.json.repositoryPolicy.targetFiles.includes('src/main/java/com/pfe/devsecops/controller/TaskController.java'), 'historical finding file retained');
  console.log('R70_BUILD_POLICY_WIDENS_TARGET_FILES: PASS');

  // Grounded file not present in repo tree -> excluded, not thrown.
  const ctxMissing = {
    findings: [{ file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' }],
    correctiveAttempt: true,
    correctiveContext: { blockingCauses: [{ mappingFile: 'src/main/java/com/pfe/devsecops/service/DoesNotExist.java' }] },
  };
  const [outMissing] = run('Build Independent Repository Policy', { tree }, { 'Prepare Batch Context': [ctxMissing] });
  assert.deepEqual(outMissing.json.repositoryPolicy.targetFiles, ['src/main/java/com/pfe/devsecops/controller/TaskController.java']);
  console.log('R70_BUILD_POLICY_NONEXISTENT_GROUNDED_FILE_EXCLUDED: PASS');

  // Ordinary (non-corrective) flow: byte-identical targetFiles to the old
  // finding-derived computation.
  const ordinaryCtx = { findings: [{ file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java' }] };
  const [outOrdinary] = run('Build Independent Repository Policy', { tree }, { 'Prepare Batch Context': [ordinaryCtx] });
  const [outOrdinaryBaseline] = (() => {
    const $ = key => ({ first: () => ({ json: [ordinaryCtx][0] }), all: () => [ordinaryCtx].map(json => ({ json })) });
    return new Function('$input', '$json', '$', 'Buffer', baselineNode('Build Independent Repository Policy').parameters.jsCode)(
      { first: () => ({ json: { tree } }), all: () => [{ json: { tree } }] }, { tree }, $, Buffer,
    );
  })();
  assert.deepEqual(outOrdinary.json.repositoryPolicy.targetFiles, outOrdinaryBaseline.json.repositoryPolicy.targetFiles);
  assert.deepEqual(outOrdinary.json.repositoryPolicy.permittedRoots, outOrdinaryBaseline.json.repositoryPolicy.permittedRoots);
  console.log('R70_NEGATIVE_E_BUILD_POLICY_ORDINARY_FLOW_UNCHANGED: PASS');
}

// ── Section 3 — Expand Finding Source Files reads the widened set.
{
  const ctx = { repositoryPolicy: { targetFiles: ['A.java', 'B.java'] }, findings: [{ file: 'A.java' }] };
  const out = run('Expand Finding Source Files', {}, { 'Build Independent Repository Policy': [ctx] });
  assert.deepEqual(out.map(i => i.json.target_file_path).sort(), ['A.java', 'B.java']);
  console.log('R70_EXPAND_FINDING_SOURCE_FILES_WIDENED: PASS');

  // Fallback path preserved when repositoryPolicy is absent (defensive, not expected in practice).
  const legacyCtx = { findings: [{ file: 'A.java' }] };
  const legacyOut = run('Expand Finding Source Files', {}, { 'Build Independent Repository Policy': [legacyCtx] });
  assert.deepEqual(legacyOut.map(i => i.json.target_file_path), ['A.java']);
  console.log('R70_NEGATIVE_E_EXPAND_FINDING_SOURCE_FILES_FALLBACK: PASS');
}

// ── Section 8/9/11 — Validate Generic Remediation Plan: the deterministic
// CORRECTIVE_TARGET_NOT_GROUNDED gate.
{
  const policy = {
    existingFiles: ['TaskController.java', 'TaskService.java', 'Unrelated.java'],
    permittedRoots: [''], targetFiles: ['TaskController.java', 'TaskService.java'],
  };
  const basePlanFields = {
    disposition: 'AUTO_CANDIDATE', rootCause: 'x', remediationIntent: 'y',
    requiredChanges: ['a'], forbiddenChanges: ['b'], expectedBehaviorPreserved: ['c'],
    validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' },
    requiredRelationshipApis: [], relationshipOperations: [],
  };
  const claudeResponse = (plans) => ({ model: 'x', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ plans }) }] });
  const prepared = (overrides, target) => ({
    findingIds: ['f1'], repositoryPolicy: policy,
    remediationContract: { sourceGrounding: { groundedRelationshipApis: [] }, sourceSnapshots: overrides.sourceSnapshots || [] },
    correctiveAttempt: overrides.correctiveAttempt, correctiveContext: overrides.correctiveContext,
  });

  function validate(overrides, target) {
    const plans = [{ ...basePlanFields, findingId: 'f1', source: 'SONARQUBE', rule: 'java:S4684', target: { file: target, line: 1 }, filesToModify: [target], filesToCreate: [], proposedPaths: [target] }];
    return run('Validate Generic Remediation Plan', claudeResponse(plans), { 'Prepare Generic Remediation Plan': [prepared(overrides)] });
  }

  // A. explicit mappingFile grounds the target -> plan accepted.
  {
    const causes = [{ mappingFile: 'TaskService.java', mappingPath: 'updateTask(TaskDTO): existing.setStatus(x);' }];
    const out = validate({ correctiveAttempt: true, correctiveContext: { blockingCauses: causes } }, 'TaskService.java');
    assert.equal(out.length, 1);
    console.log('R70_CASE_A_EXPLICIT_MAPPING_FILE_GROUNDED: PASS');
  }

  // B. no file field, but a UNIQUE mappingPath snippet match in bounded source context -> resolved.
  {
    const snippet = 'existing.setStatus(parseStatus(updatedTask.getStatus()));';
    const causes = [{ mappingPath: `updateTask(TaskDTO): ${snippet}` }];
    const snapshots = [{ file: 'TaskService.java', content: `class TaskService { void updateTask(){ ${snippet} } }` }];
    const out = validate({ correctiveAttempt: true, correctiveContext: { blockingCauses: causes }, sourceSnapshots: snapshots }, 'TaskService.java');
    assert.equal(out.length, 1);
    console.log('R70_CASE_B_BOUNDED_SNIPPET_RESOLUTION: PASS');
  }

  // C. mappingPath snippet matches MULTIPLE files ambiguously -> not resolved -> D-style rejection.
  {
    const snippet = 'existing.setStatus(parseStatus(updatedTask.getStatus()));';
    const causes = [{ mappingPath: `updateTask(TaskDTO): ${snippet}` }];
    const snapshots = [
      { file: 'TaskService.java', content: `class TaskService { ${snippet} }` },
      { file: 'TaskServiceV2.java', content: `class TaskServiceV2 { ${snippet} }` },
    ];
    assert.throws(
      () => validate({ correctiveAttempt: true, correctiveContext: { blockingCauses: causes }, sourceSnapshots: snapshots }, 'TaskService.java'),
      /CORRECTIVE_TARGET_NOT_GROUNDED/,
    );
    console.log('R70_CASE_C_AMBIGUOUS_SNIPPET_FAILS_SAFE: PASS');
  }

  // D. no causal file/path evidence at all -> must NOT default to the
  // original finding file; explicit rejection before patch generation.
  {
    const causes = [{}]; // no sourceFile/candidateFile/mappingFile/mappingPath
    assert.throws(
      () => validate({ correctiveAttempt: true, correctiveContext: { blockingCauses: causes } }, 'TaskController.java'),
      /CORRECTIVE_TARGET_NOT_GROUNDED/,
    );
    console.log('R70_CASE_D_NO_EVIDENCE_NEVER_DEFAULTS_TO_FINDING_FILE: PASS');
  }

  // E. ordinary non-corrective flow -> completely unaffected (gate skipped entirely).
  {
    const out = validate({ correctiveAttempt: undefined, correctiveContext: undefined }, 'TaskController.java');
    assert.equal(out.length, 1);
    console.log('R70_CASE_E_NON_CORRECTIVE_FLOW_UNCHANGED: PASS');
  }

  // F. existing scanner-based (non-default-value) corrective cause with a
  // valid explicit file location -> unchanged / still grounds correctly.
  {
    const causes = [{ type: 'NEW_BLOCKING_FINDING', path: 'TaskController.java' }];
    // NEW_BLOCKING_FINDING causes carry `path`, not sourceFile/candidateFile/
    // mappingFile — R70's grounding set recognizes it too, generically, by
    // treating any of the three OR a `path` field as equally authoritative.
    // (See production code: the grounded set also honors cause.path.)
    const out = validate({ correctiveAttempt: true, correctiveContext: { blockingCauses: causes } }, 'TaskController.java');
    assert.equal(out.length, 1);
    console.log('R70_CASE_F_SCANNER_CAUSE_WITH_PATH_GROUNDED: PASS');
  }

  // G. historical finding file happens to ALSO be the causal target -> allowed.
  {
    const causes = [{ mappingFile: 'TaskController.java', mappingPath: 'x(y): z' }];
    const out = validate({ correctiveAttempt: true, correctiveContext: { blockingCauses: causes } }, 'TaskController.java');
    assert.equal(out.length, 1);
    console.log('R70_CASE_G_FINDING_FILE_AS_CAUSAL_TARGET_ALLOWED: PASS');
  }

  // H. planner proposes a file with NO causal support and it is not even the
  // historical finding file -> deterministic rejection (either the pre-existing
  // REMEDIATION_TARGET_NOT_PLANNED, since Unrelated.java isn't in policy.targetFiles,
  // or CORRECTIVE_TARGET_NOT_GROUNDED once it is).
  {
    const causes = [{ mappingFile: 'TaskService.java', mappingPath: 'x(y): z' }];
    assert.throws(
      () => validate({ correctiveAttempt: true, correctiveContext: { blockingCauses: causes } }, 'Unrelated.java'),
      /REMEDIATION_TARGET_NOT_PLANNED|CORRECTIVE_TARGET_NOT_GROUNDED/,
    );
    console.log('R70_CASE_H_UNRELATED_FILE_REJECTED: PASS');
  }

  // I. planner proposes a byte-identical patch for a now-grounded target ->
  // WF2_PATCH_NOT_EFFECTIVE (Generic Candidate Preflight, untouched by R70)
  // still rejects it. Defense in depth, proven functionally, not just by
  // node-identity diff.
  {
    const patch = {
      targetFile: 'TaskService.java', fileOperation: 'MODIFY',
      patchedCode: 'same content', sourceContent: 'same content',
      completePlan: { allPlannedFiles: [{ path: 'TaskService.java' }], sourceApiContext: [] },
      repositoryPolicy: { permittedRoots: [''], existingFiles: ['TaskService.java'] },
      approvedFindingsForFile: [], applicablePlans: [],
    };
    assert.throws(
      () => new Function('$input', '$json', '$', 'Buffer', node('Generic Candidate Preflight').parameters.jsCode)(
        { first: () => ({ json: patch }) }, patch, () => ({}), Buffer,
      ),
      /WF2_PATCH_NOT_EFFECTIVE/,
    );
    console.log('R70_CASE_I_WF2_PATCH_NOT_EFFECTIVE_STILL_REJECTS: PASS');
  }

  console.log('wf2-r70-corrective-target-grounding: PASS');
}

// ── Section 9/10 — execution 2028 offline replay, using the ACTUAL dispatched
// blockingCause from the real corrective-retry-attempt-4 webhook payload.
{
  const realBlockingCause = {
    type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateSha: 'dc1aa978719ca40e6339e075cfe52a79875b2342',
    sourceType: 'Task', sourceField: 'status', sourceDefault: 'TaskStatus.TODO',
    candidateType: 'TaskDTO', candidateField: 'status', candidateDefault: null,
    baselineAbsentBehavior: 'Field kept at its declared initializer: TaskStatus.TODO',
    candidateAbsentBehavior: 'Field kept at the language default (no initializer), unconditionally propagated',
    mappingPath: 'updateTask(TaskDTO): existing.setStatus(parseStatus(updatedTask.getStatus()));',
    mappingFile: 'src/main/java/com/pfe/devsecops/service/TaskService.java',
  };
  const correctiveContext = { previousAttempt: 3, blockingCauses: [realBlockingCause], reasonCodes: ['DEFAULT_VALUE_SEMANTICS_REGRESSION'] };
  const findingFile = 'src/main/java/com/pfe/devsecops/controller/TaskController.java';

  // Step A: Build Independent Repository Policy widens targetFiles with the
  // real mappingFile.
  const tree = [{ type: 'blob', path: findingFile }, { type: 'blob', path: realBlockingCause.mappingFile }, { type: 'blob', path: 'pom.xml' }];
  const batchCtx = { findings: [{ file: findingFile }], correctiveAttempt: true, correctiveContext };
  const [policyOut] = run('Build Independent Repository Policy', { tree }, { 'Prepare Batch Context': [batchCtx] });
  assert.ok(policyOut.json.repositoryPolicy.targetFiles.includes(realBlockingCause.mappingFile));

  // Step B: Expand Finding Source Files now also expands TaskService.java.
  const expanded = run('Expand Finding Source Files', {}, { 'Build Independent Repository Policy': [policyOut.json] });
  const plannerTargets = expanded.map(i => i.json.target_file_path).sort();
  assert.deepEqual(plannerTargets, [findingFile, realBlockingCause.mappingFile].sort());

  // Step C: OLD_WRONG_TARGET_SELECTED = NO -- the exact plan execution 2028
  // actually produced (TaskController.java only, byte-identical no-op) is
  // now rejected BEFORE patch generation, not merely caught by the later
  // no-op gate.
  const policy = { existingFiles: [findingFile, realBlockingCause.mappingFile], permittedRoots: [''], targetFiles: [findingFile, realBlockingCause.mappingFile] };
  const basePlanFields = {
    disposition: 'AUTO_CANDIDATE', rootCause: 'x', remediationIntent: 'y',
    requiredChanges: ['a'], forbiddenChanges: ['b'], expectedBehaviorPreserved: ['c'],
    validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' },
    requiredRelationshipApis: [], relationshipOperations: [],
  };
  const claudeResponse = (plans) => ({ model: 'x', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ plans }) }] });
  const preparedFor = (target) => ({
    findingIds: ['f1'], repositoryPolicy: policy,
    remediationContract: { sourceGrounding: { groundedRelationshipApis: [] }, sourceSnapshots: [] },
    correctiveAttempt: true, correctiveContext,
  });
  const wrongOnlyPlan = [{ ...basePlanFields, findingId: 'f1', source: 'SONARQUBE', rule: 'java:S4684', target: { file: findingFile, line: 34 }, filesToModify: [findingFile], filesToCreate: [], proposedPaths: [findingFile] }];
  assert.throws(
    () => run('Validate Generic Remediation Plan', claudeResponse(wrongOnlyPlan), { 'Prepare Generic Remediation Plan': [preparedFor(findingFile)] }),
    /CORRECTIVE_TARGET_NOT_GROUNDED/,
    'OLD_WRONG_TARGET_SELECTED must now be prevented, not merely caught downstream',
  );
  console.log('R70_EXECUTION_2028_REPLAY_OLD_WRONG_TARGET_SELECTED=NO: PASS');

  // Step D: CORRECTIVE_TARGET_GROUNDED = YES -- a plan that (also) targets the
  // grounded causal file is accepted, addressing the actual default-value
  // invariant location instead of the historical finding file alone.
  const groundedPlan = [
    { ...basePlanFields, findingId: 'f1', source: 'SONARQUBE', rule: 'java:S4684', target: { file: findingFile, line: 34 }, filesToModify: [findingFile, realBlockingCause.mappingFile], filesToCreate: [], proposedPaths: [findingFile, realBlockingCause.mappingFile] },
  ];
  const out = run('Validate Generic Remediation Plan', claudeResponse(groundedPlan), { 'Prepare Generic Remediation Plan': [preparedFor(findingFile)] });
  const plannedPaths = out.map(i => i.json.target_file_path).sort();
  assert.deepEqual(plannedPaths, [findingFile, realBlockingCause.mappingFile].sort());
  console.log('R70_EXECUTION_2028_REPLAY_CORRECTIVE_TARGET_GROUNDED=YES: PASS');
  console.log('PLANNER_TARGETS =', JSON.stringify(plannedPaths));
}
