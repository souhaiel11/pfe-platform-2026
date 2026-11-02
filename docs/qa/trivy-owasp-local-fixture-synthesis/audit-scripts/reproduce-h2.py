import pathlib,subprocess,os,json,shutil
root=pathlib.Path('/home/souhaiel/pfe-2026/platform');lab=pathlib.Path('/tmp/remediation-fixture-lab');original=pathlib.Path('/tmp/remediation-fixture-candidate-10');results=[]
for n in [1,2]:
 wd=pathlib.Path(f'/tmp/remediation-fixture-h2-repro-{n}');wd.mkdir(exist_ok=False);shutil.copy(original/'pom.xml',wd/'pom.xml');shutil.copytree(original/'src',wd/'src');env=os.environ.copy();env['H2_PROOF_BASE']=str(wd)
 base=['mvn','-o','-B','-s',str(lab/'settings.xml'),'-Dmaven.repo.local='+str(lab/'m2'),'-Dstyle.color=never']
 goals=['clean','package','org.apache.maven.plugins:maven-dependency-plugin:3.3.0:copy-dependencies','-DincludeScope=runtime','-DoutputDirectory=target/runtime','org.apache.maven.plugins:maven-dependency-plugin:3.3.0:tree','-DoutputFile=dependency-tree.txt','org.apache.maven.plugins:maven-help-plugin:3.2.0:effective-pom','-Doutput=effective-pom.xml']
 def run(cmd,where,log):
  with open(where/log,'w') as output:p=subprocess.run(cmd,cwd=where,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=150)
  assert p.returncode==0,(cmd,where,log,p.returncode)
 run(base+goals,wd,'maven.log');run(['python3',str(lab/'scan-runtime.py'),str(wd)],wd,'scan-driver.log');run(['node',str(lab/'h2-proof.cjs'),'prepare'],wd,'prepare.log')
 candidate=pathlib.Path(str(wd)+'-patch');run(base+goals,candidate,'maven.log');run(['python3',str(lab/'scan-runtime.py'),str(candidate)],candidate,'scan-driver.log');run(['node',str(lab/'h2-proof.cjs'),'validate'],wd,'proof.log')
 proof=json.load(open(wd/'qualification.json'));results.append(proof);print('REPRO',n,proof['decision']['state'],proof['baselineFindingCount'],proof['candidateFindingCount'],flush=True)
keys=['package','currentVersion','cve','candidateVersion','targetFile','targetCoordinate','baselineFindingCount','candidateFindingCount','targetCollisionCount','baselineManifestSha256','candidateManifestSha256','facts','baselineTests','candidateTests']
for k in keys:assert results[0][k]==results[1][k],k
out=root/'docs/qa/trivy-owasp-local-fixture-synthesis/reproduction.json';out.write_text(json.dumps({'runs':results,'semanticResultsIdentical':True,'scope':'TRIVY real scanner + production local V1.8'},indent=2))
