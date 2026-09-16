const requests = $('Expand Required Dependency Sources').all().map(item=>item.json);
const request = requests[0]?.sourceGroundingRequest;
const requested = request?.requiredPaths || [];
const incomplete = (paths, count=0) => {throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: '+JSON.stringify({
  requestedCount:requested.length,fetchedCount:count,missing:[...new Set(paths)].slice(0,12).map(p=>String(p).slice(0,240))}));};
if(!request || !requested.length || !/^[a-f0-9]{40}$/.test(request.frozenSourceSha)) incomplete([]);
if(requested.length>12) throw new Error('SOURCE_API_CONTEXT_LIMIT_EXCEEDED');
const items=$input.all(); const fetched=new Map(); let totalChars=0;
for(const item of items) {
  const source=item.json||{};
  if(source.error || !requested.includes(source.path)) continue;
  if(fetched.has(source.path)) incomplete([source.path],fetched.size);
  const content=Buffer.from(String(source.content||'').replace(/\n/g,''),'base64').toString('utf8');
  if(!content.trim() || !/^[a-f0-9]{40}$/.test(String(source.sha||''))) continue;
  // Provenance must be the commit ref the fetch actually READ, never source.sha:
  // the GitHub contents response returns a BLOB sha, which is a different identity
  // from a commit sha and must never be compared against frozenSourceSha. The
  // response echoes the requested ref (contents url ?ref=, raw/blob url path), so
  // that echo is the provenance of the request that produced this content. Explicit
  // requestedCommitSha wins when a caller supplies it. Unattributable content fails
  // closed -- accepting it would let evidence claim a commit it never came from.
  const echoedRefs=[String(source.url||'').match(/[?&]ref=([^&]+)/)?.[1],
    ...[source.download_url,source.html_url,source.git_url].map(value=>String(value||'').match(/\b([a-f0-9]{40})\b/)?.[1])]
    .filter(Boolean).map(value=>decodeURIComponent(value).toLowerCase());
  const declaredProvenance=String(source.requestedCommitSha||source.sourceCommitSha||'').toLowerCase();
  const provenance=declaredProvenance||echoedRefs.find(ref=>/^[a-f0-9]{40}$/.test(ref))||'';
  if(!/^[a-f0-9]{40}$/.test(provenance) || provenance!==request.frozenSourceSha
    || echoedRefs.some(ref=>/^[a-f0-9]{40}$/.test(ref)&&ref!==request.frozenSourceSha))
    incomplete([source.path+':source provenance '+(provenance||'UNRESOLVED')+' is not the frozen source '+request.frozenSourceSha],fetched.size);
  totalChars+=content.length;
  if(totalChars>65536) throw new Error('SOURCE_API_CONTEXT_LIMIT_EXCEEDED');
  fetched.set(source.path,{item,info:javaInfo(source.path,content)});
}
const missing=requested.filter(path=>!fetched.has(path));
if(missing.length) incomplete(missing,fetched.size);
const infos=[...fetched.values()].map(value=>value.info);
const groundedRelationshipApis=[];
for(const relationship of request.requiredRelationships) {
  const entity=infos.find(info=>info.packageName+'.'+info.path.split('/').pop().replace(/\.java$/,'')===relationship.entityType && /@(?:[\w.]+\.)?Entity\b/.test(info.code));
  if(!entity) incomplete([relationship.entityType],fetched.size);
  const proofs=[];
  for(const repository of infos) {
    const declaration=repository.code.match(/\bpublic\s+interface\s+(\w+)\s+extends\s+([\w.]+)\s*<\s*([\w.]+)\s*,\s*([\w.]+)\s*>/);
    if(!declaration || repository.resolve(declaration[2])!=='org.springframework.data.jpa.repository.JpaRepository' ||
        repository.resolve(declaration[3])!==relationship.entityType) continue;
    const idType=declaration[4];
    // Narrow audited inheritance adapter, not a guessed service/repository method.
    // Chain/signature verified from local Spring Data JPA + Commons 2.7.0 classfiles.
    if(!['Long','Integer','String','java.lang.Long','java.lang.Integer','java.lang.String','java.util.UUID'].includes(idType)) continue;
    const idField=entity.code.match(/@(?:[\w.]+\.)?Id\b(?:\s*\([^)]*\))?\s*(?:@[\w.]+(?:\s*\([^)]*\))?\s*)*(?:private|protected|public)\s+([\w.]+)\s+\w+\s*[;=]/);
    if(!idField || idField[1].replace(/^java\.lang\./,'')!==idType.replace(/^java\.lang\./,'')) continue;
    proofs.push({ownerPath:relationship.ownerPath,field:relationship.field,entityType:relationship.entityType,
      entitySourcePath:entity.path,repositoryType:repository.packageName+'.'+declaration[1],
      repositorySourcePath:repository.path,repositoryDeclaration:declaration[0],method:'findById',idType,
      returnType:'java.util.Optional<'+relationship.entityType+'>',
      inheritanceContext:{adapter:'SPRING_DATA_JPA_FIND_BY_ID',auditedVersion:'2.7.0',
        chain:['org.springframework.data.jpa.repository.JpaRepository<T, ID>',
          'org.springframework.data.repository.PagingAndSortingRepository<T, ID>',
          'org.springframework.data.repository.CrudRepository<T, ID>'],signature:'java.util.Optional<T> findById(ID)'},
      sourceCommitSha:request.frozenSourceSha});
  }
  if(proofs.length!==1) incomplete([relationship.entityType+':repository API unproven or ambiguous'],fetched.size);
  groundedRelationshipApis.push(proofs[0]);
}
const sourceGrounding={initialPaths:request.initialPaths,requiredPaths:requested,
  frozenSourceSha:request.frozenSourceSha,expansionDepth:2,groundedRelationshipApis};
return requested.map(path=>({json:{...fetched.get(path).item.json,sourceGrounding}}));
