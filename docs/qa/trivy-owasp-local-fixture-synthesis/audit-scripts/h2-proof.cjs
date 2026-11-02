const root='/home/souhaiel/pfe-2026/platform';require(root+'/backend/node_modules/ts-node').register({transpileOnly:true,project:root+'/backend/tsconfig.json'});
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert/strict');
const {resolveMavenProvenance}=require(root+'/backend/src/security-remediation/maven-provenance-resolver');
const {localMavenControls,deriveMavenRemediationScope,graphClosesScope}=require(root+'/backend/src/security-remediation/maven-remediation-scope');
const {cveTargets,trackedSourceDigest}=require(root+'/backend/src/security-remediation/security-artifact-scan');
const {computeGitBlobSha1}=require(root+'/backend/src/candidate-verification/candidate-digest');
const {writeSecurityPatch}=require(root+'/backend/src/security-remediation/maven-security-patch-writer');
const {gateCandidate,buildDependencyCompatibilityDecision}=require(root+'/backend/src/dependency-compatibility/dependency-compatibility-decision');
const {classifyCandidateVersionPolicy,isAutomationEligiblePolicy}=require(root+'/backend/src/dependency-compatibility/candidate-version-policy');
const {resolveDependencyControlProfile}=require(root+'/backend/src/dependency-compatibility/dependency-control-profile-resolver');
const {TrivyNativeFixedVersionProvider}=require(root+'/backend/src/dependency-compatibility/security-candidate-collector');
const {buildRemediationPlans}=require(root+'/backend/src/dependency-compatibility/remediation-plan');
const {aggregateSurefireReports}=require(root+'/candidate-verifier/src/surefire-aggregation');
const base=process.env.H2_PROOF_BASE||'/tmp/remediation-fixture-candidate-10',candidate=base+'-patch';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const source=fs.readFileSync(base+'/pom.xml','utf8');
function scan(w){const raw=fs.readFileSync(w+'/trivy.json');const report=JSON.parse(raw);return {mode:'TRIVY_IMAGE_ARCHIVE',report,buildPassed:fs.existsSync(w+'/target/surefire-reports/fixture.SmokeTest.txt'),scannerVersion:report.Trivy.Version,artifactDigest:sha(fs.readFileSync(w+'/image.tar')),reportDigest:sha(raw),sourceDigest:trackedSourceDigest(base)};}
if(process.argv[2]==='prepare'){
 cp.execFileSync('git',['-c','core.hooksPath=/dev/null','init','-q',base]);cp.execFileSync('git',['-C',base,'-c','core.hooksPath=/dev/null','add','pom.xml','src']);cp.execFileSync('git',['-C',base,'-c','core.hooksPath=/dev/null','-c','user.name=Offline Fixture Audit','-c','user.email=offline-fixture@invalid.local','commit','--allow-empty','-qm','H2 fixture provenance']);
 const commit=cp.execFileSync('git',['-C',base,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const p=resolveMavenProvenance({package:'com.h2database:h2',installedVersion:'2.1.212',pomXmlText:source,dependencyTreeText:fs.readFileSync(base+'/dependency-tree.txt','utf8'),controllingFilePath:'pom.xml',groundedSha:commit});assert.equal(p.kind,'DIRECT_EXPLICIT');
 const request={findingIdentity:'CVE-2022-45868:com.h2database:h2',evaluatedSha:commit,ecosystem:'MAVEN',provenanceKind:p.kind,package:p.package,installedVersion:p.installedVersion,targetVersion:'2.2.220',controllingFile:p.controllingFile,controllingElement:p.controllingElement,controllingProperty:p.controllingProperty,sourceContent:source};
 const a=writeSecurityPatch(request),b=writeSecurityPatch(request);assert.equal(a.ok,true);assert.deepEqual(a,b);
 fs.mkdirSync(candidate,{recursive:true});fs.cpSync(base+'/src',candidate+'/src',{recursive:true});fs.writeFileSync(candidate+'/pom.xml',a.candidate.file.content);fs.writeFileSync(base+'/patch-evidence.json',JSON.stringify({commit,provenance:p,request,patch:a},null,2));console.log('DETERMINISTIC_PATCH_GENERATED');
}else{
 const evidence=JSON.parse(fs.readFileSync(base+'/patch-evidence.json'));const bs=scan(base),cs=scan(candidate);const targets=cveTargets(bs,'CVE-2022-45868');assert.equal(targets.length,1);assert.equal(targets[0].package,'com.h2database:h2');assert.equal(cveTargets(cs,'CVE-2022-45868').length,0);
 const controls=localMavenControls(source,'com.h2database:h2','2.2.220');assert.equal(controls.length,1);
 const after=fs.readFileSync(candidate+'/pom.xml','utf8');
 const scope=deriveMavenRemediationScope(source,'com.h2database:h2','2.2.220','pom.xml',{targetCve:'CVE-2022-45868',evaluatedSha:evidence.commit,originalBlobSha:computeGitBlobSha1(source),baselineTree:fs.readFileSync(base+'/dependency-tree.txt','utf8'),baselineEffectivePom:fs.readFileSync(base+'/effective-pom.xml','utf8'),cveTargets:targets,experiments:[{control:controls[0],sourceSha256:sha(after),dependencyTree:fs.readFileSync(candidate+'/dependency-tree.txt','utf8'),effectivePom:fs.readFileSync(candidate+'/effective-pom.xml','utf8')}]});
 assert.equal(scope.kind,'SINGLE_CONTROL');assert.equal(scope.affectedPackages.length,1);assert.ok(graphClosesScope(fs.readFileSync(base+'/dependency-tree.txt','utf8'),fs.readFileSync(candidate+'/dependency-tree.txt','utf8'),scope));
 const baselineTests=aggregateSurefireReports(base),candidateTests=aggregateSurefireReports(candidate);assert.equal(baselineTests.total,1);assert.equal(candidateTests.total,1);assert.equal(candidateTests.failures+candidateTests.errors+candidateTests.skipped,0);
 const all=s=>(s.report.Results||[]).flatMap(x=>x.Vulnerabilities||[]);assert.equal(all(bs).length,1);assert.equal(all(cs).length,0);
 const versionPolicy=classifyCandidateVersionPolicy('2.1.212','2.2.220');
 const facts={candidateVersion:'2.2.220',actualEditTarget:'com.h2database:h2',existence:'AVAILABLE',resolvedVersion:scope.affectedPackages[0].targetVersion,dependencyResolution:'PASS',build:'PASS',tests:'PASS',securityRescan:'PASS',targetCveClosed:true,newHighCriticalCount:0,dependencyGraphDelta:['com.h2database:h2: 2.1.212 -> 2.2.220'],versionPolicy,automationEligible:isAutomationEligiblePolicy(versionPolicy)};
 const gate=gateCandidate(facts,'2.2.220');assert.equal(gate.status,'VALIDATED');
 const rawFinding=all(bs)[0];const candidates=new TrivyNativeFixedVersionProvider(rawFinding.FixedVersion).collect({cve:rawFinding.VulnerabilityID,pkg:rawFinding.PkgName,installedVersion:rawFinding.InstalledVersion});assert.equal(candidates.length,1);assert.equal(candidates[0].version,'2.2.220');
 const profile=resolveDependencyControlProfile({package:rawFinding.PkgName,installedVersion:rawFinding.InstalledVersion,pomXmlText:source,dependencyTreeText:fs.readFileSync(base+'/dependency-tree.txt','utf8'),controllingFilePath:'pom.xml',groundedSha:evidence.commit,effectivePomXmlText:fs.readFileSync(base+'/effective-pom.xml','utf8')});
 const plans=buildRemediationPlans(profile,candidates);const decision=buildDependencyCompatibilityDecision(rawFinding.PkgName,plans.plans,plans.manualReviewReason,[{...facts,...gate}]);assert.equal(decision.state,'VALIDATED_RECOMMENDED');assert.equal(decision.recommendedCandidate.candidateVersion,'2.2.220');
 const result={decision,profile,plans,candidates,package:'com.h2database:h2',currentVersion:'2.1.212',cve:'CVE-2022-45868',candidateVersion:'2.2.220',targetFile:'pom.xml',targetCoordinate:'com.h2database:h2',scannerVersion:bs.scannerVersion,baselineFindingCount:1,candidateFindingCount:0,targetCollisionCount:0,scope,baselineTests,candidateTests,v18Gate:gate,v18Decision:'ACCEPT',facts,baselineReportDigest:bs.reportDigest,candidateReportDigest:cs.reportDigest,baselineManifestSha256:sha(source),candidateManifestSha256:sha(after),localCommit:evidence.commit};fs.writeFileSync(base+'/qualification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
