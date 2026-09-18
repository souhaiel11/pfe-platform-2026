// Conservative Java signature coherence checks for complete multi-file candidates.
// This is intentionally not a Java parser: it reports only mismatches whose two
// endpoint types can be resolved from candidate or supplied source snapshots.

const clean = source => String(source || '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
const simple = type => String(type || '').replace(/<[^<>]*>/g, '').replace(/\[\]$/g, '').trim().split('.').at(-1);
const compatible = (actual, required) => {
  if (!actual || !required || actual === 'null') return true;
  return actual === required || simple(actual) === simple(required);
};
const splitArgs = text => {
  const out=[]; let depth=0,start=0;
  for(let i=0;i<text.length;i++){
    if('([{<'.includes(text[i])) depth++;
    else if(')]}>'.includes(text[i])) depth--;
    else if(text[i]===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1;}
  }
  const tail=text.slice(start).trim(); if(tail)out.push(tail); return out;
};

export function analyzeJavaTypeCoherence(files, typeResolutionSources=[]) {
  const candidates=(files||[]).filter(file=>String(file.path||'').endsWith('.java'));
  if(candidates.length<2) return [];
  const sources=[...candidates.map(file=>({path:file.path,content:file.content,candidate:true})),
    ...(typeResolutionSources||[]).map(file=>({path:file.path||file.file||'<source-context>',content:file.content||file.source||'',candidate:false}))];
  const types=new Map(), methods=[], enums=new Set();
  for(const file of sources){
    const source=clean(file.content); const packageName=source.match(/\bpackage\s+([\w.]+)\s*;/)?.[1]||'';
    const top=[...source.matchAll(/\b(class|interface|enum|record)\s+(\w+)/g)];
    for(const hit of top){
      const name=hit[2], full=packageName?packageName+'.'+name:name;
      if(!types.has(name))types.set(name,{name,full,file:file.path,kind:hit[1]});
      if(hit[1]==='enum'){enums.add(name);enums.add(full);}
    }
    const owner=top[0]?.[2]||'';
    for(const hit of source.matchAll(/\benum\s+(\w+)/g)){
      enums.add(hit[1]); if(owner)enums.add(owner+'.'+hit[1]);
    }
    const methodPattern=/(?:public|protected|private|static|final|synchronized|abstract|default|native|\s)+([\w.$<>?, \[\]]+)\s+(\w+)\s*\(([^()]*)\)\s*(?:throws\s+[^{;]+)?[{;]/g;
    for(const hit of source.matchAll(methodPattern)){
      const returnType=hit[1].trim().split(/\s+/).at(-1);
      if(['if','for','while','switch','catch','return','new'].includes(returnType))continue;
      const params=splitArgs(hit[3]).map(value=>{const bits=value.replace(/@[\w.]+(?:\([^)]*\))?/g,'').trim().split(/\s+/);return {name:bits.at(-1),type:bits.slice(0,-1).join(' ').replace(/^final\s+/,'')};});
      methods.push({owner,name:hit[2],returnType,params,file:file.path});
    }
  }
  const findMethod=(receiverType,name,argCount)=>{
    const receiver=simple(receiverType);
    const matches=methods.filter(method=>method.name===name&&method.params.length===argCount&&(!receiver||simple(method.owner)===receiver));
    return matches.length===1?matches[0]:null;
  };
  const isEnum=type=>enums.has(type)||enums.has(simple(type))||[...enums].some(value=>value.endsWith('.'+type));
  const mismatches=[];
  for(const file of candidates){
    const source=clean(file.content); const vars=new Map();
    for(const method of methods.filter(item=>item.file===file.path))for(const param of method.params)vars.set(param.name,param.type);
    for(const hit of source.matchAll(/\b([A-Z][\w.$]*(?:<[^;=()]+>)?(?:\[\])?)\s+(\w+)\s*(?=[=;,):])/g))vars.set(hit[2],hit[1]);
    const infer=expression=>{
      const value=String(expression||'').trim();
      if(!value)return null; if(value==='null')return 'null';
      if(/^"(?:[^"\\]|\\.)*"$/.test(value))return 'String';
      if(/^(?:true|false)$/.test(value))return 'boolean';
      if(/^[-+]?\d+[lL]$/.test(value))return 'long'; if(/^[-+]?\d+$/.test(value))return 'int';
      const conditional=value.match(/^.+\?\s*(.+)\s*:\s*null$/s); if(conditional)return infer(conditional[1]);
      const enumFactory=value.match(/^([A-Z][\w.$]*)\.valueOf\(.+\)$/s); if(enumFactory&&isEnum(enumFactory[1]))return enumFactory[1];
      const nameCall=value.match(/^(.+)\.name\(\)$/);
      if(nameCall){const base=infer(nameCall[1]);return base&&isEnum(base)?'String':null;}
      const call=value.match(/^(\w+)\.(\w+)\((.*)\)$/s);
      if(call){const receiverType=vars.get(call[1]);const args=splitArgs(call[3]);const method=findMethod(receiverType,call[2],args.length);return method?.returnType||null;}
      if(vars.has(value))return vars.get(value); return null;
    };
    // Enum.valueOf has the JLS-defined String input contract only when the
    // receiver is proven to be an enum in candidate/source evidence.
    for(const hit of source.matchAll(/\b([A-Z][\w.$]*)\.valueOf\(((?:\w+\.)+\w+\(\))\)/g)){
      const receiver=hit[1], expression=hit[2].trim(); if(!isEnum(receiver))continue;
      const actual=infer(expression); if(!actual||compatible(actual,'String'))continue;
      const producerCall=expression.match(/^(\w+)\.(\w+)\(/); const producer=producerCall?findMethod(vars.get(producerCall[1]),producerCall[2],0):null;
      mismatches.push({producerFile:producer?.file||file.path,producerSymbol:producer?`${producer.owner}.${producer.name}()` : expression,
        declaredType:actual,consumerFile:file.path,consumerExpression:`${receiver}.valueOf(${expression})`,requiredType:'String',
        reason:'A proven enum valueOf invocation requires String, but the resolved producer returns an incompatible type.'});
    }
    // Calls to methods declared in the supplied complete source set.
    for(const hit of source.matchAll(/\b(\w+)\.(\w+)\(([^;\n()]*(?:\([^)]*\)[^;\n()]*)*)\)/g)){
      const receiverType=vars.get(hit[1]); if(!receiverType)continue;
      const args=splitArgs(hit[3]), method=findMethod(receiverType,hit[2],args.length); if(!method)continue;
      args.forEach((expression,index)=>{const actual=infer(expression),required=method.params[index]?.type;if(!actual||compatible(actual,required))return;
        mismatches.push({producerFile:file.path,producerSymbol:expression,declaredType:actual,consumerFile:file.path,
          consumerExpression:`${hit[1]}.${hit[2]}(${expression})`,requiredType:required,
          reason:'The resolved argument type is incompatible with the deterministically resolved sibling method parameter.'});});
    }
    for(const hit of source.matchAll(/\b([A-Z][\w.$]*(?:\[\])?)\s+(\w+)\s*=\s*([^;]+);/g)){
      const required=hit[1],expression=hit[3].trim(),actual=infer(expression);if(!actual||compatible(actual,required))continue;
      mismatches.push({producerFile:file.path,producerSymbol:expression,declaredType:actual,consumerFile:file.path,
        consumerExpression:`${required} ${hit[2]} = ${expression}`,requiredType:required,
        reason:'The resolved expression type is incompatible with the declared assignment target type.'});
    }
    for(const hit of source.matchAll(/(?:^|[;}])\s*(?:(?:public|protected|private|static|final|synchronized)\s+)*([A-Z][\w.$]*(?:\[\])?)\s+(\w+)\s*\([^{};]*\)\s*\{\s*return\s+([^;]+);\s*\}/g)){
      const required=hit[1],expression=hit[3].trim(),actual=infer(expression);if(!actual||compatible(actual,required))continue;
      mismatches.push({producerFile:file.path,producerSymbol:expression,declaredType:actual,consumerFile:file.path,
        consumerExpression:`return ${expression}`,requiredType:required,
        reason:'The resolved return expression type is incompatible with the declared method return type.'});
    }
  }
  return mismatches;
}

