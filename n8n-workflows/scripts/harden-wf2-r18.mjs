import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../active/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.json', import.meta.url);
const raw = JSON.parse(readFileSync(path, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;
const node = name => {
  const found = workflow.nodes.find(candidate => candidate.name === name);
  if (!found) throw new Error(`Missing WF2 node: ${name}`);
  return found;
};
const add = candidate => {
  if (!workflow.nodes.some(existing => existing.name === candidate.name)) workflow.nodes.push(candidate);
};

const verifier = `const verifyFinding=(finding,content)=>{const findingId=String(finding.findingId||finding.id||finding.key||'');const rule=String(finding.rule||finding.ruleKey||'');const lines=String(content).split('\\n');if(rule==='java:S1068'){const identifier=String(finding.message||'').match(/["“”]([^"“”]+)["“”]/)?.[1]||'';if(!identifier)return {findingId,rule,resolved:false,evidence:'IDENTIFIER_MISSING'};const escaped=identifier.replace(/[^a-zA-Z0-9_]/g,'');const references=(String(content).match(new RegExp('\\\\b'+escaped+'\\\\b','g'))||[]).length;const typeName=identifier.charAt(0).toUpperCase()+identifier.slice(1);const obsoleteImport=new RegExp('^\\\\s*import\\\\s+[^;]*\\\\.'+typeName+'\\\\s*;','m').test(String(content));return {findingId,rule,resolved:references===0&&!obsoleteImport,evidence:{identifier,references,obsoleteImport,remainingViolations:[references?identifier:null,obsoleteImport?'IMPORT_'+typeName:null].filter(Boolean)}};}if(rule==='java:S125'){const line=Math.max(1,Number(finding.line)||1);const from=Math.max(0,line-13),to=Math.min(lines.length,line+12);const suspicious=lines.slice(from,to).filter(value=>/^\\s*\\/\\//.test(value)&&/\\.\\w+\\s*\\([^)]*\\)/.test(value.replace(/^\\s*\\/\\/\\s*/,'')));return {findingId,rule,resolved:suspicious.length===0,evidence:{window:[from+1,to],commentedCodeCandidates:suspicious,remainingViolations:suspicious}};}return {findingId,rule,resolved:false,evidence:{reason:'NO_DETERMINISTIC_VERIFIER',remainingViolations:['VALIDATION_EVIDENCE_INSUFFICIENT']}};};`;

// Give the model the retry-specific evidence that was previously only used by
// the pre-check. This is rule-aware and contains no finding UUID special case.
const prepare = node('Prepare - Code Patch Body');
if (!prepare.parameters.jsCode.includes('ETAT FINAL ACTUEL DES FINDINGS')) {
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace(
    '=== FIN DU CONTENU ===\n\n${fixContext}',
    '=== FIN DU CONTENU ===\n\n' +
      'ETAT FINAL ACTUEL DES FINDINGS (preuve deterministe sur la branche courante) :\n' +
      '${JSON.stringify(validationEvidence)}\n\n' +
      'Pour java:S1068, supprime aussi toute dependance devenue obsolete liee au champ inutilise : parametre de constructeur, affectation et import, uniquement lorsqu\'ils n\'ont plus aucun usage. Le candidat final doit contenir zero reference a l\'identifiant inutilise et aucun import devenu obsolete.\n\n' +
      '${fixContext}',
  );
}

const validateCandidate = {
  id: 'wf2-validate-candidate-remediation', name: 'Validate Candidate Remediation',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [-2496, 3552],
  onError: 'continueErrorOutput',
  parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `${verifier}
const patch=$json;const expected=[...new Set((patch.approvedFindingIds||[]).map(String))].sort();const validationEvidence=(patch.approvedFindings||[]).map(f=>verifyFinding(f,patch.patchedCode));const effective=validationEvidence.filter(result=>result.resolved).map(result=>result.findingId).sort();const remainingViolations=validationEvidence.filter(result=>!result.resolved).map(result=>({findingId:result.findingId,rule:result.rule,evidence:result.evidence}));if(JSON.stringify(expected)!==JSON.stringify(effective)){throw new Error('WF2_PATCH_NOT_EFFECTIVE:'+JSON.stringify({targetFile:patch.targetFile,remainingViolations}));}
const normalizeS1068=(content,finding)=>{const identifier=String(finding.message||'').match(/["“”]([^"“”]+)["“”]/)?.[1]||'';if(!identifier)return String(content);const escaped=identifier.replace(/[^a-zA-Z0-9_]/g,'');const typeName=identifier.charAt(0).toUpperCase()+identifier.slice(1);return String(content).replace(new RegExp('^\\\\s*import\\\\s+[^;]*\\\\.'+typeName+'\\\\s*;\\\\s*','gm'),'').replace(new RegExp('^.*\\\\bprivate\\\\b.*\\\\b'+escaped+'\\\\b.*;\\\\s*$','gm'),'').replace(new RegExp('^.*\\\\bthis\\\\.'+escaped+'\\\\s*=\\\\s*'+escaped+'\\\\s*;\\\\s*$','gm'),'').replace(new RegExp('\\\\b[A-Za-z0-9_$.<>?]+\\\\s+'+escaped+'\\\\b\\\\s*,?','g'),'').replace(/\\(\\s*,/g,'(').replace(/,\\s*\\)/g,')').replace(/,\\s*,/g,',').replace(/\\\\s+/g,'');};
for(const finding of patch.approvedFindings||[]){if(String(finding.rule||finding.ruleKey||'')==='java:S1068'&&normalizeS1068(patch.sourceContent,finding)!==normalizeS1068(patch.patchedCode,finding))throw new Error('WF2_PATCH_SCOPE_VIOLATION:'+patch.targetFile);}
return {json:{...patch,candidateValidationPassed:true,validationEvidence,effectiveRemediatedFindingIds:effective,finalStateVerified:true}};` },
};
add(validateCandidate);
node('Validate Candidate Remediation').parameters = validateCandidate.parameters;

// The GitHub edit error is classified first. Definite pre-connection DNS
// failures terminate precisely; ambiguous transport failures are read back.
const classify = {
  id: 'wf2-classify-github-write-error', name: 'Classify GitHub Write Error',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [-2176, 3712],
  parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const patch=$('Validate Candidate Remediation').item.json;const raw=$json.error||$json;const message=String(raw.message||$json.message||raw.description||'GitHub write transport failure').replace(/[\\r\\n]+/g,' ').slice(0,500);const code=String(raw.code||raw.errorCode||'');const dns=/EAI_AGAIN|ENOTFOUND|DNS server|name resolution|getaddrinfo/i.test(code+' '+message);return {json:{...patch,transportError:{code,message},requiresReadBack:!dns,failureCode:dns?'GITHUB_DNS_UNAVAILABLE':'GITHUB_WRITE_UNCERTAIN',failureNode:'Update File in Branch',failureSummary:message}};` },
};
const needsReadBack = {
  id: 'wf2-transport-requires-readback', name: 'Transport Requires Read Back?',
  type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [-2000, 3712],
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: 'readback', leftValue: '={{ $json.requiresReadBack }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' }, options: {} },
};
const readBack = JSON.parse(JSON.stringify(node('Fetch Repository Files')));
Object.assign(readBack, { id: 'wf2-readback-file-after-write-error', name: 'Read Back File After Write Error', position: [-1824, 3632] });
readBack.parameters.owner.value = `={{ $('Validate Candidate Remediation').item.json.repository_owner }}`;
readBack.parameters.repository.value = `={{ $('Validate Candidate Remediation').item.json.repository_name }}`;
readBack.parameters.filePath = `={{ $('Validate Candidate Remediation').item.json.file_path }}`;
readBack.parameters.additionalParameters.reference = `={{ $('Validate Candidate Remediation').item.json.branchName }}`;
const evaluateReadBack = {
  id: 'wf2-evaluate-write-reconciliation', name: 'Evaluate GitHub Write Reconciliation',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1648, 3632], onError: 'continueErrorOutput',
  parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const patch=$('Validate Candidate Remediation').item.json;const decoded=Buffer.from(String($json.content||'').replace(/\\n/g,''),'base64').toString('utf8');const normalize=value=>String(value).replace(/\\r\\n/g,'\\n');if(normalize(decoded)===normalize(patch.patchedCode))return {json:{...patch,reconciledWrite:true,newSha:String($json.sha||''),remoteState:'EXPECTED_CANDIDATE'}};if(normalize(decoded)===normalize(patch.sourceContent))return {json:{...patch,reconciledWrite:false,failureCode:'GITHUB_WRITE_UNCONFIRMED',failureNode:'Update File in Branch',failureSummary:'GitHub write failed and remote content is unchanged',remoteState:'UNCHANGED'}};return {json:{...patch,reconciledWrite:false,failureCode:'GITHUB_REMOTE_STATE_UNEXPECTED',failureNode:'Update File in Branch',failureSummary:'GitHub write failed and remote content differs from source and candidate',remoteState:'UNEXPECTED'}};` },
};
const candidatePresent = {
  id: 'wf2-remote-candidate-present', name: 'Remote Candidate Present?',
  type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [-1472, 3632],
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: 'reconciled', leftValue: '={{ $json.reconciledWrite }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' }, options: {} },
};
const lookupHead = JSON.parse(JSON.stringify(node('Lookup Remediation Branch')));
Object.assign(lookupHead, { id: 'wf2-lookup-head-after-reconciled-write', name: 'Lookup Head After Reconciled Write', position: [-1296, 3552] });
lookupHead.parameters.url = `=https://api.github.com/repos/{{ $('Validate Candidate Remediation').item.json.repository_owner }}/{{ $('Validate Candidate Remediation').item.json.repository_name }}/git/ref/heads/{{ encodeURIComponent($('Validate Candidate Remediation').item.json.branchName) }}`;
const buildReconciled = {
  id: 'wf2-build-reconciled-file-result', name: 'Build Reconciled File Result',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1120, 3552], onError: 'continueErrorOutput',
  parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const patch=$('Evaluate GitHub Write Reconciliation').item.json;const commitSha=String($json.body?.object?.sha||$json.object?.sha||'');if(!commitSha||!patch.newSha)throw new Error('RECONCILED_WRITE_EVIDENCE_MISSING');return {json:{targetFile:patch.targetFile,approvedFindingIds:patch.approvedFindingIds,processedFindingIds:patch.processedFindingIds,changedInThisAttemptFindingIds:patch.processedFindingIds,effectiveRemediatedFindingIds:patch.effectiveRemediatedFindingIds,validationEvidence:patch.validationEvidence,outcome:'MODIFIED_AND_REMEDIATED',finalStateVerified:true,updateApplied:true,reconciledWrite:true,oldSha:patch.oldSha,newSha:patch.newSha,commitSha}};` },
};
for (const candidate of [classify, needsReadBack, readBack, evaluateReadBack, candidatePresent, lookupHead, buildReconciled]) add(candidate);

workflow.connections['Parse - Code Patch Output'].main[0] = [{ node: 'Validate Candidate Remediation', type: 'main', index: 0 }];
workflow.connections['Validate Candidate Remediation'] = { main: [
  [{ node: 'Update File in Branch', type: 'main', index: 0 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };
workflow.connections['Update File in Branch'].main[1] = [{ node: 'Classify GitHub Write Error', type: 'main', index: 0 }];
workflow.connections['Classify GitHub Write Error'] = { main: [[{ node: 'Transport Requires Read Back?', type: 'main', index: 0 }]] };
workflow.connections['Transport Requires Read Back?'] = { main: [
  [{ node: 'Read Back File After Write Error', type: 'main', index: 0 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };
workflow.connections['Read Back File After Write Error'] = { main: [
  [{ node: 'Evaluate GitHub Write Reconciliation', type: 'main', index: 0 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };
workflow.connections['Evaluate GitHub Write Reconciliation'] = { main: [
  [{ node: 'Remote Candidate Present?', type: 'main', index: 0 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };
workflow.connections['Remote Candidate Present?'] = { main: [
  [{ node: 'Lookup Head After Reconciled Write', type: 'main', index: 0 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };
workflow.connections['Lookup Head After Reconciled Write'] = { main: [
  [{ node: 'Build Reconciled File Result', type: 'main', index: 0 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };
workflow.connections['Build Reconciled File Result'] = { main: [
  [{ node: 'Merge Effective File Results', type: 'main', index: 0 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };

// Successful writes consume the already validated candidate. There is no
// post-write discovery of an ineffective patch anymore.
const build = node('Build File Result');
build.parameters.jsCode = `const update=$json;const patch=$('Validate Candidate Remediation').item.json;const commitSha=String(update.commit?.sha||'');const newSha=String(update.content?.sha||'');if(!commitSha||!newSha)throw new Error('FILE_UPDATE_EVIDENCE_MISSING');return {json:{targetFile:patch.targetFile,approvedFindingIds:patch.approvedFindingIds,processedFindingIds:patch.processedFindingIds,changedInThisAttemptFindingIds:patch.processedFindingIds,effectiveRemediatedFindingIds:patch.effectiveRemediatedFindingIds,validationEvidence:patch.validationEvidence,outcome:'MODIFIED_AND_REMEDIATED',finalStateVerified:true,updateApplied:true,oldSha:patch.oldSha,newSha,commitSha}};`;

// Preserve precise, sanitized failure metadata supplied by transport and
// candidate gates while retaining the immutable envelope.
node('Prepare WF2 Failure Status').parameters.jsCode = `const input=$input.first().json||{};const captured=$items('Capture Correlation Envelope',0,0);const ctx=captured?.[0]?.json?.correlationEnvelope||{};const err=input.error||input;const rawSummary=String(input.failureSummary||err.message||input.message||input.reason||'workflow execution error');const summary=rawSummary.replace(/[\\r\\n]+/g,' ').slice(0,500);const embedded=rawSummary.match(/^(WF2_PATCH_NOT_EFFECTIVE|WF2_PATCH_SCOPE_VIOLATION|GITHUB_[A-Z_]+)/)?.[1];const failureCode=String(input.failureCode||embedded||'WF2_EXECUTION_ERROR').slice(0,120);const failureNode=String(input.failureNode||err.node?.name||err.context?.nodeCause||(failureCode==='WF2_PATCH_NOT_EFFECTIVE'?'Validate Candidate Remediation':'WF2')).slice(0,120);const required=['incidentId','requestId','batchId','batchKey','attemptCount'];const missing=required.filter(k=>ctx[k]===undefined||ctx[k]===null||ctx[k]==='');if(missing.length)throw new Error('FAILURE_CORRELATION_MISSING:'+missing.join(','));return [{json:{status:'FAILED',workflowId:ctx.workflowId,executionId:String($execution.id),incidentId:ctx.incidentId,requestId:ctx.requestId,batchId:ctx.batchId,batchKey:ctx.batchKey,attemptCount:ctx.attemptCount,failureCode,failureSummary:summary,failureNode}}];`;

writeFileSync(path, `${JSON.stringify(Array.isArray(raw) ? [workflow] : workflow, null, 2)}\n`);
