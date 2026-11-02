// Définit les types et contrats de construction détail.

export interface BuildStage {
  id: string | null;
  name: string;
  status: string | null;
  startedAt: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface BuildCheckout {
  repo: string | null;
  sha: string | null;
  shortSha: string | null;
  branch: string | null;
  primary: boolean;
}

export interface BuildChange {
  sha: string | null;
  shortSha: string | null;
  author: string | null;
  message: string | null;
  date: string | null;
  affectedPaths: string[];
}

export interface BuildTests {
  total: number | null;
  failed: number | null;
  skipped: number | null;
  passed: number | null;
}

export interface BuildNeighbour {
  number: number;
  result: string | null;
  building: boolean;
  timestamp: number | null;
}

export interface BuildDetail {
  available: boolean;
  reason: string | null;
  message: string | null;
  jobName: string | null;
  number: number | null;
  displayName: string | null;
  description: string | null;
  status: string | null;
  result: string | null;
  building: boolean;
  startedAt: number | null;
  durationMs: number | null;
  estimatedDurationMs: number | null;
  queueDurationMs: number | null;
  queueId: number | null;
  url: string | null;
  trigger: { description: string | null; userName: string | null; type: string | null } | null;
  commit: BuildCheckout | null;
  commitReason: string | null;
  checkouts: BuildCheckout[];
  changes: BuildChange[];
  parameters: { name: string; value: string; masked: boolean }[];
  stages: BuildStage[];
  stagesReason: string | null;
  tests: BuildTests | null;
  artifacts: { fileName: string | null; relativePath: string | null }[];
  previousBuildNumber: number | null;
  nextBuildNumber: number | null;
  neighbours: BuildNeighbour[];
}

export interface BuildConsole {
  available: boolean;
  reason: string | null;
  message: string | null;
  jobName: string | null;
  number: number | null;
  tail: number;
  lines: string[];
  truncated: boolean;
  totalLines: number | null;
}

export const BUILD_DETAIL_REASONS: Record<string, string> = {
  JENKINS_NOT_CONFIGURED: 'Jenkins n’est pas configuré pour ce projet : aucun job n’est associé.',
  JENKINS_UNAUTHORIZED: 'Jenkins refuse l’accès : ce projet n’a pas d’identifiant ou de jeton valide.',
  JENKINS_UNREACHABLE: 'Jenkins est injoignable depuis la plateforme.',
  BUILD_NOT_FOUND: 'Ce build n’existe pas (ou plus) dans Jenkins.',
};

export const BUILD_COMMIT_REASONS: Record<string, string> = {
  NO_GIT_CHECKOUT_RECORDED: 'Ce build n’a enregistré aucun checkout git.',
  PROJECT_REPO_NOT_MATCHED:
    'Aucun checkout ne correspond au dépôt du projet : le commit construit ne peut pas être désigné sans risque d’erreur.',
  AMBIGUOUS_PROJECT_CHECKOUT:
    'Plusieurs checkouts du même dépôt : la plateforme n’en élit aucun plutôt que d’en désigner un au hasard.',
};

export const BUILD_STAGES_REASONS: Record<string, string> = {
  STAGE_VIEW_UNAVAILABLE:
    'Jenkins n’expose pas le découpage en étapes pour ce build (vue Stage View absente ou job non-pipeline).',
  NO_STAGE_RECORDED: 'Aucune étape n’a été enregistrée pour ce build.',
};
