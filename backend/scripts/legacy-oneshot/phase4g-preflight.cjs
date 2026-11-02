#!/usr/bin/env node
// Effectue les contrôles préalables de cohérence et d'accès pour une phase de réconciliation legacy.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{Client}=require('pg'),assert=require('assert/strict');
/** Exécute les étapes principales de ce programme. */
async function main(){
  const sql=fs.readFileSync(path.resolve(__dirname,'../../migrations/20261006_add_remediation_target_reservations.sql'),'utf8');
  const hash=crypto.createHash('sha256').update(sql).digest('hex');
  assert.equal(hash,'8b02321e206ab23039130529607caec4dad363e0128edba746f1d9d5cae55474','QUALIFIED_GUARD_SOURCE_DRIFT');
  const predicate=sql.split('CREATE TEMP VIEW remediation_target_cutover AS\n')[1].split(';')[0];
  const guard=sql.match(/IF EXISTS \((SELECT 1 FROM remediation_target_cutover GROUP BY "projectId" HAVING count\(DISTINCT lifecycle\)>1)\) THEN/)[1];
  const c=new Client({connectionString:process.env.LEGACY_RECONCILIATION_DATABASE_URL});
  await c.connect();try{
    await c.query('BEGIN READ ONLY');
    const result=await c.query('WITH remediation_target_cutover AS ('+predicate+') '+guard);
    await c.query('ROLLBACK');
    const report={checkedAt:new Date().toISOString(),migrationSourceSha256:hash,guard:'exact source predicate and IF EXISTS query; CTE replaces session-only temp view',pass:result.rows.length===0,blockingProjects:result.rows.length,migrationApplied:false};
    if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
  }finally{await c.end();}
}
main().catch(()=>{console.error('PHASE4G_PREFLIGHT_UNPROVEN');process.exitCode=1;});
