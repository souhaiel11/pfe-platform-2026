import pathlib,re,shutil,json,hashlib,os
p=pathlib.Path(__file__).resolve().parent;repo=p.parents[2];log=(p/'build.log').read_text();tests=(p/'frontend-tests.log').read_text();assert '# fail 0' in tests and '# pass 29' in tests;assert 'qa-french-ui: PASS' in (p/'french-copy.log').read_text();assert 'Application bundle generation complete' in log
source=pathlib.Path(re.findall(r'OFFLINE_BUILD_ARTIFACT = (.+)',log)[-1])/'browser';assert (source/'index.html').is_file()
target=repo/'frontend/dist/devsecops-frontend/browser';backup=pathlib.Path('/tmp/jury-served-before');
if not backup.exists(): shutil.copytree(target,backup)
files=[]
for f in source.rglob('*'):
 if not f.is_file():continue
 rel=f.relative_to(source);files.append({'file':str(rel),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
 if rel==pathlib.Path('index.html'):continue
 dest=target/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,dest)
shutil.copy2(source/'index.html',target/'index.html.jury-new');os.replace(target/'index.html.jury-new',target/'index.html')
result={'artifact':str(source),'servedOrigin':'http://127.0.0.1:4200','indexSha256':hashlib.sha256((target/'index.html').read_bytes()).hexdigest(),'files':files,'backendRedeployed':False,'oldAssetsRetainedForOpenSessions':True}
(p/'frontend-release.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='files'}))