export const crossFileTypeCoherenceNodeCode = String.raw`
const clean=source=>String(source||'').replace(/\/\*[\s\S]*?\*\//g,' ').replace(/(^|[^:])\/\/.*$/gm,'$1 ');
const simple=type=>String(type||'').replace(/<[^<>]*>/g,'').replace(/\[\]$/g,'').trim().split('.').at(-1);
const compatible=(actual,required)=>!actual||!required||actual==='null'||actual===required||simple(actual)===simple(required);
const splitArgs=text=>{const out=[];let depth=0,start=0;for(let i=0;i<text.length;i++){if('([{<'.includes(text[i]))depth++;else if(')]}>'.includes(text[i]))depth--;else if(text[i]===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1}}const tail=text.slice(start).trim();if(tail)out.push(tail);return out};
const manifest={...$input.first().json};const candidates=(manifest.files||[]).filter(file=>String(file.path||'').endsWith('.java'));
if(candidates.length<2)return [{json:{...manifest,crossFileTypeCoherencePassed:true,typeCoherenceEvidence:[]}}];
const sources=[...candidates.map(file=>({path:file.path,content:file.content})),...(manifest.typeResolutionSources||[]).map(file=>({path:file.path||file.file||'<source-context>',content:file.content||file.source||''}))];
const types=new Map(),methods=[],enums=new Set();for(const file of sources){const source=clean(file.content),packageName=source.match(/\bpackage\s+([\w.]+)\s*;/)?.[1]||'',top=[...source.matchAll(/\b(class|interface|enum|record)\s+(\w+)/g)];for(const hit of top){const name=hit[2],full=packageName?packageName+'.'+name:name;if(!types.has(name))types.set(name,{name,full,file:file.path,kind:hit[1]});if(hit[1]==='enum'){enums.add(name);enums.add(full)}}const owner=top[0]?.[2]||'';for(const hit of source.matchAll(/\benum\s+(\w+)/g)){enums.add(hit[1]);if(owner)enums.add(owner+'.'+hit[1])}const pattern=/(?:public|protected|private|static|final|synchronized|abstract|default|native|\s)+([\w.$<>?, \[\]]+)\s+(\w+)\s*\(([^()]*)\)\s*(?:throws\s+[^{;]+)?[{;]/g;for(const hit of source.matchAll(pattern)){const returnType=hit[1].trim().split(/\s+/).at(-1);if(['if','for','while','switch','catch','return','new'].includes(returnType))continue;const params=splitArgs(hit[3]).map(value=>{const bits=value.replace(/@[\w.]+(?:\([^)]*\))?/g,'').trim().split(/\s+/);return{name:bits.at(-1),type:bits.slice(0,-1).join(' ').replace(/^final\s+/,'')}});methods.push({owner,name:hit[2],returnType,params,file:file.path})}}
const findMethod=(receiverType,name,argCount)=>{const receiver=simple(receiverType),matches=methods.filter(method=>method.name===name&&method.params.length===argCount&&(!receiver||simple(method.owner)===receiver));return matches.length===1?matches[0]:null};const isEnum=type=>enums.has(type)||enums.has(simple(type))||[...enums].some(value=>value.endsWith('.'+type));const mismatches=[];
for(const file of candidates){const source=clean(file.content),vars=new Map();for(const method of methods.filter(item=>item.file===file.path))for(const param of method.params)vars.set(param.name,param.type);for(const hit of source.matchAll(/\b([A-Z][\w.$]*(?:<[^;=()]+>)?(?:\[\])?)\s+(\w+)\s*(?=[=;,):])/g))vars.set(hit[2],hit[1]);const infer=expression=>{const value=String(expression||'').trim();if(!value)return null;if(value==='null')return'null';if(/^"(?:[^"\\]|\\.)*"$/.test(value))return'String';if(/^(?:true|false)$/.test(value))return'boolean';if(/^[-+]?\d+[lL]$/.test(value))return'long';if(/^[-+]?\d+$/.test(value))return'int';const conditional=value.match(/^.+\?\s*(.+)\s*:\s*null$/s);if(conditional)return infer(conditional[1]);const enumFactory=value.match(/^([A-Z][\w.$]*)\.valueOf\(.+\)$/s);if(enumFactory&&isEnum(enumFactory[1]))return enumFactory[1];const nameCall=value.match(/^(.+)\.name\(\)$/);if(nameCall){const base=infer(nameCall[1]);return base&&isEnum(base)?'String':null}const call=value.match(/^(\w+)\.(\w+)\((.*)\)$/s);if(call){const method=findMethod(vars.get(call[1]),call[2],splitArgs(call[3]).length);return method?.returnType||null}return vars.get(value)||null};for(const hit of source.matchAll(/\b([A-Z][\w.$]*)\.valueOf\(((?:\w+\.)+\w+\(\))\)/g)){const receiver=hit[1],expression=hit[2].trim();if(!isEnum(receiver))continue;const actual=infer(expression);if(!actual||compatible(actual,'String'))continue;const producerCall=expression.match(/^(\w+)\.(\w+)\(/),producer=producerCall?findMethod(vars.get(producerCall[1]),producerCall[2],0):null;mismatches.push({producerFile:producer?.file||file.path,producerSymbol:producer?producer.owner+'.'+producer.name+'()':expression,declaredType:actual,consumerFile:file.path,consumerExpression:receiver+'.valueOf('+expression+')',requiredType:'String',reason:'A proven enum valueOf invocation requires String, but the resolved producer returns an incompatible type.'})}for(const hit of source.matchAll(/\b(\w+)\.(\w+)\(([^;\n()]*(?:\([^)]*\)[^;\n()]*)*)\)/g)){const receiverType=vars.get(hit[1]);if(!receiverType)continue;const args=splitArgs(hit[3]),method=findMethod(receiverType,hit[2],args.length);if(!method)continue;args.forEach((expression,index)=>{const actual=infer(expression),required=method.params[index]?.type;if(!actual||compatible(actual,required))return;mismatches.push({producerFile:file.path,producerSymbol:expression,declaredType:actual,consumerFile:file.path,consumerExpression:hit[1]+'.'+hit[2]+'('+expression+')',requiredType:required,reason:'The resolved argument type is incompatible with the deterministically resolved sibling method parameter.'})})}for(const hit of source.matchAll(/\b([A-Z][\w.$]*(?:\[\])?)\s+(\w+)\s*=\s*([^;]+);/g)){const required=hit[1],expression=hit[3].trim(),actual=infer(expression);if(!actual||compatible(actual,required))continue;mismatches.push({producerFile:file.path,producerSymbol:expression,declaredType:actual,consumerFile:file.path,consumerExpression:required+' '+hit[2]+' = '+expression,requiredType:required,reason:'The resolved expression type is incompatible with the declared assignment target type.'})}for(const hit of source.matchAll(/(?:^|[;}])\s*(?:(?:public|protected|private|static|final|synchronized)\s+)*([A-Z][\w.$]*(?:\[\])?)\s+(\w+)\s*\([^{};]*\)\s*\{\s*return\s+([^;]+);\s*\}/g)){const required=hit[1],expression=hit[3].trim(),actual=infer(expression);if(!actual||compatible(actual,required))continue;mismatches.push({producerFile:file.path,producerSymbol:expression,declaredType:actual,consumerFile:file.path,consumerExpression:'return '+expression,requiredType:required,reason:'The resolved return expression type is incompatible with the declared method return type.'})}}
if(mismatches.length)throw new Error('CROSS_FILE_TYPE_CONTRACT_MISMATCH:'+JSON.stringify({mismatches}));return[{json:{...manifest,crossFileTypeCoherencePassed:true,typeCoherenceEvidence:[]}}];`;
