"""Operator data/API helper. No SQL business writes and no remediation Git writers."""
import sys,pathlib,json,subprocess,importlib.util
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('fixture_control',ROOT.parent/'chain4b-r1-fixture-20261007/control.py');control=importlib.util.module_from_spec(spec);spec.loader.exec_module(control)
sql=control.sql
def save(name,obj):
    (ROOT/(name+'.json')).write_text(json.dumps(obj,indent=2)+'\n');return obj
def api(method,path,body=None,mode='jwt',plan=None):
    admin=json.loads(sql('''select row_to_json(u) from (select id,email,role from users where role='admin' order by "createdAt" limit 1) u'''))
    code='''const x=JSON.parse(process.argv[1]),j=require('jsonwebtoken');const h={'Content-Type':'application/json'};h.Authorization='Bearer '+j.sign({sub:x.admin.id,email:x.admin.email,role:x.admin.role},process.env.JWT_SECRET,{expiresIn:'10m'});if(x.mode==='internal')h['x-internal-secret']=process.env.N8N_INTERNAL_SECRET;if(x.mode==='operator'||x.plan)h['x-e2e-operator-secret']=process.env.SECURITY_REMEDIATION_E2E_OPERATOR_SECRET;if(x.plan)h['x-e2e-plan-id']=x.plan;fetch('http://127.0.0.1:3001'+(x.path==='/healthz'?'':'/api')+x.path,{method:x.method,headers:h,body:x.body===null?undefined:JSON.stringify(x.body)}).then(async r=>{const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t}console.log(JSON.stringify({status:r.status,body:b}))}).catch(e=>{console.error(e.message);process.exit(1)});'''
    data={'admin':admin,'method':method,'path':path,'body':body,'mode':mode,'plan':plan}
    return json.loads(subprocess.check_output(['docker','exec','pfe-backend','node','-e',code,json.dumps(data)],text=True))
def health():
    backend=api('GET','/healthz')
    verifier=json.loads(control.run(['docker','exec','pfe-candidate-verifier','node','-e','fetch("http://127.0.0.1:4100/health").then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))']))
    scanner=json.loads(control.run(['docker','exec','pfe-builder-scanner','node','-e','fetch("http://127.0.0.1:4200/healthz").then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))']))
    r=save('post-deploy-health',dict(backend=backend,verifier=verifier,scanner=scanner));assert all(x['status']==200 for x in r.values());print(json.dumps(r))
def freeze():
    missing='00000000-0000-4000-8000-000000000001'
    launch=api('POST','/manual-remediation/launch-batch',{'projectId':missing,'findingTaskIds':[missing]})
    retry=api('POST','/manual-remediation/'+missing+'/retry',{})
    for r in [launch,retry]:assert r['status']==503 and r['body']['code']=='SECURITY_REMEDIATION_TEMPORARILY_DISABLED',r
    print(json.dumps(save('normal-dispatch-frozen',dict(launch=launch,retry=retry))))
def provision():
    q=json.loads((ROOT/'fixture-qualification.json').read_text());f=q['finding'];of=q['owaspFinding']
    projects=api('GET','/projects');assert projects['status']==200
    matches=[p for p in projects['body'] if p.get('githubRepo')==q['repository']];assert len(matches)==1
    project=matches[0];save('project-created',{'status':200,'body':project});pid=project['id']
    before=json.loads(sql('select coalesce(json_agg(row_to_json(t)),\'[]\'::json) from manual_remediation_tasks t where "projectId"=\''+pid+'\''))
    assert len(before)==1 and before[0]['source']=='TRIVY'
    assert before[0]['securityFindingRemediation']['attemptCount']==2 and before[0]['securityFindingRemediation']['status']=='OPERATOR_TEST_STOPPED'
    save('historical-task-before-ingestion',before[0])
    block=lambda findings:{'status':'COMPLETED','executed':True,'completed':True,'resultAvailable':True,'findingCount':len(findings),'cves_count':len(findings),'critical':0,'high':1,'cves':findings}
    metadata={'sourceCommitSha':q['commit'],'qualificationRunId':'practical-closure-20261007','scannerEvidence':{'trivyReportDigest':q['baselineReportDigest'],'owaspNativeReport':'baseline-owasp.json'},'enrichedData':{'trivy':block([f]),'owasp':block([of])}}
    incident=api('POST','/incidents',{'projectId':pid,'title':'Dedicated corrected-baseline real dual-scanner evidence','description':'Exact corrected fixture baseline; real Trivy and OWASP evidence, with a fresh OWASP remediation task','status':'analyzed','source':'OWASP','metadata':metadata})
    save('incident-ingested',incident);assert incident['status']==201,incident
    tasks=json.loads(sql('select coalesce(json_agg(row_to_json(t)),\'[]\'::json) from manual_remediation_tasks t where "projectId"=\''+pid+'\''));assert len(tasks)==2
    fresh=[t for t in tasks if t['source']=='OWASP'];assert len(fresh)==1;t=fresh[0]
    old=next(t for t in tasks if t['source']=='TRIVY');assert old['securityFindingRemediation']==before[0]['securityFindingRemediation']
    assert t['scannerStatus']=='DETECTED' and t['status']=='TODO' and not t['securityFindingRemediation'] and not t['securityRemediationBatchId']
    assert t['ruleOrCve']==f['id'] and t['findingSnapshot']['component']==f['pkg'] and t['findingSnapshot']['fixedVersion']==f['fixedVersion']
    save('dedicated-task-before-e2e',t)
    result={'E2E_PROJECT_ID':pid,'E2E_PROJECT_NAME':project['name'],'E2E_REPOSITORY':q['repository'],'E2E_BASELINE_COMMIT':q['commit'],'E2E_INCIDENT_ID':incident['body']['id'],'E2E_FINDING_ID':t['findingId'],'E2E_FINDING_FINGERPRINT':t['findingFingerprint'],'E2E_TASK_ID':t['id'],'SCANNER':t['source'],'VULNERABILITY_ID':t['ruleOrCve'],'PACKAGE':t['findingSnapshot']['component'],'INSTALLED_VERSION':t['findingSnapshot']['currentVersion'],'FIXED_VERSION':t['findingSnapshot']['fixedVersion'],'ATTEMPTS_CREATED':0,'ATTEMPT_COUNT':0}
    print(json.dumps(save('fixture-identities',result)))
