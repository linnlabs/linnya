export interface ResolvePluginLatestManifestUrlOptions {
  readonly pluginId: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly defaultRootUrl?: string;
}

const defaultPluginDownloadRootUrl = 'https://download.linnyai.com/plugins';

function buildPluginEnvSuffix(pluginId: string): string {
  return pluginId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function assertRemotePluginIdPathSegment(pluginId: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(pluginId)) {
    throw new Error(`插件 ID 不能用于官方远程下载路径: ${pluginId}`);
  }
}

export function resolvePluginLatestManifestUrl(
  options: ResolvePluginLatestManifestUrlOptions,
): string {
  const pluginId = options.pluginId.trim();
  if (!pluginId) {
    throw new Error('插件 ID 不能为空');
  }

  const env = options.env ?? process.env;
  const envSuffix = buildPluginEnvSuffix(pluginId);
  const specificEnvUrl = env[`LINNYA_PLUGIN_${envSuffix}_LATEST_URL`];
  if (specificEnvUrl) {
    return specificEnvUrl;
  }

  assertRemotePluginIdPathSegment(pluginId);
  const rootUrl = env.LINNYA_PLUGIN_DOWNLOAD_ROOT_URL ?? options.defaultRootUrl ?? defaultPluginDownloadRootUrl;
  return `${rootUrl.replace(/\/+$/u, '')}/${pluginId}/latest.json`;
}
