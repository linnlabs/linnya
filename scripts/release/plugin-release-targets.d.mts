export interface OfficialPluginReleaseTarget {
  readonly id: string;
  readonly packageDir: string;
  readonly defaultR2Prefix: string;
  readonly defaultDownloadBaseUrl: string;
  readonly productionDistDirectories: readonly string[];
  readonly artifactVerification?: {
    readonly requiredFiles?: readonly {
      readonly path: string;
      readonly label: string;
    }[];
    readonly requiredPrefixes?: readonly {
      readonly path: string;
      readonly label: string;
    }[];
    readonly browserRuntimeDirectories?: readonly string[];
    readonly minimumMatchingFiles?: readonly {
      readonly pattern: string;
      readonly minimum: number;
      readonly label: string;
    }[];
  };
}

export const repoRoot: string;
export const officialPluginReleaseTargets: readonly OfficialPluginReleaseTarget[];
export function discoverWorkspaceOfficialPluginReleaseTargets(
  repoRoot?: string,
): OfficialPluginReleaseTarget[];

export function buildPluginEnvSuffix(pluginId: string): string;
export function listOfficialPluginReleaseTargetIds(): string[];
export function findOfficialPluginReleaseTarget(pluginId: string): OfficialPluginReleaseTarget | null;
export function resolvePluginProductionDistDirectories(
  pluginId: string,
  entry: Readonly<Record<string, unknown>>,
): string[];
export function readPluginIdsFromCliOrEnv(options?: {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly defaultIds?: readonly string[];
}): string[];
export function readSinglePluginIdFromCli(options?: {
  readonly scriptName?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}): string;
export function resolvePluginPackageDir(
  pluginId: string,
  env?: Readonly<Record<string, string | undefined>>,
): string;
export function resolvePluginR2Prefix(
  pluginId: string,
  env?: Readonly<Record<string, string | undefined>>,
): string;
export function resolvePluginDownloadBaseUrl(
  pluginId: string,
  env?: Readonly<Record<string, string | undefined>>,
): string;
