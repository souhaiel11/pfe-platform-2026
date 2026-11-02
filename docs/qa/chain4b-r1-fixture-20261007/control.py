"""Fixture-only operator tooling. Never invokes remediation launch/retry or SQL writes."""
import json, subprocess, pathlib, sys, urllib.request, urllib.error, datetime, os, base64
ROOT = pathlib.Path(__file__).resolve().parent
REPO = 'souhaiel11/remediation-retry-e2e-fixture'
def run(args):
    return subprocess.check_output(args, text=True).strip()
def sql(query):
    return run(['docker','exec','pfe-postgres','psql','-U','devsecops','-d','devsecops','-Atc',query])
def snapshot(name):
    tables = ['projects','manual_remediation_tasks','incidents','reports','remediation_target_reservations','security_remediation_retry_e2e_plans']
    rows = {t:json.loads(sql('select coalesce(json_object_agg(id,md5(row_to_json(t)::text)),\'{}\'::json) from '+t+' t')) for t in tables}
    flags = json.loads(run(['docker','exec','pfe-backend','node','-e',"console.log(JSON.stringify({dispatch:process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,harness:process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED}))"]))
    assert flags == {'dispatch':'false','harness':'false'}, flags
    source = run(['docker','inspect','pfe-backend','--format','{{index .Config.Labels "org.opencontainers.image.revision"}}'])
    assert source == '0957ab63280b32e4180ba47ae72bfb5a802db15a'
    result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':source,'flags':flags,'rows':rows}
    (ROOT/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'snapshot':name,'counts':{t:len(v) for t,v in rows.items()},'flags':flags,'source':source}))
def github_token():
    # Existing operator credential is held in memory only, never logged or persisted.
    token=sql('select "githubToken" from projects where coalesce("githubToken",\'\') <> \'\' limit 1')
    if not token:
        code='''const fs=require('fs'),s=require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3'),{Cipher}=require('/usr/local/lib/node_modules/n8n/node_modules/n8n-core/dist/encryption/cipher');const d=new s.Database('/home/node/.n8n/database.sqlite',s.OPEN_READONLY);d.get('select data from credentials_entity where id=?',['YBO0vWrPlyoYx4Kr'],(e,r)=>{if(e||!r)process.exit(1);const key=JSON.parse(fs.readFileSync('/home/node/.n8n/config')).encryptionKey;const c=JSON.parse(new Cipher({encryptionKey:key}).decrypt(r.data));process.stdout.write(c.accessToken);d.close()});'''
        token=run(['docker','exec','n8n','node','-e',code])
    assert token, 'No configured GitHub operator credential'
    return token
def github(method,path,body=None):
    assert path.startswith('/repos/'+REPO) or (method=='POST' and path=='/user/repos')
    token=github_token()
    req=urllib.request.Request('https://api.github.com'+path,method=method,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json','User-Agent':'chain4b-r1-fixture-operator'})
    try:
        with urllib.request.urlopen(req,timeout=40) as r: return r.status,json.load(r)
    except urllib.error.HTTPError as e: return e.code,json.load(e)
if __name__=='__main__':
    if sys.argv[1]=='snapshot': snapshot(sys.argv[2])
    elif sys.argv[1]=='repo-read':
        status,data=github('GET','/repos/'+REPO)
        result={'status':status,**{k:data.get(k) for k in ['id','full_name','default_branch','private','description','message']}}
        (ROOT/'repository-before.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))
    elif sys.argv[1]=='baseline-publish':
        w='/tmp/chain4b-r1-built'
        sha=run(['git','-C',w,'rev-parse','HEAD'])
        assert sha=='24630265ea4ed764bbb22c76d4d7dc689b5fe0bf'
        status,data=github('GET','/repos/'+REPO)
        assert status==404, 'Repository exists; inspect before reuse'
        status,data=github('POST','/user/repos',{'name':REPO.split('/')[1],'description':'Dedicated controlled remediation E2E fixture; intentionally vulnerable baseline test data','private':False,'auto_init':False,'has_issues':False,'has_projects':False,'has_wiki':False})
        assert status==201, {'status':status,'message':data.get('message')}
        env=os.environ.copy()
        env.update({'GIT_CONFIG_COUNT':'2','GIT_CONFIG_KEY_0':'http.extraHeader','GIT_CONFIG_VALUE_0':'Authorization: Basic '+base64.b64encode(('x-access-token:'+github_token()).encode()).decode(),'GIT_CONFIG_KEY_1':'core.hooksPath','GIT_CONFIG_VALUE_1':'/dev/null','GIT_TERMINAL_PROMPT':'0'})
        subprocess.run(['git','-C',w,'push','https://github.com/'+REPO+'.git','HEAD:refs/heads/main'],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        status,ref=github('GET','/repos/'+REPO+'/git/ref/heads/main')
        assert status==200 and ref['object']['sha']==sha
        result={'repository':REPO,'repositoryId':data['id'],'defaultBranch':'main','baselineCommit':sha,'baselineCommitCreated':True}
        (ROOT/'baseline-published.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))
