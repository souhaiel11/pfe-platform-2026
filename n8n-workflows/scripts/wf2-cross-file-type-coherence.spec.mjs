import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {analyzeJavaTypeCoherence,crossFileTypeCoherenceNodeCode} from './wf2-cross-file-type-coherence.mjs';
import {hardenPlanAuthorityAndTypeCoherence,planAuthorityContract} from './harden-wf2-plan-authority-type-coherence.mjs';

const artifact=new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url);
const root=JSON.parse(readFileSync(artifact,'utf8')),before=structuredClone(root[0]),workflow=structuredClone(root[0]);
hardenPlanAuthorityAndTypeCoherence(workflow);
const node=name=>workflow.nodes.find(item=>item.name===name);
const alreadyHardened=before.nodes.some(item=>item.name==='Validate Cross-File Type Coherence');
assert.equal(workflow.nodes.length,before.nodes.length+(alreadyHardened?0:2));
assert.ok(node('Prepare - Code Patch Body').parameters.jsCode.includes(planAuthorityContract));
assert.match(planAuthorityContract,/PLAN CONTRACT IS AUTHORITATIVE/);
assert.match(planAuthorityContract,/explicit String contract/);
assert.match(planAuthorityContract,/explicitly requires an independent DTO enum/);
assert.doesNotMatch(planAuthorityContract,/S4684|TaskDTO|TaskStatusDTO|TaskController|2023/);
assert.equal(workflow.connections['Validate Cross-File Candidate Manifest'].main[0][0].node,'Validate Cross-File Type Coherence');
assert.equal(workflow.connections['Validate Cross-File Type Coherence'].main[0][0].node,'Prepare Cross-File COMPILE_MAIN');
assert.equal(workflow.connections['Classify Candidate Coordination Scope'].main[1][0].node,
  before.connections['Classify Candidate Coordination Scope'].main[1][0].node,'mono-file route remains unchanged');

const dtoEnum=`package demo; public class SampleDto { public enum DtoStatus { A,B } private DtoStatus status;
 public DtoStatus getStatus(){return status;} public void setStatus(DtoStatus status){this.status=status;} }`;
const entity=`package demo; public class SampleEntity { public enum EntityStatus { A,B } private EntityStatus status;
 public EntityStatus getStatus(){return status;} }`;
const mismatchController=`package demo; public class SampleController {
 void map(SampleDto dto, SampleEntity entity){ SampleEntity.EntityStatus.valueOf(dto.getStatus()); dto.setStatus(entity.getStatus().name()); }
}`;
const mismatch=analyzeJavaTypeCoherence([
  {path:'src/SampleDto.java',operation:'CREATE',content:dtoEnum},
  {path:'src/SampleController.java',operation:'MODIFY',content:mismatchController},
],[{path:'src/SampleEntity.java',content:entity}]);
assert.ok(mismatch.some(item=>item.declaredType==='DtoStatus'&&item.requiredType==='String'),'getter enum -> enum.valueOf(String) is blocked');
assert.ok(mismatch.some(item=>item.declaredType==='String'&&item.requiredType==='DtoStatus'),'setter enum <- String is blocked');

const stringDto=`package demo; public class SampleDto { private String status; public String getStatus(){return status;} public void setStatus(String status){this.status=status;} }`;
const stringController=`package demo; public class SampleController { void map(SampleDto dto, SampleEntity entity){ SampleEntity.EntityStatus.valueOf(dto.getStatus()); dto.setStatus(entity.getStatus().name()); } }`;
assert.deepEqual(analyzeJavaTypeCoherence([{path:'src/SampleDto.java',operation:'CREATE',content:stringDto},{path:'src/SampleController.java',operation:'MODIFY',content:stringController}],[{path:'src/SampleEntity.java',content:entity}]),[],'String representation is coherent');

const enumController=`package demo; public class SampleController { void map(SampleDto dto, SampleEntity entity){ SampleEntity.EntityStatus.valueOf(dto.getStatus().name()); dto.setStatus(SampleDto.DtoStatus.valueOf(entity.getStatus().name())); } }`;
assert.deepEqual(analyzeJavaTypeCoherence([{path:'src/SampleDto.java',operation:'CREATE',content:dtoEnum},{path:'src/SampleController.java',operation:'MODIFY',content:enumController}],[{path:'src/SampleEntity.java',content:entity}]),[],'independent DTO enum representation is coherent');

