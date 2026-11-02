// Construit OWASP nœud patch.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('../../backend/node_modules/typescript');
const markerStart = '// OWASP_MAVEN_NORMALIZER_BEGIN';
const markerEnd = '// OWASP_MAVEN_NORMALIZER_END';
/** Construit OWASP nœud patch. */
export function buildOwaspNodePatch(workflow) {
  const node = workflow.nodes.find(n => n.name === 'Merge All Fetched Data');
  if (!node?.parameters?.jsCode) throw new Error('WF1 merge node missing');
  const source = readFileSync(new URL('../../backend/src/common/owasp-finding-normalizer.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const embedded = `${markerStart}\nconst normalizeOwaspFinding = (() => { const exports = {};\n${compiled}\nreturn exports.normalizeOwaspFinding; })();\n${markerEnd}\n`;
  let code = node.parameters.jsCode;
  if (code.includes(markerStart)) {
    code = code.slice(0, code.indexOf(markerStart)) + code.slice(code.indexOf(markerEnd) + markerEnd.length).replace(/^\n/, '');
  }
  if (!code.includes('owaspCves.push(normalizeOwaspFinding(dep, v));')) {
    const lines = code.split('\n');
    const positions = lines.map((line, i) => line.includes('owaspCves.push({') ? i : -1).filter(i => i >= 0);
    if (positions.length !== 1) throw new Error('Unexpected OWASP mapping shape; refusing broad replacement');
    lines[positions[0]] = '  owaspCves.push(normalizeOwaspFinding(dep, v));';
    code = lines.join('\n');
  }
  code = embedded + code;
  return { workflowId: workflow.id, baseVersionId: workflow.versionId, nodeName: node.name, offlineOnly: true, jsCode: code };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node build-wf1-owasp-normalization.mjs baseline.json offline-node-patch.json');
  const raw = JSON.parse(readFileSync(input, 'utf8'));
  writeFileSync(output, JSON.stringify(buildOwaspNodePatch(Array.isArray(raw) ? raw[0] : raw), null, 2) + '\n');
}
