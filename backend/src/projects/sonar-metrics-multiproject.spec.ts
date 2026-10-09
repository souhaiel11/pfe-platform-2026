import * as assert from 'node:assert/strict';
import { of } from 'rxjs';
import { ProjectsService } from './projects.service';

/**
 * R47 — getSonarMetrics() doit etre generique sur tous les projets.
 *
 * Constate en audit : SonarQube detenait de vraies mesures pour
 * devsecops-testbed (3 bugs, 3 vulnerabilites, 37 code smells, QG ERROR) et
 * devsecops-platform-testbed (couverture 27,6 %, 141 lignes), mais la
 * plateforme rapportait SONAR_NOT_CONFIGURED pour le premier -- parce que son
 * `sonarqubeUrl` etait nul, alors que waitForSonarQualityGate() applique deja
 * un repli sur l'adresse de service interne. La donnee etait PERDUE par la
 * plateforme, pas absente de la source.
 *
 * Verifie aussi que les etats d'absence restent distincts les uns des autres
 * et qu'aucune decision ne depend d'un nom ou d'un identifiant de projet.
 */
const PLATFORM_SONAR = 'http://sonarqube:9000';

function service(project: any, httpGet: (url: string, opts: any) => any) {
  const repo: any = { findOne: async () => project };
  const http: any = { get: (url: string, opts: any) => httpGet(url, opts) };
  return new ProjectsService(repo, { find: async () => [] } as any, http);
}
const measures = (m: Record<string, string>) => ({
  status: 200,
  data: { component: { measures: Object.entries(m).map(([metric, value]) => ({ metric, value })) } },
});

