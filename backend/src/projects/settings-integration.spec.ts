// Teste le composant « settings-integration » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { of, throwError } from 'rxjs';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProjectsService } from './projects.service';
import { UpdateProjectDto } from './dto/update-project.dto';
import { sanitizeProject } from '../common/sanitize-project';
import { IntegrationsService } from '../integrations/integrations.service';

/** Exécute le traitement et collecte son résultat. */
async function run() {
 const raw:any={id:'second',githubRepo:'team/second',githubToken:'LEAK_github',sonarqubeToken:'LEAK_sonar',jenkinsToken:'user:LEAK_jenkins',sonarqubeUrl:'https://sonar.test',sonarqubeKey:'team:second',azureConfig:null};
 const azureClean:any=sanitizeProject({...raw,azureConfig:{provider:'azure-container-instances',targetName:'public-target',clientSecret:'LEAK_azure_secret'}});
 assert.ok(!JSON.stringify(azureClean).includes('LEAK_'));assert.equal(azureClean.azureConfig.targetName,'public-target');
 const clean:any=sanitizeProject(raw);
 assert.equal(clean.githubCredentialConfigured,true);assert.equal(clean.sonarqubeCredentialConfigured,true);assert.equal(clean.jenkinsCredentialConfigured,true);
 assert.ok(!JSON.stringify(clean).includes('LEAK_'));
 assert.ok(!JSON.stringify(sanitizeProject({...raw,sonarqubeUrl:'https://user:LEAK_pw@sonar.test',validationStatus:{sonarqube:{valid:false,checkedAt:'2026-10-01',message:'LEAK_error'}}})).includes('LEAK_'));
 const updates:any[]=[];
 const repo:any={
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>raw,
 /** Applique les modifications autorisées à l’élément. */
 update:async(_id:any,payload:any)=>{updates.push(payload);Object.assign(raw,payload);}};
 // ProjectsService.update() écrit désormais DANS une transaction, derrière un
 // verrou consultatif PostgreSQL (unicité de la cible Azure) : il appelle
 // repo.manager.transaction(). Ce faux dépôt datait de la version
 // précédente, qui appelait repo.update() directement -- d'où un
 // « Cannot read properties of undefined (reading 'transaction') » qui
 // faisait échouer le test sans qu'aucun défaut produit n'existe.
 // Le manager simulé ci-dessous reproduit le contrat réellement utilisé, et
 // réexpose volontairement le MÊME repo.update que ci-dessus : toutes les
 // assertions d'origine (dont `updates[0]`) restent vérifiées à l'identique.
 repo.manager={
 /** Exécute le corps transactionnel avec un gestionnaire simulé. */
 transaction:async(body:any)=>body({
  /** Absorbe le pg_advisory_xact_lock pris par le service. */
  query:async()=>[],
  /** Fournit le dépôt transactionnel attendu par le service. */
  getRepository:()=>({find:async()=>[raw],update:repo.update}),
 })};
 let authValid=true,exists=true,fail=false,jobValid=true;
 const http:any={
 /** Récupère les données demandées. */
 get:(url:string)=>fail?throwError(()=>new Error('LEAK_remote_error')):of({data:url.includes('/job/')?{name:jobValid?'real-job':null}:url.includes('authentication')?{valid:authValid}:{components:exists?[{key:raw.sonarqubeKey}]:[]}})};
 const service=new ProjectsService(repo,{} as any,http);
 await service.update(raw.id,{githubRepo:'other/different',sonarqubeKey:'different:key'});
 assert.equal(raw.githubRepo,'other/different');assert.equal(raw.sonarqubeKey,'different:key');
 assert.equal(updates[0].githubRepo,'other/different');
 let response=await service.validateProject(raw.id);assert.equal(response.results.sonarqube.valid,true);
 raw.jenkinsInternalUrl='https://ci.test';raw.jenkinsJobName='real-job';
 response=await service.validateProject(raw.id);assert.equal(response.results.jenkins.valid,true);
 jobValid=false;response=await service.validateProject(raw.id);assert.equal(response.results.jenkins.valid,false);
 authValid=false;response=await service.validateProject(raw.id);assert.equal(response.results.sonarqube.valid,false);
 authValid=true;exists=false;response=await service.validateProject(raw.id);assert.equal(response.results.sonarqube.valid,false);
 fail=true;response=await service.validateProject(raw.id);assert.ok(!JSON.stringify(response).includes('LEAK_'));
 const emptyService=new ProjectsService({
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>({id:'empty'}),
 /** Applique les modifications autorisées à l’élément. */
 update:async()=>{}} as any,{} as any,http);
 assert.equal((await emptyService.validateProject('empty')).overallValid,false);
 for(const payload of [{githubRepo:'invalid'},{sonarqubeUrl:'https://user:secret@sonar.test'},{sonarqubeUrl:'https://sonar.test?token=secret'},{sonarqubeKey:'1234'}]) assert.ok((await validate(plainToInstance(UpdateProjectDto,payload))).length);
 assert.equal((await validate(plainToInstance(UpdateProjectDto,{githubRepo:'team/repo',sonarqubeUrl:'https://sonar.test',sonarqubeKey:'team:repo'}))).length,0);
 const integration:any={id:'diag',toolType:'prometheus',url:'https://diag.test',token:'LEAK_token',password:'LEAK_password',status:'error',lastChecked:new Date(),metadata:{error:'LEAK_error'}};
 const intRepo:any={
 /** Recherche les éléments correspondants. */
 find:async()=>[integration],
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>integration,
 /** Applique les modifications autorisées à l’élément. */
 update:async(_id:any,payload:any)=>Object.assign(integration,payload)};
 const integrations=new IntegrationsService(intRepo,{
 /** Récupère les données demandées. */
 get:()=>throwError(()=>new Error('LEAK_url_token'))} as any);
 assert.ok(!JSON.stringify(await integrations.findAll()).includes('LEAK_'));
 assert.ok(!JSON.stringify(await integrations.testConnection('diag')).includes('LEAK_'));
 await integrations.update('diag',{token:'',password:null} as any);assert.equal(integration.token,'LEAK_token');
 await integrations.update('diag',{token:'replacement'});assert.equal(integration.token,'replacement');assert.ok(!JSON.stringify(await integrations.findOne('diag')).includes('replacement'));
 console.log('Real integration persistence, DTO validation, credentials, truthful diagnostics and secret exclusion PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
