// Trace de vérité : backend LIVE -> modules de présentation RÉELS -> sortie
// exactement telle que les gabarits la rendront. Aucune donnée simulée.
import { loadFrontend } from '../../../frontend/scripts/security-lifecycle-test-loader.mjs';
const B = 'http://localhost:3001/api';
const token = (await (await fetch(`${B}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@devsecops.local', password: 'Admin@123' }),
})).json()).token;
const get = async p => (await fetch(`${B}${p}`, { headers: { Authorization: `Bearer ${token}` } })).json();

const ff = loadFrontend('../src/app/shared/french-format.ts');
const row = loadFrontend('../src/app/features/projects/project-list-row.ts', { '../../shared/french-format': ff });
const inc = loadFrontend('../src/app/features/incidents/incidents.component.ts', { '../../shared/french-format': ff });
const labels = loadFrontend('../src/app/shared/status-labels.ts');
const tone = loadFrontend('../src/app/shared/status-chip/status-tone.ts');

const [projects, security, jenkins] = await Promise.all([get('/projects'), get('/dashboard/security-global'), get('/dashboard/jenkins-global')]);
const secBy = new Map((security.byProject || []).map(p => [p.projectId, p]));
const jenBy = new Map((jenkins.projects || []).map(p => [p.projectId, p]));

const TARGETS = ['app-test-pfe-vermeg', 'pfe-app-test'];
for (const p of projects) {
  const readiness = await get(`/azure-deploy/ready/${p.id}`);
  const r = row.buildProjectListRow(p, secBy.get(p.id), jenBy.get(p.id), readiness);
  const star = TARGETS.includes(p.name) ? ' ***' : '';
  console.log(`\n── ${r.name}${star}`);
  console.log(`   dépôt        : ${r.repository ?? 'Dépôt non configuré'}`);
  console.log(`   build        : état=${r.build.state} statut=${r.build.status ?? '∅'} -> « ${r.build.state === 'KNOWN' ? labels.stageStatusLabel(r.build.status) : r.build.state === 'NO_BUILD' ? 'Aucun build' : labels.stageStatusLabel('UNAVAILABLE')} » tonalité=${tone.statusTone(r.build.state === 'KNOWN' ? r.build.status : r.build.state === 'NO_BUILD' ? 'NOT_RUN' : 'UNAVAILABLE')} n°=${r.build.number ?? '∅'}${r.build.numberFromPlatform ? ' (corrélé plateforme)' : ''} motif=${r.build.detail ?? '∅'}`);
  console.log(`   sécurité     : état=${r.security.state} score=${r.security.score ?? '∅ (affiché « — »)'} criticalCves=${r.security.criticalCves ?? '∅'} scannersManquants=[${r.security.missingScanners.join(',')}]`);
  console.log(`   déploiement  : état=${r.deployment.state} -> « ${labels.stageStatusLabel(r.deployment.state)} » tonalité=${tone.statusTone(r.deployment.state)} bloquants=${r.deployment.blockingCount ?? '∅'} premier=${r.deployment.firstReason ?? '∅'}`);
  console.log(`   incidents    : ouverts=${r.openIncidents ?? '∅'} analyse=${r.analyzingIncidents ?? '∅'}`);
  console.log(`   activité     : ${r.lastActivity ?? '∅'} (${r.lastActivityExact ?? '∅'})`);
  console.log(`   À traiter    : ${row.needsAttention(r) ? 'OUI -> ' + row.attentionReasons(r).join(' | ') : 'non'}`);
}

const incidents = await get('/incidents?size=6');
const list = Array.isArray(incidents) ? incidents : incidents.content || [];
console.log(`\n── Liste d'incidents (${list.length} lignes) ──`);
for (const i of list) {
  const r = inc.toIncidentRow(i);
  console.log(`   sévérité=${r.severity ?? '∅ -> « Non déterminée »'} | ${(r.title ?? '').slice(0, 44)} | projet=${r.projectName ?? '∅'} | source=${r.source ?? '∅'} -> « ${r.source ? labels.presentationLabel(r.source) : '—'} » | build=${r.buildNumber ?? '∅ -> « — »'} | statut=${r.status} -> « ${labels.stageStatusLabel(r.status)} » tonalité=${tone.statusTone(r.status)} | activité=${r.lastActivity ?? '∅'}`);
}
