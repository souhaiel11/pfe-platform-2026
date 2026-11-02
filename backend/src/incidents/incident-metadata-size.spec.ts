// Teste la borne de taille des métadonnées d'incident (analyse WF1 d'un build avec Trivy + OWASP complets).
import * as assert from 'node:assert/strict';
import { userMetadata, METADATA_MAX_CHARS } from './incident-write.dto';

const finding = (i: number) => ({ id: `CVE-2026-${i}`, severity: 'HIGH', description: 'x'.repeat(1000) });
// Taille réelle observée pour projet-validation-vermeg (build #15) : ~1,23 Mo.
const realistic = { enrichedData: { trivy: { cves: Array.from({ length: 600 }, (_, i) => finding(i)) }, owasp: { cves: Array.from({ length: 600 }, (_, i) => finding(i)) } } };
assert.ok(JSON.stringify(realistic).length > 1_000_000);
assert.deepEqual(userMetadata(realistic), realistic, 'un vrai build (> 1 Mo) est accepté');
assert.throws(() => userMetadata({ blob: 'x'.repeat(METADATA_MAX_CHARS + 1) }), /trop volumineux/, 'la borne existe toujours');
assert.throws(() => userMetadata({ ['__proto__']: 1, a: { constructor: 1 } } as any), /interdite/, 'garde-fous inchangés');
console.log('incident-metadata-size: OK');
