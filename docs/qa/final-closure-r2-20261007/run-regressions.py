import pathlib, subprocess, os, json, concurrent.futures
root=pathlib.Path(__file__).resolve().parents[3]
out=pathlib.Path(__file__).resolve().parent/'tests';out.mkdir(exist_ok=True)
previous=json.loads((root/'docs/qa/chain4a-r1-scoped-20261007/regressions.json').read_text())
files={root/r['file'] for r in previous}
files.update((root/'builder-scanner/src').glob('*.spec.ts'))
for pattern in ['remote-builder-artifact-validator*.spec.ts','candidate-materializer.service.spec.ts','candidate-sha-evidence.spec.ts','candidate-verification-executor*.spec.ts','candidate-verification-timeout.spec.ts']:
    files.update((root/'candidate-verifier/src').glob(pattern))
env=dict(os.environ,TS_NODE_TRANSPILE_ONLY='true');env.pop('NODE_TEST_CONTEXT',None)
def run(p):
    rel=p.relative_to(root)
    cwd=root/rel.parts[0] if p.suffix=='.ts' else root
    e=dict(env,TS_NODE_PROJECT=str(cwd/'tsconfig.json'))
    cmd=['node','-r',str(root/'backend/node_modules/ts-node/register'),str(p)] if p.suffix=='.ts' else ['node',str(p)]
    try:
        r=subprocess.run(cmd,cwd=cwd,env=e,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=240)
        text=r.stdout;code=r.returncode
    except subprocess.TimeoutExpired as ex:text=str(ex.stdout);code=124
    (out/('-'.join(rel.parts)+'.log')).write_text(text)
    return {'file':str(rel),'exitCode':code,'skipped':'SKIPPED' in text}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results=list(pool.map(run,sorted(files)))
(out.parent/'regressions.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'files':len(results),'failures':[r for r in results if r['exitCode']],'skips':[r for r in results if r['skipped']]},indent=2))
