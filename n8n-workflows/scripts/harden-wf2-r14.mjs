import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../active/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.json', import.meta.url);
const raw = JSON.parse(readFileSync(path, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;
const node = name => {
  const found = workflow.nodes.find(candidate => candidate.name === name);
  if (!found) throw new Error(`Missing WF2 node: ${name}`);
  return found;
};

for (const name of ['Prepare - Code Patch Body', 'Parse - Code Patch Output']) {
  const target = node(name);
  if (target.parameters.mode !== 'runOnceForEachItem') throw new Error(`${name} is not per-item`);
  target.parameters.jsCode = target.parameters.jsCode
    .replaceAll('return [{', 'return {')
    .replaceAll('\n  }];', '\n  };')
    .replaceAll('\n}];', '\n};');
  if (/return \[\{/.test(target.parameters.jsCode)) {
    throw new Error(`${name} still returns an all-items array`);
  }
}

const failure = node('Prepare WF2 Failure Status');
failure.parameters.jsCode = failure.parameters.jsCode.replace(
  "let ctx={};try{ctx=$('Capture Correlation Envelope').first().json.correlationEnvelope||{}}catch{}",
  "const captured=$items('Capture Correlation Envelope',0,0);const ctx=captured?.[0]?.json?.correlationEnvelope||{}",
);
failure.parameters.jsCode = failure.parameters.jsCode.replace('correlationEnvelope||{}const err', 'correlationEnvelope||{};const err');
if (!failure.parameters.jsCode.includes("$items('Capture Correlation Envelope',0,0)")) {
  throw new Error('Failure status does not use the guaranteed captured envelope');
}

const success = node('Save Execution Result to Backend');
const serialized = JSON.stringify(success.parameters).replaceAll(
  "$('Capture Correlation Envelope').first().json.correlationEnvelope",
  "$items('Capture Correlation Envelope',0,0)[0].json.correlationEnvelope",
);
success.parameters = JSON.parse(serialized);

writeFileSync(path, `${JSON.stringify(Array.isArray(raw) ? [workflow] : workflow, null, 2)}\n`);
