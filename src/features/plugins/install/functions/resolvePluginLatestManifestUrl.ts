export interface ResolvePluginLatestManifestUrlOptions {
  readonly pluginId: string;
  readonly defaultRootUrl?: string;
}

const defaultPluginDownloadRootUrl = 'https://download.linnyai.com/plugins';

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

  assertRemotePluginIdPathSegment(pluginId);
  const rootUrl = options.defaultRootUrl ?? defaultPluginDownloadRootUrl;
  return `${rootUrl.replace(/\/+$/u, '')}/${pluginId}/latest.json`;
}
