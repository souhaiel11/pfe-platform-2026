// Offline execution of the artifact Code nodes and graph contracts. No model/network calls.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { relationshipContract, batchReviewContract, harden } from './harden-wf2-multifile-candidate-review.mjs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const fixture = JSON.parse(readFileSync(new URL('./fixtures/wf2-attempt-1999-atomic-review.json', import.meta.url)));
const node = name => wf.nodes.find(n => n.name === name);
const targets = (name, port = 0) => (wf.connections[name]?.main[port] || []).map(e => e.node);
const hash = code => createHash('sha256').update(code).digest('hex');
const jsonItems = values => values.map(json => ({json}));
const planItems = fixture.plannedFiles.map(file => ({plannedFiles: fixture.plannedFiles,
  remediationPlans: fixture.remediationPlans, target_file_path: file.path, fileOperation: file.operation}));
const prepared = {remediationContract: {sourceSnapshots: fixture.sources, findings: [], forbiddenChanges: [],
  sourceGrounding:{frozenSourceSha:fixture.sourceCommitSha,groundedRelationshipApis:[{repositoryType:'com.pfe.devsecops.repository.UserRepository',method:'findById'}]}}};
const context = {batchId:'fixture-1999', requestId:fixture.requestId, attemptCount:3,
  repository_owner:'souhaiel11', repository_name:'pfe-app-test', baseSha:fixture.sourceCommitSha};
function run(name, values, extra = {}) {
  const refs = {'Prepare Batch Context': [context], 'Validate Generic Remediation Plan': planItems,
    'Prepare Generic Remediation Plan': [prepared], 'Lookup Remediation Branch': [{statusCode:404}], ...extra};
  const $ = ref => { assert.ok(refs[ref], 'unexpected node reference: ' + ref); return {
    all: () => jsonItems(refs[ref]), first: () => ({json:refs[ref][0]}), item: {json:refs[ref][0]}}; };
  return new Function('$input', '$json', '$', node(name).parameters.jsCode)(
    {all:() => jsonItems(values), first:() => ({json:values[0]})}, values[0], $);
}
const codes = [
  'package com.pfe.devsecops.controller; import com.pfe.devsecops.dto.TaskDTO; public class TaskController { public TaskDTO echo(TaskDTO dto) { return dto; } }',
  'package com.pfe.devsecops.service; public class TaskService { public String kind() { return "task"; } }',
  'package com.pfe.devsecops.dto; public class TaskDTO { private Long userId; }'
];
function preflight(index, code = codes[index]) {
  const file = fixture.plannedFiles[index];
  return run('Generic Candidate Preflight', [{patchedCode:code, sourceContent:fixture.sources.find(s=>s.file===file.path)?.content || '',
    targetFile:file.path, file_path:file.path, fileOperation:file.operation,
    completePlan:{allPlannedFiles:fixture.plannedFiles}, approvedFindingsForFile:[], applicablePlans:[],
    approvedFindingIds:['finding-1999'], processedFindingIds:['finding-1999'],
    repositoryPolicy:{existingFiles:fixture.plannedFiles.filter(f=>f.operation==='MODIFY').map(f=>f.path),
      permittedRoots:['src/main/java/']}}]).json;
}
const candidates = codes.map((code, index) => {
  const candidate = preflight(index);
  return run('Accumulate Candidate File', [{...candidate, contentSha256:hash(code)}],
    {'Generic Candidate Preflight':[candidate]}).json;
});
const assemble = items => run('Prepare Candidate Manifest', items)[0].json;
let reviewCalls = 0;
const beginReview = items => { const manifest = assemble(items); reviewCalls++; return manifest; };
for (const incomplete of [[], candidates.slice(0,1), candidates.slice(0,2)]) {
  assert.throws(() => beginReview(incomplete), /CANDIDATE_SET_INCOMPLETE/);
  assert.equal(reviewCalls, 0, 'incomplete generation must never start semantic review');
}
assert.throws(() => beginReview([...candidates, candidates[0]]), /CANDIDATE_SET_INCOMPLETE/);
assert.throws(() => beginReview([candidates[0], candidates[1], candidates[1]]), /CANDIDATE_SET_INCOMPLETE/);
const extra = structuredClone(candidates); extra[2].targetFile = extra[2].file_path = 'src/main/java/Extra.java';
assert.throws(() => beginReview(extra), /CANDIDATE_SET_INCOMPLETE/);
for (const mutation of [item=>item.fileOperation='MODIFY', item=>item.file_path='wrong/path',
  item=>item.targetFile='../escape', item=>item.targetFile='/absolute/path']) {
  const invalid = structuredClone(candidates); mutation(invalid[2]);
  assert.throws(() => beginReview(invalid), /CANDIDATE_SET_INCOMPLETE/);
}
const rejectedPreflight = structuredClone(candidates); rejectedPreflight[1].genericPreflightPassed = false;
assert.throws(() => beginReview(rejectedPreflight), /CANDIDATE_SET_PREFLIGHT_FAILED/);
assert.throws(() => preflight(2, codes[2] + '\n// TODO implement association'), /PLACEHOLDER_MARKER/);
assert.equal(reviewCalls, 0);
try { assemble(candidates.slice(0,1)); } catch (error) {
  const metadata = JSON.parse(error.message.slice(error.message.indexOf(':')+1));
  assert.deepEqual(Object.keys(metadata), ['plannedCount','generatedCount','missingPaths','unexpectedPaths']);
  assert.equal(metadata.plannedCount, 3); assert.equal(metadata.generatedCount, 1);
  assert.deepEqual(metadata.missingPaths, fixture.plannedFiles.slice(1).map(f=>f.path));
  assert.ok(!error.message.includes('public class'));
}
const manifest = beginReview(candidates);
assert.equal(reviewCalls, 1);
const reviewContext = JSON.parse(manifest.llmRequestBody.messages[0].content);
assert.deepEqual(reviewContext.candidateFiles.map(f=>f.path), fixture.plannedFiles.map(f=>f.path));
assert.deepEqual(reviewContext.fullRemediationPlan, fixture.remediationPlans);
assert.deepEqual(reviewContext.sourceSnapshots, fixture.sources);
assert.deepEqual(reviewContext.sourceGrounding,prepared.remediationContract.sourceGrounding,'batch reviewer receives the same API evidence used by generation');
assert.match(reviewContext.candidateFiles[0].candidateCode, /import com.pfe.devsecops.dto.TaskDTO/);
assert.match(reviewContext.candidateFiles[2].candidateCode, /class TaskDTO/);
assert.ok(manifest.llmRequestBody.system.endsWith(batchReviewContract));
const realController = preflight(0, fixture.rejectedController);
assert.equal(realController.genericPreflightPassed,true,'actual 1999 controller passes deterministic checks; semantic relationship review remains required');
const realBatch = [run('Accumulate Candidate File', [{contentSha256:hash(realController.patchedCode)}],
  {'Generic Candidate Preflight':[realController]}).json,...candidates.slice(1)];
