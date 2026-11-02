import subprocess,json,pathlib,os,time
out=pathlib.Path(__file__).resolve().parent
run=lambda c:subprocess.check_output(c,text=True).strip()
def sql(q):return run(['docker','exec','pfe-postgres','psql','-U','devsecops','-d','devsecops','-Atc',q])
flags=json.loads(run(['docker','exec','pfe-backend','node','-e','console.log(JSON.stringify({dispatch:process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,harness:process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED}))']));assert flags=={'dispatch':'false','harness':'false'}
counts=json.loads(sql('''select json_build_object('plans',(select count(*) from security_remediation_retry_e2e_plans where state='ACTIVE'),'reservations',(select count(*) from remediation_target_reservations where state='ACTIVE'),'writers',(select count(*) from manual_remediation_tasks where "securityFindingRemediation"->>'status' in ('DISPATCHING','RUNNING','EVALUATING','PR_CREATING')))'''));assert not any(counts.values()),counts
old=json.loads(run(['docker','inspect','pfe-backend']))[0];assert old['Image']=='sha256:3835d850600755188f93342f612899d64b4f653c992b062d19bbd8166018c742'
qualified=json.loads(run(['docker','image','inspect','local/backend-read-qualified:20261008']))[0];expected=json.loads((out/'qualified-artifact.json').read_text());assert qualified['Config']['Labels']['platform.read-contract.sha256']==expected['patchSha256']
config=json.loads(pathlib.Path('/tmp/azgov-backend-deploy.private.json').read_text());svc=config['services']['backend'];oldenv=dict(x.split('=',1) for x in old['Config']['Env']);assert all(oldenv.get(k)==str(v) for k,v in svc['environment'].items()),'Stale deployment environment';svc['image']=qualified['Id']
private=pathlib.Path('/tmp/backend-read-deploy.private.json');fd=os.open(private,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump(config,f)
(out/'deployment-preflight.json').write_text(json.dumps({'flags':flags,'counts':counts,'baseImage':old['Image'],'qualifiedImage':qualified['Id'],'onlyComponent':'backend'},indent=2))
subprocess.run(['docker','compose','--project-name','platform','-f',str(private),'up','-d','--no-deps','backend'],check=True)
new=json.loads(run(['docker','inspect','pfe-backend']))[0];assert new['Image']==qualified['Id'];assert set(new['Config']['Env'])==set(old['Config']['Env']),'Environment changed'
result={'image':new['Image'],'patchSha256':new['Config']['Labels']['platform.read-contract.sha256'],'allEnvironmentValuesPreserved':True,'componentsUpdated':['backend']};(out/'backend-deployment.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
