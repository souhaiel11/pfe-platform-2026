"""Configure existing exact backend artifact for the authorized E2E window."""
import json,subprocess,pathlib,os,sys,secrets
ROOT=pathlib.Path(__file__).resolve().parent
private=pathlib.Path('/tmp/practical-backend-config.private.json')
def run(c):return subprocess.check_output(c,text=True).strip()
mode=sys.argv[1];assert mode in ['configure','harness-on','harness-off']
original=json.loads(run(['docker','inspect','pfe-backend']))[0]
IMAGE='sha256:8ee224f973389451be32820381201e8466c8f710b887aed55f6d3363fb8f1fcd'
assert original['Image']==IMAGE
if mode=='configure':
    env=dict(e.split('=',1) for e in original['Config']['Env'])
    assert env['SECURITY_REMEDIATION_DISPATCH_ENABLED']=='false' and env['SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED']=='false'
    env['SECURITY_REMEDIATION_EVIDENCE_STORE_FILE']='/run/security-remediation/fixture-evidence.json'
    env['SECURITY_REMEDIATION_E2E_OPERATOR_SECRET']=secrets.token_hex(32)
    env['SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED']='false'
    svc={'container_name':'pfe-backend','image':IMAGE,'environment':env,'restart':original['HostConfig']['RestartPolicy']['Name'],'networks':{},'volumes':[],'ports':[]}
    if original['HostConfig'].get('Init'):svc['init']=True
    if original['HostConfig']['Memory']:svc['mem_limit']=original['HostConfig']['Memory']
    if original['HostConfig']['NanoCpus']:svc['cpus']=original['HostConfig']['NanoCpus']/1e9
    networks={};volumes={}
    for name,n in original['NetworkSettings']['Networks'].items():
        networks[name]={'external':True,'name':name};svc['networks'][name]={'aliases':[a for a in n.get('Aliases') or [] if a in ['backend','pfe-backend']]}
    for port,bindings in (original['HostConfig']['PortBindings'] or {}).items():
        for binding in bindings:svc['ports'].append({'target':int(port.split('/')[0]),'published':binding['HostPort'],'protocol':port.split('/')[1],'host_ip':binding['HostIp'] or '0.0.0.0'})
    for m in original['Mounts']:
        if m['Destination']=='/run/security-remediation/fixture-evidence.json':continue
        source=m.get('Name',m['Source']) if m['Type']=='volume' else m['Source']
        if m['Type']=='volume':volumes[source]={'external':True,'name':source}
        svc['volumes'].append({'type':m['Type'],'source':source,'target':m['Destination'],'read_only':not m['RW']})
    svc['volumes'].append({'type':'bind','source':str(ROOT/'fixture-evidence-store.json'),'target':'/run/security-remediation/fixture-evidence.json','read_only':True})
    cfg={'services':{'backend':svc},'networks':networks,'volumes':volumes}
else:
    cfg=json.loads(private.read_text());env=cfg['services']['backend']['environment']
    env['SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED']='true' if mode=='harness-on' else 'false'
    if mode=='harness-off':env.pop('SECURITY_REMEDIATION_E2E_OPERATOR_SECRET',None)
assert env['SECURITY_REMEDIATION_DISPATCH_ENABLED']=='false'
fd=os.open(private,os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:json.dump(cfg,f)
subprocess.run(['docker','compose','--project-name','platform','-f',str(private),'up','-d','--no-deps','backend'],check=True)
print(json.dumps({'mode':mode,'backendImage':IMAGE,'normalDispatch':env['SECURITY_REMEDIATION_DISPATCH_ENABLED'],'harness':env['SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED'],'runtimeCodeChanged':False}))
