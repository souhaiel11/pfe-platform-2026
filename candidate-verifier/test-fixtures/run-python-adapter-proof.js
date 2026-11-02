// Isolated proof of PythonBuildAdapter against a real pytest project, run
// INSIDE the candidate-verifier container. NOT part of any pipeline.
const { PythonBuildAdapter } = require('/candidate-verifier/dist/candidate-verifier/src/python-build-adapter.js');
const fs = require('fs');
const path = require('path');

const ws = process.argv[2];
const TIMEOUT_MS = 5 * 60 * 1000;
const adapter = new PythonBuildAdapter(); // same instance: compile() then runRegressionTests()

console.log('=== workspace:', ws, '===');
console.log('buildType   :', adapter.buildType);
console.log('supports()  :', adapter.supports(ws));

const c = adapter.compile(ws, TIMEOUT_MS);
console.log('\n--- compile() ---');
console.log('status      :', c.status);
console.log('exitCode    :', c.exitCode);
console.log('durationMs  :', c.durationMs);
console.log('evidence (last 500):\n' + String(c.evidenceTail).slice(-500));

const r = adapter.runRegressionTests(ws, TIMEOUT_MS);
console.log('\n--- runRegressionTests() ---');
console.log('status      :', r.status);
console.log('total       :', r.total);
console.log('failures    :', r.failures);
console.log('errors      :', r.errors);
console.log('skipped     :', r.skipped);
console.log('durationMs  :', r.durationMs);
console.log('evidence (last 600):\n' + String(r.evidenceRef).slice(-600));
