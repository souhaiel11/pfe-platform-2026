import * as assert from 'node:assert/strict';
import { RepositoryResearchService } from './repository-research.service';

// Real repository, real commits (already present locally from this
// session's work on PR #25) -- not mocked. This is the exact worked example
// the CRITICAL RESEARCH RULE was built from: Task.dueDate never existed at
// any commit, and R21-BA/R21-BC established that by hand; this proves the
// service reaches the same conclusion deterministically.
const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
const SHA = 'ea6230b79b99f0c5fcb3c7da3f838bb3efbe81be';
const service = new RepositoryResearchService();

function req(overrides: Partial<Parameters<RepositoryResearchService['answer']>[0]>) {
  return { requestId: 'req-1', revisionSha: SHA, requestType: 'FIELD_EXISTS' as const, symbolOrFile: '', reason: 'test', ...overrides };
}

// --- Test 1: exact-SHA invariant enforced, fails closed on mismatch ---
{
  const result = service.answer(req({ symbolOrFile: 'src/main/java/com/pfe/devsecops/model/Task.java#status' }), 'a-different-sha-entirely', REPO_PATH);
  assert.equal(result.state, 'CONTRADICTORY', 'Test 1 - researchRevisionSha != remediationRevisionSha fails closed as CONTRADICTORY');
}

// --- Test 2: FIELD_EXISTS unknown field returns NOT_FOUND (the exact real-world case) ---
{
  const result = service.answer(
    req({ symbolOrFile: 'src/main/java/com/pfe/devsecops/model/Task.java#dueDate' }),
    SHA,
    REPO_PATH,
  );
  assert.equal(result.state, 'NOT_FOUND', 'Test 2 - Task.dueDate is NOT_FOUND at the real SHA (matches R21-BA ground truth)');
  assert.equal(result.evidence[0].file, 'src/main/java/com/pfe/devsecops/model/Task.java');
  assert.equal(result.evidence[0].revisionSha, SHA);
}

// --- Test 3: FIELD_EXISTS a real field resolves with its real type ---
{
  const result = service.answer(
    req({ symbolOrFile: 'src/main/java/com/pfe/devsecops/model/Task.java#status' }),
    SHA,
    REPO_PATH,
  );
  assert.equal(result.state, 'RESOLVED', 'Test 3 - Task.status is RESOLVED');
  assert.equal(result.facts[0].type, 'TaskStatus', 'Test 3 - real declared type captured (TaskStatus enum, not String)');
}

// --- Test 4: nonexistent file at a real SHA -> NOT_FOUND, not a thrown error ---
{
  const result = service.answer(
    req({ symbolOrFile: 'src/main/java/com/pfe/devsecops/model/DoesNotExist.java#anything' }),
    SHA,
    REPO_PATH,
  );
  assert.equal(result.state, 'NOT_FOUND', 'Test 4 - nonexistent file degrades to NOT_FOUND, never throws');
}

// --- Test 5: METHOD_SIGNATURE resolves a real method on TaskDTO ---
{
  const result = service.answer(
    { requestId: 'req-2', revisionSha: SHA, requestType: 'METHOD_SIGNATURE', symbolOrFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java#getStatus', reason: 'test' },
    SHA,
    REPO_PATH,
  );
  assert.equal(result.state, 'RESOLVED', 'Test 5 - TaskDTO.getStatus() resolves');
  assert.equal(result.facts[0].returnType, 'String', 'Test 5 - real return type captured');
}

// --- Test 6: METHOD_SIGNATURE for a method that never existed -> NOT_FOUND ---
{
  const result = service.answer(
    { requestId: 'req-3', revisionSha: SHA, requestType: 'METHOD_SIGNATURE', symbolOrFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java#getDueDate', reason: 'test' },
    SHA,
    REPO_PATH,
  );
  // NOTE: at this exact SHA, TaskDTO.java (the pre-fix candidate) still
  // DECLARES getDueDate() even though Task has no dueDate field -- proving
  // the two are checked independently and a declared-but-mismatched method
  // is still RESOLVED for METHOD_SIGNATURE (it exists syntactically); it is
  // FIELD_EXISTS on the *entity* that correctly reports NOT_FOUND (Test 2).
  assert.equal(result.state, 'RESOLVED', 'Test 6 - TaskDTO.getDueDate() itself is syntactically present at this SHA (the defect was the entity mismatch, not a missing DTO method)');
}

// --- Test 9 (Phase 9 #11/#12 companion): a not-yet-implemented question class returns NOT_FOUND honestly, never a fabricated answer ---
{
  const result = service.answer(
    { requestId: 'req-4', revisionSha: SHA, requestType: 'CALLERS', symbolOrFile: 'anything', reason: 'test' },
    SHA,
    REPO_PATH,
  );
  assert.equal(result.state, 'NOT_FOUND', 'Test - unimplemented question class (CALLERS) is honest NOT_FOUND, not a guess');
}

console.log('RepositoryResearchService: PASS');