def target():
    ids=json.loads((ROOT/'fixture-identities.json').read_text());t=json.loads((ROOT/'dedicated-task-before-e2e.json').read_text());incident=json.loads((ROOT/'incident-ingested.json').read_text())['body'];project=json.loads((ROOT/'project-created.json').read_text())['body']
    code='''const x=JSON.parse(process.argv[1]);require('./dist/security-remediation/maven-target.adapter').productionTargetResolver().resolve(x.task,x.project,x.incident).then(k=>console.log(JSON.stringify(k))).catch(e=>{console.error(e.message);process.exit(1)})'''
    result=json.loads(control.run(['docker','exec','pfe-backend','node','-e',code,json.dumps({'task':t,'project':project,'incident':incident})]))
    assert result['targetFile']=='pom.xml' and result['lockGranularity']=='FILE',result
    ids.update(E2E_TARGET_TYPE=result['lockGranularity'],E2E_TARGET_PATH=result['targetFile'],EXPECTED_4G_KEY=[ids['E2E_PROJECT_ID'].strip().lower(),result['lockGranularity'],result['targetFile']],DATABASE_TARGET_KEY=result['targetKey'],TARGET_RESOLUTION_DYNAMIC='YES',TARGET_RESOLUTION_SOURCE='productionTargetResolver / MAVEN_ROOT_DESCRIPTOR / immutable Git tree membership',expectedCandidate='2.2.220')
    save('fixture-identities',ids);save('dynamic-target',result)
    import hashlib
    payload=json.dumps(ids,sort_keys=True,separators=(',',':')).encode()+b'\n'
    (ROOT/'CHAIN4B_FIXTURE_MANIFEST.json').write_bytes(payload)
    digest=hashlib.sha256(payload).hexdigest();(ROOT/'CHAIN4B_FIXTURE_MANIFEST.sha256').write_text(digest+'\n')
    print(json.dumps({'target':result,'manifestHash':digest}))
def eligibility():
    ids=json.loads((ROOT/'fixture-identities.json').read_text());task=json.loads(sql('select row_to_json(t) from manual_remediation_tasks t where id=\''+ids['E2E_TASK_ID']+'\''))
    assert task['status']=='TODO' and task['scannerStatus']=='DETECTED' and not task['securityFindingRemediation'] and not task['securityRemediationBatchId']
    code='''const x=JSON.parse(process.argv[1]),{V1_8CompatibilityDecisionService}=require('./dist/dependency-compatibility/v1_8-compatibility-decision.service'),{canDispatchSecurityRemediationV1_8}=require('./dist/dependency-compatibility/v1_8-security-remediation-gate');const e=new V1_8CompatibilityDecisionService().lookup(x.SCANNER,x.VULNERABILITY_ID,x.PACKAGE,x.INSTALLED_VERSION);const r=canDispatchSecurityRemediationV1_8({repository:x.E2E_REPOSITORY,commitSha:x.E2E_BASELINE_COMMIT,source:x.SCANNER,cve:x.VULNERABILITY_ID,component:x.PACKAGE,installedVersion:x.INSTALLED_VERSION,statusPermitsDispatch:true},e);console.log(JSON.stringify({decision:r.decision,reason:r.reason,evidenceId:e.evidenceId}));'''
    r=json.loads(control.run(['docker','exec','pfe-backend','node','-e',code,json.dumps(ids)]));assert r['decision']=='ALLOW',r
    save('live-task-eligibility',r);print(json.dumps(r))
def remote(name):
    result={}
    for key,path in [('branches','/branches?per_page=100'),('pulls','/pulls?state=all&per_page=100'),('commits','/commits?per_page=100')]:
        status,data=control.github('GET','/repos/'+control.REPO+path);assert status==200,(key,status)
        result[key]=[{'name':v['name'],'sha':v['commit']['sha']} for v in data] if key=='branches' else [{'number':v['number'],'state':v['state']} for v in data] if key=='pulls' else [v['sha'] for v in data]
    assert result['branches']==[{'name':'main','sha':'13af977f770f78d47462b5ccbe856de9c0a4f077'}] and not result['pulls'] and result['commits']==['13af977f770f78d47462b5ccbe856de9c0a4f077','24630265ea4ed764bbb22c76d4d7dc689b5fe0bf'],result
    print(json.dumps(save(name,result)))
