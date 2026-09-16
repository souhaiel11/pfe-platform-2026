// Fix H: local artifact transformation only. No n8n import or business action.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';

export const inputBoundaryContract = ` Input-boundary behavior is part of the preserved contract. When replacing a strongly constrained input type with a more permissive representation, preserve the baseline's observable validation boundary; never move a deserialization or boundary-validation rejection into an unhandled business-layer exception. First determine from supplied source evidence whether the source field has a closed value domain. Prefer an independent DTO-owned type that preserves that closed domain without importing, reusing, or nesting a persistence type. Use a String or other more permissive DTO representation only when the remediation plan explicitly requires it AND supplied project evidence proves Bean Validation or an equivalent validator is active at the HTTP boundary for that field. Otherwise implement a grounded error path with observably equivalent acceptance, rejection, null, omission, case, and empty-value behavior. Preserve observed behavior rather than Java syntax. Do not invent validation dependencies, annotations, exception handlers, serialization settings, or project conventions.`;

export const reviewerPolicyContract = ` Classify every review claim as exactly PROVEN_DEFECT, VERIFICATION_REQUIRED, or NO_DEFECT. PROVEN_DEFECT requires direct supplied-source or deterministic evidence and is the only classification that may produce REJECTED. VERIFICATION_REQUIRED means a plausible but unproven risk; it may produce INCONCLUSIVE but must never be presented as a certain rejection. NO_DEFECT means the claim is refuted by supplied evidence. Apply these generic evidence rules without weakening real checks: (1) overloads with distinct parameter types are not ambiguous for a statically typed argument when only one overload is applicable; still identify real ambiguity involving null, varargs, boxing, inheritance/interfaces, generic erasure, or multiple applicable conversions; (2) every CREATE and MODIFY file in this complete candidate manifest is one compilation unit, so a type created in the same batch is available to siblings; still reject a dependency absent from the manifest or with a mismatched package/type; (3) an internal method that accepts or returns a persistence entity is not by itself external entity exposure; still reject an entity actually crossing a request body, response body, serialization, RPC, schema, or other external boundary; (4) a dependency-injection defect requires evidence of an incompatible instantiation, an absent bean, multiple ambiguous constructors, or an actually incompatible test/mock; a constructor change alone is not proof; (5) a PRESERVE relationship operation concerns only its exact grounded relationship identity field; changes to another field do not violate PRESERVE and must be assessed separately. Compare observable baseline and candidate dataflow: a syntactically explicit assignment is NO_DEFECT when it preserves an already client-controlled or otherwise identical baseline value. For every PROVEN_DEFECT provide the exact file, exact symbol, conflicting signatures, affected call site, violated plan rule, and concrete evidence. Never infer a compile failure when compilation evidence is unavailable: use VERIFICATION_REQUIRED.`;

export const reviewOutputSchema = {
  type: 'json_schema',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['verdict', 'findings'],
    properties: {
      verdict: {type: 'string', enum: ['ACCEPTABLE_FOR_SCANNER_VALIDATION', 'REJECTED', 'INCONCLUSIVE']},
      findings: {type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['finding', 'classification', 'file', 'symbol', 'conflictingSignatures', 'affectedCallSite', 'violatedPlanRule', 'evidence'],
        properties: {
          finding: {type: 'string'},
          classification: {type: 'string', enum: ['PROVEN_DEFECT', 'VERIFICATION_REQUIRED', 'NO_DEFECT']},
          file: {type: 'string'}, symbol: {type: 'string'},
          conflictingSignatures: {type: 'array', items: {type: 'string'}},
          affectedCallSite: {type: 'string'}, violatedPlanRule: {type: 'string'},
          evidence: {type: 'array', items: {type: 'string'}}
        }
      }}
    }
  }
};

