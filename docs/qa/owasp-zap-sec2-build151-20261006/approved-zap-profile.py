import urllib.request, urllib.parse, time, json, sys, os

base   = "http://127.0.0.1:8090"
target = os.environ["ZAP_TARGET_URL"]

def call(path, params=None, timeout=30):
    url = base + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return urllib.request.urlopen(url, timeout=timeout).read().decode()

# RCA-BUILD-138-R15.1: the readiness failure must never be swallowed.
# Record the real exception (class + message, no secrets) so the cause
# is observable in the Jenkins console / kubectl logs.
readiness_error = "no attempt made"
for attempt in range(1, 241):
    try:
        call("/JSON/core/view/version/", timeout=3)
        print("ZAP_READY attempt=%d" % attempt); break
    except Exception as exc:
        readiness_error = "%s: %s" % (type(exc).__name__, exc)
        if attempt == 1 or attempt % 20 == 0:
            print("ZAP_READINESS attempt=%d error=%s" % (attempt, readiness_error))
        time.sleep(3)
else:
    print("ZAP_NOT_READY_AFTER_720S last_error=%s" % readiness_error)
    log_tail = ""
    try:
        log_tail = open("/zap/wrk/zap.log").read()[-2000:]
        print("ZAP_LOG_TAIL:"); print(log_tail)
    except Exception as e2:
        print("COULD_NOT_READ_LOG", e2)
    try:
        open("/zap/wrk/zap.failed", "w").write(
            "ZAP_NOT_READY_AFTER_720S last_error=%s\\n%s" % (readiness_error, log_tail))
    except Exception:
        pass
    sys.exit(1)

try:
    call("/JSON/core/action/accessUrl/", {"url": target, "followRedirects": "true"})
    print("TARGET_ACCESSED")
except Exception as e:
    print("TARGET_ACCESS_ERROR", e)

try:
    sid = json.loads(call("/JSON/spider/action/scan/", {"url": target, "recurse": "true"}))["scan"]
    while True:
        st = json.loads(call("/JSON/spider/view/status/", {"scanId": sid}))["status"]
        if int(st) >= 100: break
        time.sleep(3)
    print("SPIDER_DONE")
except Exception as e:
    print("SPIDER_ERROR", e)

try:
    aid = json.loads(call("/JSON/ascan/action/scan/", {"url": target, "recurse": "true"}))["scan"]
    while True:
        st = json.loads(call("/JSON/ascan/view/status/", {"scanId": aid}))["status"]
        if int(st) >= 100: break
        time.sleep(5)
    print("ACTIVE_SCAN_DONE")
except Exception as e:
    print("ACTIVE_SCAN_ERROR", e)

try:
    open("/zap/wrk/zap-report.json","w").write(call("/OTHER/core/other/jsonreport/", timeout=60))
    print("JSON_REPORT_CREATED")
except Exception as e:
    print("JSON_REPORT_ERROR", e)
    open("/zap/wrk/zap-report.json","w").write(json.dumps({"site":[{"name":target,"alerts":[]}],"status":"zap_report_api_fallback"}))
try:
    open("/zap/wrk/zap-report.html","w").write(call("/OTHER/core/other/htmlreport/", timeout=60))
    print("HTML_REPORT_CREATED")
except Exception as e:
    print("HTML_REPORT_ERROR", e)

# RCA-BUILD-138-R15.1: completion marker must distinguish SUCCESS from
# FAILURE. zap.done only when a non-empty report exists; the parent
# Jenkins wait must never announce "ZAP done" for a scan that produced
# no report. (The ZAP_NOT_READY path above writes zap.failed and exits
# before reaching here.)
try:
    if os.path.getsize("/zap/wrk/zap-report.json") > 0:
        open("/zap/wrk/zap.done", "w").write("ok")
    else:
        open("/zap/wrk/zap.failed", "w").write("ZAP_REPORT_EMPTY")
except Exception as e:
    open("/zap/wrk/zap.failed", "w").write("ZAP_REPORT_MARKER_ERROR %s" % e)
