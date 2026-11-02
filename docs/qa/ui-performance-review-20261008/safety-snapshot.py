import json,subprocess,pathlib,sys,hashlib
p=pathlib.Path(__file__).resolve().parent
run=lambda a:subprocess.check_output(a,text=True).strip()
tables=['projects','manual_remediation_tasks','incidents','reports','remediation_target_reservations','security_remediation_retry_e2e_plans']
rows={t:json.loads(run(['docker','exec','pfe-postgres','psql','-U','devsecops','-d','devsecops','-Atc',"select coalesce(json_object_agg(id,md5(row_to_json(t)::text)),'{}'::json) from "+t+' t'])) for t in tables}
flags=json.loads(run(['docker','exec','pfe-backend','node','-e',"console.log(JSON.stringify({dispatch:process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED,harness:process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED}))"]))
assert flags=={'dispatch':'false','harness':'false'}
components={name:run(['docker','inspect',name,'--format','{{.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}']) for name in ['pfe-backend','pfe-candidate-verifier','pfe-builder-scanner']}
code="const s=require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3'),d=new s.Database('/home/node/.n8n/database.sqlite',s.OPEN_READONLY);d.all('select id,versionId,nodes,connections,settings from workflow_entity order by id',(e,r)=>{if(e)throw e;console.log(JSON.stringify(r));d.close()})"
w=json.loads(run(['docker','exec','n8n','node','-e',code]));workflowHashes={r['id']:hashlib.sha256(json.dumps(r,sort_keys=True).encode()).hexdigest() for r in w}
v={'flags':flags,'components':components,'rows':rows,'workflowHashes':workflowHashes}
(p/(sys.argv[1]+'.json')).write_text(json.dumps(v,indent=2)+'\n');print(json.dumps({'snapshot':sys.argv[1],'flags':flags,'components':components,'counts':{k:len(v) for k,v in rows.items()}}))
