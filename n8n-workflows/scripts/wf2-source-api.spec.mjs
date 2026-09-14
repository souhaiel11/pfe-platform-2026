import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const w=JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url)))[0];
const fixture=JSON.parse(readFileSync(new URL('./fixtures/wf2-task-source-api.json',import.meta.url)));
const node=name=>w.nodes.find(n=>n.name===name);
const [task,controller,service]=fixture.sources;
assert.equal(fixture.sourceCommitSha,'4c9537d51ab6c560c0e1c53a7e07e922a844f3e6');
assert.doesNotMatch(task.content,/\bcompleted\b|\bisCompleted\s*\(|\bgetCompleted\s*\(|\bsetCompleted\s*\(/i);
assert.match(task.content,/private TaskStatus status/);
assert.match(task.content,/private Integer priority/);
assert.match(service.content,/existing\.setStatus\(updatedTask\.getStatus\(\)\)/);
assert.match(service.content,/task\.setStatus\(Task\.TaskStatus\.DONE\)/);
const ctx={batchId:'b',repositoryPolicy:{existingFiles:fixture.sources.map(s=>s.file)}};
const expanded=new Function('$input','$','Buffer',node('Expand Referenced API Sources').parameters.jsCode)(
 {all:()=>[{json:{path:controller.file,content:Buffer.from(controller.content).toString('base64')}}]},()=>({first:()=>({json:ctx})}),Buffer);
assert.deepEqual(expanded.map(i=>i.json.target_file_path).sort(),fixture.sources.map(s=>s.file).sort());
assert.ok(!expanded.some(i=>i.json.target_file_path.includes('TaskRepository')),'no recursive repository-wide expansion');
const refs=node('Fetch Referenced API Sources').parameters.additionalParameters.reference;
assert.match(refs,/Lookup Remediation Branch/);assert.match(refs,/body\?\.object\?\.sha/);assert.match(refs,/\.baseSha/);
const target=controller.file;
const plan={findingId:'f',target:{file:target,line:34},filesToModify:[target],filesToCreate:[],requiredChanges:['Explicit DTO to entity mapping'],remediationIntent:'DTO mapping'};
const planned={target_file_path:target,fileOperation:'MODIFY',remediationPlans:[plan],plannedFiles:[target]};
function prepare(sources){return new Function('$json','$','Buffer',node('Prepare - Code Patch Body').parameters.jsCode)(
 {path:target,content:Buffer.from(controller.content).toString('base64')},name=>({first:()=>({json:name==='Prepare Generic Remediation Plan'?{remediationContract:{sourceSnapshots:sources}}:ctx}),all:()=>[{json:planned}]}),Buffer).json;}
const result=prepare(fixture.sources);
assert.deepEqual(result.completePlan.sourceApiContext,fixture.sources);
assert.match(result.llmRequestBody.messages[0].content,/getStatus/);
assert.match(result.llmRequestBody.messages[0].content,/setStatus/);
const system=result.llmRequestBody.system;
for(const required of [/only fields, methods and constructors proven/,/never infer boolean getter names/,/Preserve enum types and nullable\/reference types exactly/,/explicit type-safe mapping/,/no reflective BeanUtils fallback/,/Do not invent fields, getters, setters or constructors/,/stop generation instead of guessing/]) assert.match(system,required);
assert.throws(()=>prepare([]),/SOURCE_API_CONTEXT_REQUIRED/);
assert.throws(()=>prepare([{file:'other.java',content:'x'.repeat(65537)}]),/SOURCE_API_CONTEXT_LIMIT_EXCEEDED/);
assert.equal(result.llmRequestBody.max_tokens,16384);
console.log('Source API context and mapping constraints PASS: real Task has no completed accessor; status enum API exposed; missing/bounded context fail closed. This tests guidance, not LLM compliance.');