assert.equal(JSON.parse(assemble(realBatch).llmRequestBody.messages[0].content).candidateFiles[0].candidateCode,fixture.rejectedController);
const canonical = structuredClone(candidates);
canonical[0].targetFile = canonical[0].file_path = canonical[0].file_path.replaceAll('/', '\\');
assert.deepEqual(assemble(canonical).files.map(f=>f.path), manifest.files.map(f=>f.path));

function enforce(verdict, evidence = []) {
  return run('Enforce Independent Review', [{content:[{type:'text',text:JSON.stringify({verdict,evidence})}], stop_reason:'end_turn'}],
    {'Prepare Candidate Manifest':[manifest]}).json;
}
assert.throws(() => enforce('REJECTED', [{category:'RELATIONSHIP_DROPPED'}]), /WF2_CANDIDATE_REJECTED/);
assert.throws(() => enforce('REJECTED', [{category:'INCOMPATIBLE_SIBLING_SIGNATURE'}]), /WF2_CANDIDATE_REJECTED/);
assert.throws(() => enforce('INCONCLUSIVE'), /WF2_MANUAL_REVIEW_REQUIRED/);
const accepted = enforce('ACCEPTABLE_FOR_SCANNER_VALIDATION', ['all files reviewed']);
assert.equal(accepted.files.length, 3);
for (const file of accepted.files) {
  assert.equal(file.validationEvidence.reviewGranularity, 'BATCH');
  assert.deepEqual(file.validationEvidence.reviewedCandidatePaths, fixture.plannedFiles.map(f=>f.path));
  assert.deepEqual(file.candidateAcceptedFindingIds, ['finding-1999']);
}
assert.equal(accepted._canonicalJson, manifest._canonicalJson);
assert.ok(!accepted.llmRequestBody);
const finalized = run('Assemble Candidate Manifest', [{...accepted,candidateDigest:hash(accepted._canonicalJson)}])[0].json;
assert.equal(finalized.files.length, 3);

