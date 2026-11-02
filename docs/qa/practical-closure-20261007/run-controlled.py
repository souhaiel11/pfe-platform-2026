"""Exactly one operator-scoped run; never resumes/reissues mutation requests."""
import pathlib,importlib.util,subprocess,json,time,sys,traceback
ROOT=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('closure',ROOT/'closure.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
assert (ROOT/'pre-e2e-safety.json').exists()
assert not (ROOT/'plan-created.json').exists(), 'Never rerun this script after plan creation'
assert not c.task()['securityFindingRemediation']
def config(mode):subprocess.run([sys.executable,str(ROOT/'backend-config.py'),mode],check=True)
def ready():
    for _ in range(30):
        try:
            if c.api('GET','/healthz')['status']==200:return
        except subprocess.CalledProcessError:pass
        time.sleep(0.5)
    raise RuntimeError('Backend readiness timeout')
def terminal(seconds):
    stop=time.monotonic()+seconds
    while time.monotonic()<stop:
        t=c.task();r=t.get('securityFindingRemediation') or {}
        if r.get('finishedAt'):return t
        time.sleep(1)
    raise RuntimeError('No terminal outcome within bounded observation window')
passed=False
try:
    config('harness-on');ready();c.create_plan();c.launch(False)
    t=terminal(45);r=t['securityFindingRemediation'];c.state('attempt1-final')
    assert r['attemptCount']==1 and r['attemptNumber']==1 and r['reasonCode']=='VERIFIER_TIMEOUT' and r['retryable'] is True,r
    first=json.loads((ROOT/'attempt1-final.json').read_text());active=[x for x in first['reservations'] if x['state']=='ACTIVE'];assert len(active)==1 and active[0]['ownerAttemptId']==r['attemptId']
    before=c.task();body={'projectId':t['projectId'],'findingTaskId':t['id'],'attemptId':r['attemptId'],'attemptNumber':1,'batchId':r['batchId'],'status':'TECHNICAL_FAILURE','reasonCode':'VERIFIER_TIMEOUT'}
    duplicate=c.api('POST','/internal/security-remediation/result',body,mode='internal');after=c.task();assert duplicate['status'] in [200,201],duplicate;assert before==after
    c.save('duplicate-callback-proof',{'request':body,'response':duplicate,'taskUnchanged':True,'pass':True})
    c.launch(True);c.stale()
    t=terminal(940);r=t['securityFindingRemediation'];c.state('attempt2-final')
    assert r['status']=='OPERATOR_TEST_STOPPED' and r['retryable'] is False and r['attemptNumber']==2 and r['attemptCount']==2,r
    assert r['operatorTest']['controlledStop'] is True and r['operatorTest']['candidateEvaluationPassed'] is True,r
    final=json.loads((ROOT/'attempt2-final.json').read_text());assert not [x for x in final['reservations'] if x['state']=='ACTIVE']
    plan=json.loads((ROOT/'plan-created.json').read_text())['body']['id'];p=next(p for p in final['plans'] if p['id']==plan);assert p['state']=='COMPLETED' and p['consumedAttempt1'] and p['consumedAttempt2'],p
    passed=True
except Exception as e:
    c.save('controlled-run-failure',{'type':type(e).__name__,'message':str(e)});traceback.print_exc()
finally:
    config('harness-off');ready();c.state('final-state');c.freeze()
    c.save('controlled-run-outcome',{'pass':passed,'thirdAttemptCreated':False,'normalDispatchAfter':False,'harnessAfter':False})
    print(json.dumps({'controlledRunPassed':passed,'harnessAfter':False,'normalDispatchAfter':False,'thirdAttemptCreated':False}),flush=True)
raise SystemExit(0 if passed else 1)
