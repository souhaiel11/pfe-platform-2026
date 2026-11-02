import subprocess,json,pathlib,os
ROOT=pathlib.Path(__file__).resolve().parent
IMAGE='sha256:947ceacfa1633f8b36889a77bb7040d2abce90d51c5972c3fd12a41f45d6a244'
def run(c):return subprocess.check_output(c,text=True).strip()
def sql(q):return run(['docker','exec','pfe-postgres','psql','-U','devsecops','-d','devsecops','-Atc',q])
flags=json.loads(run(['docker','exec','pfe-backend','node','-e','console.log(JSON.stringify({dispatch:process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,harness:process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED}))']));assert flags=={'dispatch':'false','harness':'false'}
counts=json.loads(sql('''select json_build_object('plans',(select count(*) from security_remediation_retry_e2e_plans where state='ACTIVE'),'reservations',(select count(*) from remediation_target_reservations where state='ACTIVE'),'writers',(select count(*) from manual_remediation_tasks where "securityFindingRemediation"->>'status' in ('DISPATCHING','RUNNING','EVALUATING','PR_CREATING')))'''));assert not any(counts.values())
x=json.loads(run(['docker','inspect','pfe-candidate-verifier']))[0];assert x['Image']=='sha256:8a91eaad6bb10f30d57429759b896af749192f1f236ba2bfd5a4675d3db06c91'
env=dict(v.split('=',1) for v in x['Config']['Env']);env['OWASP_DATA_DIRECTORY']='/var/pfe-owasp-data'
svc={'container_name':'pfe-candidate-verifier','image':IMAGE,'environment':env,'restart':x['HostConfig']['RestartPolicy']['Name'],'networks':{},'volumes':[]}
if x['HostConfig'].get('Init'):svc['init']=True
if x['HostConfig']['Memory']:svc['mem_limit']=x['HostConfig']['Memory']
if x['HostConfig']['NanoCpus']:svc['cpus']=x['HostConfig']['NanoCpus']/1e9
networks={};volumes={}
for name,n in x['NetworkSettings']['Networks'].items():networks[name]={'external':True,'name':name};svc['networks'][name]={'aliases':[a for a in n.get('Aliases') or [] if a in ['candidate-verifier','pfe-candidate-verifier']]}
for m in x['Mounts']:
 source=m.get('Name',m['Source']) if m['Type']=='volume' else m['Source']
 if m['Type']=='volume':volumes[source]={'external':True,'name':source}
 svc['volumes'].append({'type':m['Type'],'source':source,'target':m['Destination'],'read_only':not m['RW']})
volumes['practical_owasp_data']={'external':True,'name':'practical_owasp_data'};svc['volumes'].append({'type':'volume','source':'practical_owasp_data','target':'/var/pfe-owasp-data'})
p=pathlib.Path('/tmp/practical-verifier-deploy.private.json');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump({'services':{'candidate-verifier':svc},'networks':networks,'volumes':volumes},f)
(ROOT/'deployment-preflight.json').write_text(json.dumps({'flags':flags,'counts':counts,'component':'candidate-verifier','image':IMAGE,'sourceCommit':'62dd93fed2b519b1b7f8a63ae92e95158df5e91a'},indent=2)+'\n')
subprocess.run(['docker','compose','--project-name','platform','-f',str(p),'up','-d','--no-deps','candidate-verifier'],check=True)
a=json.loads(run(['docker','inspect','pfe-candidate-verifier']))[0];assert a['Image']==IMAGE
result={'image':a['Image'],'sourceCommit':a['Config']['Labels']['org.opencontainers.image.revision'],'component':'candidate-verifier'};assert result['sourceCommit']=='62dd93fed2b519b1b7f8a63ae92e95158df5e91a';(ROOT/'deployment-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