// The only successful generation-loop exit is the guarded batch preparation.
assert.equal(node('Merge Effective File Results').parameters.batchSize, 1);
assert.deepEqual(targets('Merge Effective File Results'), ['Prepare Candidate Manifest']);
assert.deepEqual(targets('Merge Effective File Results',1), ['Route Planned File Operation']);
assert.deepEqual(targets('Generic Candidate Preflight'), ['Hash Candidate File Content']);
assert.deepEqual(targets('Hash Candidate File Content'), ['Accumulate Candidate File']);
assert.deepEqual(targets('Accumulate Candidate File'), ['Merge Effective File Results']);
assert.deepEqual(targets('Prepare Candidate Manifest'), ['Independent Semantic Review']);
assert.deepEqual(targets('Independent Semantic Review'), ['Enforce Independent Review']);
assert.deepEqual(targets('Enforce Independent Review'), ['Hash Candidate Manifest']);
assert.deepEqual(targets('Assemble Candidate Manifest'), ['Call Candidate Verification']);
assert.deepEqual(targets('Call Candidate Verification'), ['Call Write Guard']);
function reachable(start, stops = []) {
  const seen = new Set(); const todo = [start];
  while (todo.length) { const name=todo.pop(); if(seen.has(name)||stops.includes(name))continue;
    seen.add(name); todo.push(...(wf.connections[name]?.main || []).flat().map(edge=>edge.node)); }
  return seen;
}
const writes = ['Create Missing Branch','Create File in Branch','Update File in Branch'];
for (const retired of wf.nodes.filter(n=>JSON.stringify(n.parameters).includes("$('Enforce Independent Review').item.json")))
  assert.ok(!reachable('Validate Generic Remediation Plan').has(retired.name),'retired per-file review consumers stay disconnected: '+retired.name);
for (const stop of ['Prepare Candidate Manifest','Independent Semantic Review','Enforce Independent Review','Call Candidate Verification','Call Write Guard']) {
  const reachableNodes = reachable('Validate Generic Remediation Plan', [stop]);
  for (const write of writes) assert.ok(!reachableNodes.has(write), stop + ' must dominate ' + write);
}
for (const name of ['Generic Candidate Preflight','Prepare Candidate Manifest','Enforce Independent Review']) {
  assert.equal(node(name).onError, 'continueErrorOutput');
  const failureReachable = reachable(targets(name,1)[0]);
  assert.ok(failureReachable.has('Prepare WF2 Failure Status'));
  for (const blocked of ['Independent Semantic Review','Call Candidate Verification',...writes]) assert.ok(!failureReachable.has(blocked));
}
assert.equal(wf.nodes.length,155);
assert.deepEqual(harden(structuredClone(wf)),wf,'transformation is idempotent');
for (const name of ['Prepare Generic Remediation Plan','Prepare - Code Patch Body'])
  assert.ok(node(name).parameters.jsCode.includes(JSON.stringify(relationshipContract)));
assert.ok(node('Prepare Candidate Manifest').parameters.jsCode.includes(readFileSync(new URL('./lib/wf2-candidate-set-guard.js',import.meta.url),'utf8')));

