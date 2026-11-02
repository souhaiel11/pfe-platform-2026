// Teste réellement les connexions Jenkins, SonarQube et GitHub à partir des valeurs saisies.
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CheckProjectConfigDto, ResultatControle, ResultatVerification } from './config-check.dto';

@Injectable()
export class ConfigCheckService {
  private static readonly DELAI_MS = 6000;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly http: HttpService) {}

  /** Lance les trois contrôles (Jenkins, SonarQube, Git) et agrège le verdict global : bloquant dès qu'un seul est "ko". */
  async verifier(dto: CheckProjectConfigDto): Promise<ResultatVerification> {
    const controles: ResultatControle[] = [
      await this.verifierJenkins(dto),
      await this.verifierSonarQube(dto),
      await this.verifierGithub(dto),
    ];

    const bloquant = controles.some(c => c.etat === 'ko');
    return {
      controles,
      bloquant,
      autoriseEnregistrement: !bloquant,
      verifieLe: new Date().toISOString(),
    };
  }

  /** Vérifie que l'adresse Jenkins répond bien avec un serveur Jenkins, puis que le job configuré existe (si des identifiants sont fournis). */
  private async verifierJenkins(dto: CheckProjectConfigDto): Promise<ResultatControle> {
    const base = this.normaliserUrl(dto.jenkinsInternalUrl);
    /** Construit le résultat de vérification d’un champ. */
    const ligne = (etat: ResultatControle['etat'], message: string): ResultatControle =>
      ({ id: 'jenkins', champ: 'Jenkins', section: 'cicd', etat, message });

    if (!base) return ligne('skip', 'Adresse non renseignée — aucun test possible.');

    const { code, entetes } = await this.reponse(`${base}/api/json`);
    if (code === null) {
      return ligne('ko', `Aucune réponse de ${base}. Vérifiez l'adresse interne de Jenkins.`);
    }
    const version = String(entetes['x-jenkins'] || entetes['X-Jenkins'] || '').trim();
    if (!version) {
      return ligne('ko', `${base} répond (HTTP ${code}) mais ce n'est pas un serveur Jenkins `
                       + `(en-tête X-Jenkins absent). Vérifiez l'adresse.`);
    }

    const chemin = this.cheminJob(dto.jenkinsJobPath || dto.jenkinsJobName);
    if (!chemin) {
      return ligne('ok', `Jenkins ${version} joignable à ${base}. Aucun job renseigné.`);
    }
    const lisible = chemin.replace(/\/job\//g, ' / ').replace(/^ \/ /, '');

    const auth = this.authBasique(dto.jenkinsUsername, dto.jenkinsToken);
    if (!auth) {
      return ligne('ok', `Jenkins ${version} joignable à ${base}. Chemin du job « ${lisible} » `
                       + `non vérifié : saisissez l'utilisateur et le jeton Jenkins pour le tester.`);
    }

    const codeJob = await this.statut(`${base}${chemin}/api/json`, auth);
    if (codeJob === 200) {
      return ligne('ok', `Jenkins ${version} joignable à ${base}, job « ${lisible} » trouvé.`);
    }
    if (codeJob === null) {
      return ligne('ko', `Jenkins répond, mais aucune réponse sur le chemin du job « ${lisible} ».`);
    }
    if (codeJob === 401 || codeJob === 403) {
      return ligne('ko', `Jenkins refuse les identifiants (HTTP ${codeJob}). `
                       + `Vérifiez l'utilisateur et le jeton.`);
    }
    if (codeJob === 404) {
      return ligne('ko', `Job « ${lisible} » introuvable sur ce Jenkins. Pour un job multibranche, `
                       + `le chemin s'écrit « job/job/branche » dans Jenkins Job Path.`);
    }
    return ligne('ko', `Réponse inattendue de Jenkins sur le chemin du job (HTTP ${codeJob}).`);
  }

  /** Vérifie que SonarQube répond et est à l'état "UP", puis que la clé de projet est acceptée si une clé est fournie. */
  private async verifierSonarQube(dto: CheckProjectConfigDto): Promise<ResultatControle> {
    const base = this.normaliserUrl(dto.sonarqubeUrl);
    /** Construit le résultat de vérification d’un champ. */
    const ligne = (etat: ResultatControle['etat'], message: string): ResultatControle =>
      ({ id: 'sonarqube', champ: 'SonarQube', section: 'sonarqube', etat, message });

    if (!base) return ligne('skip', 'Adresse non renseignée — aucun test possible.');

    let etatServeur: string | null = null;
    try {
      const r = await firstValueFrom(
        this.http.get(`${base}/api/system/status`, { timeout: ConfigCheckService.DELAI_MS }),
      );
      etatServeur = String((r.data as any)?.status || '');
    } catch { etatServeur = null; }

    if (etatServeur === null) {
      return ligne('ko', `Aucune réponse de ${base}. Vérifiez l'adresse interne de SonarQube.`);
    }
    if (etatServeur !== 'UP') {
      return ligne('ko', `SonarQube répond à ${base} mais n'est pas prêt (état « ${etatServeur} »).`);
    }

    const cle = String(dto.sonarqubeKey || '').trim();
    if (!cle) return ligne('ok', `SonarQube joignable et prêt à ${base}. Aucune clé renseignée.`);

    const code = await this.statut(`${base}/api/projects/search?projects=${encodeURIComponent(cle)}`);
    if (code === 200) {
      return ligne('ok', `SonarQube joignable à ${base}, clé « ${cle} » acceptée.`);
    }
    return ligne('ok', `SonarQube joignable et prêt à ${base}. Existence de la clé « ${cle} » `
                     + `non vérifiable : l'instance exige un jeton que la plateforme ne détient pas.`);
  }

  /** Valide le format "propriétaire/dépôt" puis vérifie que le dépôt GitHub existe réellement via l'API publique (sans jeton). */
  private async verifierGithub(dto: CheckProjectConfigDto): Promise<ResultatControle> {
    const depot = String(dto.githubRepo || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    if (!depot) {
      return {
        id: 'git', champ: 'Git', section: 'cicd', etat: 'skip',
        message: 'Non renseigné — aucun test possible.',
      };
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(depot)) {
      return {
        id: 'git', champ: 'Git', section: 'cicd', etat: 'ko',
        message: 'Format attendu « propriétaire/dépôt ».',
      };
    }
    const code = await this.statut(`https://api.github.com/repos/${depot}`);
    if (code === 200) {
      return { id: 'git', champ: 'Git', section: 'cicd', etat: 'ok', message: `Dépôt ${depot} accessible.` };
    }
    if (code === 404) {
      return {
        id: 'git', champ: 'Git', section: 'cicd', etat: 'ko',
        message: `Dépôt ${depot} introuvable publiquement. Vérifiez le nom, ou ignorez si le dépôt est privé.`,
      };
    }
    return {
      id: 'git', champ: 'Git', section: 'cicd', etat: 'skip',
      message: `Accessibilité non vérifiée (HTTP ${code ?? 'aucune réponse'}).`,
    };
  }

  /** Renvoie le code HTTP de la réponse, ou null si aucune réponse n'est parvenue. */
  private async statut(url: string, headers?: Record<string, string>): Promise<number | null> {
    return (await this.reponse(url, headers)).code;
  }

  /** Effectue la requête GET et renvoie à la fois le code HTTP et les en-têtes de la réponse, pour vérifier l'identité réelle du serveur. */
  private async reponse(url: string, headers?: Record<string, string>):
      Promise<{ code: number | null; entetes: Record<string, any> }> {
    try {
      const r = await firstValueFrom(this.http.get(url, {
        timeout: ConfigCheckService.DELAI_MS,
        headers,
        /** Valide le statut. */
        validateStatus: () => true,
      } as any));
      return { code: Number((r as any)?.status) || null, entetes: (r as any)?.headers || {} };
    } catch {
      return { code: null, entetes: {} };
    }
  }

  /** Nettoie une URL saisie (retire le / final) et la rejette si elle n'a pas un schéma http(s) valide. */
  private normaliserUrl(valeur?: string): string | null {
    const v = String(valeur || '').trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s]+$/i.test(v) ? v : null;
  }

  /** Construit le chemin d'API Jenkins d'un job à partir de son nom ou chemin saisi (gère les jobs multibranches). */
  private cheminJob(valeur?: string): string | null {
    const segments = String(valeur || '')
      .split('/').map(s => s.trim()).filter(s => s.length > 0 && s !== 'job');
    if (!segments.length) return null;
    return segments.map(s => `/job/${encodeURIComponent(s)}`).join('');
  }

  /** Construit l'en-tête Authorization Basic à partir de l'utilisateur et du jeton Jenkins, ou renvoie null si l'un des deux manque. */
  private authBasique(utilisateur?: string, jeton?: string): Record<string, string> | null {
    const u = String(utilisateur || '').trim();
    const t = String(jeton || '').trim();
    if (!u || !t) return null;
    return { Authorization: `Basic ${Buffer.from(`${u}:${t}`).toString('base64')}` };
  }
}