const service=`package demo; public class SampleService { public void accept(String status){} }`;
const badCaller=`package demo; public class Caller { void call(SampleService service, SampleDto dto){ service.accept(dto.getStatus()); } }`;
const direct=analyzeJavaTypeCoherence([{path:'src/SampleDto.java',operation:'CREATE',content:dtoEnum},{path:'src/SampleService.java',operation:'CREATE',content:service},{path:'src/Caller.java',operation:'MODIFY',content:badCaller}]);
assert.ok(direct.some(item=>item.requiredType==='String'&&item.declaredType==='DtoStatus'),'same-batch direct method mismatch is blocked');

const badAssignment=`package demo; public class AssignmentConsumer { String read(SampleDto dto){ String local=dto.getStatus(); return local; } String direct(SampleDto dto){ return dto.getStatus(); } }`;
const assignment=analyzeJavaTypeCoherence([{path:'src/SampleDto.java',operation:'CREATE',content:dtoEnum},{path:'src/AssignmentConsumer.java',operation:'MODIFY',content:badAssignment}]);
assert.ok(assignment.some(item=>item.reason.includes('assignment target')),'directly resolvable assignment mismatch is blocked');
assert.ok(assignment.some(item=>item.reason.includes('return expression')),'directly resolvable return mismatch is blocked');

// Exact execution-2023 declarations and expressions recovered from persisted output.
const execution2023Dto=`package com.pfe.devsecops.dto; public class TaskDTO { public enum TaskStatusDTO { TODO, IN_PROGRESS, DONE, CANCELLED } private TaskStatusDTO status; public TaskStatusDTO getStatus(){return status;} public void setStatus(TaskStatusDTO status){this.status=status;} }`;
const execution2023Controller=`package com.pfe.devsecops.controller; import com.pfe.devsecops.dto.TaskDTO; import com.pfe.devsecops.model.Task; public class TaskController { void create(TaskDTO taskDto, Task task){ Task.TaskStatus status=Task.TaskStatus.valueOf(taskDto.getStatus()); task.setStatus(status); } void update(TaskDTO taskDto, Task task){ Task.TaskStatus status=Task.TaskStatus.valueOf(taskDto.getStatus()); task.setStatus(status); } TaskDTO toDto(Task task){ TaskDTO dto=new TaskDTO(); dto.setStatus(task.getStatus() != null ? task.getStatus().name() : null); return dto; } }`;
const execution2023Entity=`package com.pfe.devsecops.model; public class Task { public enum TaskStatus { TODO, IN_PROGRESS, DONE, CANCELLED } private TaskStatus status; public TaskStatus getStatus(){return status;} public void setStatus(TaskStatus status){this.status=status;} }`;
const e2023=analyzeJavaTypeCoherence([{path:'src/main/java/com/pfe/devsecops/controller/TaskController.java',operation:'MODIFY',content:execution2023Controller},{path:'src/main/java/com/pfe/devsecops/dto/TaskDTO.java',operation:'CREATE',content:execution2023Dto}],[{path:'src/main/java/com/pfe/devsecops/model/Task.java',content:execution2023Entity}]);
assert.ok(e2023.filter(item=>item.requiredType==='String'&&item.declaredType==='TaskStatusDTO').length>=2);
assert.ok(e2023.some(item=>item.requiredType==='TaskStatusDTO'&&item.declaredType==='String'));

const manifest={files:[{path:'src/TaskDTO.java',content:execution2023Dto},{path:'src/TaskController.java',content:execution2023Controller}],typeResolutionSources:[{path:'src/Task.java',content:execution2023Entity}]};
const $input={first:()=>({json:manifest})};
assert.throws(()=>new vm.Script(`(()=>{${crossFileTypeCoherenceNodeCode}})()`).runInNewContext({$input}),/CROSS_FILE_TYPE_CONTRACT_MISMATCH/,'production node blocks execution-2023 before compilation');

const mono={files:[{path:'src/Legacy.java',content:'class Legacy {}'}]};
const monoResult=new vm.Script(`(()=>{${crossFileTypeCoherenceNodeCode}})()`).runInNewContext({$input:{first:()=>({json:mono})}});
assert.equal(monoResult[0].json.crossFileTypeCoherencePassed,true,'mono-file input is a no-op safeguard');
console.log('WF2 plan authority, generic cross-file Java type coherence, execution-2023 regression: PASS');
