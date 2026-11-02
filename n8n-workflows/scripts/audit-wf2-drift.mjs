// Prépare les écarts entre les versions du workflow dans WF2.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executableContent, presentationContent, presentationDiff, sha256 } from './wf2-drift-content.mjs';
import { reachable, writes } from './build-wf2-cancellation.mjs';
/** Lit les données depuis leur source. */
const read=p=>{const w=JSON.parse(readFileSync(p));return Array.isArray(w)?w[0]:w;};
const currentPath=process.argv[2] || fileURLToPath(new URL('../../docs/qa/wf2-drift-normalization/current-active.json',import.meta.url));
const r=read(new URL('../../docs/qa/r91-live-promotion/WF2-R91-POST-RESTART-ACTIVE.json',import.meta.url));
const w=read(currentPath);
const run=spawnSync(process.execPath,[fileURLToPath(new URL('./wf2-cancellation.spec.mjs',import.meta.url))],{env:{...process.env,WF2_CANCELLATION_ARTIFACT:currentPath},encoding:'utf8'});
const required=['Register WF2 Execution','Execution May Continue?','Restore Registered Intake','Pre-Git Cancellation Gate','Git Write Allowed?','Restore Pre-Git Context','WF2 Cancellation Terminal'];
const dom=writes.map(n=>reachable(w,'Webhook').has(n) && !reachable(w,'Webhook',new Set(['Pre-Git Cancellation Gate'])).has(n));
const terminal=reachable(w,'WF2 Cancellation Terminal');
const isolated=terminal.size===1 && terminal.has('WF2 Cancellation Terminal') && ![...writes,'Save Execution Result to Backend','Persist WF2 Failure Status'].some(n=>terminal.has(n));
const nodesPresent=required.every(name=>w.nodes.filter(n=>n.name===name).length===1);
const eh=[r,w].map(x=>sha256(executableContent(x)));const ph=[r,w].map(x=>sha256(presentationContent(x)));
const securityOk=run.status===0 && dom.every(Boolean) && isolated && nodesPresent;
const report={
 R91_EXECUTABLE_SHA256:eh[0],CURRENT_EXECUTABLE_SHA256:eh[1],EXECUTABLE_HASH_MATCH:eh[0]===eh[1],
 R91_PRESENTATION_SHA256:ph[0],CURRENT_PRESENTATION_SHA256:ph[1],PRESENTATION_HASH_MATCH:ph[0]===ph[1],
 EXECUTABLE_DRIFT:eh[0]!==eh[1],PRESENTATION_DRIFT:ph[0]!==ph[1],SECURITY_INVARIANT_DRIFT:!securityOk,
 W1_W12_EXECUTABLE_PASS:run.status===0,PRESENTATION_DIFF:presentationDiff(r,w),
 PRE_WRITE_GATE_DOMINATES_CREATE_BRANCH:dom[0],PRE_WRITE_GATE_DOMINATES_UPDATE_FILE:dom[1],
 PRE_WRITE_GATE_DOMINATES_CREATE_FILE:dom[2],PRE_WRITE_GATE_DOMINATES_CREATE_PR:dom[3],
 PRE_WRITE_GATE_DOMINANCE_PROVEN:dom.every(Boolean),CANCELLATION_TERMINAL_ISOLATED:isolated,
 R91_CANCELLATION_NODES_PRESENT:nodesPresent,CURRENT_ACTIVE_VERSION_ID:w.activeVersionId,
 FINAL_VERDICT:!securityOk?'C — SECURITY_INVARIANT_DRIFT_FOUND':eh[0]!==eh[1]?'B — EXECUTABLE_DRIFT_FOUND':'A — EXECUTABLE_R91_BEHAVIOR_PRESERVED',
};
console.log(JSON.stringify(report,null,2));
if(!securityOk){console.error(run.stderr || run.stdout);process.exitCode=1;}
