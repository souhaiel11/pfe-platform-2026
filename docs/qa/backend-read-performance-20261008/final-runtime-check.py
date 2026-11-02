import json,pathlib,urllib.request,hashlib,subprocess
p=pathlib.Path(__file__).resolve().parent
with urllib.request.urlopen('http://127.0.0.1:4200',timeout=15) as r:index=r.read()
release=json.loads((p/'frontend-release.json').read_text());assert hashlib.sha256(index).hexdigest()==release['indexSha256']
with urllib.request.urlopen('http://127.0.0.1:3001/healthz',timeout=15) as r:health=json.loads(r.read())
assert health=={'status':'ok'}
run=lambda c:subprocess.check_output(c,text=True).strip()
flags=json.loads(run(['docker','exec','pfe-backend','node','-e','console.log(JSON.stringify({dispatch:process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,harness:process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED}))']));assert flags=={'dispatch':'false','harness':'false'}
counts=json.loads(run(['docker','exec','pfe-postgres','psql','-U','devsecops','-d','devsecops','-Atc', '''select json_build_object('plans',(select count(*) from security_remediation_retry_e2e_plans where state='ACTIVE'),'reservations',(select count(*) from remediation_target_reservations where state='ACTIVE'),'writers',(select count(*) from manual_remediation_tasks where "securityFindingRemediation"->>'status' in ('DISPATCHING','RUNNING','EVALUATING','PR_CREATING')))''']));assert not any(counts.values())
v={'servedIndexSha256':release['indexSha256'],'backendDbHealth':health,'flags':flags,'activeCounts':counts,'result':'PASS'};(p/'final-runtime-check.json').write_text(json.dumps(v,indent=2));print(json.dumps(v))
