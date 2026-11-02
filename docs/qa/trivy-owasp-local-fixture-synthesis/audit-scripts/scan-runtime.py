import pathlib,io,tarfile,json,hashlib,subprocess,sys
wd=pathlib.Path(sys.argv[1]);lab=pathlib.Path('/tmp/remediation-fixture-lab');layer=io.BytesIO()
with tarfile.open(fileobj=layer,mode='w') as tar:
 for f in sorted((wd/'target/runtime').glob('*.jar')):
  data=f.read_bytes();t=tarfile.TarInfo('app/dependencies/'+f.name);t.size=len(data);t.mtime=0;tar.addfile(t,io.BytesIO(data))
 for f in sorted((wd/'target').glob('*.jar')):
  data=f.read_bytes();t=tarfile.TarInfo('app/'+f.name);t.size=len(data);t.mtime=0;tar.addfile(t,io.BytesIO(data))
data=layer.getvalue();config=json.dumps({'architecture':'amd64','os':'linux','rootfs':{'type':'layers','diff_ids':['sha256:'+hashlib.sha256(data).hexdigest()]}}).encode();name=hashlib.sha256(config).hexdigest()+'.json';manifest=json.dumps([{'Config':name,'RepoTags':['local-fixture:h2'],'Layers':['layer.tar']}]).encode()
with tarfile.open(wd/'image.tar','w') as tar:
 for n,d in [(name,config),('layer.tar',data),('manifest.json',manifest)]:
  t=tarfile.TarInfo(n);t.size=len(d);t.mtime=0;tar.addfile(t,io.BytesIO(d))
(wd/'empty-ignore').write_text('');(wd/'config.yaml').write_text('{}\n')
with open(wd/'trivy.log','w') as log:
 p=subprocess.run([str(lab/'trivy'),'image','--input',str(wd/'image.tar'),'--cache-dir',str(lab/'trivy-cache'),'--scanners','vuln,misconfig','--config',str(wd/'config.yaml'),'--ignorefile',str(wd/'empty-ignore'),'--skip-db-update','--skip-java-db-update','--skip-check-update','--skip-version-check','--offline-scan','--list-all-pkgs','--exit-code','0','--format','json','--no-progress','--timeout','2m','--output',str(wd/'trivy.json')],stdout=log,stderr=log)
assert p.returncode==0
r=json.load(open(wd/'trivy.json'));vs=[v for x in r.get('Results',[]) for v in x.get('Vulnerabilities',[]) or []];print([(v['PkgName'],v['VulnerabilityID'],v.get('FixedVersion')) for v in vs])
