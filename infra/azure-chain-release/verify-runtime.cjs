// Regroupe les traitements de vérification exécution.
const assert = require('node:assert/strict');
const {Client} = require('pg');
const jwt = require('jsonwebtoken');
/** Exécute les étapes principales de ce programme. */
async function main() {
  const db = new Client({host:process.env.DB_HOST, port:Number(process.env.DB_PORT||5432), user:process.env.DB_USER, password:process.env.DB_PASS, database:process.env.DB_NAME});
  await db.connect();
  const ids = [];
  let token;
  /** Appelle le service avec les paramètres du scénario. */
  const call = async (path, method='GET', body) => {
    const response = await fetch('http://127.0.0.1:3001/api'+path, {
      method, headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})
    });
    const data = await response.json();
    if (method === 'POST' && path === '/projects' && response.status === 201) ids.push(data.id);
    return {status:response.status,data};
  };
  try {
    const {rows} = await db.query('SELECT id FROM users WHERE role=$1 AND "isActive"=true LIMIT 1',['admin']);
    assert.equal(rows.length,1,'active admin required');
    token = jwt.sign({sub:rows[0].id},process.env.JWT_SECRET,{expiresIn:'5m'});
    const before = await db.query('SELECT count(*)::int AS n FROM projects');
    const suffix = Date.now().toString(36);
    const name = 'azure-chain-qa-'+suffix;
    const concurrent = await Promise.all([
      call('/projects','POST',{name}),
      call('/projects','POST',{name:name.toUpperCase()})
    ]);
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
    const project = concurrent.find(r=>r.status===201).data;
    assert.equal(project.azureConfig.targetName,'aci-'+name);
    assert.equal(project.azureConfig.registry,process.env.AZURE_DEFAULT_REGISTRY);
    assert.equal(project.azureConfig.resourceGroup,process.env.AZURE_DEFAULT_RESOURCE_GROUP);
    assert.equal(project.azureConfig.healthCheck,undefined);
    const manual = await call('/projects','POST',{name:name+'-manual',azureConfig:null});
    assert.equal(manual.status,201);
    assert.equal(manual.data.azureConfig,null);
    assert.equal((await call('/projects/'+manual.data.id,'PUT',{azureConfig:project.azureConfig})).status,409);
    const own = {...project.azureConfig,targetName:'aci-'+name+'-manual',imageRepository:name+'-manual'};
    assert.equal((await call('/projects/'+manual.data.id,'PUT',{azureConfig:own})).status,200);
    assert.equal((await call('/projects/'+manual.data.id,'PUT',{azureConfig:{...own,ports:['70000']}})).status,400);
    assert.equal((await call('/projects/'+project.id,'PUT',{azureConfig:project.azureConfig})).status,200);
    for (const id of ids.splice(0)) assert.equal((await call('/projects/'+id,'DELETE')).status,200);
    const after = await db.query('SELECT count(*)::int AS n FROM projects');
    assert.equal(after.rows[0].n,before.rows[0].n);
    console.log(JSON.stringify({result:'PASS',checks:['concurrent slug allocation: 201/409','platform target defaults','no invented health endpoint','explicit opt-out','shared target rejected','manual configuration created','invalid ports rejected','own target update accepted','test projects removed'],projectCountUnchanged:true}));
  } finally {
    for (const id of ids) await call('/projects/'+id,'DELETE');
    await db.end();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
