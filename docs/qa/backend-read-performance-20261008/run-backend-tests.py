import pathlib,subprocess,concurrent.futures,json,os
root=pathlib.Path('/home/souhaiel/pfe-2026/platform');out=root/'docs/qa/backend-read-performance-20261008';logs=out/'backend-tests';logs.mkdir(exist_ok=True)
def run(p):
 env=dict(os.environ,TS_NODE_PROJECT=str(root/'backend/tsconfig.json'),TS_NODE_TRANSPILE_ONLY='true');env.pop('NODE_TEST_CONTEXT',None)
 r=subprocess.run(['node','-r',str(root/'backend/node_modules/ts-node/register'),str(p)],cwd=root/'backend',env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=300)
 rel=str(p.relative_to(root));(logs/(rel.replace('/','-')+'.log')).write_text(r.stdout);return {'file':rel,'exitCode':r.returncode,'skipped':'SKIPPED' in r.stdout}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,sorted((root/'backend/src').rglob('*.spec.ts'))))
(out/'backend-tests.json').write_text(json.dumps(results,indent=2));print(json.dumps({'files':len(results),'failed':[r for r in results if r['exitCode']],'skipped':[r for r in results if r['skipped']]}))
