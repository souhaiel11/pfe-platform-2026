import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groundingInstruction, relationshipPatchGuard, relationshipPlanSchema, relationshipPlanValidation } from './harden-wf2-relationship-source-grounding.mjs';

const workflow = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const node = name => workflow.nodes.find(candidate => candidate.name === name);
const validatorCode = node('Validate Generic Remediation Plan').parameters.jsCode;
const validationStart = validatorCode.indexOf('const groundedApis=');
const validationEnd = validatorCode.indexOf('const fileMap=new Map();', validationStart);
assert.ok(validationStart >= 0 && validationEnd > validationStart);
const realValidation = validatorCode.slice(validationStart, validationEnd).trim();
assert.equal(realValidation, relationshipPlanValidation.trim(), 'helper/artifact validator drift');

const patchCode = node('Prepare - Code Patch Body').parameters.jsCode;
const patchStart = patchCode.indexOf("const sourceGrounding=$('Prepare Generic Remediation Plan')");
const patchEnd = patchCode.indexOf('const approvedFindingIds=', patchStart);
assert.ok(patchStart >= 0 && patchEnd > patchStart);
const realPatchGuard = patchCode.slice(patchStart, patchEnd).trim();
assert.equal(realPatchGuard, relationshipPatchGuard.trim(), 'helper/artifact patch guard drift');
assert.match(patchCode, /relationshipOperations:plans\.flatMap/);
assert.ok(patchCode.includes(groundingInstruction));

const plannerCode = node('Prepare Generic Remediation Plan').parameters.jsCode;
const schemaStart = plannerCode.indexOf('const planSchema=');
const schemaEnd = plannerCode.indexOf("if(!llmRequestBody||typeof llmRequestBody!=='object')", schemaStart);
assert.equal(plannerCode.slice(schemaStart, schemaEnd).trim(), relationshipPlanSchema.trim(), 'helper/artifact schema drift');
assert.ok(plannerCode.includes(groundingInstruction));

const userProof = { ownerPath: 'src/main/java/com/pfe/devsecops/model/Task.java', field: 'user', repositoryType: 'com.pfe.devsecops.repository.UserRepository', repositorySourcePath: 'src/main/java/com/pfe/devsecops/repository/UserRepository.java', entityType: 'com.pfe.devsecops.model.User', method: 'findById', idType: 'Long' };
const projectProof = { ownerPath: userProof.ownerPath, field: 'project', repositoryType: 'com.pfe.devsecops.repository.ProjectRepository', repositorySourcePath: 'src/main/java/com/pfe/devsecops/repository/ProjectRepository.java', entityType: 'com.pfe.devsecops.model.Project', method: 'findById', idType: 'Long' };
const api = proof => Object.fromEntries(['repositoryType', 'repositorySourcePath', 'entityType', 'method', 'idType'].map(key => [key, proof[key]]));
const resolve = proof => ({ ownerPath: proof.ownerPath, field: proof.field, relatedEntityType: proof.entityType, operation: 'RESOLVE_BY_ID', requiredApi: api(proof) });
const preserve = proof => ({ ownerPath: proof.ownerPath, field: proof.field, relatedEntityType: proof.entityType, operation: 'PRESERVE', requiredApi: null });
const plan = (findingId, operations, requiredRelationshipApis = operations.filter(op => op.requiredApi).map(op => op.requiredApi), dto = 'TaskDTO.java') => ({ findingId, remediationIntent: 'DTO entity mapping with explicit relationship semantics', filesToCreate: [`src/main/java/com/pfe/devsecops/dto/${dto}`], relationshipOperations: operations, requiredRelationshipApis });
const prepared = proofs => ({ remediationContract: { sourceGrounding: { groundedRelationshipApis: proofs } } });
const validate = (plans, proofs = [userProof]) => new Function('prepared', 'normalized', realValidation)(prepared(proofs), plans);
const blocks = (plans, proofs) => assert.throws(() => validate(plans, proofs), /SOURCE_API_CONTEXT_INCOMPLETE/);

