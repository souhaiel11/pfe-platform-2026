import * as assert from 'node:assert/strict';
import { of, throwError } from 'rxjs';
import { ProjectsService } from './projects.service';

/**
 * R46 — aucune valeur Sonar, Trivy ou GitHub ne doit jamais être fabriquée.
 *
 * Les trois replis précédents (getMockSonarMetrics, getMockTrivyReport,
 * getMockGithubStats) renvoyaient des valeurs plausibles — couverture 85 %,
 * 12 code smells, 1500 lignes, 3 CVE élevées, 18 PR fusionnées —
 * indistinguables de vraies données par n'importe quel consommateur.
 *
 * Vérifie aussi le repli sur un jeton Sonar de plateforme : un jeton
 * SonarQube est un jeton d'utilisateur, pas un secret propre à un projet.
 */
const BASE = {
  id: 'p1', name: 'demo', sonarqubeUrl: 'http://sonarqube:9000',
  sonarqubeKey: 'demo', sonarqubeToken: null, githubRepo: null,
};

function service(project: any, http: any) {
  const repo: any = { findOne: async () => project };
  return new ProjectsService(repo, { find: async () => [] } as any, http as any);
}

function okMeasures(measures: Record<string, string>) {
  return {
    status: 200,
    data: { component: { measures: Object.entries(measures).map(([metric, value]) => ({ metric, value })) } },
  };
}

