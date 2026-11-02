// Prépare le rattachement aux preuves du dépôt dans WF2.
/** Retire les éléments inutiles à l’analyse du code Java. */
/** Retire les éléments inutiles à l’analyse du code Java. */
const cleanJava = source => String(source).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, value => value.replace(/[^\n]/g, ' '));
/** Extrait les informations utiles du code Java. */
const javaInfo = (path, content) => {
  const code = cleanJava(content);
  const packageName = code.match(/\bpackage\s+([\w.]+)\s*;/)?.[1] || '';
  const imports = [...code.matchAll(/\bimport\s+(?!static\s)([\w.]+)\s*;/g)].map(m=>m[1]);
  /** Retrouve les données fiables correspondant à la demande. */
  const resolve = name => name.includes('.') ? name : imports.find(value=>value.endsWith('.'+name)) || packageName+'.'+name;
  return {path, content, code, packageName, imports, resolve};
};
/** Retrouve les champs nécessaires à la relation de données. */
const relationFields = source => [...source.code.matchAll(/@(?:[\w.]+\.)?(?:ManyToOne|OneToOne)\b(?:\s*\([^)]*\))?\s*(?:@[\w.]+(?:\s*\([^)]*\))?\s*)*(?:private|protected|public)\s+([\w.]+)\s+(\w+)\s*[;=]/g)]
  .map(match=>({ownerPath:source.path, field:match[2], entityType:source.resolve(match[1])}));
/** Vérifie que le chemin Java reste dans le périmètre autorisé. */
const safeJavaPath = path => /(?:^|\/)src\/main\/java\/[\w/]+\.java$/.test(path) &&
  !/(?:^|\/)(?:target|build|generated|generated-sources|resources|secrets|config|configuration)(?:\/|$)/i.test(path) &&
  !path.startsWith('/') && !path.split('/').some(part=>part==='.'||part==='..') && !/[\0-\x1f\\:]/.test(path);
/** Retrouve la racine des sources du projet. */
const sourceRoot = path => path.match(/^(.*?src\/main\/java\/)/)?.[1];
/** Détermine si un import doit être exclu du contexte. */
const excludedImport = name => /^(?:java|javax|jakarta|org\.springframework|org\.hibernate|org\.slf4j|lombok)\./.test(name);
