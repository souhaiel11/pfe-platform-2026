from pathlib import Path
import urllib.request,urllib.error,urllib.parse,json,uuid,time,subprocess,base64,re
p=Path('/home/souhaiel/pfe-2026/platform/docs/qa/sec4e-csrf-review-20261007')
base='http://127.0.0.1:18086'
observations=[]
def http(method,path,data=None,headers=None,port=18086):
 body=json.dumps(data).encode() if data is not None else None
 h=dict(headers or {})
 if data is not None:h.setdefault('Content-Type','application/json')
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=body,method=method,headers=h)
 try:r=urllib.request.urlopen(req,timeout=15)
 except urllib.error.HTTPError as e:r=e
 return r.status,dict(r.headers),r.read()
def record(name,method,path,response,expected=None):
 status,headers,body=response
 row={'test':name,'method':method,'path':re.sub(r'jsessionid=[^&\s]+','jsessionid=REDACTED',path),'status':status,'setCookie':[v for k,v in headers.items() if k.lower()=='set-cookie'],'wwwAuthenticate':next((v for k,v in headers.items() if k.lower()=='www-authenticate'),None),'accessControlAllowOrigin':next((v for k,v in headers.items() if k.lower()=='access-control-allow-origin'),None),'accessControlAllowCredentials':next((v for k,v in headers.items() if k.lower()=='access-control-allow-credentials'),None)}
 if expected is not None:row['pass']=status==expected;assert row['pass'],(name,status,expected)
 observations.append(row);return row
for i in range(60):
 try:
  r=http('GET','/api/auth/health')
  if r[0]==200:break
 except Exception:pass
 time.sleep(1)
record('public_health','GET','/api/auth/health',r,200)
username='sec4e_'+uuid.uuid4().hex[:12];password=uuid.uuid4().hex+'aA!9'
r=http('POST','/api/auth/register',{'username':username,'password':password,'email':username+'@example.invalid'});record('register','POST','/api/auth/register',r,200);userId=json.loads(r[2])['id']
r=http('POST','/api/auth/login',{'username':username,'password':password});record('login','POST','/api/auth/login',r,200);token=json.loads(r[2])['token']
origin='http://attacker.example.invalid';bearer={'Authorization':'Bearer '+token};cookie={'Cookie':'Authorization='+token+'; jwt='+token+'; token='+token+'; auth_token='+token+'; JSESSIONID=diagnostic_session; remember-me='+token}
record('authenticated_read','GET','/api/tasks',http('GET','/api/tasks',headers=bearer),200)
record('next_read_no_bearer','GET','/api/tasks',http('GET','/api/tasks'),403)
record('cookie_only_read','GET','/api/tasks',http('GET','/api/tasks',headers=cookie),403)
basic={'Authorization':'Basic '+base64.b64encode((username+':'+password).encode()).decode()}
record('valid_basic_credentials_not_supported','GET','/api/tasks',http('GET','/api/tasks',headers=basic),403)
record('form_login_not_available','POST','/login',http('POST','/login',{'username':username,'password':password}),403)
record('remember_me_cookie_only','GET','/api/tasks',http('GET','/api/tasks',headers={'Cookie':'remember-me='+token}),403)
request={'title':'SEC4E controlled task','description':'Disposable local fixture','priority':4,'status':'IN_PROGRESS'}
r=http('POST','/api/tasks',request,bearer);record('valid_bearer_create','POST','/api/tasks',r,200);taskId=json.loads(r[2])['id']
paths=[('POST','/api/tasks',request),('PUT',f'/api/tasks/{taskId}',request),('POST',f'/api/tasks/{taskId}/process?action=COMPLETE&role=USER',None),('DELETE',f'/api/tasks/{taskId}',None)]
for method,path,body in paths:
 for name,h in [('anonymous',{}),('cookie_only',cookie),('invalid_jwt',{'Authorization':'Bearer invalid-token'}),('basic_only',basic)]:
  record(name+'_state_change',method,path,http(method,path,body,{**h,'Origin':origin}),403)
# A browser-style simple form POST cannot supply a victim's explicit bearer header.
req=urllib.request.Request(base+'/api/tasks',data=b'title=Untrusted&priority=4',method='POST',headers={'Origin':origin,'Content-Type':'application/x-www-form-urlencoded','Cookie':cookie['Cookie']})
try:r=urllib.request.urlopen(req,timeout=15)
except urllib.error.HTTPError as e:r=e
record('cross_origin_simple_form_cookie_only','POST','/api/tasks',(r.status,dict(r.headers),r.read()),403)
record('cors_preflight_context','OPTIONS','/api/tasks',http('OPTIONS','/api/tasks',headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}),200)
record('valid_bearer_update','PUT',f'/api/tasks/{taskId}',http('PUT',f'/api/tasks/{taskId}',{**request,'status':'DONE'},bearer),200)
record('valid_bearer_process','POST',f'/api/tasks/{taskId}/process?action=COMPLETE&role=USER',http('POST',f'/api/tasks/{taskId}/process?action=COMPLETE&role=USER',headers=bearer),200)
record('valid_bearer_delete_fixture','DELETE',f'/api/tasks/{taskId}',http('DELETE',f'/api/tasks/{taskId}',headers=bearer),204)
for port in [18086,18087]:
 r=http('GET','/h2-console/',port=port);row=record('external_h2_console_'+str(port),'GET','/h2-console/',r);row['remoteAccessDeniedBody']='remote connections' in r[2].decode(errors='replace').lower();row['bodyExcerpt']=r[2].decode(errors='replace')[:1000]
