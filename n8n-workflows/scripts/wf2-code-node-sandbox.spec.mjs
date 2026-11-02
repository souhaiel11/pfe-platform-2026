// Teste le composant « wf2-code-node-sandbox » et ses cas d’erreur.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wf=JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url)))[0];
const codeNodes=wf.nodes.filter(n=>n.type==='n8n-nodes-base.code'&&typeof n.parameters?.jsCode==='string');
assert.ok(codeNodes.length>0,'workflow exposes Code nodes to scan');

/** Prépare les données nécessaires à ce scénario. */
const executableOnly=code=>String(code)
  .replace(/\/\*[\s\S]*?\*\//g,' ')
  .split('\n').filter(line=>!/^\s*\/\//.test(line)).join('\n');

// Explicit, documented deny-list. Each entry: why it is unavailable/unsafe here.
const BANNED=[
  {name:'URL',            pattern:/\bnew\s+URL\s*\(|\bURL\s*\.\s*(?:parse|canParse)\s*\(/,
    why:'WHATWG URL is not a Code-node global (execution 2008); parse refs with a literal match'},
  {name:'URLSearchParams',pattern:/\bnew\s+URLSearchParams\s*\(/,
    why:'same WHATWG origin as URL, not provided by the sandbox'},
  {name:'fetch',          pattern:/(?<![.\w])fetch\s*\(/,
    why:'network egress from a Code node is not permitted; use a dedicated HTTP node'},
  {name:'require',        pattern:/(?<![.\w])require\s*\(/,
    why:'module loading is disallowed in the Code-node task runner (R22-E2Q, execution 1952)'},
  {name:'import()',       pattern:/(?<![.\w])import\s*\(/,
    why:'dynamic import is disallowed for the same reason as require()'},
  {name:'process',        pattern:/(?<![.\w])process\s*\./,
    why:'host process/env access is not exposed to Code nodes'},
  {name:'globalThis',     pattern:/(?<![.\w])globalThis\b/,
    why:'reaching for host globals bypasses the sandbox contract'},
  {name:'setTimeout',     pattern:/(?<![.\w])set(?:Timeout|Interval|Immediate)\s*\(/,
    why:'timers are not part of the Code-node execution contract'},
  {name:'TextDecoder',    pattern:/\bnew\s+Text(?:Decoder|Encoder)\s*\(/,
    why:'not a provided global; decode via Buffer, which the sandbox does supply'},
];

const offences=[];
for (const node of codeNodes) {
  const code=executableOnly(node.parameters.jsCode);
  for (const {name,pattern,why} of BANNED)
    if (pattern.test(code)) offences.push(node.name+' uses '+name+' ('+why+')');
}
assert.deepEqual(offences,[],'no Code node may use a sandbox-unavailable global:\n  '+offences.join('\n  '));

// A swallowing catch is only a sandbox hazard when the guarded block can raise a
// ReferenceError from a missing global -- that is exactly how Fix E failed:
// `try { new URL(...) } catch {}` reported "no provenance" instead of crashing.
// A bare `try { JSON.parse(x) } catch {}` fallback is idiomatic and stays allowed,
// so this rule targets the real defect rather than policing unrelated correct code.
const swallowing=[];
for (const node of codeNodes) {
  const code=executableOnly(node.parameters.jsCode);
  for (const m of code.matchAll(/try\s*\{([\s\S]*?)\}\s*catch\s*(?:\(\s*(\w+)\s*\))?\s*\{([\s\S]*?)\}/g)) {
    const [,guarded,binding,handler]=m;
    const risky=BANNED.filter(({pattern})=>pattern.test(guarded)).map(({name})=>name);
    const discards=binding?!handler.includes(binding):true;
    if (risky.length&&discards)
      swallowing.push(node.name+' swallows errors from '+risky.join('/')+' inside try/catch');
  }
}
assert.deepEqual(swallowing,[],'a sandbox error must never be silently discarded:\n  '+swallowing.join('\n  '));

// ── (2) Execution harness that REMOVES the banned globals ────────────────────
// Node bodies are invoked with URL/fetch/require/... explicitly shadowed as
// undefined, so a spec that passes here passes under sandbox conditions too.
export const SANDBOX_SHADOWED=['URL','URLSearchParams','fetch','require','process','globalThis','setTimeout','setInterval','TextDecoder','TextEncoder'];
/** Prépare les données nécessaires à ce scénario. */
export function runInSandbox(jsCode,{$input,$json,$,Buffer:BufferImpl=Buffer}={}) {
  const args=['$input','$json','$','Buffer',...SANDBOX_SHADOWED];
  return new Function(...args,jsCode)($input,$json,$,BufferImpl,...SANDBOX_SHADOWED.map(()=>undefined));
}

// Proof the harness is real, expressed as the bug's actual signature: the pre-Fix-F
// body did not crash in production -- its own catch swallowed the sandbox error and
// it returned "no ref", which is far worse than crashing. So assert BEHAVIOUR.
const SHA='a'.repeat(40);
const item={$json:{url:'https://api.github.com/repos/o/r/contents/F.java?ref='+SHA}};
const PRE_FIX_F="const src=$json;let ref='';try{ref=new URL(String(src.url||'')).searchParams.get('ref');}catch{}return ref||'';";
const POST_FIX_F="const src=$json;return String(src.url||'').match(/[?&]ref=([a-f0-9]{40})(?:[&#]|$)/)?.[1]||'';";
/** Prépare les données nécessaires à ce scénario. */
const inPlainNode=code=>new Function('$json',code)(item.$json);
assert.equal(inPlainNode(PRE_FIX_F),SHA,'URL-based parse resolves the ref in plain Node (why the suite missed it)');
assert.equal(runInSandbox(PRE_FIX_F,item),'','harness must reproduce the sandbox: URL-based parse silently yields NO ref');
assert.equal(inPlainNode(POST_FIX_F),SHA,'sandbox-safe extraction works in plain Node');
assert.equal(runInSandbox(POST_FIX_F,item),SHA,'sandbox-safe extraction works with URL removed');

console.log('PASS Code-node sandbox: '+codeNodes.length+' Code nodes scanned, '+BANNED.length
  +' banned globals enforced, no swallowing catch, harness reproduces sandbox (URL-based parse fails, literal match works)');
