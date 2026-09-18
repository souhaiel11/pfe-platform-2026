// Offline Code-node policy tests. No model, network, n8n import, or business action.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  hardenFixH,
  inputBoundaryContract,
  reviewerPolicyContract,
  reviewOutputSchema,
} from './harden-wf2-fix-h-semantic-policy.mjs';

const artifact=JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url)))[0];
const node=name=>{const found=artifact.nodes.find(item=>item.name===name);assert.ok(found,name);return found;};
assert.equal(artifact.nodes.length,186);
assert.equal(new Set(artifact.nodes.map(item=>item.id)).size,186);
assert.deepEqual(hardenFixH(structuredClone(artifact)),artifact,'Fix H hardener must be idempotent');

const patchCode=node('Prepare - Code Patch Body').parameters.jsCode;
assert.ok(patchCode.includes(inputBoundaryContract));
for(const required of [
  'strongly constrained input type','observable validation boundary','closed value domain',
  'independent DTO-owned type','Bean Validation','active at the HTTP boundary',
  'acceptance, rejection, null, omission, case, and empty-value behavior',
  'Preserve observed behavior rather than Java syntax',
]) assert.match(inputBoundaryContract,new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
assert.doesNotMatch(inputBoundaryContract,/TaskStatus|TaskDTO|pfe-app-test/);

const manifestCode=node('Prepare Candidate Manifest').parameters.jsCode;
assert.ok(manifestCode.includes(reviewerPolicyContract));
for(const required of [
  'PROVEN_DEFECT','VERIFICATION_REQUIRED','NO_DEFECT','only classification that may produce REJECTED',
  'overloads with distinct parameter types','null, varargs, boxing','generic erasure',
  'one compilation unit','absent from the manifest','internal method','external entity exposure',
  'incompatible instantiation','absent bean','multiple ambiguous constructors',
  'PRESERVE relationship operation concerns only its exact grounded relationship identity field',
  'exact file','exact symbol','conflicting signatures','affected call site','violated plan rule',
]) assert.match(reviewerPolicyContract,new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
assert.doesNotMatch(reviewerPolicyContract,/TaskDTO|TaskStatus|TaskService/);
assert.deepEqual(reviewOutputSchema.schema.properties.verdict.enum,
  ['ACCEPTABLE_FOR_SCANNER_VALIDATION','REJECTED','INCONCLUSIVE']);
assert.deepEqual(reviewOutputSchema.schema.properties.findings.items.properties.classification.enum,
  ['PROVEN_DEFECT','VERIFICATION_REQUIRED','NO_DEFECT']);

const candidate={candidateSetComplete:true,llmRequestBody:{},reviewBodyString:'{}',files:[{
  path:'src/main/java/example/Boundary.java',approvedFindingIds:['finding'],validationEvidence:{},
}],_canonicalJson:'{}'};
const enforceCode=node('Enforce Independent Review').parameters.jsCode;
const runReview=review=>new Function('$json','$',enforceCode)(
  {content:[{type:'text',text:JSON.stringify(review)}],stop_reason:'end_turn'},
  name=>{assert.equal(name,'Prepare Candidate Manifest');return{first:()=>({json:candidate})};},
);
const finding=(name,classification,evidence=['supplied source'])=>({
  finding:name,classification,file:'src/main/java/example/Boundary.java',symbol:'Boundary#operation',
  conflictingSignatures:['Boundary#operation(Input)'],affectedCallSite:'Boundary#operation request boundary',
  violatedPlanRule:'preserve observable baseline behavior',evidence,
});

// Execution 2015 replay: seven reviewer claims are not proven defects. The two
// overload claims are separate findings; status validation is the sole proven defect.
const execution2015=[
  finding('distinct create overloads are ambiguous','NO_DEFECT',['distinct static parameter types select one applicable overload']),
  finding('distinct update overloads are ambiguous','NO_DEFECT',['distinct static parameter types select one applicable overload']),
  finding('create-time updated value assignment is semantic drift','NO_DEFECT',['baseline already accepted and retained the same client value']),
  finding('permissive DTO status loses boundary validation','PROVEN_DEFECT',['invalid closed-domain input moves from deserialization rejection to an unhandled business exception']),
  finding('retained internal entity methods expose the API','NO_DEFECT',['external request and response boundaries use the DTO']),
  finding('same-batch CREATE type is unavailable','NO_DEFECT',['the complete manifest is one compilation unit']),
  finding('constructor dependency necessarily breaks injection','NO_DEFECT',['no incompatible instantiation, absent bean, or ambiguous constructor is evidenced']),
  finding('mapping another field violates relationship PRESERVE','NO_DEFECT',['the exact grounded relationship field is untouched']),
];
assert.throws(()=>runReview({verdict:'REJECTED',findings:execution2015}),error=>{
  assert.match(error.message,/WF2_CANDIDATE_REJECTED/);
  assert.match(error.message,/permissive DTO status loses boundary validation/);
  assert.doesNotMatch(error.message,/distinct create overloads/);
  return true;
});
const falsePositives=execution2015.filter(item=>item.classification==='NO_DEFECT');
assert.doesNotThrow(()=>runReview({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',findings:falsePositives}));
assert.throws(()=>runReview({verdict:'REJECTED',findings:[finding('uncompiled risk','VERIFICATION_REQUIRED')]}),
  /REVIEW_CLASSIFICATION_POLICY_VIOLATION/);
assert.throws(()=>runReview({verdict:'INCONCLUSIVE',findings:[finding('uncompiled risk','VERIFICATION_REQUIRED')]}),
  /WF2_MANUAL_REVIEW_REQUIRED/);

// Legitimate non-regressions remain rejectable with concrete proof.
for(const defect of [
  finding('dependency type is absent from complete manifest','PROVEN_DEFECT',['imported package/type is absent from every supplied CREATE/MODIFY and baseline source']),
  finding('null call has two applicable overloads','PROVEN_DEFECT',['two unrelated reference overloads are both applicable to the null literal']),
  finding('persistence entity remains the response body','PROVEN_DEFECT',['controller signature returns the persistent entity at an external HTTP boundary']),
]) assert.throws(()=>runReview({verdict:'REJECTED',findings:[defect]}),/WF2_CANDIDATE_REJECTED/);

// Fail closed on an unsupported certainty or an incompletely evidenced rejection.
assert.throws(()=>runReview({verdict:'REJECTED',findings:falsePositives}),/REVIEW_CLASSIFICATION_POLICY_VIOLATION/);
const incomplete=finding('claimed defect','PROVEN_DEFECT');incomplete.affectedCallSite='';
assert.throws(()=>runReview({verdict:'REJECTED',findings:[incomplete]}),/REVIEW_REJECTION_EVIDENCE_INCOMPLETE/);
assert.throws(()=>runReview({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',findings:[finding('claimed defect','PROVEN_DEFECT')]}),
  /REVIEW_CLASSIFICATION_POLICY_VIOLATION/);

console.log('PASS Fix H: observable input-boundary generation contract, evidence taxonomy, execution-2015 replay, and legitimate rejection regressions');
