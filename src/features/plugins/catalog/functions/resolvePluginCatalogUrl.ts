import type { PluginCatalogChannel } from '@app/schemas';

/** 官方插件分发根（用户 2026-11-22 定：统一迁到 download.linnya.com/plugins）。 */
export const OFFICIAL_PLUGIN_DISTRIBUTION_ROOT_URL = 'https://download.linnya.com/plugins';

/** 签名 catalog 是移动指针：`<root>/catalog/<channel>.json`；artifact 地址由 catalog 条目锁定。 */
export function resolvePluginCatalogUrl(channel: PluginCatalogChannel, rootUrl = OFFICIAL_PLUGIN_DISTRIBUTION_ROOT_URL): string {
  return `${rootUrl.replace(/\/+$/u, '')}/catalog/${channel}.json`;
}
