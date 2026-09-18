import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const workflow = JSON.parse(fs.readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const preflight = workflow.nodes.find(node => node.name === 'Generic Candidate Preflight');
assert.ok(preflight, 'Generic Candidate Preflight missing');
const run = json => new Function('$json', '$', 'Buffer', preflight.parameters.jsCode)(json, () => { throw new Error('unexpected node lookup'); }, Buffer).json;
const path = 'src/main/java/com/pfe/devsecops/service/TaskService.java';
const base = (baseline, candidate, operation = 'MODIFY', target = path) => ({
  targetFile: target,
  fileOperation: operation,
  sourceContent: operation === 'CREATE' ? '' : baseline.replace('return taskRepository.findAll();', 'return taskRepository.findAll().stream().toList();'),
  patchedCode: candidate,
  repositoryPolicy: { existingFiles: operation === 'MODIFY' ? [target] : [], permittedRoots: ['src/main/java/'], suggestedCommands: [] },
  completePlan: { allPlannedFiles: [{ path: target, operation }], sourceApiContext: operation === 'MODIFY' ? [{ file: target, content: baseline }] : [] },
  approvedFindingsForFile: [], applicablePlans: [],
});
const pass = fixture => assert.equal(run(fixture).genericPreflightPassed, true);
const block = fixture => assert.throws(() => run(fixture), /SCANNER_SUPPRESSION/);

const baseline = `class TaskService {
  @SuppressWarnings("unchecked")
  java.util.List<String> search(String title) { return java.util.List.of(title); }
  java.util.List<String> getAll() { return java.util.List.of(); }
}`;
const modified = baseline.replace('return java.util.List.of();', 'return java.util.List.copyOf(java.util.List.of());');

pass(base(baseline, modified)); // 1. inherited identical
block(base('class X { void a() {} }', 'class X { @SuppressWarnings("unchecked") void a() {} }', 'MODIFY', 'src/main/java/X.java')); // 2. new
block(base(baseline, modified.replace('@SuppressWarnings("unchecked")', '@SuppressWarnings({"unchecked", "rawtypes"})'))); // 3. broadened
block(base(baseline, modified.replace('java.util.List<String> getAll()', '@SuppressWarnings("unchecked")\n  java.util.List<String> getAll()'))); // 4. duplicate
block(base('', 'class Created { @SuppressWarnings("unchecked") void a() {} }', 'CREATE', 'src/main/java/Created.java')); // 5. create
pass(base(baseline, modified.replace('  @SuppressWarnings("unchecked")\n', ''))); // 6. removed

// 7. Real TaskService source captured from the frozen S4684 source context.
const provenance = JSON.parse(fs.readFileSync(new URL('./fixtures/wf2-s4684-current-taskservice.json', import.meta.url)));
assert.equal(provenance.sourceCommitSha, '6ed56ff791acbf3e111431285bef7b30c8076084');
assert.equal(provenance.executionId, 2006);
const realFixture = JSON.parse(fs.readFileSync(new URL(`./fixtures/${provenance.contentFixture}`, import.meta.url)));
const realTaskService = realFixture.sources.find(source => source.file === path)?.content;
assert.ok(realTaskService?.includes('@SuppressWarnings("unchecked")'));
assert.equal(crypto.createHash('sha256').update(realTaskService).digest('hex'), provenance.contentSha256,
  'fixture bytes must match TaskService captured at the current frozen S4684 baseline');
const realCandidate = realTaskService.replace('return taskRepository.findById(id);', 'return taskRepository.findById(id).filter(task -> task != null);');
pass(base(realTaskService, realCandidate));

// 8. The comparison source is the frozen sourceApiContext, not moving branch content.
const branchContentWithoutSuppression = realTaskService.replace('    @SuppressWarnings("unchecked")\n', '').replace('return taskRepository.findAll();', 'return taskRepository.findAll().stream().toList();');
pass({ ...base(realTaskService, realCandidate), sourceContent: branchContentWithoutSuppression });
assert.match(preflight.parameters.jsCode, /completePlan\?\.sourceApiContext/);
for (const name of ['Fetch Finding Source Context', 'Fetch Referenced API Sources', 'Fetch Required Dependency Sources']) {
  const reference = workflow.nodes.find(node => node.name === name)?.parameters?.additionalParameters?.reference;
  assert.equal(reference, "={{ $('Prepare Batch Context').first().json.baseSha }}", `${name} must use frozen baseSha`);
}

assert.equal(workflow.nodes.length, 186);
console.log('wf2-preflight-scanner-suppression: PASS (8 baseline-aware cases; real TaskService fixture)');
