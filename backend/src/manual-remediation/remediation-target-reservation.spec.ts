// Teste le composant « remediation-target-reservation » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalTarget, normalizeTargetFile, productionTarget, safeTerminalTargetRelease, reserveTarget } from './remediation-target-reservation';
const projectId='3aa1c9b9-e114-40e4-884b-ebc7aa32e002';

/** Faux EntityManager : l'INSERT ne renvoie rien, le SELECT ... FOR UPDATE renvoie la réservation fournie. */
function fakeTx(reservation: any){
 return { query: async (sql: string) => String(sql).includes('SELECT') ? (reservation ? [reservation] : []) : [] } as any;
}
const MINE='11111111-1111-1111-1111-111111111111';
const OTHER='22222222-2222-2222-2222-222222222222';
const key={projectId,targetKey:'["v1","FILE","pom.xml"]',targetFile:'pom.xml'} as any;
test('canonical FILE key excludes finding/scanner/CVE/task/version and preserves resolved Maven case',()=>{
 const a=canonicalTarget(projectId.toUpperCase(),'pom.xml','com.h2database:h2');
 const b=canonicalTarget(projectId,'pom.xml','other:dependency');
 assert.equal(a.targetKey,b.targetKey);assert.equal(a.projectId,b.projectId);
 assert.equal(a.dependencyCoordinate,'com.h2database:h2');
 assert.notEqual(a.targetKey,canonicalTarget(projectId,'module-a/pom.xml','com.h2database:h2').targetKey);
 assert.equal(canonicalTarget(projectId,'pom.xml','Group:Artifact').dependencyCoordinate,'Group:Artifact');
});
test('paths reject traversal/absolute/aliases/encoding/platform separators/control/noncanonical unicode',()=>{
 for(const p of ['../pom.xml','/pom.xml','./pom.xml','a/../pom.xml','a/./pom.xml','a//pom.xml','a/pom.xml/','a\\pom.xml','C:/pom.xml','%70om.xml','pom.xml ',' pom.xml','pom.xml\n','a/../../pom.xml','.git/pom.xml','a/.GIT/pom.xml','póm.xml','']) assert.throws(()=>normalizeTargetFile(p),undefined,p);
 for(const p of ['pom.xml','module-a/pom.xml','a/b/pom.xml']) assert.equal(normalizeTargetFile(p),p);
});
test('invalid coordinate and project never create canonical key',()=>{
 for(const c of ['h2','g:a:v',' g:a','g:a ','pkg:maven/g/a','g/a']) assert.throws(()=>canonicalTarget(projectId,'pom.xml',c));
 assert.throws(()=>canonicalTarget('-'.repeat(36),'pom.xml','g:a'));
});
test('production target follows trusted root grounding rather than scanner-supplied path',()=>{
 const key=productionTarget({projectId,findingSnapshot:{component:'com.h2database:h2',targetFile:'../../evil',fileName:'H2'}});
 assert.equal(key.targetFile,'pom.xml');
});
test('pre-Git failures allow a safe terminal release of the target file',()=>{
 // Échecs déjà couverts avant ce correctif.
 for(const reasonCode of ['APPLICATION_TESTS_FAILED','APPLICATION_TESTS_NOT_EXECUTED','MAVEN_RESOLUTION_MISMATCH',
   'TARGET_CVE_STILL_OPEN_AFTER_PATCH','TARGET_CVE_NEVER_OBSERVED_IN_BASELINE','INVALID_CANDIDATE','MAVEN_MUTATED_CANDIDATE_SOURCE'])
  assert.equal(safeTerminalTargetRelease({reasonCode}),true,reasonCode);
 assert.equal(safeTerminalTargetRelease({status:'OPERATOR_TEST_STOPPED'}),true);
 // Échecs de transport backend <-> worker interne : ajoutés après un blocage
 // réel (cible en quarantaine définitive, aucune voie de récupération).
 // Aucun candidat n'existe à ce stade, donc aucune écriture Git possible.
 for(const reasonCode of ['VERIFIER_UNAVAILABLE','VERIFIER_PROTOCOL_ERROR'])
  assert.equal(safeTerminalTargetRelease({reasonCode}),true,reasonCode);
 // Le suffixe de détail ne doit pas changer la classification : seul le code
 // avant ':' compte (c'est exactement la forme réellement observée,
 // « RUNTIME_COMMAND_FAILED:PODMAN_BASE_IMAGE_PULL » étant remonté en
 // failureClass VERIFIER_UNAVAILABLE par l'orchestrateur).
 assert.equal(safeTerminalTargetRelease({reasonCode:'VERIFIER_UNAVAILABLE:BUILDER_RESPONSE_PARSE'}),true);
 // Refus / échecs d'évaluation (avant toute écriture Git) : la cible se libère.
 for(const status of ['NOT_ELIGIBLE','GROUNDING_FAILED','REMEDIATION_SCOPE_UNPROVEN','CANDIDATE_BUILD_FAILED'])
  assert.equal(safeTerminalTargetRelease({status,reasonCode:'CROSS_MAJOR_ONLY'}),true,status);
 // Statut post-écriture ou ambigu : jamais libéré par ce chemin.
 for(const status of ['CANDIDATE_READY','TECHNICAL_FAILURE','DISPATCHING'])
  assert.equal(safeTerminalTargetRelease({status,reasonCode:'UNKNOWN'}),false,status);
});
test('target conflict distinguishes a RUNNING remediation from a FAILED one holding the file',async()=>{
 // Cas 1 — une remédiation tourne réellement : code et message historiques,
 // strictement inchangés (aucun consommateur existant affecté).
 const running=await reserveTarget(fakeTx({id:'r1',claims:{[OTHER]:{status:'DISPATCHING'}}}),key,[MINE]).then(()=>null,e=>e);
 assert.equal(running.response.code,'REMEDIATION_TARGET_ALREADY_IN_PROGRESS');
 assert.equal(running.response.status,'TARGET_BUSY');
 assert.match(running.response.message,/déjà en cours/);
 // Cas 2 — plus AUCUNE remédiation ne tourne : la réservation a survécu à une
 // tentative terminée en échec (QUARANTINED). C'est exactement la situation
 // où l'ancien message envoyait chercher une « correction existante »
 // introuvable.
 const stuck=await reserveTarget(fakeTx({id:'r2',claims:{[OTHER]:{status:'QUARANTINED'}}}),key,[MINE]).then(()=>null,e=>e);
 assert.equal(stuck.response.code,'REMEDIATION_TARGET_BLOCKED_BY_FAILED_REMEDIATION');
 assert.equal(stuck.response.status,'TARGET_QUARANTINED');
 assert.match(stuck.response.message,/Aucune correction n’est en cours/);
 // Les deux refus doivent nommer le détenteur et le fichier, pour que l'UI
 // puisse dire QUELLE CVE bloque -- l'information qui manquait.
 for(const err of [running,stuck]){
  assert.equal(err.response.targetFile,'pom.xml');
  assert.deepEqual(err.response.blocking.map((b:any)=>b.taskId),[OTHER]);
 }
 // Un mélange « échouée + en cours » ne doit PAS être présenté comme « rien
 // ne tourne » : on reste sur le refus prudent.
 const mixed=await reserveTarget(fakeTx({id:'r3',claims:{[OTHER]:{status:'QUARANTINED'},'33333333-3333-3333-3333-333333333333':{status:'DISPATCHING'}}}),key,[MINE]).then(()=>null,e=>e);
 assert.equal(mixed.response.code,'REMEDIATION_TARGET_ALREADY_IN_PROGRESS');
});
test('a target left only by retry-waiting claims stays joinable, and a missing reservation still conflicts',async()=>{
 // WAITING_RETRY est toléré par conception : la réservation est rejoignable,
 // donc aucun refus. Ce comportement ne doit pas changer.
 const joined=await reserveTarget(fakeTx({id:'r4',claims:{[MINE]:{status:'RESERVED'},[OTHER]:{status:'WAITING_RETRY'}}}),key,[MINE]);
 assert.equal(joined,'r4');
 // Aucune réservation lisible : refus générique, jamais présenté comme une
 // quarantaine (on ne sait pas, donc on ne prétend pas savoir).
 const none=await reserveTarget(fakeTx(null),key,[MINE]).then(()=>null,e=>e);
 assert.equal(none.response.code,'REMEDIATION_TARGET_ALREADY_IN_PROGRESS');
 assert.deepEqual(none.response.blocking,[]);
});
test('a failure that is not provably pre-Git is never releasable',()=>{
 // Contrôles négatifs : rien d'autre n'a été élargi par le correctif.
 // En particulier les échecs survenant APRÈS une écriture Git possible
 // doivent rester non libérables, donc en quarantaine.
 for(const reasonCode of ['WRITE_CONFLICT','PATCH_CONFLICT','BRANCH_CONTENT_CONFLICT','PR_HEAD_SHA_MISMATCH',
   'GUARD_REJECTED','CANDIDATE_DRIFTED','ANCESTRY_INVALID','UNKNOWN_FAILURE','RUNTIME_COMMAND_FAILED',
   'VERIFIER_TIMEOUT','WORKER_DEADLINE_EXCEEDED'])
  assert.equal(safeTerminalTargetRelease({reasonCode}),false,reasonCode);
 // Un reasonCode absent ne vaut jamais autorisation.
 for(const r of [{},{reasonCode:null},{reasonCode:''},{status:'TECHNICAL_FAILURE'}])
  assert.equal(safeTerminalTargetRelease(r),false,JSON.stringify(r));
});
