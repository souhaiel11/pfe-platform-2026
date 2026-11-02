import pathlib,tarfile,io,json,hashlib,subprocess,sys,os
w=pathlib.Path(sys.argv[1]);lab=pathlib.Path(os.environ.get('H2_AUDIT_LAB','/tmp/phase4g2-lab'))
layer=io.BytesIO()
with tarfile.open(fileobj=layer,mode='w') as t:
 for p in sorted((w/'target/runtime').glob('*.jar'))+sorted((w/'target').glob('*.jar')):
  b=p.read_bytes();n=('app/dependencies/' if p.parent.name=='runtime' else 'app/')+p.name;i=tarfile.TarInfo(n);i.size=len(b);t.addfile(i,io.BytesIO(b))
b=layer.getvalue();c=json.dumps({'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+hashlib.sha256(b).hexdigest()]}}).encode();name=hashlib.sha256(c).hexdigest()+'.json'
with tarfile.open(w/'image.tar','w') as t:
 for n,d in [(name,c),('layer.tar',b),('manifest.json',json.dumps([{'Config':name,'RepoTags':['offline-h2:fixture'],'Layers':['layer.tar']}]).encode())]:
  i=tarfile.TarInfo(n);i.size=len(d);t.addfile(i,io.BytesIO(d))
(w/'empty-ignore').write_text('');(w/'trivy-config.yaml').write_text('{}\n')
cmd=[str(lab/'trivy'),'image','--input',str(w/'image.tar'),'--cache-dir',str(lab/'trivy-cache'),'--scanners','vuln,misconfig','--config',str(w/'trivy-config.yaml'),'--ignorefile',str(w/'empty-ignore'),'--skip-db-update','--skip-java-db-update','--skip-check-update','--skip-version-check','--offline-scan','--list-all-pkgs','--exit-code','0','--format','json','--no-progress','--timeout','2m','--output',str(w/'trivy.json')]
with open(w/'trivy.log','w') as f:r=subprocess.run(cmd,stdout=f,stderr=f,timeout=140)
assert r.returncode==0
cmd=['mvn','-B','-s',str(lab/'settings.xml'),'-Dmaven.repo.local='+str(lab/'m2'),'org.owasp:dependency-check-maven:12.2.2:check','-Dformat=ALL','-DfailBuildOnCVSS=11','-DfailOnError=true','-DdataDirectory='+str(lab/'owasp-data'),'-DautoUpdate=false','-DretireJsAnalyzerEnabled=false','-DnodeAuditAnalyzerEnabled=false','-DossindexAnalyzerEnabled=false']
with open(w/'owasp.log','w') as f:r=subprocess.run(cmd,cwd=w,stdout=f,stderr=f,timeout=180)
assert r.returncode==0,('OWASP_SCAN_FAILED',w)
print(json.dumps({'workspace':str(w),'trivy':[(v['VulnerabilityID'],v['PkgName'],v.get('InstalledVersion'),v.get('FixedVersion')) for z in json.loads((w/'trivy.json').read_text()).get('Results',[]) for v in z.get('Vulnerabilities',[]) or []],'owasp':[(v['name'],d['fileName']) for d in json.loads((w/'target/dependency-check-report.json').read_text())['dependencies'] for v in d.get('vulnerabilities',[])]}))
