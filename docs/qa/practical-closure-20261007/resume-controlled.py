"""Continue the SAME plan from attempt 1; never launches an initial/third attempt."""
import pathlib,importlib.util,subprocess,json,time,sys,traceback
ROOT=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('closure',ROOT/'closure.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
assert (ROOT/'plan-created.json').exists() and not (ROOT/'retry-response.json').exists()
t=c.task();r=t['securityFindingRemediation'];first=json.loads((ROOT/'attempt1-final.json').read_text())['task']['securityFindingRemediation'];assert r==first and r['attemptCount']==1 and r['retryable'] is True
body={'projectId':t['projectId'],'findingTaskId':t['id'],'attemptId':r['attemptId'],'attemptNumber':1,'batchId':r['batchId'],'status':r['status'],'reason':r['reason'],'reasonCode':r['reasonCode'],'executionId':r['executionId']}
# Prove the exact replay matches the stored completion digest before API replay.
code="""const x=JSON.parse(process.argv[1]),r=x.task.securityFindingRemediation,k=['status','candidateStatus','batchStatus','reason','reasonCode','executionId','prUrl','prNumber','branchName','candidateSha','candidateIdentity','evaluatedSha','patchEvidence','securityValidationEvidence','verificationEvidence','unresolvedGitSideEffect'],result=Object.fromEntries(k.map(k=>[k,r[k]]));const changed=require('./dist/manual-remediation/security-remediation-lifecycle').completeAttempt(x.task,{attemptId:r.attemptId,attemptNumber:r.attemptNumber,batchId:r.batchId},result);if(changed)throw Error('Expected exact duplicate');console.log(JSON.stringify({completionDigestMatches:true}));"""
proof=json.loads(c.control.run(['docker','exec','pfe-backend','node','-e',code,json.dumps({'task':t})]));assert proof['completionDigestMatches']
before=c.task();response=c.api('POST','/internal/security-remediation/result',body,mode='internal');after=c.task();assert response['status'] in [200,201],response;assert before==after
c.save('duplicate-callback-proof',{'request':body,'response':response,'taskUnchanged':True,'completionDigestMatches':True,'pass':True})
def config(mode):subprocess.run([sys.executable,str(ROOT/'backend-config.py'),mode],check=True)
def ready():
 for _ in range(30):
  try:
   if c.api('GET','/healthz')['status']==200:return
  except subprocess.CalledProcessError:pass
  time.sleep(0.5)
 raise RuntimeError('Readiness timeout')
passed=False
try:
 config('configure');ready();config('harness-on');ready()
 c.launch(True);c.stale()
 stop=time.monotonic()+940
 while time.monotonic()<stop:
  t=c.task();r=t['securityFindingRemediation']
  if r.get('finishedAt'):break
  time.sleep(1)
 else:raise RuntimeError('Attempt 2 terminal observation timeout')
 c.state('attempt2-final')
 assert r['status']=='OPERATOR_TEST_STOPPED' and r['retryable'] is False and r['attemptNumber']==2 and r['attemptCount']==2,r
 assert r['operatorTest']['controlledStop'] is True and r['operatorTest']['candidateEvaluationPassed'] is True,r
 final=json.loads((ROOT/'attempt2-final.json').read_text());assert not [x for x in final['reservations'] if x['state']=='ACTIVE']
 plan=json.loads((ROOT/'plan-created.json').read_text())['body']['id'];p=next(p for p in final['plans'] if p['id']==plan);assert p['state']=='COMPLETED' and p['plan']['consumedAttempt1'] and p['plan']['consumedAttempt2'],p
 passed=True
except Exception as e:
 c.save('controlled-continuation-failure',{'type':type(e).__name__,'message':str(e)});traceback.print_exc()
finally:
 config('harness-off');ready();c.state('final-state');c.freeze()
 c.save('controlled-run-outcome',{'pass':passed,'samePlanContinued':True,'initialCallbackProbeCorrected':True,'thirdAttemptCreated':False,'normalDispatchAfter':False,'harnessAfter':False})
 print(json.dumps({'controlledRunPassed':passed,'samePlan':True,'harnessAfter':False,'normalDispatchAfter':False,'thirdAttemptCreated':False}),flush=True)
raise SystemExit(0 if passed else 1)
