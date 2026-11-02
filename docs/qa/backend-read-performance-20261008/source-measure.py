import json,pathlib,urllib.request,hashlib,collections
p=pathlib.Path(__file__).resolve().parent;auth=json.loads(pathlib.Path('/tmp/jury-session.private.json').read_text());project='3aa1c9b9-e114-40e4-884b-ebc7aa32e002';out=[]
def get(ep):
 with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4200/api/'+ep,headers={'Authorization':'Bearer '+auth['token']}),timeout=60) as r:b=r.read();return b,json.loads(b)
def size(v):return len(json.dumps(v,separators=(',',':'),ensure_ascii=False).encode())
for ep in ['incidents?projectId='+project,'reports?projectId='+project]:
 raw,rows=get(ep);totals=collections.Counter();nested=collections.Counter()
 for r in rows:
  for k,v in r.items():totals[k]+=size(v)
  for k in ['metadata','rawData']:
   if isinstance(r.get(k),dict):
    for f,v in r[k].items():nested[k+'.'+f]+=size(v)
  if isinstance(r.get('aiAnalysis'),str):
   try:
    for k,v in json.loads(r['aiAnalysis']).items():nested['aiAnalysis.'+k]+=size(v)
   except:pass
 latest=next((r for r in rows if r.get('aiAnalysis')),None) if ep.startswith('incidents') else rows[0]
 detailraw,detail=get(ep.split('?')[0]+'/'+latest['id']) if latest else (b'',{})
 out.append({'endpoint':'GET /api/'+ep,'caller':'ProjectDetail.loadReports' if ep.startswith('incidents') else 'ProjectDetail.loadJudgeStatus','requestsPerFullNavigation':1,'responseBytes':len(raw),'rowCount':len(rows),'topLevelValueBytes':dict(totals.most_common()),'nestedValueBytes':dict(nested.most_common()),'latestDetail':{'id':latest['id'] if latest else None,'bytes':len(detailraw),'sha256':hashlib.sha256(detailraw).hexdigest()},'analysisCount':sum(bool(r.get('aiAnalysis')) for r in rows)})
(p/'source-measure-before.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
