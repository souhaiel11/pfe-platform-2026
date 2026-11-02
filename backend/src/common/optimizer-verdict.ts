import { Project } from '../projects/project.entity';
import { resolveJenkinsInternalUrl } from './jenkins-url';

export function isSecurityFinding(issue: any): boolean {
  return /security|sécurité|vulnerability|vulnerabil|secret|credential|injection|CVE-/i.test(
    [issue.category, issue.type, issue.title, issue.ruleId].join(' '),
  );
}

export function optimizerVerdict(result: any, build?: any): any {
  if (!result || !Array.isArray(result.issues)) return result;
  const issues = result.issues.filter((i: any) => {
    const severity = String(i.severity || '').toUpperCase();
    const security = isSecurityFinding(i);
    const actionable = ['CRITICAL', 'BLOCKER', 'BLOCKING', 'CRITIQUE', 'BLOQUANT'].includes(severity)
      || i.blocking === true || (['HIGH', 'HAUTE', 'ÉLEVÉE'].includes(severity) && security);
    return actionable && (!build || security);
  });
  return { ...result, issues, validation: build || null,
    summary: issues.length ? result.summary : build
      ? `Tout va bien : build Jenkins #${build.number} réussi pour la version actuelle. Aucun problème bloquant identifié.`
      : 'Aucun problème critique, bloquant ou de sécurité élevée identifié.',
    ...(issues.length ? {} : { estimatedTimeSavingPercent: 0 }),
  };
}

/** Projection only: original diagnostics remain intact in the analysis history. */
export async function currentOptimizerVerdict(row: any, project: Project | null, filePath: string): Promise<any> {
  if (!row?.result || row.status !== 'done') return row;
  let evidence: any;
  try {
    const base = project && resolveJenkinsInternalUrl(project);
    const repo = String(project?.githubRepo || '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    const job = project?.jenkinsJobPath || project?.jenkinsJobName;
    if (base && job && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
      const credential = project.jenkinsToken || process.env.JENKINS_TOKEN;
      const headers: Record<string, string> = credential ? { Authorization: `Basic ${Buffer.from(credential).toString('base64')}` } : {};
      const res = await fetch(`${base}/job/${job}/lastBuild/api/json`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Jenkins unavailable');
      const build = await res.json();
      const revisions = (build.actions || []).map((a: any) => a.lastBuiltRevision?.SHA1).filter(Boolean);
      if (build.result === 'SUCCESS' && !build.building && revisions.length === 1
          && Number(build.timestamp) >= new Date(row.createdAt).getTime()) {
        const ghHeaders: Record<string, string> = { 'User-Agent': 'DevSecOps-Platform', Accept: 'application/vnd.github+json' };
        if (project.githubToken) ghHeaders.Authorization = `Bearer ${project.githubToken}`;
        const headRes = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, { headers: ghHeaders, signal: AbortSignal.timeout(5000) });
        if (!headRes.ok) throw new Error('Repository unavailable');
        const head = await headRes.json();
        if (head.sha === revisions[0]) {
          const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${head.sha}`, { headers: ghHeaders, signal: AbortSignal.timeout(5000) });
          if (fileRes.ok) {
            const file = await fileRes.json();
            if (file.type === 'file' && (filePath !== 'Dockerfile' || await dockerStagePassed(base, job, build.number, headers))) evidence = { number: build.number, commitSha: head.sha, result: 'SUCCESS', filePath };
          }
        }
      }
    }
  } catch { /* Missing evidence must never manufacture a successful validation. */ }
  return { ...row, result: optimizerVerdict(row.result, evidence) };
}

async function dockerStagePassed(base: string, job: string, number: number, headers: Record<string, string>): Promise<boolean> {
  const res = await fetch(`${base}/job/${job}/${number}/wfapi/describe`, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return false;
  const data = await res.json();
  return (data.stages || []).some((stage: any) => /docker.*build|build.*docker|container.*build|build.*image/i.test(stage.name)
    && stage.status === 'SUCCESS');
}
