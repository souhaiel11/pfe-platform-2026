const ctx = $('Build Independent Repository Policy').first().json;
// Provenance of the EVIDENCE, not the write target. Every source fetch node
// (Finding Source Context / Referenced API Sources / Required Dependency
// Sources) reads at baseSha, so the frozen SHA declared here must be baseSha on
// a first pass AND on a corrective second pass. Declaring the remediation branch
// tip while reading baseSha attributed content to a commit it never came from.
// The remediation branch remains the target for lookup/commit/drift/PR writes.
const frozenSourceSha = String($('Prepare Batch Context').first().json.baseSha||'');
if (!/^[a-f0-9]{40}$/.test(frozenSourceSha)) throw new Error('SOURCE_SHA_FROZEN_REQUIRED');
const initial = $input.all().map(item=>({path:String(item.json.path||''),
  content:Buffer.from(String(item.json.content||'').replace(/\n/g,''),'base64').toString('utf8')}));
if (initial.length>12 || initial.reduce((n,s)=>n+s.content.length,0)>65536) throw new Error('SOURCE_API_CONTEXT_LIMIT_EXCEEDED');
const selected = new Set(initial.map(source=>source.path));
const existing = new Set(ctx.repositoryPolicy.existingFiles);
const infos = initial.filter(source=>safeJavaPath(source.path)).map(source=>javaInfo(source.path,source.content));
const requiredRelationships = infos.flatMap(relationFields);
// Counts ONLY the single-valued owning associations the relationship grounding
// contract can actually prove (repository findById -> Optional<T>). Collection
// associations (@OneToMany/@ManyToMany, always the inverse mappedBy side here)
// carry no single-entity lookup to ground, so counting them produced a false
// mismatch against requiredRelationships. Both sides of this comparison must
// span the SAME relationship categories; the fail-closed property is retained
// for a @ManyToOne/@OneToOne whose declaration relationFields cannot parse.
const associationCount=infos.reduce((count,info)=>count+[...info.code.matchAll(/@(?:[\w.]+\.)?(?:ManyToOne|OneToOne)\b/g)].length,0);
if(associationCount!==requiredRelationships.length) throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: unsupported relationship declaration requires explicit source evidence');
const reasons = new Map();
const add = (path, reason) => { if(safeJavaPath(path)&&existing.has(path)) {selected.add(path); reasons.set(path,reason);} };
for (const info of infos) {
  const root = sourceRoot(info.path);
  // Application namespace is based on the source's package, not third-party paths.
  const applicationPackage = info.packageName.split('.').slice(0,-1).join('.');
  if (!root || !applicationPackage) continue;
  for (const imported of info.imports) {
    if (excludedImport(imported) || !imported.startsWith(applicationPackage+'.')) continue;
    const parts=imported.split('.');
    while(parts.length>1) {const path=root+parts.join('/')+'.java'; if(existing.has(path)){add(path,'LOCAL_IMPORT');break;} parts.pop();}
  }
  // Same-package types (Task.user needs no import) count as the same single hop.
  const samePackage=root+info.packageName.replace(/\./g,'/')+'/';
  for (const path of existing) if(path.startsWith(samePackage)&&!path.slice(samePackage.length).includes('/')) {
    const type=path.slice(samePackage.length).replace(/\.java$/,'');
    if (/^[A-Za-z_$][\w$]*$/.test(type)&&new RegExp('\\b'+type+'\\b').test(info.code)) add(path,'SAME_PACKAGE_TYPE');
  }
  // UserRepository is NOT imported by TaskService. Discover bounded repository
  // candidates in the same module/application when associations need grounding.
  // Their names are never API proof; declarations are validated after fetching.
  if (requiredRelationships.some(relation=>relation.ownerPath===info.path)) {
    const applicationRoot=root+applicationPackage.replace(/\./g,'/')+'/';
    for (const path of existing) if(path.startsWith(applicationRoot)&&/(?:^|\/)(?:repository|repositories)\/[^/]+\.java$/.test(path))
      add(path,'RELATIONSHIP_REPOSITORY_CANDIDATE');
  }
}
if(selected.size>12) throw new Error('SOURCE_API_CONTEXT_LIMIT_EXCEEDED');
const initialPaths=initial.map(source=>source.path);
const requiredPaths=[...selected];
return requiredPaths.map(target_file_path=>({json:{...ctx,target_file_path,
  sourceGroundingRequest:{initialPaths,requiredPaths,requiredRelationships,frozenSourceSha,
    expansionDepth:2,reason:reasons.get(target_file_path)||'INITIAL_SOURCE'}}}));
