import json,pathlib,urllib.request,urllib.error,hashlib,time
p=pathlib.Path(__file__).resolve().parent;auth=json.loads(pathlib.Path('/tmp/jury-session.private.json').read_text());out=[]
def get(path,authorized=True):
 r=urllib.request.Request('http://127.0.0.1:4200/api/'+path,headers={'Authorization':'Bearer '+auth['token']}if authorized else {})
 try:
  with urllib.request.urlopen(r,timeout=30)as response:b=response.read();return response.status,b,json.loads(b)
 except urllib.error.HTTPError as e:return e.code,e.read(),None

with urllib.request.urlopen('http://127.0.0.1:3001/healthz',timeout=20) as response: status=response.status;health=json.loads(response.read())
assert status==200 and health['status']=='ok';out.append({'check':'backend/DB health','status':status,'result':'PASS'})
projects=get('projects')[2];isolated=json.loads((p/'isolated-read-qualification.json').read_text())
for project in projects:
 for kind in ['incidents','reports']:
  status,b,page=get(f'project-reads/{kind}?projectId={project["id"]}&pageSize=20');assert status==200
  ref=next(x for x in isolated if x['project']==project['name']and x['kind']==kind);assert page['total']==ref['total'];assert all(r['projectId']==project['id'] for r in page['items']);assert len(page['items'])<=20
  out.append({'check':'served list','project':project['name'],'kind':kind,'rows':len(page['items']),'total':page['total'],'bytes':len(b),'result':'PASS'})
for old in json.loads((p/'source-measure-before.json').read_text()):
 kind='incidents'if'/incidents?'in old['endpoint']else'reports';id=old['latestDetail']['id'];status,b,detail=get(kind+'/'+id);assert status==200;digest=hashlib.sha256(b).hexdigest();assert digest==old['latestDetail']['sha256'];out.append({'check':'full detail unchanged','kind':kind,'id':id,'bytes':len(b),'sha256':digest,'result':'PASS'})
status,_,_=get('project-reads/incidents?projectId='+projects[0]['id'],False);assert status==401;out.append({'check':'authentication required','status':status,'result':'PASS'})
for params in ['projectId=invalid','projectId='+projects[0]['id']+'&page=0','projectId='+projects[0]['id']+'&pageSize=101']:
 status,_,_=get('project-reads/incidents?'+params);assert status==400
out.append({'check':'malformed project/pagination rejected','result':'PASS'})
(p/'runtime-api-audit.json').write_text(json.dumps(out,indent=2));print(json.dumps({'checks':len(out),'result':'PASS'}))
