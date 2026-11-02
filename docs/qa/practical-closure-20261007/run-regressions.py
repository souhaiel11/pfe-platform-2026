import pathlib,subprocess,json,os,concurrent.futures
root=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent;logs=out/'tests';logs.mkdir(exist_ok=True)
files={r['file'] for r in json.loads((root/'docs/qa/final-closure-r2-20261007/regressions-final.json').read_text())}
files.update(str(p.relative_to(root)) for p in (root/'candidate-verifier/src').glob('*.spec.ts'))
def test(rel):
 p=root/rel
 if not p.exists():p=pathlib.Path('/tmp/r2-qualified-backend-source')/rel
 component=next(x for x in p.parents if x.name==rel.split('/')[0]);env=dict(os.environ,TS_NODE_PROJECT=str(component/'tsconfig.json'),TS_NODE_TRANSPILE_ONLY='true');env.pop('NODE_TEST_CONTEXT',None)
 if rel.startswith('builder-scanner/'):
  cmd=['docker','run','--rm','--init','--network','none','--cap-add','SYS_ADMIN','--mount',f'type=bind,src={root},dst={root},readonly','--mount','type=bind,src=/home/souhaiel/pfe-2026/pfe-app-test,dst=/home/souhaiel/pfe-2026/pfe-app-test,readonly','--workdir',str(root/'builder-scanner'),'--entrypoint','node','local/r2-builder-qualified:repro1','-e',f'require({json.dumps(str(root/"backend/node_modules/ts-node"))}).register({{transpileOnly:true,project:"tsconfig.json"}});require({json.dumps(str(p))})']
 else:cmd=['node','-r',str(root/'backend/node_modules/ts-node/register'),str(p)] if p.suffix=='.ts' else ['node',str(p)]
 try:r=subprocess.run(cmd,cwd=component if p.suffix=='.ts' else root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=300);code=r.returncode;text=r.stdout
 except subprocess.TimeoutExpired as ex:code=124;text=str(ex.stdout)
 (logs/(rel.replace('/','-')+'.log')).write_text(text)
 return {'file':rel,'exitCode':code,'skipped':'SKIPPED' in text}
previous=json.loads((out/'regressions.json').read_text());failed={r['file'] for r in previous if r['exitCode']}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:reruns=list(pool.map(test,sorted(failed)))
updated={r['file']:r for r in reruns};results=[updated.get(r['file'],r) for r in previous]
(out/'regressions.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps({'files':len(results),'failures':[r for r in results if r['exitCode']],'skips':[r for r in results if r['skipped']]}))
