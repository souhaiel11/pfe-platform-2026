// Audite les données de test et les traces du harnais de relance E2E.
require('ts-node').register({transpileOnly:true,project:require('path').resolve(__dirname,'../tsconfig.json')});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {canDispatchSecurityRemediationV1_8}=require('../src/dependency-compatibility/v1_8-security-remediation-gate');
const root=path.resolve(__dirname,'../src');
const decisions=Object.values(JSON.parse(fs.readFileSync(path.join(root,'dependency-compatibility/v1_8-evidence-store.json'))).decisions);
const cves=JSON.parse(fs.readFileSync(path.join(root,'common/fixtures/trivy-149-cves.json'))).cves;
const logback=JSON.parse(fs.readFileSync(path.join(root,'security-remediation/fixtures/v17/logback.json')));
const grouped=new Map();
for(const e of decisions.filter(e=>e.state==='VALIDATED_RECOMMENDED')){
 const context={repository:e.repository,commitSha:e.validatedCommitSha,source:e.findingSource,cve:e.cve,component:e.component,installedVersion:e.installedVersion,statusPermitsDispatch:true};
 const original=canDispatchSecurityRemediationV1_8(context,e);assert.equal(original.decision,'ALLOW');
 const proposed=canDispatchSecurityRemediationV1_8({...context,repository:'souhaiel11/remediation-retry-e2e-fixture'},e);assert.equal(proposed.decision,'BLOCK');
 const key=[e.component,e.installedVersion,e.recommendedVersion,e.editType].join('|');
 if(grouped.has(key))continue;
 const findings=[...new Set(cves.filter(c=>c.pkg===e.component).map(c=>c.id))];
 const rejection=[];
 if(findings.length>1)rejection.push('MULTIPLE_CVES_SHARE_DEPENDENCY_TARGET');
 if(e.editType==='PARENT_VERSION')rejection.push('PARENT_EDIT_NOT_SUPPORTED_BY_MINIMAL_HARNESS_FIXTURE');
 if(e.component==='ch.qos.logback:logback-classic'){
  const sameCvePackages=new Set();for(const r of logback.baseReport.Results||[])for(const v of r.Vulnerabilities||[])if(v.VulnerabilityID==='CVE-2023-6378')sameCvePackages.add(v.PkgName);
  assert.ok(sameCvePackages.has('ch.qos.logback:logback-core'));
  rejection.push('REAL_LOGBACK_PROOF_REQUIRES_SECOND_VULNERABLE_COMPONENT_OR_COORDINATED_EDIT');
 }
 rejection.push('NO_PROOF_FOR_NEW_REPOSITORY_AND_SHA');
 grouped.set(key,{package:e.component,vulnerableVersion:e.installedVersion,cve:e.cve,compatibleVersion:e.recommendedVersion,editType:e.editType,originalProofGate:original.decision,proposedFixtureGate:proposed.decision,proposedFixtureGateReason:proposed.reason,retainedScannerCves:findings,sourceEvidenceId:e.evidenceId,qualification:'REJECTED',reasons:rejection});
}
console.log(JSON.stringify({proposedRepository:'souhaiel11/remediation-retry-e2e-fixture',proposedProjectName:'remediation-retry-e2e-fixture',ecosystem:'MAVEN',existingRealPairsFound:true,acceptedDedicatedFixtures:[],candidates:[...grouped.values()]},null,2));
