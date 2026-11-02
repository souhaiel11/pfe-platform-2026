// Vérifie les refus WF4 et la limite d’entrée de l’analyse.
import * as assert from 'node:assert/strict';
import { assertOptimizerInput, readOptimizerRejection } from './optimizer-contract';
(async () => {
  assertOptimizerInput('a'.repeat(60000));
  assert.throws(() => assertOptimizerInput('a'.repeat(60001)), /60 000/);
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  assert.match((await readOptimizerRejection(reply({ success: false, error: 'TOO_LARGE' })))!, /60 000/);
  assert.match((await readOptimizerRejection(reply([{ success: false, error: 'TOO_LARGE' }])))!, /60 000/);
  assert.equal(await readOptimizerRejection(reply({ success: false, message: 'Entrée invalide' })), 'Entrée invalide');
  assert.equal(await readOptimizerRejection(reply({ success: true })), null);
  assert.equal(await readOptimizerRejection(reply({ message: 'Workflow was started' })), null);
  assert.match((await readOptimizerRejection(reply({}, 503)))!, /503/);
  console.log('WF4 : limite, refus immédiats et accusés de réception vérifiés.');
})().catch(e => { console.error(e); process.exitCode = 1; });
