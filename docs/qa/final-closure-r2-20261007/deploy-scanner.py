"""Deploy only the qualified scanner; private environment stays out of evidence."""
import subprocess,json,pathlib,os,sys
ROOT=pathlib.Path(__file__).resolve().parent
IMAGE='sha256:8581ec8d1cbd9332d3b9294bea63292f7880f54b4ae98aa394af8401b1613196'
def run(cmd):return subprocess.check_output(cmd,text=True).strip()
def sql(q):return run(['docker','exec','pfe-postgres','psql','-U','devsecops','-d','devsecops','-Atc',q])
flags=json.loads(run(['docker','exec','pfe-backend','node','-e','console.log(JSON.stringify({dispatch:process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,harness:process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED}))']))
assert flags=={'dispatch':'false','harness':'false'}
counts=json.loads(sql('''select json_build_object('plans',(select count(*) from security_remediation_retry_e2e_plans where state='ACTIVE'),'reservations',(select count(*) from remediation_target_reservations where state='ACTIVE'),'writers',(select count(*) from manual_remediation_tasks where "securityFindingRemediation"->>'status' in ('DISPATCHING','RUNNING','EVALUATING','PR_CREATING')))'''))
assert not any(counts.values()),counts
code='''const s=require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3'),d=new s.Database('/home/node/.n8n/database.sqlite',s.OPEN_READONLY);d.get("select count(*) n from execution_entity where workflowId=? and status in ('new','running','waiting')",['RdYyfjVpOm2LxS95'],(e,r)=>{if(e)throw e;console.log(r.n);d.close()});'''
assert run(['docker','exec','n8n','node','-e',code])=='0'
container=json.loads(run(['docker','inspect','pfe-builder-scanner']))[0]
assert container['Image']=='sha256:ebbf25b40eb9f3cffcd9ac6c709cf09e83eec5de5d18f6fc6d2fb29cb83a935f'
env=dict(v.split('=',1) for v in container['Config']['Env'])
svc={'container_name':'pfe-builder-scanner','image':IMAGE,'environment':env,'init':True,'restart':'unless-stopped','cap_add':container['HostConfig']['CapAdd'],'mem_limit':container['HostConfig']['Memory'],'cpus':container['HostConfig']['NanoCpus']/1e9,'networks':{},'volumes':[]}
networks={};volumes={}
for name,network in container['NetworkSettings']['Networks'].items():
    networks[name]={'external':True,'name':name};svc['networks'][name]={'aliases':[a for a in (network.get('Aliases') or []) if a in ['builder-scanner','pfe-builder-scanner']]}
for m in container['Mounts']:
    name='r2_qualification_trivy_cache' if m['Destination']=='/var/pfe-trivy-cache' else m['Name']
    volumes[name]={'external':True,'name':name}
    svc['volumes'].append({'type':'volume','source':name,'target':m['Destination'],'read_only':not m['RW']})
volumes['platform_trivy_scanner_cache']={'external':True,'name':'platform_trivy_scanner_cache'}
svc['volumes'].append({'type':'volume','source':'platform_trivy_scanner_cache','target':'/var/pfe-trivy-cache/java-db','read_only':True,'volume':{'subpath':'java-db'}})
config={'services':{'builder-scanner':svc},'networks':networks,'volumes':volumes}
private=pathlib.Path('/tmp/r2-scanner-deploy.private.json')
fd=os.open(private,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump(config,f)
summary={'image':IMAGE,'sourceCommit':'9038f556d8e8e27eb31c1a31feeac5168e529908','component':'builder-scanner','safetyFlags':flags,'safetyCounts':counts,'activeWf6Executions':0,'newVulnerabilityCache':'r2_qualification_trivy_cache','javaCache':'existing current Java database, read-only subpath'}
(ROOT/'deployment-preflight.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
if sys.argv[1]=='deploy':
    subprocess.run(['docker','compose','--project-name','platform','-f',str(private),'up','-d','--no-deps','builder-scanner'],check=True)
    actual=json.loads(run(['docker','inspect','pfe-builder-scanner']))[0]
    assert actual['Image']==IMAGE
    (ROOT/'deployment-result.json').write_text(json.dumps({'image':actual['Image'],'containerId':actual['Id'],'sourceCommit':actual['Config']['Labels']['org.opencontainers.image.revision']},indent=2)+'\n')
