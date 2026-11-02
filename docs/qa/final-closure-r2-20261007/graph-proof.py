import json,pathlib,subprocess,hashlib
out=pathlib.Path(__file__).resolve().parent
code='''const s=require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3'),d=new s.Database('/home/node/.n8n/database.sqlite',s.OPEN_READONLY);d.get('select versionId,nodes,connections,settings from workflow_entity where id=?',['RdYyfjVpOm2LxS95'],(e,r)=>{if(e)throw e;console.log(JSON.stringify(r));d.close()});'''
w=json.loads(subprocess.check_output(['docker','exec','n8n','node','-e',code],text=True))
assert w['versionId']=='0470ab42-713a-4097-a9a7-72c8f00bacde'
nodes=json.loads(w['nodes']);connections=json.loads(w['connections'])
writers=['Create Missing Branch','Write File To Branch','Create Pull Request','Close Drifted Created PR']
def reachable(start,blocked=None):
    seen=set();todo=[start]
    while todo:
        n=todo.pop()
        if n==blocked or n in seen:continue
        seen.add(n)
        for branches in connections.get(n,{}).values():
            for branch in branches:todo.extend(e['node'] for e in branch)
    return seen
for name in writers:
    assert name in reachable('Webhook - Security Remediation Request')
    assert name not in reachable('Webhook - Security Remediation Request','Candidate Ready?')
gate=next(n for n in nodes if n['name']=='Candidate Ready?')['parameters']['conditions']['conditions'][0]['leftValue']
assert gate=='={{ Boolean($json.body?.status === "CANDIDATE_READY") }}'
false_start=connections['Candidate Ready?']['main'][1][0]['node']
assert not set(writers)&reachable(false_start)
extra=[]
for n in nodes:
    p=n.get('parameters',{});method=p.get('method',p.get('requestMethod','GET'))
    if n['type'].endswith('.httpRequest') and method in ['POST','PUT','PATCH','DELETE'] and 'api.github.com' in str(p.get('url','')) and n['name'] not in writers:extra.append(n['name'])
assert not extra,extra
result={'versionId':w['versionId'],'workflowHash':hashlib.sha256(json.dumps(w,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'writers':writers,'gate':gate,'allGitWritersAfterBarrier':True,'stopEnvelopeCannotReachGitWriters':True,'workflowModified':False}
(out/'pre-git-barrier-proof.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
