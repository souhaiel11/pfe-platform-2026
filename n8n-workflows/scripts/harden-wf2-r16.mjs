import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../active/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.json', import.meta.url);
const raw = JSON.parse(readFileSync(path, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;
const node = name => {
  const found = workflow.nodes.find(candidate => candidate.name === name);
  if (!found) throw new Error(`Missing WF2 node: ${name}`);
  return found;
};

const verifier = `const verifyFinding=(finding,content)=>{const findingId=String(finding.findingId||finding.id||finding.key||'');const rule=String(finding.rule||finding.ruleKey||'');const lines=String(content).split('\\n');if(rule==='java:S1068'){const identifier=String(finding.message||'').match(/["“”]([^"“”]+)["“”]/)?.[1]||'';if(!identifier)return {findingId,rule,resolved:false,evidence:'IDENTIFIER_MISSING'};const escaped=identifier.replace(/[^a-zA-Z0-9_]/g,'');const references=(String(content).match(new RegExp('\\\\b'+escaped+'\\\\b','g'))||[]).length;const typeName=identifier.charAt(0).toUpperCase()+identifier.slice(1);const obsoleteImport=new RegExp('^\\\\s*import\\\\s+[^;]*\\\\.'+typeName+'\\\\s*;','m').test(String(content));return {findingId,rule,resolved:references===0&&!obsoleteImport,evidence:{identifier,references,obsoleteImport}};}if(rule==='java:S125'){const line=Math.max(1,Number(finding.line)||1);const from=Math.max(0,line-13),to=Math.min(lines.length,line+12);const suspicious=lines.slice(from,to).filter(value=>/^\\s*\\/\\//.test(value)&&/\\.\\w+\\s*\\([^)]*\\)/.test(value.replace(/^\\s*\\/\\/\\s*/,'')));return {findingId,rule,resolved:suspicious.length===0,evidence:{window:[from+1,to],commentedCodeCandidates:suspicious}};}return {findingId,rule,resolved:false,evidence:'NO_DETERMINISTIC_VERIFIER'};};`;

const selector = node('Select Existing PR');
selector.parameters.jsCode = `const ctx=$('Prepare Batch Context').first().json;const raw=$input.all().map(item=>item.json);const candidates=raw.flatMap(value=>Array.isArray(value)?value:Array.isArray(value?.items)?value.items:value?.number?[value]:[]);const matching=candidates.filter(pr=>String(pr.state||'').toLowerCase()==='open'&&pr.head?.ref===ctx.targetBranchName&&pr.base?.ref===ctx.baseBranch&&pr.head?.repo?.full_name===ctx.githubRepo&&pr.base?.repo?.full_name===ctx.githubRepo&&String(pr.body||'').includes(ctx.batchId));if(matching.length>1)throw new Error('DUPLICATE_BATCH_PR');return [{json:{existingPr:matching[0]||null,createRequired:matching.length===0,candidateCount:candidates.length,matchingCount:matching.length}}];`;

const prepare = node('Prepare - Code Patch Body');
prepare.parameters.jsCode = prepare.parameters.jsCode.replace(
  'const shortName    = fileName.split',
  `const approvedFindingsForFile=gate.findings.filter(f=>String(f.file||f.component||'')===fileName);\nconst approvedFindingIdsForFile=approvedFindingsForFile.map(f=>String(f.findingId||f.id||f.key)).sort();\nif(!approvedFindingIdsForFile.length)throw new Error('FILE_WITHOUT_APPROVED_FINDINGS:'+fileName);\n${verifier}\nconst validationEvidence=approvedFindingsForFile.map(f=>verifyFinding(f,fileContent));\nconst alreadyResolvedFindingIds=validationEvidence.filter(result=>result.resolved).map(result=>result.findingId).sort();\nif(alreadyResolvedFindingIds.length===approvedFindingIdsForFile.length){return {json:{requiresPatch:false,skipAutoFix:true,outcome:'ALREADY_REMEDIATED',file_sha:fileSha,file_path:fileName,targetFile:fileName,sourceContent:fileContent,repository_owner:gate.repository_owner||'',repository_name:gate.repository_name||'',default_branch:gate.default_branch,branchName:gate.targetBranchName,incidentId:gate.incidentId,projectId:gate.projectId,buildNumber:gate.buildNumber,attemptCount:gate.attemptCount,approvedFindingIdsForFile,approvedFindingsForFile,alreadyResolvedFindingIds,validationEvidence}};}\n\nconst shortName    = fileName.split`,
);
prepare.parameters.jsCode = prepare.parameters.jsCode.replace(
  "const approvedFindingsForFile=gate.findings.filter(f=>String(f.file||f.component||'')===fileName);\nconst approvedFindingIdsForFile=approvedFindingsForFile.map(f=>String(f.findingId||f.id||f.key)).sort();\nif(!approvedFindingIdsForFile.length)throw new Error('FILE_WITHOUT_APPROVED_FINDINGS:'+fileName);\n\nconst systemPrompt",
  'const systemPrompt',
);
prepare.parameters.jsCode = prepare.parameters.jsCode.replace(
  'claudeBodyString: JSON.stringify(body),',
  'requiresPatch: true,\n    claudeBodyString: JSON.stringify(body),\n    sourceContent: fileContent,\n    validationEvidence,\n    alreadyResolvedFindingIds,',
);

const parse = node('Parse - Code Patch Output');
parse.parameters.jsCode = parse.parameters.jsCode.replace(
  'targetFile, approvedFindingIds, processedFindingIds, oldSha: prepareNode.file_sha,',
  'targetFile, approvedFindingIds, approvedFindings: prepareNode.approvedFindingsForFile, processedFindingIds, oldSha: prepareNode.file_sha, sourceContent: prepareNode.sourceContent,',
);

const build = node('Build File Result');
build.parameters.jsCode = `${verifier}const update=$json;const patch=$('Parse - Code Patch Output').item.json;const commitSha=String(update.commit?.sha||'');const newSha=String(update.content?.sha||'');if(!commitSha||!newSha)throw new Error('FILE_UPDATE_EVIDENCE_MISSING');const validationEvidence=(patch.approvedFindings||[]).map(f=>verifyFinding(f,patch.patchedCode));const effectiveRemediatedFindingIds=validationEvidence.filter(result=>result.resolved).map(result=>result.findingId).sort();const expected=[...new Set((patch.approvedFindingIds||[]).map(String))].sort();if(JSON.stringify(effectiveRemediatedFindingIds)!==JSON.stringify(expected))throw new Error('EFFECTIVE_REMEDIATION_INCOMPLETE:'+patch.targetFile);return {json:{targetFile:patch.targetFile,approvedFindingIds:expected,processedFindingIds:patch.processedFindingIds,changedInThisAttemptFindingIds:patch.processedFindingIds,effectiveRemediatedFindingIds,validationEvidence,outcome:'MODIFIED_AND_REMEDIATED',finalStateVerified:true,updateApplied:true,oldSha:patch.oldSha,newSha,commitSha}};`;

const completeness = node('Validate Batch Completeness');
completeness.parameters.jsCode = `const ctx=$('Prepare Batch Context').first().json;const results=$input.all().map(i=>i.json);const norm=v=>[...new Set((v||[]).map(String))].sort();const expectedFindingIds=norm(ctx.findingIds);const expectedTargetFiles=norm(ctx.targetFiles);const processedFindingIds=norm(results.flatMap(r=>r.processedFindingIds||[]));const effectiveRemediatedFindingIds=norm(results.flatMap(r=>r.effectiveRemediatedFindingIds||[]));const verifiedFiles=norm(results.filter(r=>r.finalStateVerified).map(r=>r.targetFile));const resultFiles=norm(results.map(r=>r.targetFile));const unexpectedFindingIds=effectiveRemediatedFindingIds.filter(id=>!expectedFindingIds.includes(id));const missingFindingIds=expectedFindingIds.filter(id=>!effectiveRemediatedFindingIds.includes(id));const unexpectedFiles=resultFiles.filter(file=>!expectedTargetFiles.includes(file));const missingFiles=expectedTargetFiles.filter(file=>!verifiedFiles.includes(file));const failedFileOperations=results.filter(r=>!r.finalStateVerified||r.outcome==='FAILED').map(r=>r.targetFile);const pass=!missingFindingIds.length&&!unexpectedFindingIds.length&&!missingFiles.length&&!unexpectedFiles.length&&!failedFileOperations.length&&results.length===expectedTargetFiles.length;if(!pass)throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({missingFindingIds,unexpectedFindingIds,missingFiles,unexpectedFiles,failedFileOperations}));return [{json:{completenessPassed:true,expectedFindingIds,expectedTargetFiles,processedFindingIds,effectiveRemediatedFindingIds,verifiedFiles,updatedFiles:verifiedFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results}}];`;

const buildAlready = {
  id: 'wf2-build-already-remediated-result', name: 'Build Already Remediated Result',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [-2368, 3888], onError: 'continueErrorOutput',
  parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const prepared=$json;const expected=[...new Set((prepared.approvedFindingIdsForFile||[]).map(String))].sort();const effective=[...new Set((prepared.alreadyResolvedFindingIds||[]).map(String))].sort();if(JSON.stringify(expected)!==JSON.stringify(effective))throw new Error('ALREADY_REMEDIATED_EVIDENCE_MISMATCH');return {json:{targetFile:prepared.targetFile,approvedFindingIds:expected,processedFindingIds:[],changedInThisAttemptFindingIds:[],alreadyResolvedFindingIds:effective,effectiveRemediatedFindingIds:effective,validationEvidence:prepared.validationEvidence,outcome:'ALREADY_REMEDIATED',finalStateVerified:true,updateApplied:false,oldSha:prepared.file_sha,newSha:prepared.file_sha,commitSha:null}};` },
};
const requiresPatch = {
  id: 'wf2-file-requires-patch', name: 'File Requires Patch?', type: 'n8n-nodes-base.if', typeVersion: 2.3,
  position: [-2336, 3616], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: 'requires-patch', leftValue: '={{ $json.requiresPatch }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' }, options: {} },
};
const merge = {
  id: 'wf2-merge-effective-file-results', name: 'Merge Effective File Results', type: 'n8n-nodes-base.merge',
  typeVersion: 3.2, position: [-2000, 3712], parameters: {},
};
for (const added of [requiresPatch, buildAlready, merge]) if (!workflow.nodes.some(existing => existing.name === added.name)) workflow.nodes.push(added);

workflow.connections['Prepare - Code Patch Body'].main[0] = [{ node: 'File Requires Patch?', type: 'main', index: 0 }];
workflow.connections['File Requires Patch?'] = { main: [
  [{ node: 'de Patch - HTTP Request', type: 'main', index: 0 }],
  [{ node: 'Build Already Remediated Result', type: 'main', index: 0 }],
] };
workflow.connections['Build Already Remediated Result'] = { main: [
  [{ node: 'Merge Effective File Results', type: 'main', index: 1 }],
  [{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }],
] };
workflow.connections['Build File Result'].main[0] = [{ node: 'Merge Effective File Results', type: 'main', index: 0 }];
workflow.connections['Merge Effective File Results'] = { main: [[{ node: 'Validate Batch Completeness', type: 'main', index: 0 }]] };

const success = node('Save Execution Result to Backend');
let serialized = JSON.stringify(success.parameters);
serialized = serialized.replace(
  "processedFindingIds: $('Validate Batch Completeness').first().json.processedFindingIds, updatedFiles: $('Validate Batch Completeness').first().json.updatedFiles, commitShas:",
  "processedFindingIds: $('Validate Batch Completeness').first().json.processedFindingIds, effectiveRemediatedFindingIds: $('Validate Batch Completeness').first().json.effectiveRemediatedFindingIds, verifiedFiles: $('Validate Batch Completeness').first().json.verifiedFiles, fileResults: $('Validate Batch Completeness').first().json.fileResults, updatedFiles: $('Validate Batch Completeness').first().json.updatedFiles, commitShas:",
);
success.parameters = JSON.parse(serialized);

writeFileSync(path, `${JSON.stringify(Array.isArray(raw) ? [workflow] : workflow, null, 2)}\n`);
