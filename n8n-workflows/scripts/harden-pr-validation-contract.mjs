import fs from 'node:fs';

const root = new URL('../active/', import.meta.url);
const wf1Path = new URL('wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json', root);
const wf3Path = new URL('wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json', root);
const load = path => { const raw = JSON.parse(fs.readFileSync(path)); return Array.isArray(raw) ? raw[0] : raw; };
const save = (path, workflow) => fs.writeFileSync(path, JSON.stringify([workflow], null, 2) + '\n');
const node = (workflow, name) => workflow.nodes.find(candidate => candidate.name === name);

// R52 -- single source of truth for the Sonar credential reference, used by
// every Sonar HTTP node across WF1 and WF3. 'SONARQUBE credential 2'
// (httpBasicAuth) started failing Sonar auth with a real 401 (proven live on
// PR-24 build #4); replaced by the new, manually-created Header Auth
// credential 'n8n-sonarqube-api'. Never a raw token -- id/name reference only.
const SONAR_CREDENTIAL_TYPE = 'httpHeaderAuth';
const SONAR_CREDENTIAL = { id: 'DUFtkRTI3V05MJ3X', name: 'n8n-sonarqube-api' };

const required = [
  'validationRequestId','projectId','incidentId','fixRequestId','batchId','batchKey','attemptCount',
  'repository','prNumber','prHeadBranch','expectedPrHeadSha','checkoutSha','jenkinsJob','prValidationJob',
  'jenkinsBuildNumber','jenkinsBuildUrl','jenkinsStatus','ceTaskId','analysisId','requiredStages',
  // R45 -- explicit, always present, never inferred from missing fields.
  'sonarAnalysisMode',
];
// COMMUNITY_EXACT_SHA-only requirement: a dedicated per-PR project key was
// actually analyzed (Community Edition cannot run native PR analysis --
// proven on real PR-24 build #2). DEVELOPER_NATIVE_PR does not need these.
const communityRequired = ['baseSonarProjectKey', 'validationSonarProjectKey'];
const validModes = ['COMMUNITY_EXACT_SHA', 'DEVELOPER_NATIVE_PR'];

const validatorCode = `let input=$input.first().json; if(input.body) input=input.body;
const required=${JSON.stringify(required)};
const missing=required.filter(k=>input[k]===undefined||input[k]===null||input[k]===''||(k==='requiredStages'&&!Array.isArray(input[k])));
if(missing.length) throw new Error('INVALID_PR_VALIDATION_CONTRACT:'+missing.join(','));
const validModes=${JSON.stringify(validModes)};
if(!validModes.includes(input.sonarAnalysisMode)) throw new Error('INVALID_SONAR_ANALYSIS_MODE:'+input.sonarAnalysisMode);
if(input.sonarAnalysisMode==='COMMUNITY_EXACT_SHA'){
  const communityRequired=${JSON.stringify(communityRequired)};
  const communityMissing=communityRequired.filter(k=>input[k]===undefined||input[k]===null||input[k]==='');
  if(communityMissing.length) throw new Error('INVALID_PR_VALIDATION_CONTRACT:'+communityMissing.join(','));
}
const sha=v=>/^[a-f0-9]{40}$/i.test(String(v||''));
if(!sha(input.expectedPrHeadSha)||!sha(input.checkoutSha)||String(input.expectedPrHeadSha).toLowerCase()!==String(input.checkoutSha).toLowerCase()) throw new Error('PR_HEAD_SHA_MISMATCH');
if(!Number.isInteger(Number(input.attemptCount))||Number(input.attemptCount)<1) throw new Error('INVALID_ATTEMPT');
if(!Number.isInteger(Number(input.prNumber))||Number(input.prNumber)<1) throw new Error('INVALID_PR_NUMBER');
return [{json:input}];`;