# The loopback probe runs inside each exact candidate; helper class is outside the application tree.
def internal(container,method,path,body='',headers=None):
 args=['docker','exec',container,'java','-cp','/tmp','Sec4eHttpProbe',method,'http://127.0.0.1:8080'+path,base64.b64encode(body.encode()).decode()]
 for k,v in (headers or {}).items():args.extend([k,base64.b64encode(v.encode()).decode()])
 result=subprocess.run(args,check=True,capture_output=True,text=True).stdout;status=None;h={};data=b''
 for line in result.splitlines():
  if line.startswith('STATUS='):status=int(line[7:])
  elif line.startswith('HEADER='):
   k,v=line[7:].split(':',1);h[k]=base64.b64decode(v).decode()
  elif line.startswith('BODY='):data=base64.b64decode(line[5:])
 return status,h,data
h2=[]
for container in ['sec4e-app','sec4e-prod-probe']:
 r=internal(container,'GET','/h2-console/');assert r[0]==200;body=r[2].decode();match=re.search(r'jsessionid=([a-zA-Z0-9]+)',body);assert match;sid=match.group(1)
 row={'container':container,'entryStatus':r[0],'entrySetCookie':[v for k,v in r[1].items() if k.lower()=='set-cookie'],'urlSessionObserved':True,'entryBodyRedacted':body.replace(sid,'REDACTED_H2_SESSION')}
 r=internal(container,'GET','/h2-console/login.jsp?jsessionid='+sid);row['loginFormStatus']=r[0];row['loginFormUsesUrlSession']='login.do?jsessionid=' in r[2].decode();row['loginFormSetCookie']=[v for k,v in r[1].items() if k.lower()=='set-cookie'];
 form=urllib.parse.urlencode({'driver':'org.h2.Driver','url':'jdbc:h2:mem:testdb','user':'sa','password':''})
 r=internal(container,'POST','/h2-console/login.do?jsessionid='+sid,form,{'Content-Type':'application/x-www-form-urlencoded'});row['databaseLoginStatus']=r[0];row['databaseLoginSetCookie']=[v for k,v in r[1].items() if k.lower()=='set-cookie'];row['databaseLoginSucceeded']='frame.jsp' in r[2].decode() or 'query.jsp' in r[2].decode();row['databaseLoginBodyRedacted']=r[2].decode().replace(sid,'REDACTED_H2_SESSION')[:3000]
 if row['databaseLoginSucceeded']:
  # Only a diagnostic table in a disposable database; no application/business rows modified.
  sql="CREATE TABLE SEC4E_REVIEW_PROBE(MARKER VARCHAR(40)); INSERT INTO SEC4E_REVIEW_PROBE VALUES('CONTROLLED_REVIEW'); SELECT * FROM SEC4E_REVIEW_PROBE;"
  r=internal(container,'POST','/h2-console/query.do?jsessionid='+sid,urllib.parse.urlencode({'sql':sql}),{'Content-Type':'application/x-www-form-urlencoded','Origin':origin,'Referer':origin+'/csrf-form.html'})
  row['knownUrlSessionCrossOriginSqlStatus']=r[0];row['knownUrlSessionCrossOriginSqlExecuted']='CONTROLLED_REVIEW' in r[2].decode() and 'error' not in r[2].decode().lower();row['queryBodyRedacted']=r[2].decode().replace(sid,'REDACTED_H2_SESSION')[:4000]
  r=internal(container,'POST','/h2-console/query.do?jsessionid='+sid,urllib.parse.urlencode({'sql':'SELECT COUNT(*) AS ROWS_PROVED FROM SEC4E_REVIEW_PROBE;'}),{'Content-Type':'application/x-www-form-urlencoded'});row['diagnosticTableConfirmed']='ROWS_PROVED' in r[2].decode();row['confirmationBodyRedacted']=r[2].decode().replace(sid,'REDACTED_H2_SESSION')[:2500]
 h2.append(row)
(p/'api-runtime-diagnostics.json').write_text(json.dumps(observations,indent=2));(p/'h2-runtime-diagnostics.json').write_text(json.dumps(h2,indent=2))
print('API diagnostics:',len(observations),'all expected statuses passed; Set-Cookie observed:',sum(bool(x['setCookie']) for x in observations))
print('H2 summary:',json.dumps([{k:v for k,v in x.items() if 'Body' not in k} for x in h2],indent=2))
