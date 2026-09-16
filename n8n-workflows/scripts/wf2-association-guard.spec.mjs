import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Association completeness guard alignment.
//
// "Expand Required Dependency Sources" compares two counts to prove no JPA
// association silently escaped relationship grounding. Both sides must span the
// SAME relationship categories. Production previously counted four categories
// for associationCount while relationFields only extracts the two single-valued
// owning ones, so any @OneToMany/@ManyToMany in the INITIAL source set produced
// a false SOURCE_API_CONTEXT_INCOMPLETE. This suite pins the aligned contract
// and the fail-closed property that must survive it. Production node code is
// executed as-is from the promotion target; nothing is re-implemented here.
const wf=JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url)))[0];
const fixture=JSON.parse(readFileSync(new URL('./fixtures/wf2-association-guard-incident-6edab0c8.json',import.meta.url)));
const node=name=>{const n=wf.nodes.find(n=>n.name===name);assert.ok(n,name);return n;};
const expandNode=node('Expand Required Dependency Sources');

// Production regexes, asserted directly against the shipped node body.
const assocLine=expandNode.parameters.jsCode.split('\n').find(l=>l.includes('const associationCount='));
assert.ok(assocLine,'associationCount computation present');
assert.match(assocLine,/ManyToOne\|OneToOne\)/,'associationCount counts the single-valued owning categories');
assert.doesNotMatch(assocLine,/OneToMany|ManyToMany/,'collection-valued associations are outside this invariant');
const relationLine=expandNode.parameters.jsCode.split('\n').find(l=>l.includes('const relationFields'));
assert.match(relationLine,/\(\?:ManyToOne\|OneToOne\)/,'requiredRelationships parsing is unchanged');

const byPath=new Map(fixture.sources.map(s=>[s.path,s]));
const read=p=>{const s=byPath.get(p);assert.ok(s,'fixture source '+p);return s.content;};
const toItem=path=>({json:{path,sha:'0'.repeat(40),content:Buffer.from(read(path)).toString('base64')}});
const ctx={repository_owner:'souhaiel11',repository_name:'pfe-app-test',baseSha:fixture.sourceCommitSha,
  repositoryPolicy:{existingFiles:fixture.repositoryTree},findings:[]};
function run(name,items,refs={}) {
  const values={'Build Independent Repository Policy':[ctx],'Prepare Batch Context':[ctx],'Lookup Remediation Branch':[{statusCode:404}],...refs};
  const $=key=>{assert.ok(values[key],'unexpected reference '+key);return {first:()=>({json:values[key][0]}),all:()=>values[key].map(json=>({json})),item:{json:values[key][0]}};};
  return new Function('$input','$json','$','Buffer',node(name).parameters.jsCode)({all:()=>items,first:()=>items[0]},items[0]?.json,$,Buffer);
}
// Mirrors the real DEPTH_0 -> DEPTH_1 step (Expand Referenced API Sources) so each
// finding is replayed through the same initial set production would assemble.
const referenced=target=>run('Expand Referenced API Sources',[toItem(target)]).map(i=>i.json.target_file_path);

const guard=target=>{
  const initial=referenced(target).map(toItem);
  try { return {pass:true,items:run('Expand Required Dependency Sources',initial)}; }
  catch (error) { return {pass:false,error}; }
};