const wf1 = load(wf1Path);
let wf1Validator = node(wf1, 'Validate PR Validation Contract');
if (!wf1Validator) {
  wf1Validator = { id:'wf1-validate-pr-contract', name:'Validate PR Validation Contract', type:'n8n-nodes-base.code', typeVersion:2, position:[2464,-96], parameters:{jsCode:validatorCode} };
  wf1.nodes.push(wf1Validator);
} else wf1Validator.parameters.jsCode = validatorCode;
wf1.connections['Is PR Validation'].main[0] = [{node:'Validate PR Validation Contract',type:'main',index:0}];
wf1.connections['Validate PR Validation Contract'] = {main:[[{node:'Call WF3 - Post-PR Validation',type:'main',index:0}]]};
node(wf1, 'Call WF3 - Post-PR Validation').parameters.workflowInputs.value.payload = '={{ JSON.stringify($json) }}';

// R52 -- the SonarQube credential 'SONARQUBE credential 2' (httpBasicAuth)
// started failing Sonar auth (401 "Authorization failed", proven live on
// real PR-24 build #4). Rewire to the new, manually-created Header Auth
// credential 'n8n-sonarqube-api'. Same builder as the WF3 nodes below --
// keep both in sync here, one source of truth for the Sonar credential.
const wf1SonarNode = node(wf1, 'Fetch SonarQube Issues');
wf1SonarNode.parameters.genericAuthType = SONAR_CREDENTIAL_TYPE;
wf1SonarNode.credentials = { [SONAR_CREDENTIAL_TYPE]: SONAR_CREDENTIAL };
save(wf1Path, wf1);

const wf3 = load(wf3Path);
node(wf3, 'Extract Validation Context').parameters.jsCode = `let input=$input.first().json;if(input.payload)input=typeof input.payload==='string'?JSON.parse(input.payload):input.payload;if(input.body)input=input.body;
const required=${JSON.stringify(required)};const missing=required.filter(k=>input[k]===undefined||input[k]===null||input[k]===''||(k==='requiredStages'&&!Array.isArray(input[k])));if(missing.length)throw new Error('INVALID_VALIDATION_CONTRACT:'+missing.join(','));
const validModes=${JSON.stringify(validModes)};if(!validModes.includes(input.sonarAnalysisMode))throw new Error('INVALID_SONAR_ANALYSIS_MODE:'+input.sonarAnalysisMode);
if(input.sonarAnalysisMode==='COMMUNITY_EXACT_SHA'){const communityRequired=${JSON.stringify(communityRequired)};const communityMissing=communityRequired.filter(k=>input[k]===undefined||input[k]===null||input[k]==='');if(communityMissing.length)throw new Error('INVALID_VALIDATION_CONTRACT:'+communityMissing.join(','));}
const fullSha=v=>/^[a-f0-9]{40}$/i.test(String(v||''));if(!fullSha(input.expectedPrHeadSha)||!fullSha(input.checkoutSha)||String(input.expectedPrHeadSha).toLowerCase()!==String(input.checkoutSha).toLowerCase())throw new Error('PR_HEAD_SHA_MISMATCH');
const repository=String(input.repository).replace(/^https?:\\/\\/github\\.com\\//,'').replace(/\\.git$/,'').toLowerCase();if(repository.split('/').length!==2)throw new Error('INVALID_REPOSITORY');
return [{json:{...input,repository,prNumber:Number(input.prNumber),attemptCount:Number(input.attemptCount),buildNumber:Number(input.jenkinsBuildNumber),buildUrl:String(input.jenkinsBuildUrl),jenkinsStatus:String(input.jenkinsStatus).toUpperCase(),expectedPrHeadSha:String(input.expectedPrHeadSha).toLowerCase(),checkoutSha:String(input.checkoutSha).toLowerCase(),requiredStages:input.requiredStages}}];`;