(async () => {
  // ── 1. Sans jeton ni variable de plateforme : indisponible, pas inventé ──
  {
    delete process.env.SONAR_TOKEN;
    const svc = service({ ...BASE }, { get: () => { throw new Error('ne doit pas etre appele'); } });
    const out: any = await svc.getSonarMetrics('p1');
    assert.equal(out.available, false);
    assert.equal(out.reason, 'SONAR_TOKEN_UNAVAILABLE');
    for (const field of ['bugs', 'vulnerabilities', 'codeSmells', 'coverage', 'qualityGate']) {
      assert.equal(out[field], null, `${field} doit rester null, jamais 0 ni 'A'`);
    }
  }

  // ── 2. Jeton de plateforme : la requête part, les mesures sont réelles ──
  {
    process.env.SONAR_TOKEN = 'jeton-de-test';
    const calls: string[] = [];
    const svc = service({ ...BASE }, {
      get: (url: string) => {
        calls.push(url);
        if (url.includes('/api/measures/component')) {
          return of(okMeasures({ bugs: '0', vulnerabilities: '0', code_smells: '7', coverage: '92.4', ncloc: '276', sqale_rating: '1.0' }));
        }
        if (url.includes('/api/qualitygates/project_status')) return of({ status: 200, data: { projectStatus: { status: 'OK' } } });
        if (url.includes('/api/project_analyses/search')) return of({ status: 200, data: { analyses: [{ date: '2026-10-08T15:08:56+0000' }] } });
        return of({ status: 404, data: {} });
      },
    });
    const out: any = await svc.getSonarMetrics('p1');
    assert.equal(out.available, true);
    assert.equal(out.codeSmells, 7);
    assert.equal(out.bugs, 0, 'un 0 réellement mesuré reste 0');
    assert.equal(out.coverage, 92.4);
    assert.equal(out.linesOfCode, 276);
    assert.equal(out.maintainabilityRating, 'A', '1.0 se traduit en A');
    assert.equal(out.qualityGate, 'OK');
    assert.equal(out.lastAnalysisAt, '2026-10-08T15:08:56+0000');
    assert.ok(calls.some(u => u.includes('qualitygates')), 'le contrôle qualité est bien interrogé');
    delete process.env.SONAR_TOKEN;
  }

  // ── 3. Le jeton du projet reste prioritaire sur celui de la plateforme ──
  {
    process.env.SONAR_TOKEN = 'jeton-de-plateforme';
    const seen: string[] = [];
    const svc = service({ ...BASE, sonarqubeToken: 'jeton-du-projet' }, {
      get: (_url: string, cfg: any) => {
        seen.push(Buffer.from(String(cfg.headers.Authorization).replace('Basic ', ''), 'base64').toString());
        return of(okMeasures({ bugs: '1' }));
      },
    });
    await svc.getSonarMetrics('p1');
    assert.ok(seen[0].startsWith('jeton-du-projet:'), 'le jeton du projet gagne');
    delete process.env.SONAR_TOKEN;
  }

  // ── 4. Une métrique absente reste absente ──────────────────────────────
  {
    process.env.SONAR_TOKEN = 'jeton-de-test';
    const svc = service({ ...BASE }, { get: () => of(okMeasures({ bugs: '2' })) });
    const out: any = await svc.getSonarMetrics('p1');
    assert.equal(out.bugs, 2);
    for (const field of ['vulnerabilities', 'codeSmells', 'coverage', 'duplications', 'linesOfCode']) {
      assert.equal(out[field], null, `${field} absent de Sonar doit rester null, jamais 0`);
    }
    for (const field of ['securityRating', 'reliabilityRating', 'maintainabilityRating']) {
      assert.equal(out[field], null, `${field} absent doit rester null, jamais 'A'`);
    }
    delete process.env.SONAR_TOKEN;
  }

  // ── 5. Erreur d'API : motif explicite, aucune mesure plausible ─────────
  {
    process.env.SONAR_TOKEN = 'jeton-de-test';
    for (const [response, expected] of [
      [of({ status: 404, data: {} }), 'SONAR_PROJECT_NOT_FOUND'],
      [of({ status: 401, data: {} }), 'SONAR_API_STATUS_401'],
      [throwError(() => new Error('reseau')), 'SONAR_API_ERROR'],
    ] as any[]) {
      const svc = service({ ...BASE }, { get: () => response });
      const out: any = await svc.getSonarMetrics('p1');
      assert.equal(out.available, false);
      assert.equal(out.reason, expected);
      assert.equal(out.coverage, null);
    }
    delete process.env.SONAR_TOKEN;
  }

  // ── 6. Trivy : plus aucun rapport inventé ──────────────────────────────
  {
    const svc = service({ ...BASE }, { get: () => of({ status: 200, data: {} }) });
    const out: any = await svc.getTrivyReport('p1');
    assert.equal(out.available, false);
    assert.equal(out.reason, 'TRIVY_NOT_QUERYABLE_BY_API');
    for (const field of ['critical', 'high', 'medium', 'low', 'vulnerabilities']) {
      assert.equal(out[field], null, `${field} ne doit jamais etre un nombre invente`);
    }
  }

  // ── 7. GitHub : indisponibilité explicite ──────────────────────────────
  {
    const svc = service({ ...BASE }, { get: () => throwError(() => new Error('api')) });
    const sansDepot: any = await svc.getGithubStats('p1');
    assert.equal(sansDepot.available, false);
    assert.equal(sansDepot.reason, 'GITHUB_REPO_NOT_CONFIGURED');
    assert.equal(sansDepot.mergedPRs, null, 'jamais 18 PR fusionnees inventees');

    const svc2 = service({ ...BASE, githubRepo: 'owner/repo' }, { get: () => throwError(() => new Error('api')) });
    const enErreur: any = await svc2.getGithubStats('p1');
    assert.equal(enErreur.available, false);
    assert.equal(enErreur.reason, 'GITHUB_API_ERROR');
    assert.equal(enErreur.totalPRs, null);
  }

  // ── 8. Corrélation Sonar : le repli de jeton vaut aussi ici ────────────
  {
    delete process.env.SONAR_TOKEN;
    const svc = service({ ...BASE }, { get: () => { throw new Error('ne doit pas etre appele'); } });
    const sans: any = await svc.resolveSonarCorrelation('p1', 'ce-task-1234');
    assert.equal(sans.qualityGate, 'QUALITY_GATE_UNAVAILABLE');
    assert.equal(sans.state, 'SONAR_NOT_CONFIGURED');

    process.env.SONAR_TOKEN = 'jeton-de-test';
    const svc2 = service({ ...BASE }, {
      get: (url: string) => url.includes('/api/ce/task')
        ? of({ status: 200, data: { task: { status: 'SUCCESS', analysisId: 'a-1' } } })
        : of({ status: 200, data: { projectStatus: { status: 'OK' } } }),
    });
    const avec: any = await svc2.resolveSonarCorrelation('p1', 'ce-task-1234');
    assert.equal(avec.qualityGate, 'OK');
    assert.equal(avec.analysisId, 'a-1');
    assert.equal(avec.correlationVerified, true);
    delete process.env.SONAR_TOKEN;
  }

  console.log('R46 sonar/trivy/github data truth: PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