// ── 1/2. Parseable single-valued owning relationships are grounded ────────────
const taskController='src/main/java/com/pfe/devsecops/controller/TaskController.java';
const taskEntity='src/main/java/com/pfe/devsecops/model/Task.java';
assert.match(read(taskEntity),/@ManyToOne\b/,'baseline entity declares the owning association');
const s4684=guard(taskController);
assert.ok(s4684.pass,'S4684 source path must remain valid');
const s4684Request=s4684.items[0].json.sourceGroundingRequest;
assert.equal(s4684Request.requiredRelationships.length,1,'S4684 grounds exactly one relationship');
assert.equal(s4684Request.requiredRelationships[0].entityType,'com.pfe.devsecops.model.User');
assert.equal(s4684Request.frozenSourceSha,fixture.sourceCommitSha,'frozen baseline SHA preserved');
assert.equal(s4684Request.expansionDepth,2);
assert.deepEqual([...s4684Request.requiredPaths].sort(),[
  'src/main/java/com/pfe/devsecops/controller/TaskController.java',
  'src/main/java/com/pfe/devsecops/model/Task.java',
  'src/main/java/com/pfe/devsecops/model/User.java',
  'src/main/java/com/pfe/devsecops/repository/TaskRepository.java',
  'src/main/java/com/pfe/devsecops/repository/UserRepository.java',
  'src/main/java/com/pfe/devsecops/service/TaskService.java',
].sort(),'S4684 still expands to the full grounded 6-file set');

// Synthetic single-valued variants exercised through the real node.
const entityVariant=body=>[toItem(taskController),{json:{path:taskEntity,sha:'0'.repeat(40),content:Buffer.from(body).toString('base64')}},
  toItem('src/main/java/com/pfe/devsecops/service/TaskService.java')];
const taskBody=read(taskEntity);
const oneToOne=run('Expand Required Dependency Sources',entityVariant(taskBody.replace('@ManyToOne','@OneToOne')));
assert.equal(oneToOne[0].json.sourceGroundingRequest.requiredRelationships.length,1,'@OneToOne owning side still requires evidence');

// ── 3/4. Collection-valued associations must not false-block ──────────────────
for (const collection of ['@OneToMany(mappedBy = "task")','@ManyToMany']) {
  const items=entityVariant(taskBody.replace('@ManyToOne',collection));
  let expanded;
  assert.doesNotThrow(()=>{expanded=run('Expand Required Dependency Sources',items);},collection+' must not false-block');
  assert.ok(expanded.length>0);
  assert.equal(expanded[0].json.sourceGroundingRequest.requiredRelationships.length,0,
    collection+' contributes no single-valued relationship');
}

// ── 5. Fail-closed preserved for unparseable owning relationships ─────────────
for (const [label,mutation] of [
  ['package-private field','User user;'],
  ['parameterized field type','private Optional<User> user;'],
]) {
  const items=entityVariant(taskBody.replace('private User user;',mutation));
  assert.throws(()=>run('Expand Required Dependency Sources',items),/SOURCE_API_CONTEXT_INCOMPLETE/,
    'unparseable @ManyToOne ('+label+') must fail closed');
}

// ── 6-9. Every current AUTO_FIX_ELIGIBLE finding clears the guard ─────────────
assert.equal(fixture.findings.length,12,'incident 6edab0c8 carries 12 AUTO_FIX_ELIGIBLE findings');
const previouslyBlocked=[
  'src/main/java/com/pfe/devsecops/controller/AuthController.java',
  'src/main/java/com/pfe/devsecops/security/CustomUserDetailsService.java',
  'src/main/java/com/pfe/devsecops/service/AuthService.java',
];
for (const finding of fixture.findings) {
  const result=guard(finding.file);
  assert.ok(result.pass,finding.findingId+' ('+finding.rule+') must clear the association guard: '+(result.error&&result.error.message));
}
// The three paths the asymmetry used to block all pull User.java (@OneToMany) into
// their INITIAL set -- that is precisely why they failed before the alignment.
for (const target of previouslyBlocked) {
  assert.ok(referenced(target).includes('src/main/java/com/pfe/devsecops/model/User.java'),
    target+' pulls the @OneToMany-bearing entity into its initial set');
  assert.ok(guard(target).pass,target+' previously false-blocked, must now pass');
}

console.log('PASS association guard alignment: '+fixture.findings.length+' AUTO_FIX_ELIGIBLE findings clear the guard, '
  +'collection associations no longer false-block, unparseable single-valued relationships still fail closed, S4684 1/1 unchanged');