node(wf3, 'Get Incident From DB').parameters.query = `SELECT i.id, i."projectId", i."prUrl", i."jenkinsJobName", i."buildNumber", i.metadata, p."sonarqubeKey"
FROM incidents i JOIN projects p ON p.id=i."projectId"
WHERE i.id = '{{ $("Extract Validation Context").first().json.incidentId }}'
AND i."projectId" = '{{ $("Extract Validation Context").first().json.projectId }}'
AND lower(regexp_replace(p."githubRepo", '^(https?://github.com/)?|[.]git$', '', 'g')) = '{{ $("Extract Validation Context").first().json.repository }}'
AND i."prUrl" LIKE '%/' || '{{ $("Extract Validation Context").first().json.repository }}' || '/pull/' || '{{ $("Extract Validation Context").first().json.prNumber }}'
AND i.metadata->'fixRequest'->>'requestId' = '{{ $("Extract Validation Context").first().json.fixRequestId }}'
AND i.metadata->'fixRequest'->>'batchId' = '{{ $("Extract Validation Context").first().json.batchId }}'
AND COALESCE(i.metadata->'fixRequest'->>'batchKey',i.metadata->'fixRequest'->>'batchId') = '{{ $("Extract Validation Context").first().json.batchKey }}'
AND (i.metadata->'fixRequest'->>'attemptCount')::int = {{ $("Extract Validation Context").first().json.attemptCount }}
AND i.metadata->'prValidationRequest'->>'validationRequestId' = '{{ $("Extract Validation Context").first().json.validationRequestId }}'
AND lower(i.metadata->'prValidationRequest'->>'expectedPrHeadSha') = '{{ $("Extract Validation Context").first().json.expectedPrHeadSha }}'
LIMIT 1;`;

// R45 -- Community mode analyzed a dedicated per-PR project (isolated from
// the main project's history), never native PR-scoped issues. Search that
// project's plain (non-PR-scoped) open issues instead of componentKeys=
// <main project>&pullRequest=<n>, which is itself a Developer-only Sonar
// feature and meaningless here (the validation project never has more than
// one exact-SHA snapshot in it). Developer mode is unchanged.
node(wf3, 'Prepare Approved Finding Validation').parameters.jsCode = `const incident=$input.first().json||{};let metadata=incident.metadata||{};if(typeof metadata==='string')metadata=JSON.parse(metadata);const fix=metadata.fixRequest||{};const findings=Array.isArray(fix.findings)?fix.findings:[];const findingIds=Array.isArray(fix.findingIds)?fix.findingIds.map(String):[];if(!findingIds.length||findings.length!==findingIds.length)throw new Error('APPROVED_FINDING_BATCH_UNAVAILABLE');
const ctx=$('Extract Validation Context').first().json;const mode=ctx.sonarAnalysisMode;const pr=ctx.prNumber;
let projectKey;let url;
if(mode==='COMMUNITY_EXACT_SHA'){
  projectKey=String(ctx.validationSonarProjectKey||'');if(!projectKey)throw new Error('SONAR_VALIDATION_PROJECT_KEY_UNAVAILABLE');
  const rules=[...new Set(findings.map(f=>f.rule).filter(Boolean))];
  url='http://sonarqube:9000/api/issues/search?componentKeys='+encodeURIComponent(projectKey)+'&rules='+encodeURIComponent(rules.join(','))+'&ps=500';
}else{
  projectKey=String(incident.sonarqubeKey||'');if(!projectKey)throw new Error('SONAR_PROJECT_KEY_UNAVAILABLE');
  const rules=[...new Set(findings.map(f=>f.rule).filter(Boolean))];
  url='http://sonarqube:9000/api/issues/search?componentKeys='+encodeURIComponent(projectKey)+'&pullRequest='+encodeURIComponent(pr)+'&rules='+encodeURIComponent(rules.join(','))+'&ps=500';
}
return [{json:{url,findings,findingIds,analysisId:ctx.analysisId,sonarAnalysisMode:mode,validationSonarProjectKey:projectKey}}];`;

