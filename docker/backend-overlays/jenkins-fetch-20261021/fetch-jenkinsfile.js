"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchJenkinsfile = fetchJenkinsfile;
// Récupère le Jenkinsfile via WF4 et traduit les échecs de connexion.
const common_1 = require("@nestjs/common");
/** Attend une réponse complète du workflow dans le délai prévu. */
async function fetchJenkinsfile(webhook, body, transport = fetch, 
// WF4 peut attendre GitHub 180 s ; nginx autorise 200 s.
timeoutMs = 185_000) {
    const fail = (code, message, status) => {
        throw new common_1.HttpException({ code, message }, status);
    };
    try {
        const response = await transport(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: body.owner, repo: body.repo, filePath: body.filePath || 'Jenkinsfile', ref: body.ref || 'main' }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            fail('JENKINSFILE_WORKFLOW_UNAVAILABLE', 'Le service de récupération du Jenkinsfile est indisponible. Réessayez dans quelques instants.', common_1.HttpStatus.BAD_GATEWAY);
        }
        const data = await response.json();
        const result = Array.isArray(data) ? data[0] : data;
        if (result?.success !== true) {
            const error = typeof result?.error === 'string' ? result.error : JSON.stringify(result?.error || '');
            if (/timeout|timed?\s*out|ECONN|ENOTFOUND|EAI_AGAIN|connection|socket|offline/i.test(error)) {
                fail('JENKINSFILE_GIT_UNREACHABLE', 'La connexion à GitHub a échoué. Vérifiez la connexion Internet du serveur puis réessayez.', common_1.HttpStatus.BAD_GATEWAY);
            }
            if (!result || typeof result !== 'object' || result.success !== false) {
                fail('JENKINSFILE_INVALID_RESPONSE', 'Le service de récupération a renvoyé une réponse invalide. Réessayez.', common_1.HttpStatus.BAD_GATEWAY);
            }
            fail('JENKINSFILE_NOT_FOUND', 'Jenkinsfile inaccessible. Vérifiez le dépôt, la branche, le chemin du fichier et les droits GitHub.', common_1.HttpStatus.NOT_FOUND);
        }
        if (typeof result.jenkinsfile !== 'string' || !result.jenkinsfile.trim()) {
            fail('JENKINSFILE_INVALID_RESPONSE', 'Le service de récupération n’a renvoyé aucun Jenkinsfile exploitable.', common_1.HttpStatus.BAD_GATEWAY);
        }
        return result;
    }
    catch (error) {
        if (error instanceof common_1.HttpException)
            throw error;
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
            fail('JENKINSFILE_FETCH_TIMEOUT', 'La récupération du Jenkinsfile depuis GitHub a dépassé le délai prévu. Vérifiez la connexion Internet du serveur puis réessayez.', common_1.HttpStatus.GATEWAY_TIMEOUT);
        }
        fail('JENKINSFILE_GIT_UNREACHABLE', 'Impossible de récupérer le Jenkinsfile. Vérifiez la connexion du serveur à n8n et à GitHub puis réessayez.', common_1.HttpStatus.BAD_GATEWAY);
    }
}
