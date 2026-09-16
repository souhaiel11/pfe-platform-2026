import * as assert from 'node:assert/strict';
import { compilerDiagnostics } from './candidate-verification-executor';
import { WorkspaceManager } from './workspace-manager.service';
import { assertVerificationStep } from '../../backend/src/candidate-verification/candidate-verification.types';

const raw=`password=hunter2\n[ERROR] /var/pfe-remediation-workspaces/request/batch/attempt-1/step-1/src/main/java/com/pfe/devsecops/controller/TaskController.java:[23,67] incompatible types: java.util.List<com.pfe.devsecops.dto.TaskDTO> cannot be converted to java.util.List<com.pfe.devsecops.model.Task>\n[ERROR] /var/pfe-remediation-workspaces/request/batch/attempt-1/step-1/src/main/java/com/pfe/devsecops/controller/TaskController.java:[57,74] incompatible types: java.util.List<com.pfe.devsecops.dto.TaskDTO> cannot be converted to java.util.List<com.pfe.devsecops.model.Task>`;
const d=compilerDiagnostics(raw,'/var/pfe-remediation-workspaces/request/batch/attempt-1/step-1');
assert.doesNotMatch(d.boundedCompilerTail!,/hunter2|\/var\/pfe-remediation-workspaces/);
for(const usable of ['TaskController.java','23','57','List<com.pfe.devsecops.dto.TaskDTO>','List<com.pfe.devsecops.model.Task>'])
  assert.match(d.boundedCompilerTail!,new RegExp(usable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'redaction must preserve '+usable);
assert.ok(d.implicatedPaths.some(p=>p.endsWith('TaskController.java')));
for(const usable of ['List<TaskDTO>','List<Task>'])
  assert.ok(d.implicatedSymbols.includes(usable),'redacted structured diagnostics must preserve '+usable);
const persistedDiagnostic=JSON.stringify(d);
for(const usable of ['TaskController.java','23','57','List<TaskDTO>','List<Task>'])
  assert.match(persistedDiagnostic,new RegExp(usable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'bounded/redacted diagnostic must remain usable: '+usable);
const manager=new WorkspaceManager('/tmp/progressive-verification-spec');
assert.equal(manager.workspaceId('request','batch',1,3),'request/batch/attempt-1/step-3');
assert.equal(manager.workspaceId('request','batch',1),'request/batch/attempt-1');
assert.doesNotThrow(()=>assertVerificationStep({sequence:1,phase:'INITIAL_COMPILE',stateDigest:'a'.repeat(64)},'COMPILE_MAIN'));
assert.throws(()=>assertVerificationStep({sequence:1,phase:'FULL_TEST',stateDigest:'a'.repeat(64)},'COMPILE_MAIN'),/INVALID_VERIFICATION_STEP/);
assert.throws(()=>assertVerificationStep({sequence:0,phase:'INITIAL_COMPILE',stateDigest:'not-a-digest'},'COMPILE_MAIN'),/INVALID_VERIFICATION_STEP/);
console.log('progressive verification diagnostics/workspace identity: PASS');
