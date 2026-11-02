// Prépare harden WF2 placeholder marqueur contexte pour les workflows n8n.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url);
const exported = JSON.parse(fs.readFileSync(workflowPath));
const workflow = Array.isArray(exported) ? exported[0] : exported;
const preflight = workflow.nodes.find(node => node.name === 'Generic Candidate Preflight');
assert.ok(preflight, 'Generic Candidate Preflight missing');

const before = preflight.parameters.jsCode;
if (!before.includes('const workMarkerOccurrences=')) {
  assert.match(before, /const baselineSource=/, 'frozen baseline source must remain available');
  const start = before.indexOf('const violations=[];const extractComments=');
  const end = before.indexOf("if(operation==='CREATE'&&/\\/dto\\//i.test(path))", start);
  assert.ok(start >= 0 && end > start, 'PLACEHOLDER_MARKER guard drifted');

  const contextualGuard = String.raw`const violations=[];
const normalizeWorkMarker=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
const commentSegments=src=>{const out=[];let i=0;const text=String(src||'');const n=text.length;while(i<n){const ch=text[i];if(ch==='/'&&text[i+1]==='/'){let j=i+2;while(j<n&&text[j]!=='\n')j++;out.push({kind:'line',text:text.slice(i+2,j)});i=j;continue}if(ch==='/'&&text[i+1]==='*'){let j=i+2;while(j<n&&!(text[j]==='*'&&text[j+1]==='/'))j++;out.push({kind:'block',text:text.slice(i+2,j)});i=j<n?j+2:j;continue}if(ch==='"'&&text[i+1]==='"'&&text[i+2]==='"'){let j=i+3;while(j<n&&!(text[j]==='"'&&text[j+1]==='"'&&text[j+2]==='"'))j++;i=j<n?j+3:j;continue}if(ch==='"'||ch==="'"||ch==='\x60'){const quote=ch;let j=i+1;while(j<n){if(text[j]==='\\'){j+=2;continue}if(text[j]===quote){j++;break}if(text[j]==='\n'&&quote!=='\x60')break;j++}i=j;continue}i++}return out};
const workMarkerOccurrences=src=>{const found=[];for(const comment of commentSegments(src)){for(const rawLine of String(comment.text||'').split('\n')){const line=rawLine.replace(/^\s*\*\s?/,'').trim();const match=line.match(/^(TODO|FIXME|XXX|HACK)\b([\s\S]*)$/i);if(!match)continue;const tail=match[2]||'';const contextual=comment.kind==='line'||/^\s*(?::|\(|$)/.test(tail)||/^\s+(?:implement|fix|remove|revisit|broken|later)\b/i.test(tail);if(contextual)found.push(comment.kind+'|'+match[1].toLowerCase()+'|'+normalizeWorkMarker(line))}}return found};
const inheritedWorkMarkers=new Map();for(const fingerprint of workMarkerOccurrences(baselineSource))inheritedWorkMarkers.set(fingerprint,(inheritedWorkMarkers.get(fingerprint)||0)+1);let workMarkerIntroduced=false;for(const fingerprint of workMarkerOccurrences(code)){const remaining=inheritedWorkMarkers.get(fingerprint)||0;if(remaining>0)inheritedWorkMarkers.set(fingerprint,remaining-1);else workMarkerIntroduced=true}
const checks=[[/\b(?:password|secret|api[_-]?key|token)\s*[=:]\s*["'][^"']+["']/i,'POSSIBLE_SECRET'],[/^\s*\/\/\s*(?:if|for|while|return|throw|[\w.]+\s*\()/m,'COMMENTED_OUT_EXECUTABLE']];for(const [re,label] of checks)if(re.test(code))violations.push(label);if(scannerSuppressionIntroduced)violations.push('SCANNER_SUPPRESSION');if(workMarkerIntroduced)violations.push('PLACEHOLDER_MARKER');`;

  preflight.parameters.jsCode = before.slice(0, start) + contextualGuard + before.slice(end);
}

assert.equal(workflow.nodes.length, 186, 'node count changed');
assert.equal(new Set(workflow.nodes.map(node => node.id)).size, 155, 'node ids changed');
fs.writeFileSync(workflowPath, JSON.stringify([workflow], null, 2) + '\n');
console.log(JSON.stringify({workflow: workflow.id, nodes: workflow.nodes.length, placeholderMarkerContextual: true}));