(async () => {
  // ── 1. projectKey + token, AUCUNE url : repli sur l'adresse de plateforme ──
  {
    const seen: string[] = [];
    const svc = service(
      { id: 'p1', name: 'devsecops-testbed', sonarqubeUrl: null, sonarqubeKey: 'devsecops-testbed', sonarqubeToken: 'tok' },
      (url) => {
        seen.push(url);
        if (url.includes('/api/measures/component')) return of(measures({ bugs: '3', vulnerabilities: '3', code_smells: '37', ncloc: '488', duplicated_lines_density: '13.4', security_rating: '5.0' }));
        if (url.includes('/api/qualitygates/project_status')) return of({ status: 200, data: { projectStatus: { status: 'ERROR' } } });
        return of({ status: 200, data: { analyses: [{ date: '2026-08-20T18:18:10+0000' }] } });
      });
    const out: any = await svc.getSonarMetrics('p1');
    assert.equal(out.available, true, 'une url absente ne doit plus rendre le projet non configure');
    assert.equal(out.bugs, 3); assert.equal(out.vulnerabilities, 3); assert.equal(out.codeSmells, 37);
    assert.equal(out.linesOfCode, 488); assert.equal(out.duplications, 13.4);
    assert.equal(out.securityRating, 'E', 'la note 5.0 doit se traduire E');
    assert.equal(out.qualityGate, 'ERROR');
    assert.ok(seen.every(u => u.startsWith(PLATFORM_SONAR)), `toutes les requetes doivent viser ${PLATFORM_SONAR}`);
  }

  // ── 2. L'url propre au projet reste prioritaire sur le repli ──
  {
    const seen: string[] = [];
    const svc = service(
      { id: 'p2', name: 'autre', sonarqubeUrl: 'https://sonar.example.org/', sonarqubeKey: 'autre', sonarqubeToken: 'tok' },
      (url) => { seen.push(url); return of(measures({ bugs: '0' })); });
    await svc.getSonarMetrics('p2');
    assert.ok(seen[0].startsWith('https://sonar.example.org/api/'), 'une url de projet doit etre respectee et normalisee');
  }

  // ── 3. ETATS D'ABSENCE DISTINCTS — jamais fondus en un seul ──
  {
    // Pas de projectKey => reellement non configure.
    const noKey = service({ id: 'p3', sonarqubeUrl: PLATFORM_SONAR, sonarqubeKey: null, sonarqubeToken: 'tok' },
      () => { throw new Error('ne doit pas appeler Sonar'); });
    assert.equal((await noKey.getSonarMetrics('p3') as any).reason, 'SONAR_NOT_CONFIGURED');

    // Key presente mais aucun jeton (ni projet ni plateforme) => indisponible.
    delete process.env.SONAR_TOKEN;
    const noTok = service({ id: 'p4', sonarqubeUrl: PLATFORM_SONAR, sonarqubeKey: 'k', sonarqubeToken: null },
      () => { throw new Error('ne doit pas appeler Sonar'); });
    assert.equal((await noTok.getSonarMetrics('p4') as any).reason, 'SONAR_TOKEN_UNAVAILABLE');

    // Projet inconnu de Sonar => distinct d'une absence de configuration.
    const absent = service({ id: 'p5', sonarqubeUrl: PLATFORM_SONAR, sonarqubeKey: 'jamais-analyse', sonarqubeToken: 'tok' },
      () => of({ status: 404, data: {} }));
    assert.equal((await absent.getSonarMetrics('p5') as any).reason, 'SONAR_PROJECT_NOT_FOUND');

    // Source en erreur => ni zero, ni non configure.
    const broken = service({ id: 'p6', sonarqubeUrl: PLATFORM_SONAR, sonarqubeKey: 'k', sonarqubeToken: 'tok' },
      () => of({ status: 503, data: {} }));
    const b: any = await broken.getSonarMetrics('p6');
    assert.equal(b.reason, 'SONAR_API_STATUS_503');
    for (const f of ['bugs', 'vulnerabilities', 'codeSmells', 'coverage', 'qualityGate', 'linesOfCode']) {
      assert.equal(b[f], null, `${f} doit rester null quand la source echoue`);
    }
  }

  // ── 4. ZERO REEL PRESERVE, et une mesure absente n'est pas zero ──
  {
    const svc = service({ id: 'p7', sonarqubeUrl: PLATFORM_SONAR, sonarqubeKey: 'k', sonarqubeToken: 'tok' },
      (url) => url.includes('/api/measures/component')
        ? of(measures({ bugs: '0', code_smells: '0' }))   // ncloc/coverage non fournis
        : of({ status: 500, data: {} }));
    const out: any = await svc.getSonarMetrics('p7');
    assert.equal(out.bugs, 0, 'un zero mesure doit rester 0');
    assert.equal(out.codeSmells, 0);
    assert.equal(out.coverage, null, 'une mesure non fournie ne doit pas devenir 0');
    assert.equal(out.linesOfCode, null);
    assert.equal(out.qualityGate, null, 'un controle qualite non resolu reste null');
  }

  // ── 5. GENERICITE — un projet nouveau, arbitraire, se comporte pareil ──
  {
    const build = (name: string, key: string) => service(
      { id: 'x', name, sonarqubeUrl: null, sonarqubeKey: key, sonarqubeToken: 'tok' },
      (url) => url.includes('/api/measures/component') ? of(measures({ bugs: '7' })) : of({ status: 500, data: {} }));
    const a: any = await build('projet-onboarde-hier', 'cle-a').getSonarMetrics('x');
    const b: any = await build('tout-autre-nom', 'cle-b').getSonarMetrics('x');
    assert.equal(a.bugs, 7); assert.equal(b.bugs, 7);
    assert.deepEqual(
      { ...a, projectKey: null }, { ...b, projectKey: null },
      'aucun comportement ne doit dependre du nom du projet');
  }

  // ── 6. Aucune identite de projet codee en dur dans le service ──
  {
    const fs = await import('node:fs');
    const code = fs.readFileSync(__dirname + '/projects.service.ts', 'utf8');
    const body = code.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const needle of ['pfe-app-test', 'app-test-pfe-vermeg', 'vuln-testapp', 'devsecops-testbed']) {
      assert.ok(!body.includes(needle), `projects.service.ts ne doit pas nommer ${needle} hors commentaire`);
    }
    assert.ok(!/['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/.test(body),
      'aucun UUID de projet en dur');
  }

  console.log('R47 sonar multi-project data truth: PASS');
})().catch(e => { console.error(e); process.exit(1); });
