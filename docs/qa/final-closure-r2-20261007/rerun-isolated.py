import pathlib,subprocess,json,os
root=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent
results=json.loads((out/'regressions.json').read_text())
for r in results:
    if not r['exitCode'] and not r['file'].startswith('builder-scanner/'): continue
    p=root/r['file'];cwd=p.parents[1]
    if r['file'].startswith('builder-scanner/'):
        cmd=['docker','run','--rm','--init','--network','none','--cap-add','SYS_ADMIN','--mount',f'type=bind,src={root},dst={root},readonly','--mount','type=bind,src=/home/souhaiel/pfe-2026/pfe-app-test,dst=/home/souhaiel/pfe-2026/pfe-app-test,readonly','--workdir',str(root/'builder-scanner'),'--entrypoint','node','local/r2-builder-qualified:repro1','-e',f'require({json.dumps(str(root/"backend/node_modules/ts-node"))}).register({{transpileOnly:true,project:"tsconfig.json"}});require({json.dumps(str(p))})']
        env=None;cwd=root
    else:
        if not p.exists(): p=pathlib.Path('/tmp/r2-qualified-backend-source')/r['file']
        cwd=p.parents[2] if '/backend/' in str(p) else p.parents[1];env=dict(os.environ,TS_NODE_PROJECT=str(cwd/'tsconfig.json'),TS_NODE_TRANSPILE_ONLY='true');env.pop('NODE_TEST_CONTEXT',None)
        cmd=['node','-r',str(root/'backend/node_modules/ts-node/register'),str(p)]
    rr=subprocess.run(cmd,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=180)
    (out/'tests'/('isolated-'+r['file'].replace('/','-')+'.log')).write_text(rr.stdout)
    r.update(exitCode=rr.returncode,skipped='SKIPPED' in rr.stdout,isolatedRerun=True)
    print(json.dumps({'file':r['file'],'exitCode':rr.returncode}),flush=True)
(out/'regressions-final.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'files':len(results),'failures':[r for r in results if r['exitCode']],'skips':[r for r in results if r['skipped']]}))