// Execution 2013's actual malformed shape remains blocked: owner type was put in the old ambiguous field.
blocks([plan('execution-2013-malformed-create', [{ entityType: 'Task', field: 'user', operation: 'RESOLVE_BY_ID', requiredApi: api(userProof) }])]);
blocks([plan('execution-2013-malformed-update', [{ entityType: 'Task', field: 'user', operation: 'PRESERVE', requiredApi: null }], [])]);
// Corrected execution 2013, execution 2012 and execution 2010 equivalent shapes.
assert.doesNotThrow(() => validate([plan('b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', [resolve(userProof)]), plan('f11d4686-a7ba-4c0c-abbb-a12998c57220', [preserve(userProof)], [])]));
assert.doesNotThrow(() => validate([plan('b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', [resolve(userProof)], undefined, 'TaskRequestDTO.java'), plan('f11d4686-a7ba-4c0c-abbb-a12998c57220', [preserve(userProof)], [], 'TaskResponseDTO.java')]));
// Two grounded relationships, only User touched: Project remains available but not required.
assert.doesNotThrow(() => validate([plan('user-only', [resolve(userProof)])], [userProof, projectProof]));
blocks([plan('null-api', [{ ...resolve(userProof), requiredApi: null }], [])]);
const fabricated = { ...api(userProof), repositoryType: 'com.pfe.devsecops.repository.FakeRepository' };
blocks([plan('fabricated-operation', [{ ...resolve(userProof), requiredApi: fabricated }], [fabricated])]);
blocks([plan('missing-declaration', [resolve(userProof)], [])]);
blocks([plan('preserve-with-api', [{ ...preserve(userProof), requiredApi: api(userProof) }], [api(userProof)])]);
blocks([plan('orphan', [preserve(userProof)], [api(userProof)])]);
blocks([plan('fabricated-declaration', [resolve(userProof)], [fabricated])]);
blocks([plan('wrong-owner', [{ ...resolve(userProof), ownerPath: 'src/main/java/com/pfe/devsecops/model/Other.java' }])]);
blocks([plan('wrong-field', [{ ...resolve(userProof), field: 'project' }])]);
blocks([plan('owner-as-related-entity', [{ ...resolve(userProof), relatedEntityType: 'Task' }])]);
blocks([plan('simple-related-entity', [{ ...resolve(userProof), relatedEntityType: 'User' }])]);
blocks([plan('wrong-related-entity', [{ ...resolve(userProof), relatedEntityType: projectProof.entityType }])]);
for (const [key, value] of [['repositoryType', 'com.pfe.devsecops.repository.AccountRepository'], ['repositorySourcePath', 'src/main/java/com/pfe/devsecops/repository/AccountRepository.java'], ['entityType', 'com.pfe.devsecops.model.Account'], ['method', 'findUserById'], ['idType', 'String']]) {
  const wrong = { ...api(userProof), [key]: value };
  blocks([plan(`wrong-${key}`, [{ ...resolve(userProof), requiredApi: wrong }], [wrong])]);
}
assert.doesNotThrow(() => validate([plan('non-relationship', [], [])]));
assert.doesNotThrow(() => validate([plan('duplicate', [resolve(userProof), resolve(userProof)], [api(userProof), api(userProof)])]));

// Execute the real patch-body guard, including the unused Project proof.
const sourceGrounding = { initialPaths: [userProof.ownerPath], groundedRelationshipApis: [userProof, projectProof] };
const sourceApiContext = [{ file: userProof.ownerPath }, { file: userProof.repositorySourcePath }, { file: projectProof.repositorySourcePath }];
const relationships = [{ ownerPath: userProof.ownerPath, field: 'user', entityType: userProof.entityType }, { ownerPath: userProof.ownerPath, field: 'project', entityType: projectProof.entityType }];
const runPatchGuard = plans => new Function('$', 'sourceApiContext', 'plans', 'relationFields', 'javaInfo', realPatchGuard)(
  () => ({ first: () => ({ json: { remediationContract: { sourceGrounding } } }) }), sourceApiContext, plans,
  source => relationships.filter(relation => relation.ownerPath === source.path), (path, content) => ({ path, content }),
);
assert.doesNotThrow(() => runPatchGuard([plan('patch-user', [resolve(userProof)])]));
assert.doesNotThrow(() => runPatchGuard([plan('patch-preserve', [preserve(userProof)], [])]));
assert.throws(() => runPatchGuard([plan('patch-fabricated', [{ ...resolve(userProof), requiredApi: fabricated }], [fabricated])]), /SOURCE_API_CONTEXT_INCOMPLETE/);

assert.equal(workflow.id, 'u3eeMwTuhCsetfcS');
assert.equal(workflow.nodes.length, 155);
assert.equal(new Set(workflow.nodes.map(candidate => candidate.id)).size, 155);
console.log('PASS unambiguous relationship operations: execution 2013 malformed BLOCK/corrected PASS, executions 2010/2012 corrected, two-relation relevance, fail-closed identity/API matrix and real patch guard');
