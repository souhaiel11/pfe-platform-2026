import json,pathlib,statistics,collections,csv,hashlib
p=pathlib.Path(__file__).resolve().parent
B=json.loads((p/'before-measurements.json').read_text());A=json.loads((p/'after-measurements.json').read_text());assert len(B['rows'])==len(A['rows'])==56 and not A['exceptions']
payload=json.loads((p/'payload-characterization.json').read_text()) if (p/'payload-characterization.json').exists() else {'rows':[]}
characterized={r['endpoint']:r['decodedBytes'] for r in payload['rows']}
size=lambda q:q['bytes'] if q['bytes'] is not None else characterized.get(q['endpoint'])
med=statistics.median
key=lambda r:(r['project'],r['flow'],r['mode'])
bg=collections.defaultdict(list);ag=collections.defaultdict(list)
for r in B['rows']:bg[key(r)].append(r)
for r in A['rows']:ag[key(r)].append(r)
comparison=[]
for k,rs in bg.items():
 aa=ag[k];before=med(r['dataCompleteMs'] for r in rs);after=med(r['dataCompleteMs'] for r in aa)
 comparison.append(dict(PROJECT=k[0],PAGE=k[1],MODE=k[2],BEFORE_MS=round(before,1),AFTER_MS=round(after,1),IMPROVEMENT_PERCENT=round((before-after)*100/before,1),REQUESTS_BEFORE=med(r['totalApiRequests'] for r in rs),REQUESTS_AFTER=med(r['totalApiRequests'] for r in aa),FEEDBACK_BEFORE_MS=round(med(r['feedbackMs'] for r in rs),1),FEEDBACK_AFTER_MS=round(med(r['feedbackMs'] for r in aa),1),RENDER_LONG_TASKS_BEFORE_MS=round(med(r['longTaskMs'] for r in rs),1),RENDER_LONG_TASKS_AFTER_MS=round(med(r['longTaskMs'] for r in aa),1)))
def necessary(req,row):
 ep=req['endpoint'];t=row['tab']
 if ep.startswith('/api/incidents?') and '&size=20' in ep:return False,'Overlap with same-project full report/incident response'
 if '/jenkins-status' in ep:return t=='jenkins','Live Jenkins feature'
 if '/manual-remediation' in ep or ep.endswith('/cycles'):return t=='securite','Security/remediation feature'
 if '/azure-deploy/ready/' in ep:return t in ['rapport','securite','deploiement','config'],'Overview/security/configuration/deployment readiness'
 return True,'Shared report/header evidence or active-tab child'
water=[]
for phase,doc in [('before',B),('after',A)]:
 groups=collections.defaultdict(list)
 for r in doc['rows']:
  for req in r['requests']:
   needed,reason=necessary(req,r);groups[(req['endpoint'],needed,reason)].append(req)
 for (ep,n,reason),rs in groups.items():
  caller='ProjectDetail'
  if '/jenkins/analyses' in ep:caller='JenkinsfileOptimizer'
  if '/governance/' in ep:caller='DeploymentGovernance'
  water.append(dict(PHASE=phase,ENDPOINT=ep,COUNT=len(rs),DURATION_MS_MEDIAN=round(med(x['durationMs'] for x in rs),1),DURATION_MS_MAX=max(x['durationMs'] for x in rs),PAYLOAD_SIZE_BYTES_MAX=max((size(x) for x in rs if size(x) is not None),default=None),PAYLOAD_SOURCE='in-band decoded body or separate streaming characterization for inspector-evicted bodies',CALLER_COMPONENT=caller,NECESSARY='YES' if n else 'NO',REASON=reason))
for name,rows in [('before-after',comparison),('network-waterfall',water)]:
 (p/(name+'.json')).write_text(json.dumps(rows,indent=2)+'\n')
 with (p/(name+'.csv')).open('w') as f:w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
# Count removed overlapping and inactive reads only over comparable full-document samples.
def inactive(doc):return sum(not necessary(q,r)[0] and not ('&size=20' in q['endpoint']) for r in doc['rows'] if r['mode']=='cold' for q in r['requests'])
metrics={'PAGES_MEASURED':20,'SAMPLES_PER_RELEASE':56,'TOTAL_REQUESTS_BEFORE':sum(r['totalApiRequests'] for r in B['rows']),'TOTAL_REQUESTS_AFTER':sum(r['totalApiRequests'] for r in A['rows']),'DUPLICATE_REQUESTS_FOUND':sum('&size=20' in q['endpoint'] for r in B['rows'] for q in r['requests']),'DUPLICATE_REQUESTS_REMOVED':sum('&size=20' in q['endpoint'] for r in B['rows'] for q in r['requests'])-sum('&size=20' in q['endpoint'] for r in A['rows'] for q in r['requests']),'INACTIVE_TAB_REQUESTS_FOUND':inactive(B),'INACTIVE_TAB_REQUESTS_REMOVED':inactive(B)-inactive(A),'MEDIAN_UI_IMPROVEMENT_PERCENT':round(med(x['IMPROVEMENT_PERCENT'] for x in comparison if x['MODE']=='cold'),1),'LARGEST_MEASURED_IMPROVEMENT':max((x for x in comparison if x['MODE']=='cold'),key=lambda r:r['IMPROVEMENT_PERCENT']),'DECODED_API_BYTES_BEFORE':sum(q['bytes'] or 0 for r in B['rows'] for q in r['requests']),'DECODED_API_BYTES_AFTER':sum(q['bytes'] or 0 for r in A['rows'] for q in r['requests']),'FIRST_MEANINGFUL_COLD_BEFORE_MS_MEDIAN':round(med(r['feedbackMs'] for r in B['rows'] if r['mode']=='cold'),1),'FIRST_MEANINGFUL_COLD_AFTER_MS_MEDIAN':round(med(r['feedbackMs'] for r in A['rows'] if r['mode']=='cold'),1),'FIRST_MEANINGFUL_COLD_AFTER_MS_MAX':max(r['feedbackMs'] for r in A['rows'] if r['mode']=='cold'),'SLOW_BACKEND_ENDPOINTS':[r for r in water if r['PHASE']=='after' and r['DURATION_MS_MEDIAN']>500 and '/governance/' not in r['ENDPOINT']],'SLOW_EXTERNAL_ENDPOINTS':[r for r in water if r['PHASE']=='after' and r['DURATION_MS_MEDIAN']>500 and '/governance/' in r['ENDPOINT']]}
metrics['CHARACTERIZED_LARGEST_RESPONSE_BYTES']=max(characterized.values(),default=None)
metrics['INBAND_BODY_CAPTURE_ERRORS_BEFORE']=sum(bool(q.get('bodyError')) for r in B['rows'] for q in r['requests'])
metrics['INBAND_BODY_CAPTURE_ERRORS_AFTER']=sum(bool(q.get('bodyError')) for r in A['rows'] for q in r['requests'])
supplement=[]
for phase,doc in [('before',B),('after',A)]:
 for r in doc['rows']:
  known=[q for q in r['requests'] if size(q) is not None]
  largest=max(known,key=size,default=None)
  supplement.append({'phase':phase,'project':r['project'],'flow':r['flow'],'mode':r['mode'],'trial':r['trial'],'largestEndpoint':largest['endpoint'] if largest else None,'largestDecodedBytes':size(largest) if largest else None,'byteSource':'in-band or separate streaming characterization; raw inspector failures retained'})
(p/'response-size-supplement.json').write_text(json.dumps(supplement,indent=2)+'\n')
(p/'performance-summary.json').write_text(json.dumps(metrics,indent=2)+'\n');print(json.dumps(metrics))
