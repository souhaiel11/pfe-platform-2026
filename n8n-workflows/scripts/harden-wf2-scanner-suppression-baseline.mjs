import fs from 'node:fs';

const workflowPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url);
const exported = JSON.parse(fs.readFileSync(workflowPath));
const workflow = Array.isArray(exported) ? exported[0] : exported;
const node = name => {
  const found = workflow.nodes.find(candidate => candidate.name === name);
  if (!found) throw new Error(`NODE_NOT_FOUND:${name}`);
  return found;
};

// Planning and dependency grounding must always describe the frozen remediation
// baseline. The later Fetch Repository Files node intentionally remains on the
// remediation branch because it supplies the write SHA/current candidate input.
for (const name of [
  'Fetch Finding Source Context',
  'Fetch Referenced API Sources',
  'Fetch Required Dependency Sources',
]) {
  node(name).parameters.additionalParameters.reference = "={{ $('Prepare Batch Context').first().json.baseSha }}";
}

const preflight = node('Generic Candidate Preflight');
const before = preflight.parameters.jsCode;
if (before.includes('const baselineSnapshots=')) {
  preflight.parameters.jsCode = before
    .replace("const operation=String(patch.fileOperation||'');const baselineSnapshots=", "const baselineOperation=String(patch.fileOperation||'');const baselineSnapshots=")
    .replace("const baselineSource=operation==='CREATE'?'':", "const baselineSource=baselineOperation==='CREATE'?'':")
    .replace(";if(baselineOperation==='MODIFY'&&!baselineSource)throw new Error('FROZEN_BASELINE_SOURCE_UNAVAILABLE:'+path)", '');
} else {
const declarations = "const patch=$json;const code=String(patch.patchedCode||'');const source=String(patch.sourceContent||'');const path=String(patch.targetFile||'');";
const baselineAwareDeclarations = declarations + String.raw`
const baselineOperation=String(patch.fileOperation||'');const baselineSnapshots=patch.completePlan?.sourceApiContext||[];const baselineEntry=baselineSnapshots.find(item=>String(item?.file||'')===path);const baselineSource=baselineOperation==='CREATE'?'':String(baselineEntry?.content||'');
const normalizeSuppression=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
const suppressionOccurrences=src=>{const text=String(src||'');const lines=text.split('\n');const offsets=[];let offset=0;for(const line of lines){offsets.push(offset);offset+=line.length+1}const lineAt=index=>{let low=0,high=offsets.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(offsets[mid]<=index)low=mid;else high=mid-1}return low};const pattern=/@SuppressWarnings\s*\((?:[^()"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*\)|\bNOSONAR\b|sonar\.issue\.ignore|eslint-disable(?:-next-line|-line)?|noinspection/gi;const found=[];for(const match of text.matchAll(pattern)){const lineIndex=lineAt(match.index);const rawLine=lines[lineIndex]||'';const kind=/^@SuppressWarnings/i.test(match[0])?'suppresswarnings':/nosonar/i.test(match[0])?'nosonar':/sonar\.issue\.ignore/i.test(match[0])?'sonar-ignore':/eslint-disable/i.test(match[0])?'eslint-disable':'noinspection';let anchor=normalizeSuppression(rawLine);if(kind==='suppresswarnings'||/^\s*(?:\/\/|\/\*)/.test(rawLine)){let cursor=lineAt(match.index+match[0].length-1)+1;while(cursor<lines.length&&(!lines[cursor].trim()||/^\s*(?:\/\/|\/\*|\*|@)/.test(lines[cursor])))cursor++;anchor=normalizeSuppression(lines[cursor]||'END_OF_FILE')}found.push(kind+'|'+normalizeSuppression(match[0])+'|'+anchor)}return found};
const inheritedSuppressions=new Map();for(const fingerprint of suppressionOccurrences(baselineSource))inheritedSuppressions.set(fingerprint,(inheritedSuppressions.get(fingerprint)||0)+1);let scannerSuppressionIntroduced=false;for(const fingerprint of suppressionOccurrences(code)){const remaining=inheritedSuppressions.get(fingerprint)||0;if(remaining>0)inheritedSuppressions.set(fingerprint,remaining-1);else scannerSuppressionIntroduced=true}
`;
if (!before.includes(declarations)) throw new Error('PREFLIGHT_DECLARATIONS_DRIFTED');
let updated = before.replace(declarations, baselineAwareDeclarations);
updated = updated.replace(
  "const path=String(patch.targetFile||'');const policy=patch.repositoryPolicy||{};const planned=(patch.completePlan?.allPlannedFiles||[]).map(f=>f.path);const operation=String(patch.fileOperation||'');",
  "const path=String(patch.targetFile||'');const policy=patch.repositoryPolicy||{};const planned=(patch.completePlan?.allPlannedFiles||[]).map(f=>f.path);",
);
const oldChecks = "const checks=[[/\\b(?:NOSONAR|SuppressWarnings|sonar\\.issue\\.ignore|eslint-disable|noinspection)\\b/i,'SCANNER_SUPPRESSION'],[/\\b(?:password|secret|api[_-]?key|token)\\s*[=:]\\s*[\"'][^\"']+[\"']/i,'POSSIBLE_SECRET'],[/^\\s*\\/\\/\\s*(?:if|for|while|return|throw|[\\w.]+\\s*\\()/m,'COMMENTED_OUT_EXECUTABLE']];for(const [re,label] of checks)if(re.test(code))violations.push(label);";
const newChecks = "const checks=[[/\\b(?:password|secret|api[_-]?key|token)\\s*[=:]\\s*[\"'][^\"']+[\"']/i,'POSSIBLE_SECRET'],[/^\\s*\\/\\/\\s*(?:if|for|while|return|throw|[\\w.]+\\s*\\()/m,'COMMENTED_OUT_EXECUTABLE']];for(const [re,label] of checks)if(re.test(code))violations.push(label);if(scannerSuppressionIntroduced)violations.push('SCANNER_SUPPRESSION');";
if (!updated.includes(oldChecks)) throw new Error('SCANNER_SUPPRESSION_CHECK_DRIFTED');
updated = updated.replace(oldChecks, newChecks);
preflight.parameters.jsCode = updated;
}

if (workflow.nodes.length !== 155) throw new Error(`NODE_COUNT_CHANGED:${workflow.nodes.length}`);
fs.writeFileSync(workflowPath, JSON.stringify([workflow], null, 2) + '\n');
console.log(JSON.stringify({ workflow: workflow.id, nodes: workflow.nodes.length, baselineAwareScannerSuppression: true }));
