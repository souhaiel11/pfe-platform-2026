import json,pathlib,urllib.request,time,gzip
p=pathlib.Path(__file__).resolve().parent;a=json.loads(pathlib.Path('/tmp/jury-session.private.json').read_text());docs=[json.loads((p/(x+'-measurements.json')).read_text()) for x in ['before','after']];missing=sorted({q['endpoint'] for d in docs for r in d['rows'] for q in r['requests'] if q['bytes'] is None});rows=[]
for endpoint in missing:
 t=time.perf_counter();req=urllib.request.Request('http://127.0.0.1:4200'+endpoint,headers={'Authorization':'Bearer '+a['token'],'Accept-Encoding':'identity'})
 with urllib.request.urlopen(req,timeout=60) as r:
  encoded=r.headers.get('Content-Encoding');stream=gzip.GzipFile(fileobj=r) if encoded=='gzip' else r;n=0
  while chunk:=stream.read(1024*1024):n+=len(chunk)
  rows.append({'endpoint':endpoint,'decodedBytes':n,'status':r.status,'durationMs':round((time.perf_counter()-t)*1000,1),'contentEncoding':encoded,'source':'Separate authenticated streaming GET of same endpoint; no body persisted'})
v={'reason':'Chromium inspector evicted the large bodies; this was a measurement limitation, not a failed API/UI request','rows':rows};(p/'payload-characterization.json').write_text(json.dumps(v,indent=2)+'\n');print(json.dumps(v))
