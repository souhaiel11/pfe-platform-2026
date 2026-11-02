import json,sys,pathlib,urllib.request,subprocess
p=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(p.parent/'practical-closure-20261007'));import closure
session=json.loads(pathlib.Path('/tmp/jury-session.private.json').read_text())
def api(path):
 r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4200/api'+path,headers={'Authorization':'Bearer '+session['token']}),timeout=45);return json.load(r)
projects=api('/projects');project=next(x for x in projects if x['name']=='pfe-app-test');pid=project['id'];incidents=api('/incidents?projectId='+pid);inc=next(x for x in incidents if x.get('aiAnalysis'));ed=inc.get('metadata',{}).get('enrichedData',{});jenkins=api('/projects/'+pid+'/jenkins-status');readiness=api('/azure-deploy/ready/'+pid);preview=api('/azure-deploy/governance/'+pid)
tasks=api('/manual-remediation?projectId=ebe3bd94-8240-4c30-a2d9-6de2106a28bc&includeV18=true');t=next(x for x in tasks if x['source']=='OWASP');sec=api('/dashboard/security-global')
# SQL values selected explicitly, never credentials.
db=json.loads(closure.sql("select row_to_json(t) from (select id,name,\"githubRepo\" from projects where id='"+pid+"')t"));dbi=json.loads(closure.sql("select row_to_json(t) from (select id,status,\"createdAt\",metadata->'enrichedData' as ed from incidents where id='"+inc['id']+"')t"));assert db['name']==project['name'] and db['githubRepo']==project['githubRepo'];assert dbi['status']==inc['status']; differences=[k for k in set(dbi['ed'] or {})|set(ed) if (dbi['ed'] or {}).get(k)!=ed.get(k)]; print(json.dumps({'apiEnrichmentBlocks':differences}));
for k in ['sonar','trivy','owasp','zap']:
 for f in ['critical','high','cves_count','quality_gate','bugs','vulnerabilities','code_smells','coverage','alerts_high','alerts_medium','alerts_count']:
  assert (dbi['ed'] or {}).get(k,{}).get(f)==ed.get(k,{}).get(f),(k,f)
out={'project':db,'incident':{'id':inc['id'],'status':inc['status'],'createdAt':inc['createdAt']},'scanners':{k:{f:ed.get(k,{}).get(f) for f in fields} for k,fields in {'sonar':['status','quality_gate','bugs','vulnerabilities','code_smells','coverage'],'trivy':['status','critical','high','cves_count'],'owasp':['status','critical','high','cves_count'],'zap':['status','alerts_high','alerts_medium','alerts_count']}.items()},'jenkins':{k:jenkins.get(k) for k in ['_liveData','buildNumber','result','timestamp','message','url','buildSuccessRate','sampleSize']},'remediation':{'taskId':t['id'],'findingId':t['findingId'],'scannerStatus':t['scannerStatus'],'manualStatus':t['status'],'attemptStatus':t['securityFindingRemediation']['status'],'candidateEvaluationPassed':t['securityFindingRemediation']['operatorTest']['candidateEvaluationPassed']},'deployment':{k:readiness.get(k) for k in ['ready','deploymentConfigured','deploymentTarget','currentBuild','validatedBuild','reasons']},'governance':{k:preview.get(k) for k in ['projectId','decision','mainBuildNumber','buildIdentity','artifact','environment','securityValidation','failedControls']},'securityGlobalNoData':sec.get('projectsWithoutData'),'databaseMatchesApi':True}
# Credentials are audited by key path and presence only; actual values never persisted.
import re
secrets=[]
def walk(obj,path):
 if isinstance(obj,dict):
  for k,v in obj.items():
   keypath=path+'.'+k
   if re.search(r'password|secret|authorization|githubToken|apiKey|jenkinsToken',k,re.I) and isinstance(v,str) and v:secrets.append(keypath)
   else:walk(v,keypath)
 elif isinstance(obj,list):
  for i,v in enumerate(obj):walk(v,path+'[]')
walk(inc,'incident');walk(project,'project');out['nonemptyCredentialFieldPaths']=secrets
(p/'data-truth-spot-check.json').write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n');print(json.dumps(out,ensure_ascii=False))