def task():
    ids=json.loads((ROOT/'fixture-identities.json').read_text())
    return json.loads(sql('select row_to_json(t) from manual_remediation_tasks t where id=\''+ids['E2E_TASK_ID']+'\''))
def state(name):
    t=task();r=t.get('securityFindingRemediation') or {}
    reservations=json.loads(sql('select coalesce(json_agg(row_to_json(r)),\'[]\'::json) from remediation_target_reservations r where "projectId"=\''+t['projectId']+'\''))
    plans=json.loads(sql('select coalesce(json_agg(row_to_json(p)),\'[]\'::json) from security_remediation_retry_e2e_plans p where "projectId"=\''+t['projectId']+'\''))
    save(name,{'task':t,'reservations':reservations,'plans':plans})
    print(json.dumps({'taskId':t['id'],'status':r.get('status'),'attemptId':r.get('attemptId'),'attemptNumber':r.get('attemptNumber'),'attemptCount':r.get('attemptCount'),'reasonCode':r.get('reasonCode'),'retryable':r.get('retryable'),'operatorTest':r.get('operatorTest'),'reservations':[{'id':v['id'],'state':v['state'],'ownerAttemptId':v['ownerAttemptId']} for v in reservations],'plans':[{'id':v['id'],'state':v['state']} for v in plans]}))
def create_plan():
    import datetime
    ids=json.loads((ROOT/'fixture-identities.json').read_text());t=task();assert not t['securityFindingRemediation']
    assert sql("select count(*) from security_remediation_retry_e2e_plans where state='ACTIVE'")=='0'
    expires=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=25)).isoformat()
    r=api('POST','/internal/test/retry-e2e-plan',{'projectId':ids['E2E_PROJECT_ID'],'taskId':ids['E2E_TASK_ID'],'expiresAt':expires},mode='operator')
    save('plan-created',r);assert r['status']==201,r
    print(json.dumps({'planId':r['body']['id'],'state':r['body']['state'],'expiresAt':expires}))
def launch(retry=False):
    ids=json.loads((ROOT/'fixture-identities.json').read_text());plan=json.loads((ROOT/'plan-created.json').read_text())['body']['id'];t=task();current=t['securityFindingRemediation']
    if retry:
        first=json.loads((ROOT/'attempt1-final.json').read_text())['task']['securityFindingRemediation']
        assert current['attemptNumber']==1 and current['attemptId']==first['attemptId'] and current['reasonCode']=='VERIFIER_TIMEOUT' and current['retryable'] is True
        r=api('POST','/manual-remediation/'+ids['E2E_TASK_ID']+'/retry',{'expectedAttemptId':first['attemptId']},plan=plan)
    else:
        assert not current
        r=api('POST','/manual-remediation/launch-batch',{'projectId':ids['E2E_PROJECT_ID'],'findingTaskIds':[ids['E2E_TASK_ID']]},plan=plan)
    save('retry-response' if retry else 'launch-response',r);assert r['status'] in [200,201,202],r
    print(json.dumps({'status':r['status'],'operation':'retry-once' if retry else 'initial-launch','body':r['body']}))
def stale():
    first=json.loads((ROOT/'attempt1-final.json').read_text())['task']['securityFindingRemediation'];before=task()
    second=before['securityFindingRemediation'];assert second['attemptNumber']==2 and second['attemptId']!=first['attemptId'] and second['batchId']!=first['batchId']
    body={'projectId':before['projectId'],'findingTaskId':before['id'],'attemptId':first['attemptId'],'attemptNumber':1,'batchId':first['batchId'],'status':'TECHNICAL_FAILURE','reasonCode':'VERIFIER_TIMEOUT'}
    result=api('POST','/internal/security-remediation/result',body,mode='internal');after=task()
    assert result['status']==409,result
    assert before==after,'Task changed during stale callback proof; inspect concurrent legitimate completion before drawing a conclusion'
    print(json.dumps(save('stale-callback-proof',{'request':body,'response':result,'taskUnchanged':True,'currentAttemptId':second['attemptId'],'currentBatchId':second['batchId'],'pass':True})))
if __name__=='__main__':
    if sys.argv[1]=='health':health()
    elif sys.argv[1]=='freeze':freeze()
    elif sys.argv[1]=='provision':provision()
    elif sys.argv[1]=='target':target()
    elif sys.argv[1]=='eligibility':eligibility()
    elif sys.argv[1]=='remote':remote(sys.argv[2])
    elif sys.argv[1]=='state':state(sys.argv[2])
    elif sys.argv[1]=='plan':create_plan()
    elif sys.argv[1]=='launch':launch()
    elif sys.argv[1]=='retry':launch(True)
    elif sys.argv[1]=='stale':stale()