// R45 -- evidence wording never claims native PR analysis when Community
// exact-SHA mode ran (WF3 must explicitly know analysisMode, per contract).
node(wf3, 'Consolidate Validation Result').parameters.jsCode = `const ctx=$('Extract Validation Context').first().json;let incident={};try{incident=$('Get Incident From DB').first().json||{}}catch{};let sonar={};try{sonar=$('Get SonarQube PR Quality Gate').first().json||{}}catch{};let findingSearch={};try{findingSearch=$('Get SonarQube Approved Findings').first().json||{}}catch{};const prepared=$('Prepare Approved Finding Validation').first().json;
const analysisMode=ctx.sonarAnalysisMode;const analysisLabel=analysisMode==='COMMUNITY_EXACT_SHA'?'Sonar Community exact-SHA validation':'Sonar native PR analysis';
const sonarCorrelationVerified=!!ctx.ceTaskId&&!!ctx.analysisId&&!!sonar.projectStatus;const sonarStatus=sonarCorrelationVerified?String(sonar.projectStatus.status||'UNAVAILABLE').toUpperCase():'CORRELATION_PENDING';const requiredNames=['build','tests','sonar'];const missingStage=requiredNames.filter(name=>!ctx.requiredStages.some(s=>s.stage===name&&s.required===true));const requiredFailures=ctx.requiredStages.filter(s=>s.required!==false&&s.status!=='PASSED'&&!(s.status==='WARNING'&&!s.blocking));
const searchAvailable=Array.isArray(findingSearch.issues);const normalizeFile=value=>String(value||'').replace(/^[^:]+:/,'').replace(/^\\/+/, '');const openIssues=searchAvailable?findingSearch.issues:[];const findingResults=prepared.findings.map(f=>{if(!searchAvailable)return{findingId:String(f.findingId),rule:f.rule,result:'INCONCLUSIVE',evidence:analysisLabel+' issue search unavailable'};const match=openIssues.find(issue=>String(issue.rule||'')===String(f.rule||'')&&normalizeFile(issue.component).endsWith(normalizeFile(f.file))&&(!f.line||!issue.line||Number(issue.line)===Number(f.line)));return match?{findingId:String(f.findingId),rule:f.rule,result:'INVALID',evidence:analysisLabel+' issue '+String(match.key||match.rule)+' remains open'}:{findingId:String(f.findingId),rule:f.rule,result:'VALID',evidence:analysisLabel+' '+ctx.analysisId+' at '+ctx.checkoutSha+': approved finding absent'};});
const everyFindingValid=findingResults.length===prepared.findingIds.length&&findingResults.every(r=>r.result==='VALID');const shaVerified=ctx.expectedPrHeadSha===ctx.checkoutSha;const correlationVerified=!!incident?.id&&incident.id===ctx.incidentId&&sonarCorrelationVerified&&shaVerified;const passed=ctx.jenkinsStatus==='SUCCESS'&&sonarStatus==='OK'&&correlationVerified&&!missingStage.length&&!requiredFailures.length&&Number(ctx.unresolvedBlockingCount||0)===0&&everyFindingValid;const anyInvalid=findingResults.some(r=>r.result==='INVALID');
return [{json:{...ctx,findingResults,validationStatus:passed?'VALIDATED':anyInvalid?'INVALID':'INCONCLUSIVE',passed,sonarStatus,sonarAnalysisMode:analysisMode,sonarCorrelationVerified,correlationVerified,finalStateVerified:shaVerified,requiredStagesStatus:(!missingStage.length&&!requiredFailures.length)?'PASSED':'FAILED',failureReasons:[ctx.jenkinsStatus!=='SUCCESS'?'Jenkins='+ctx.jenkinsStatus:null,sonarStatus!=='OK'?'Sonar='+sonarStatus:null,!shaVerified?'PR HEAD mismatch':null,!correlationVerified?'Correlation unverified':null,!everyFindingValid?'Approved finding validation incomplete':null,...missingStage.map(s=>'Required stage missing='+s),...requiredFailures.map(s=>s.stage+'='+s.status)].filter(Boolean),timestamp:new Date().toISOString()}}];`;

// R49 -- both nodes were created with authentication:'predefinedCredentialType'
// but no credentials block was ever attached (proven live: real PR-24 build
// #3's WF3 execution 1896 -- both nodes errored "Credentials not found").
// R52 -- the httpBasicAuth credential wired in R49 subsequently started
// failing Sonar auth with a real 401 (proven live on build #4); rewired to
// the httpHeaderAuth SONAR_CREDENTIAL defined at the top of this file. Never
// a raw token -- reference by id only, exactly like n8n's own credential system.
for (const nodeName of ['Get SonarQube PR Quality Gate', 'Get SonarQube Approved Findings']) {
  const sonarNode = node(wf3, nodeName);
  sonarNode.parameters.nodeCredentialType = SONAR_CREDENTIAL_TYPE;
  sonarNode.credentials = { [SONAR_CREDENTIAL_TYPE]: SONAR_CREDENTIAL };
}

save(wf3Path, wf3);
