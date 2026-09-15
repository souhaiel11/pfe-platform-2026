// Small, conservative Java source adapter. Unsupported syntax fails closed when
// relationship evidence is required; this is not a general Java compiler.
const cleanJava = source => String(source).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, value => value.replace(/[^\n]/g, ' '));
const javaInfo = (path, content) => {
  const code = cleanJava(content);
  const packageName = code.match(/\bpackage\s+([\w.]+)\s*;/)?.[1] || '';
  const imports = [...code.matchAll(/\bimport\s+(?!static\s)([\w.]+)\s*;/g)].map(m=>m[1]);
  const resolve = name => name.includes('.') ? name : imports.find(value=>value.endsWith('.'+name)) || packageName+'.'+name;
  return {path, content, code, packageName, imports, resolve};
};
const relationFields = source => [...source.code.matchAll(/@(?:[\w.]+\.)?(?:ManyToOne|OneToOne)\b(?:\s*\([^)]*\))?\s*(?:@[\w.]+(?:\s*\([^)]*\))?\s*)*(?:private|protected|public)\s+([\w.]+)\s+(\w+)\s*[;=]/g)]
  .map(match=>({ownerPath:source.path, field:match[2], entityType:source.resolve(match[1])}));
const safeJavaPath = path => /(?:^|\/)src\/main\/java\/[\w/]+\.java$/.test(path) &&
  !/(?:^|\/)(?:target|build|generated|generated-sources|resources|secrets|config|configuration)(?:\/|$)/i.test(path) &&
  !path.startsWith('/') && !path.split('/').some(part=>part==='.'||part==='..') && !/[\0-\x1f\\:]/.test(path);
const sourceRoot = path => path.match(/^(.*?src\/main\/java\/)/)?.[1];
const excludedImport = name => /^(?:java|javax|jakarta|org\.springframework|org\.hibernate|org\.slf4j|lombok)\./.test(name);