// Relationship behavior is exercised in Java using the REAL create/update methods,
// the real rejected toEntity method, and small explicit dependency test doubles.
// This proves fixture semantics, not how an external LLM will judge arbitrary code.
const source = suffix => fixture.sources.find(s=>s.file.endsWith(suffix)).content;
function method(code, signature) {
  const start=code.indexOf(signature); assert.ok(start>=0,signature);
  let end=code.indexOf('{',start), depth=1; end++;
  for (;depth && end<code.length;end++) { if(code[end]==='{')depth++; if(code[end]==='}')depth--; }
  assert.equal(depth,0); return code.slice(start,end);
}
assert.match(source('/Task.java'), /@ManyToOne\s+@JoinColumn\(name = "user_id"\)\s+private User user/);
assert.match(source('/Task.java'), /@Data/);
assert.match(source('/UserRepository.java'), /extends JpaRepository<User, Long>/);
const originalCreate = method(source('/TaskService.java'),'public Task createTask(Task task)');
const originalUpdate = method(source('/TaskService.java'),'public Task updateTask(Long id, Task updatedTask)');
assert.ok(!originalUpdate.includes('setUser'));
const badMapper = method(fixture.rejectedController,'private Task toEntity(TaskDTO dto)');
assert.ok(!badMapper.includes('setUser'));
const goodMapper = `private Task toEntity(TaskDTO dto) {
  Task task = new Task(); task.setTitle(dto.getTitle());
  if (dto.getUserId() != null) task.setUser(userRepository.findById(dto.getUserId())
    .orElseThrow(() -> new IllegalArgumentException("Unknown user")));
  return task;
}`;
const harness = `import java.time.LocalDateTime; import java.util.Optional;
public class RelationshipProof {
  static class User { Long id; User(Long id) { this.id=id; } }
  static class Task {
    enum TaskStatus { TODO, IN_PROGRESS, DONE, CANCELLED }
    Long id; String title, description; TaskStatus status; Integer priority; LocalDateTime createdAt, updatedAt; User user;
    public void setId(Long v){id=v;} public void setTitle(String v){title=v;} public String getTitle(){return title;}
    public void setDescription(String v){description=v;} public String getDescription(){return description;}
    public void setStatus(TaskStatus v){status=v;} public TaskStatus getStatus(){return status;}
    public void setPriority(Integer v){priority=v;} public Integer getPriority(){return priority;}
    public void setCreatedAt(LocalDateTime v){createdAt=v;} public void setUpdatedAt(LocalDateTime v){updatedAt=v;}
    public void setUser(User v){user=v;} public User getUser(){return user;}
  }
  static class TaskDTO {
    Long userId; TaskDTO(Long userId){this.userId=userId;}
    public Long getUserId(){return userId;} public Long getId(){return null;} public String getTitle(){return "task";}
    public String getDescription(){return "description";} public String getStatus(){return "TODO";}
    public Integer getPriority(){return 1;} public LocalDateTime getCreatedAt(){return null;} public LocalDateTime getUpdatedAt(){return null;}
  }
  static class UserRepository {
    User known = new User(7L); int calls;
    public Optional<User> findById(Long id){calls++;return id.equals(known.id)?Optional.of(known):Optional.empty();}
  }
  static class TaskRepository {
    Task existing;
    public Optional<Task> findById(Long id){return Optional.ofNullable(existing);}
    public Task save(Task task){existing=task;return task;}
  }
  static class OriginalService { TaskRepository taskRepository = new TaskRepository(); ${originalCreate} ${originalUpdate} }
  static class Bad { ${badMapper} }
  static class Good { UserRepository userRepository = new UserRepository(); ${goodMapper} }
  static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
  public static void main(String[] args) {
    OriginalService service=new OriginalService(); Good good=new Good();
    Task lost=service.createTask(new Bad().toEntity(new TaskDTO(7L)));
    check(lost.getUser()==null,"bad fixture must expose actual association drop");
    Task created=service.createTask(good.toEntity(new TaskDTO(7L)));
    check(created.getUser()==good.userRepository.known,"create must use resolved entity identity");
    check(good.userRepository.calls==1,"create uses proven ID lookup");
    Task changed=good.toEntity(new TaskDTO(null));
    check(service.updateTask(1L,changed).getUser()==good.userRepository.known,"update preserves existing relationship");
    changed.setUser(new User(99L));
    check(service.updateTask(1L,changed).getUser()==good.userRepository.known,"update does not introduce reassignment");
    check(good.toEntity(new TaskDTO(null)).getUser()==null,"nullable create preserved");
    try {good.toEntity(new TaskDTO(404L));throw new AssertionError("unknown ID accepted");}catch(IllegalArgumentException expected){}
    System.out.println("BAD relationship contract: BLOCK; GOOD relationship contract: PASS");
  }
}`;
const directory = mkdtempSync(join(tmpdir(),'wf2-relationship-proof-'));
writeFileSync(join(directory,'RelationshipProof.java'),harness);
execFileSync('javac',[join(directory,'RelationshipProof.java')],{stdio:'pipe'});
assert.match(execFileSync('java',['-cp',directory,'RelationshipProof'],{encoding:'utf8'}), /BAD relationship contract: BLOCK; GOOD relationship contract: PASS/);
console.log('PASS WF2 multifile atomic review: completeness, preflight, full sibling context, whole-batch verdict, Git barriers, real-source Java relationship fixtures');
