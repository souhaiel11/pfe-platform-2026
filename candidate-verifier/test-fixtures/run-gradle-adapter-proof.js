// Isolated proof of GradleBuildAdapter against a real Gradle project, run
// INSIDE the candidate-verifier container (where Gradle 8.10.2 lives).
// NOT part of any pipeline -- instantiates the compiled adapter directly.
const { GradleBuildAdapter } = require('/candidate-verifier/dist/candidate-verifier/src/gradle-build-adapter.js');
const fs = require('fs');
const path = require('path');

const ws = process.argv[2];
const mode = process.argv[3] || 'full'; // 'full' | 'compile-only'
const TIMEOUT_MS = 5 * 60 * 1000;

const adapter = new GradleBuildAdapter();

console.log('=== workspace:', ws, '| mode:', mode, '===');
console.log('buildType         :', adapter.buildType);
console.log('supports()        :', adapter.supports(ws));

const compile = adapter.compile(ws, TIMEOUT_MS);
console.log('\n--- compile() ---');
console.log('status            :', compile.status);
console.log('exitCode          :', compile.exitCode);
console.log('durationMs        :', compile.durationMs);
console.log('evidenceTail (last 800):\n' + String(compile.evidenceTail).slice(-800));

if (mode === 'compile-only') {
  process.exit(0);
}

const reg = adapter.runRegressionTests(ws, TIMEOUT_MS);
console.log('\n--- runRegressionTests() ---');
console.log('status            :', reg.status);
console.log('total             :', reg.total);
console.log('failures          :', reg.failures);
console.log('errors            :', reg.errors);
console.log('skipped           :', reg.skipped);
console.log('durationMs        :', reg.durationMs);
console.log('evidenceRef (last 600):\n' + String(reg.evidenceRef).slice(-600));

// Show the REAL JUnit XML the parse was derived from.
const xmlDir = path.join(ws, 'build', 'test-results', 'test');
console.log('\n--- real JUnit XML under', xmlDir, '---');
try {
  for (const f of fs.readdirSync(xmlDir).filter(n => n.endsWith('.xml'))) {
    console.log('FILE:', f);
    console.log(fs.readFileSync(path.join(xmlDir, f), 'utf8'));
  }
} catch (e) {
  console.log('(could not read XML dir:', e.message, ')');
}
