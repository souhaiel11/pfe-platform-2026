"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertOptimizerInput = assertOptimizerInput;
exports.readOptimizerRejection = readOptimizerRejection;
// Vérifie les entrées et les refus immédiats de l’analyse WF4.
const common_1 = require("@nestjs/common");
/** Applique la même limite que le nœud d’entrée de WF4. */
function assertOptimizerInput(jenkinsfile) {
    if (jenkinsfile.trim().length > 60_000) {
        throw new common_1.BadRequestException('Jenkinsfile trop volumineux pour cette analyse : limite de 60 000 caractères.');
    }
}
/** Lit un refus immédiat ; le résultat normal arrive par callback. */
async function readOptimizerRejection(response) {
    if (!response.ok)
        return `Le workflow d’analyse a refusé la demande (HTTP ${response.status}).`;
    const data = await response.json();
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.success !== false)
        return null;
    if (result.error === 'TOO_LARGE')
        return 'Jenkinsfile trop volumineux pour cette analyse : limite de 60 000 caractères.';
    return typeof result.message === 'string' && result.message.trim()
        ? result.message : 'Le workflow a refusé les données de cette analyse.';
}
