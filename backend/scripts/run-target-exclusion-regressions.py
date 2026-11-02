# Lance les tests de réservation exclusive des cibles de correction.
import os, subprocess, json, pathlib, concurrent.futures
root=pathlib.Path(__file__).resolve().parents[2]; out=root/'docs/qa/trivy-owasp-target-exclusion';out.mkdir(exist_ok=True)
backend=root/'backend'
files=sorted(set(backend.glob('src/manual-remediation/*.spec.ts'))|set(backend.glob('src/security-remediation/*.spec.ts'))|set(backend.glob('src/dependency-compatibility/*v1_8*.spec.ts')))
files.append(backend/'src/incidents/remediation-batch.spec.ts')
wf=sorted((root/'n8n-workflows/scripts').glob('wf6-*.spec.mjs'))
env=dict(os.environ,TS_NODE_TRANSPILE_ONLY='true');env.pop('NODE_TEST_CONTEXT',None)
def run(p):
 """Exécute un fichier de test et conserve son journal."""
 cmd=['node','-r','ts-node/register',str(p)] if p.suffix=='.ts' else ['node',str(p)]
 result=subprocess.run(cmd,cwd=backend if p.suffix=='.ts' else root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 (out/(p.name+'.log')).write_text(result.stdout)
 import re
 count=re.search(r'^# tests (\d+)',result.stdout,re.M)
 return {'file':str(p.relative_to(root)), 'exitCode':result.returncode, 'tests':int(count[1]) if count else None}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,files+wf))
(out/'regressions.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'files':len(results),'tests':sum(r['tests'] or 0 for r in results),'failed':[r for r in results if r['exitCode']]},indent=2))
