const fs = require('fs');
if (!process.env.R2_USE_MOUNTED_CACHE) {
  fs.cpSync('/cache', '/tmp/r2-cache', {recursive: true});
  process.env.SECURITY_TRIVY_CACHE_DIR = '/tmp/r2-cache';
}
process.env.BUILDER_INTERNAL_SECRET = 'isolated-smoke-only';
require('/builder-scanner/dist/builder-scanner/src/server');
(async () => {
  const health = await fetch('http://127.0.0.1:4200/healthz');
  if (health.status !== 200) throw Error('Smoke readiness failed: '+JSON.stringify(await health.json()));
  const response = await fetch('http://127.0.0.1:4200/internal/build-scan', {
    method: 'POST', headers: {'Content-Type':'application/json', 'x-internal-secret':'isolated-smoke-only'},
    body: JSON.stringify({workspacePath:'/tmp/fixture', budgetMs:120000})
  });
  const body = await response.json();
  if (!body.ok) throw Error(JSON.stringify(body));
  const findings = body.scan.report.Results.flatMap(r => r.Vulnerabilities || []);
  const targetPresent = findings.some(v => v.VulnerabilityID === 'CVE-2022-45868' && v.PkgName === 'com.h2database:h2');
  if (targetPresent !== (process.env.R2_EXPECT_TARGET !== 'absent')) throw Error('Unexpected target finding presence');
  console.log(JSON.stringify({runtimeSmokePass:true,healthStatus:health.status,realScanPassed:body.ok,findings:findings.map(v=>({id:v.VulnerabilityID,package:v.PkgName,installedVersion:v.InstalledVersion,fixedVersion:v.FixedVersion}))}));
  process.exit(0);
})().catch(e => {console.error(e);process.exit(1)});
