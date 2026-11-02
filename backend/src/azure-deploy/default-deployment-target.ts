// Dérive une cible de déploiement Azure par défaut (azureConfig) pour un projet qui n'en a pas encore, à partir des seuls défauts de plateforme configurés.
import { AzureDeploymentConfig } from '../projects/project.entity';

/** Défauts de déploiement au niveau plateforme, lus depuis l'environnement. */
export interface PlatformDeploymentDefaults {
  resourceGroup?: string | null;
  registry?: string | null;
  region?: string | null;
  cpu?: string | null;
  memoryInGb?: string | null;
  ports?: string[] | null;
}

export type DerivationFailureCode =
  | 'PLATFORM_DEFAULTS_NOT_CONFIGURED'
  | 'PROJECT_NAME_NOT_DERIVABLE'
  | 'DEPLOYMENT_TARGET_ALREADY_TAKEN';

export type DeploymentTargetDerivation =
  | { ok: true; azureConfig: AzureDeploymentConfig; slug: string }
  | { ok: false; failureCode: DerivationFailureCode; reason: string };

const REPOSITORY_RE = /^[a-z0-9][a-z0-9._/-]{0,254}$/;
const TARGET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/;
const TARGET_NAME_PREFIX = 'aci-';
const TARGET_NAME_MAX = 63;

/** Convertit un nom de projet en slug déterministe utilisable comme dépôt ACR et suffixe de nom d'ACI ; renvoie null si rien d'exploitable ne subsiste. */
export function deriveDeploymentSlug(projectName: unknown): string | null {
  const raw = String(projectName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return null;
  const bounded = slug.slice(0, TARGET_NAME_MAX - TARGET_NAME_PREFIX.length).replace(/-+$/, '');
  if (!bounded || !/^[a-z0-9]/.test(bounded)) return null;
  return bounded;
}

/** Préfixe le slug du projet pour obtenir le nom de ressource ACI (`aci-<slug>`). */
export function deploymentTargetNameFor(slug: string): string {
  return `${TARGET_NAME_PREFIX}${slug}`;
}

/** Lit les défauts de déploiement de plateforme depuis les variables d'environnement, sans jamais inventer une valeur absente. */
export function readPlatformDeploymentDefaults(
  env: Record<string, string | undefined> = process.env,
): PlatformDeploymentDefaults {
  /** Retire les espaces autour de la valeur fournie. */
  const trimmed = (value: string | undefined) => {
    const out = String(value ?? '').trim();
    return out ? out : null;
  };
  const ports = trimmed(env.AZURE_DEFAULT_PORTS);
  return {
    resourceGroup: trimmed(env.AZURE_DEFAULT_RESOURCE_GROUP),
    registry: trimmed(env.AZURE_DEFAULT_REGISTRY),
    region: trimmed(env.AZURE_DEFAULT_REGION),
    cpu: trimmed(env.AZURE_DEFAULT_CPU),
    memoryInGb: trimmed(env.AZURE_DEFAULT_MEMORY_GB),
    ports: ports ? ports.split(',').map(p => p.trim()).filter(Boolean) : null,
  };
}

/** Entrée de la dérivation : nom du projet, défauts de plateforme, et cibles/dépôts déjà attribués à d'autres projets. */
export interface DeriveDefaultTargetInput {
  projectName: unknown;
  defaults: PlatformDeploymentDefaults;
  takenTargetNames?: Iterable<string>;
  takenRepositories?: Iterable<string>;
}

/** Dérive l'azureConfig complet d'un projet sans cible existante, en échouant avec une raison explicite dès que la réponse correcte n'est pas déductible. */
export function buildDefaultAzureConfig(input: DeriveDefaultTargetInput): DeploymentTargetDerivation {
  const { defaults } = input;
  const resourceGroup = (defaults.resourceGroup ?? '').trim();
  const registry = (defaults.registry ?? '').trim();
  if (!resourceGroup || !registry) {
    return {
      ok: false,
      failureCode: 'PLATFORM_DEFAULTS_NOT_CONFIGURED',
      reason:
        'AZURE_DEFAULT_RESOURCE_GROUP et AZURE_DEFAULT_REGISTRY ne sont pas configurés — ' +
        'aucun registre n’est choisi à la place du projet.',
    };
  }

  const slug = deriveDeploymentSlug(input.projectName);
  if (!slug) {
    return {
      ok: false,
      failureCode: 'PROJECT_NAME_NOT_DERIVABLE',
      reason:
        `Le nom de projet ${JSON.stringify(String(input.projectName ?? ''))} ne donne aucun identifiant ` +
        'utilisable comme dépôt ACR ou nom de conteneur.',
    };
  }

  const targetName = deploymentTargetNameFor(slug);
  if (!REPOSITORY_RE.test(slug) || !TARGET_NAME_RE.test(targetName) || targetName.length > TARGET_NAME_MAX) {
    return {
      ok: false,
      failureCode: 'PROJECT_NAME_NOT_DERIVABLE',
      reason: `La cible dérivée (${targetName}) ne respecte pas les charsets ACR/ACI.`,
    };
  }

  const taken = new Set([...(input.takenTargetNames ?? [])].map(v => String(v).toLowerCase()));
  const takenRepos = new Set([...(input.takenRepositories ?? [])].map(v => String(v).toLowerCase()));
  if (taken.has(targetName.toLowerCase()) || takenRepos.has(slug)) {
    return {
      ok: false,
      failureCode: 'DEPLOYMENT_TARGET_ALREADY_TAKEN',
      reason:
        `La cible ${targetName} (dépôt ${slug}) appartient déjà à un autre projet — ` +
        'deux projets ne peuvent pas partager un conteneur ni un dépôt d’images.',
    };
  }

  const azureConfig: AzureDeploymentConfig = {
    provider: 'azure-container-instances',
    resourceGroup,
    targetName,
    registry,
    imageRepository: slug,
    ...(defaults.region ? { region: defaults.region } : {}),
    ...(defaults.cpu ? { cpu: defaults.cpu } : {}),
    ...(defaults.memoryInGb ? { memoryInGb: defaults.memoryInGb } : {}),
    ...(defaults.ports && defaults.ports.length ? { ports: defaults.ports } : {}),
  };
  return { ok: true, azureConfig, slug };
}