export function hardenFixH(workflow) {
  const node = name => { const found=workflow.nodes.find(item=>item.name===name); assert.ok(found,name); return found; };
  const patch = node('Prepare - Code Patch Body').parameters;
  const inputBoundaryStatement=`llmRequestBody.system+=${JSON.stringify(inputBoundaryContract)};\n`;
  patch.jsCode=patch.jsCode.replaceAll(inputBoundaryStatement,'');
  const patchAnchor="if(!llmRequestBody||typeof llmRequestBody!=='object')";
  assert.ok(patch.jsCode.includes(patchAnchor),'patch prompt validation anchor missing');
  patch.jsCode=patch.jsCode.replace(patchAnchor,inputBoundaryStatement+patchAnchor);

  const manifest=node('Prepare Candidate Manifest').parameters;
  if (!manifest.jsCode.includes(reviewerPolicyContract)) {
    const anchor='const llmRequestBody = {...template, system: template.system + ';
    assert.ok(manifest.jsCode.includes(anchor),'batch review request anchor missing');
    manifest.jsCode=manifest.jsCode.replace(anchor,
      `const llmRequestBody = {...template, output_config:{format:${JSON.stringify(reviewOutputSchema)}}, system: template.system + ${JSON.stringify(reviewerPolicyContract)} + `);
  }

  const enforce=node('Enforce Independent Review').parameters;
  if (!enforce.jsCode.includes('REVIEW_CLASSIFICATION_POLICY_VIOLATION')) {
    const anchor="const verdict=String(review.verdict||'INCONCLUSIVE').toUpperCase();";
    assert.ok(enforce.jsCode.includes(anchor),'review verdict anchor missing');
    const guard=`const findings=Array.isArray(review.findings)?review.findings:[];const classes=new Set(['PROVEN_DEFECT','VERIFICATION_REQUIRED','NO_DEFECT']);if(findings.some(f=>!f||!classes.has(String(f.classification||'').toUpperCase())))throw new Error('INDEPENDENT_REVIEW_INCONCLUSIVE:'+JSON.stringify({category:'REVIEW_CLASSIFICATION_POLICY_VIOLATION'}));const proven=findings.filter(f=>String(f.classification).toUpperCase()==='PROVEN_DEFECT');const verification=findings.filter(f=>String(f.classification).toUpperCase()==='VERIFICATION_REQUIRED');const rejectionProofComplete=f=>String(f.file||'').trim()&&String(f.symbol||'').trim()&&Array.isArray(f.conflictingSignatures)&&f.conflictingSignatures.length>0&&String(f.affectedCallSite||'').trim()&&String(f.violatedPlanRule||'').trim()&&Array.isArray(f.evidence)&&f.evidence.length>0;if(proven.some(f=>!rejectionProofComplete(f)))throw new Error('INDEPENDENT_REVIEW_INCONCLUSIVE:'+JSON.stringify({category:'REVIEW_REJECTION_EVIDENCE_INCOMPLETE'}));`;
    enforce.jsCode=enforce.jsCode.replace(anchor,guard+anchor)
      .replace("if(verdict==='REJECTED')throw new Error('WF2_CANDIDATE_REJECTED:'+JSON.stringify(review.evidence||[]));if(verdict==='INCONCLUSIVE')throw new Error('WF2_MANUAL_REVIEW_REQUIRED:'+JSON.stringify(review.evidence||[]));",
        "if(verdict==='REJECTED'&&!proven.length)throw new Error('INDEPENDENT_REVIEW_INCONCLUSIVE:'+JSON.stringify({category:'REVIEW_CLASSIFICATION_POLICY_VIOLATION'}));if(verdict!=='REJECTED'&&proven.length)throw new Error('INDEPENDENT_REVIEW_INCONCLUSIVE:'+JSON.stringify({category:'REVIEW_CLASSIFICATION_POLICY_VIOLATION'}));if(verdict==='ACCEPTABLE_FOR_SCANNER_VALIDATION'&&verification.length)throw new Error('INDEPENDENT_REVIEW_INCONCLUSIVE:'+JSON.stringify({category:'REVIEW_CLASSIFICATION_POLICY_VIOLATION'}));if(verdict==='REJECTED')throw new Error('WF2_CANDIDATE_REJECTED:'+JSON.stringify(proven));if(verdict==='INCONCLUSIVE')throw new Error('WF2_MANUAL_REVIEW_REQUIRED:'+JSON.stringify(findings));");
    enforce.jsCode=enforce.jsCode.replace('independentReview:review.evidence||[]','independentReview:review.findings||[]');
  }
  enforce.jsCode=enforce.jsCode.replace('Array.isArray(f.conflictingSignatures)&&String',
    'Array.isArray(f.conflictingSignatures)&&f.conflictingSignatures.length>0&&String');
  assert.equal(workflow.nodes.length,155);
  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const artifact=new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url);
  const data=JSON.parse(readFileSync(artifact,'utf8'));
  hardenFixH(data[0]);
  writeFileSync(artifact,JSON.stringify(data,null,2)+'\n');
  console.log('Fix H local artifact updated: generation boundary + evidence-based reviewer policy; 155 nodes.');
}
