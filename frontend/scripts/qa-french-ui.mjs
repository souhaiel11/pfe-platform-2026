import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/app/', import.meta.url).pathname;
const files = [];
const walk = dir => readdirSync(dir).forEach(name => { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : /\.(html|ts)$/.test(name) && files.push(path); });
walk(root);

const failures = [];
const rawEnumInterpolation = /\{\{\s*[\w?.]+\.(?:status|decision|riskLevel|securityLevel|severity|remediationType)\s*(?:\|\|\s*['"][^'"]+['"])?\s*\}\}/g;
const emptyCell = /<t[dh][^>]*>\s*<\/t[dh]>/g;
const englishButton = /<button[^>]*>[^<]*(?:\bCancel\b|\bSave\b|\bDelete\b|\bRetry\b|\bReset\b)[^<]*<\/button>/gi;
const forbiddenVisible = /\b(?:Finding|Findings|Owner|Remediation|Evidence|Root Cause|Developer Guidance|Judge Agent|Raw Data|PR Validation|Loading|No data|No results|Not Ready|Build unavailable)\b|\bN\/A\b/g;
const rawVisibleEnum = /\b(?:PASSED|FAILED|FAILURE|WARNING|NOT_RUN|NOT_REACHED|RUNNING|BLOCK|READY|NOT_READY|AUTO_FIX_ELIGIBLE|DEVELOPER_ACTION_REQUIRED|ADMIN_ACTION_REQUIRED|DONE_BY_USER|REOPENED)\b/g;

function presentationFragments(source, file) {
  const templates = file.endsWith('.html')
    ? [source]
    : [...source.matchAll(/template\s*:\s*`([\s\S]*?)`\s*,?\s*(?:styles|styleUrls)/g)].map(m => m[1]);
  return templates.flatMap(template => {
    const clean = template.replace(/<!--[\s\S]*?-->/g, '');
    const attrs = [...clean.matchAll(/(?:aria-label|title|placeholder)\s*=\s*["']([^"']+)["']/g)].map(m => m[1]);
    const text = clean.replace(/<[^>]+>/g, ' ').replace(/\{\{[\s\S]*?\}\}/g, ' ');
    return [text, ...attrs];
  });
}

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const [kind, regex] of [['enum brut', rawEnumInterpolation], ['cellule vide', emptyCell], ['bouton anglais', englishButton]]) {
    for (const match of source.matchAll(regex)) failures.push(`${file.replace(root, '')}: ${kind}: ${match[0].replace(/\s+/g, ' ').slice(0, 140)}`);
  }
  for (const fragment of presentationFragments(source, file)) {
    for (const [kind, regex] of [['chaîne produit anglaise', forbiddenVisible], ['enum brut visible', rawVisibleEnum]]) {
      for (const match of fragment.matchAll(regex)) failures.push(`${file.replace(root, '')}: ${kind}: ${match[0]}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('qa-french-ui: PASS');
