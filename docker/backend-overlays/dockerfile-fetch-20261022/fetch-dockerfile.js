"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDockerfile = fetchDockerfile;
// Distingue un fichier absent d’un service lent ou inaccessible.
async function fetchDockerfile(webhook, input, transport = fetch) {
    const failure = (code, message, statusCode) => ({ success: false, code, message, statusCode });
    try {
        const response = await transport(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, ref: input.ref || 'main' }), signal: AbortSignal.timeout(185_000) });
        if (!response.ok)
            return failure('DOCKERFILE_WORKFLOW_UNAVAILABLE', 'Le service de récupération du Dockerfile est indisponible. Réessayez.', 502);
        const data = await response.json();
        const result = Array.isArray(data) ? data[0] : data;
        if (result?.success === true && typeof result.content === 'string' && result.content.trim())
            return result;
        const error = JSON.stringify(result?.error || '');
        if (/timeout|timed?\s*out|ECONN|ENOTFOUND|EAI_AGAIN|connection|socket|offline/i.test(error))
            return failure('DOCKERFILE_GIT_UNREACHABLE', 'La connexion à GitHub a échoué pendant la récupération du Dockerfile. Réessayez.', 502);
        if (result?.success === false)
            return failure('DOCKERFILE_NOT_FOUND', 'Dockerfile inaccessible. Vérifiez le dépôt, la branche, le chemin et les droits GitHub.', 404);
        return failure('DOCKERFILE_INVALID_RESPONSE', 'Le service de récupération n’a pas renvoyé de Dockerfile exploitable.', 502);
    }
    catch (error) {
        if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
            return failure('DOCKERFILE_FETCH_TIMEOUT', 'La récupération du Dockerfile a dépassé le délai prévu. Vérifiez la connexion du serveur puis réessayez.', 504);
        return failure('DOCKERFILE_GIT_UNREACHABLE', 'Le serveur ne parvient pas à joindre le service de récupération du Dockerfile. Réessayez.', 502);
    }
}
